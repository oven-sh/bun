//! Resolves the paths an archive or a URL names without leaving a directory, whatever symlinks are on disk.

use bun_core::{ZStr, strings};
use bun_paths::path_buffer_pool;

use crate::{CloseOnDrop, E, Error, Fd, Maybe, Mode, O, Tag};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Symlinks {
    /// No constraint and no cost, for a `dir` that holds no symlink.
    Follow,
    /// Followed while relative and in `dir`.
    FollowInside,
    /// Followed as if `dir` were `/`, which is also its own parent.
    FollowAsRoot,
    Refuse,
}

/// Enough to look names up in a directory that its archive made unreadable.
#[cfg(any(target_os = "linux", target_os = "android"))]
const SEARCH: i32 = O::PATH | O::DIRECTORY;
#[cfg(not(any(target_os = "linux", target_os = "android")))]
const SEARCH: i32 = libc::O_SEARCH | O::DIRECTORY;

// <sys/fcntl.h> and <sys/errno.h> of the macOS 26 SDK.
#[cfg(target_os = "macos")]
const O_RESOLVE_BENEATH: i32 = 0x0000_1000;
#[cfg(target_os = "macos")]
const ENOTCAPABLE: i32 = 107;
#[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
use libc::{ENOTCAPABLE, O_RESOLVE_BENEATH};

/// As many as the kernel follows for one path.
const SYMLINKS_LIMIT: u32 = if cfg!(any(target_os = "linux", target_os = "android")) {
    40
} else {
    32
};

/// A `path` that would leave `dir` is `EXDEV`, and a symlink that is not followed `ELOOP` or `ENOTDIR`.
pub fn openat(dir: Fd, path: &ZStr, flags: i32, mode: Mode, symlinks: Symlinks) -> Maybe<Fd> {
    if symlinks == Symlinks::Follow {
        return crate::openat(dir, path, flags, mode);
    }
    refuse_absolute_and_dot_dot(path.as_bytes(), Tag::open)?;
    match openat_by_kernel(dir, path, flags, mode, symlinks) {
        Some(Err(err)) if err.get_errno() == E::EAGAIN => {}
        // `O_RESOLVE_BENEATH` opens what `RESOLVE_IN_ROOT` would, except where it refuses to leave `dir`.
        Some(Err(err)) if symlinks == Symlinks::FollowAsRoot && err.get_errno() == E::EXDEV => {}
        Some(result) => return result,
        None => {}
    }
    match open_without_symlinks(dir, path, flags, mode) {
        Err(err)
            if symlinks != Symlinks::Refuse
                && matches!(err.get_errno(), E::ELOOP | E::ENOTDIR | E::EMLINK) => {}
        result => return result,
    }
    let resolved = resolve_symlinks(dir, path, flags, symlinks)?;
    open_without_symlinks(dir, ZStr::from_slice_with_nul(&resolved), flags, mode)
        .map_err(|e| e.with_path(path.as_bytes()))
}

fn open_without_symlinks(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
    #[cfg(target_os = "macos")]
    return crate::openat(dir, path, flags | O::NOFOLLOW_ANY, mode);
    #[cfg(not(target_os = "macos"))]
    open_component_by_component(dir, path, flags, mode)
}

/// `None` where the kernel cannot do this.
fn openat_by_kernel(
    dir: Fd,
    path: &ZStr,
    flags: i32,
    mode: Mode,
    symlinks: Symlinks,
) -> Option<Maybe<Fd>> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        use crate::linux_syscall::ResolveFlags;
        let resolve = ResolveFlags::NO_MAGICLINKS
            | match symlinks {
                Symlinks::FollowAsRoot => ResolveFlags::IN_ROOT,
                Symlinks::Refuse => ResolveFlags::BENEATH | ResolveFlags::NO_SYMLINKS,
                _ => ResolveFlags::BENEATH,
            };
        let result = crate::openat2_if_available(dir, path, flags, mode, resolve)?;
        Some(result.map_err(|e| Error::from_code_int(e, Tag::open).with_path(path.as_bytes())))
    }
    #[cfg(target_os = "macos")]
    {
        let resolve = match (kernel_resolves_beneath(dir), symlinks) {
            (Err(err), _) => return Some(Err(err)),
            (Ok(false), _) => return None,
            (Ok(true), Symlinks::Refuse) => O_RESOLVE_BENEATH | O::NOFOLLOW_ANY,
            (Ok(true), _) => O_RESOLVE_BENEATH,
        };
        Some(crate::openat(dir, path, flags | resolve, mode).map_err(not_capable_is_exdev))
    }
    #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
    {
        if symlinks == Symlinks::Refuse || !kernel_may_resolve() {
            return None;
        }
        Some(
            crate::openat(dir, path, flags | O_RESOLVE_BENEATH, mode).map_err(not_capable_is_exdev),
        )
    }
}

pub fn mkdirat(dir: Fd, path: &[u8], mode: Mode, symlinks: Symlinks) -> Maybe<()> {
    in_parent(dir, path, symlinks, Tag::mkdir, |parent, name| {
        crate::mkdirat(parent, name, mode)
    })
}

fn symlinkat(target: &ZStr, dir: Fd, path: &[u8], symlinks: Symlinks) -> Maybe<()> {
    in_parent(dir, path, symlinks, Tag::symlinkat, |parent, name| {
        // No kernel makes `a/l` of `a/l/`, and a caller that checked the target took the link to be in `a/l`.
        if path.last() == Some(&b'/') {
            return Err(Error::from_code(E::ENOENT, Tag::symlinkat).with_path(path));
        }
        crate::symlinkat(target, parent, name)
    })
}

/// Follows the symlinks that lead to `path` while they stay in `dir`, and then asks `is_safe` about the path without them, which is where the new one will be.
pub fn symlinkat_where_safe(
    target: &ZStr,
    dir: Fd,
    path: &[u8],
    is_safe: impl FnOnce(&[u8]) -> bool,
) -> Maybe<()> {
    let result = symlinkat(target, dir, path, Symlinks::Refuse);
    let (Err(err), Some(slash)) = (&result, strings::last_index_of_char(path, b'/')) else {
        return result;
    };
    if !matches!(err.get_errno(), E::ELOOP | E::ENOTDIR | E::EMLINK) {
        return result;
    }
    let mut buf = path_buffer_pool::get();
    let parent = z(&path[..slash], &mut buf.0, Tag::symlinkat)?;
    let mut resolved = resolve_symlinks(dir, parent, 0, Symlinks::FollowInside)?;
    resolved.pop();
    resolved.extend_from_slice(&path[slash..]);
    if !is_safe(&resolved) {
        return Err(Error::from_code(E::EXDEV, Tag::symlinkat).with_path(path));
    }
    symlinkat(target, dir, &resolved, Symlinks::Refuse).map_err(|e| e.with_path(path))
}

pub fn unlinkat(dir: Fd, path: &[u8], symlinks: Symlinks) -> Maybe<()> {
    in_parent(dir, path, symlinks, Tag::unlink, crate::unlinkat)
}

/// `mkdir -p`
pub fn make_path(dir: Fd, path: &[u8], symlinks: Symlinks) -> Maybe<()> {
    crate::mkdir_recursive_with(path, |prefix| mkdirat(dir, prefix, 0o755, symlinks))
}

/// No flag constrains how `f` resolves a path, and macOS follows a name that ends in `/`.
fn in_parent<T>(
    dir: Fd,
    path: &[u8],
    symlinks: Symlinks,
    tag: Tag,
    f: impl FnOnce(Fd, &ZStr) -> Maybe<T>,
) -> Maybe<T> {
    let mut buf = path_buffer_pool::get();
    if symlinks == Symlinks::Follow {
        return f(dir, z(path, &mut buf.0, tag)?);
    }
    refuse_absolute_and_dot_dot(path, tag)?;
    let path = strings::trim_right(path, b"/");
    let Some(slash) = strings::last_index_of_char(path, b'/') else {
        return f(dir, z(path, &mut buf.0, tag)?);
    };
    let parent = z(&path[..slash], &mut buf.0, tag)?;
    let parent = openat(dir, parent, SEARCH, 0, symlinks)?;
    let _close = CloseOnDrop::new(parent);
    f(parent, z(&path[slash + 1..], &mut buf.0, tag)?).map_err(|e| e.with_path(path))
}

/// `O_NOFOLLOW` covers only the last component, so each one is opened by a call of its own.
#[cfg(not(target_os = "macos"))]
fn open_component_by_component(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
    let with_path = |e: Error| e.with_path(path.as_bytes());
    let mut names = strings::split(path.as_bytes(), b"/")
        .filter(|name| !name.is_empty())
        .peekable();
    let mut current = dir;
    let mut _close = None;
    while let Some(name) = names.next() {
        if names.peek().is_none() {
            // `names` drops a last `/`, which the kernel takes to name a directory.
            let flags = match path.as_bytes().last() {
                Some(b'/') if flags & O::CREAT != 0 => {
                    return Err(with_path(Error::from_code(E::EISDIR, Tag::open)));
                }
                Some(b'/') => flags | O::DIRECTORY,
                _ => flags,
            };
            return crate::openat_a(current, name, flags | O::NOFOLLOW, mode).map_err(with_path);
        }
        current = crate::openat_a(current, name, SEARCH | O::NOFOLLOW, 0).map_err(with_path)?;
        _close = Some(CloseOnDrop::new(current));
    }
    Err(with_path(Error::from_code(E::ENOENT, Tag::open)))
}

/// `path` without its symlinks and with a NUL. Only what refuses symlinks may use it: the disk can change after this has read it.
fn resolve_symlinks(dir: Fd, path: &ZStr, flags: i32, symlinks: Symlinks) -> Maybe<Vec<u8>> {
    fn read_link(dir: Fd, path: &mut Vec<u8>, target: &mut [u8]) -> Maybe<usize> {
        path.push(0);
        let result = crate::readlinkat(dir, ZStr::from_slice_with_nul(path), target);
        path.pop();
        result
    }
    let with_path = |e: Error| e.with_path(path.as_bytes());
    let fail = |e: E| Err(with_path(Error::from_code(e, Tag::open)));
    let exclusive = flags & (O::CREAT | O::EXCL) == O::CREAT | O::EXCL;
    let mut target_buf = path_buffer_pool::get();
    let mut resolved: Vec<u8> = Vec::with_capacity(path.len() + 3);
    let mut tail: &[u8] = b"";
    let mut spliced: Vec<u8>;
    let mut rest = path.as_bytes();
    let mut followed = 0;
    loop {
        rest = strings::trim_left(rest, b"/");
        let (name, after) =
            rest.split_at(strings::index_of_char_usize(rest, b'/').unwrap_or(rest.len()));
        let parent = resolved.len();
        if name.is_empty() {
            break;
        }
        if matches!(name, b"." | b"..") {
            // The kernel looks these up in a directory, and `EINVAL` says that `x/.` is one.
            if !resolved.is_empty() {
                resolved.extend_from_slice(b"/.");
                let looked_up = read_link(dir, &mut resolved, &mut target_buf.0);
                resolved.truncate(parent);
                match looked_up {
                    Err(err) if err.get_errno() != E::EINVAL => return Err(with_path(err)),
                    _ => {}
                }
            }
            // Only the target of a symlink has one.
            if name == b".." {
                if resolved.is_empty() && symlinks != Symlinks::FollowAsRoot {
                    return fail(E::EXDEV);
                }
                resolved.truncate(strings::last_index_of_char(&resolved, b'/').unwrap_or(0));
            }
            tail = b"/.";
            rest = after;
            continue;
        }
        if !resolved.is_empty() {
            resolved.push(b'/');
        }
        resolved.extend_from_slice(name);
        let last = strings::trim_left(after, b"/").is_empty();
        let len = match read_link(dir, &mut resolved, &mut target_buf.0) {
            // `O_EXCL` is about the symlink itself.
            Ok(len) if !(last && exclusive) => len,
            Err(err) if err.get_errno() != E::EINVAL && !(last && err.get_errno() == E::ENOENT) => {
                return Err(with_path(err));
            }
            _ => {
                tail = if after.is_empty() { b"" } else { b"/" };
                rest = after;
                continue;
            }
        };
        resolved.truncate(parent);
        followed += 1;
        match target_buf.0[..len].first() {
            _ if followed > SYMLINKS_LIMIT => return fail(E::ELOOP),
            None => return fail(E::ENOENT),
            Some(b'/') if symlinks == Symlinks::FollowAsRoot => resolved.clear(),
            Some(b'/') => return fail(E::EXDEV),
            Some(_) => {}
        }
        let mut next = Vec::with_capacity(len + after.len());
        next.extend_from_slice(&target_buf.0[..len]);
        next.extend_from_slice(after);
        spliced = next;
        rest = &spliced;
    }
    if resolved.is_empty() {
        resolved.push(b'.');
    } else {
        resolved.extend_from_slice(tail);
    }
    resolved.push(0);
    Ok(resolved)
}

fn refuse_absolute_and_dot_dot(path: &[u8], tag: Tag) -> Maybe<()> {
    if path.first() == Some(&b'/')
        || (strings::contains(path, b"..") && strings::split(path, b"/").any(|name| name == b".."))
    {
        return Err(Error::from_code(E::EXDEV, tag).with_path(path));
    }
    Ok(())
}

fn z<'a>(path: &[u8], buf: &'a mut [u8], tag: Tag) -> Maybe<&'a ZStr> {
    if path.len() >= buf.len() {
        return Err(Error::from_code(E::ENAMETOOLONG, tag).with_path(path));
    }
    buf[..path.len()].copy_from_slice(path);
    buf[path.len()] = 0;
    Ok(ZStr::from_buf(buf, path.len()))
}

#[cfg(not(any(target_os = "linux", target_os = "android")))]
fn kernel_may_resolve() -> bool {
    !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_RESOLVE_BENEATH
        .get()
        .unwrap_or(false)
}

/// Refusing to leave `dir` the way macOS 26 does. 15.4 documents other semantics, and older kernels ignore the flag.
#[cfg(target_os = "macos")]
fn kernel_resolves_beneath(dir: Fd) -> Maybe<bool> {
    static CACHED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if let Some(known) = CACHED.get() {
        return Ok(*known);
    }
    let leave = || crate::openat(dir, bun_core::zstr!(".."), SEARCH | O_RESOLVE_BENEATH, 0);
    let known = kernel_may_resolve()
        && match leave() {
            Ok(fd) => {
                let _ = crate::close(fd);
                false
            }
            Err(err) => match i32::from(err.errno) {
                ENOTCAPABLE => true,
                // These say nothing about the flag, so they are not remembered.
                libc::EMFILE
                | libc::ENFILE
                | libc::ENOMEM
                | libc::EBADF
                | libc::ENOTDIR
                | libc::EIO
                | libc::ESTALE
                | libc::ETIMEDOUT => {
                    return Err(err);
                }
                _ => false,
            },
        };
    Ok(*CACHED.get_or_init(|| known))
}

#[cfg(not(any(target_os = "linux", target_os = "android")))]
fn not_capable_is_exdev(mut err: Error) -> Error {
    if i32::from(err.errno) == ENOTCAPABLE {
        err.errno = E::EXDEV as _;
    }
    err
}
