//! Resolves the paths an archive or a URL names without leaving a directory, whatever symlinks are on disk.

use bun_core::{ZStr, strings};
use bun_paths::path_buffer_pool;

use crate::{CloseOnDrop, E, Error, Fd, Maybe, Mode, O, Tag};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Symlinks {
    /// No constraint and no cost, for a `dir` that holds no symlink.
    Follow,
    /// Followed while relative and in `dir`, by `openat2` or `O_RESOLVE_BENEATH`. Refused without those.
    FollowInside,
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

#[cfg(any(target_os = "linux", target_os = "android"))]
const EAGAIN_ATTEMPTS: u32 = 4;

/// A `path` that would leave `dir` is `EXDEV`, and a symlink that is not followed `ELOOP` or `ENOTDIR`.
pub fn openat(dir: Fd, path: &ZStr, flags: i32, mode: Mode, symlinks: Symlinks) -> Maybe<Fd> {
    if symlinks == Symlinks::Follow {
        return crate::openat(dir, path, flags, mode);
    }
    match openat_if_supported(dir, path, flags, mode, symlinks) {
        Some(Err(err)) if err.get_errno() == E::EAGAIN => {}
        Some(result) => return result,
        None => {}
    }
    #[cfg(target_os = "macos")]
    return crate::openat(dir, path, flags | O::NOFOLLOW_ANY, mode);
    #[cfg(not(target_os = "macos"))]
    open_component_by_component(dir, path, flags, mode)
}

/// `None` where the kernel cannot do this, for a caller that would rather not refuse every symlink then.
pub fn openat_if_supported(
    dir: Fd,
    path: &ZStr,
    flags: i32,
    mode: Mode,
    symlinks: Symlinks,
) -> Option<Maybe<Fd>> {
    if let Err(err) = refuse_absolute_and_dot_dot(path.as_bytes(), Tag::open) {
        return Some(Err(err));
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        use crate::linux_syscall::ResolveFlags;
        let mut resolve = ResolveFlags::BENEATH | ResolveFlags::NO_MAGICLINKS;
        if symlinks == Symlinks::Refuse {
            resolve |= ResolveFlags::NO_SYMLINKS;
        }
        // A rename or mount anywhere on the system while a symlink's `..` resolves is `EAGAIN`.
        let mut result = Err(libc::EAGAIN);
        for _ in 0..EAGAIN_ATTEMPTS {
            result = crate::openat2_if_available(dir, path, flags, mode, resolve)?;
            if !matches!(result, Err(libc::EAGAIN)) {
                break;
            }
        }
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

pub fn symlinkat(target: &ZStr, dir: Fd, path: &[u8], symlinks: Symlinks) -> Maybe<()> {
    in_parent(dir, path, symlinks, Tag::symlinkat, |parent, name| {
        crate::symlinkat(target, parent, name)
    })
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
        .filter(|name| !matches!(*name, b"" | b"."))
        .peekable();
    let mut current = dir;
    let mut _close = None;
    while let Some(name) = names.next() {
        if names.peek().is_none() {
            return crate::openat_a(current, name, flags | O::NOFOLLOW, mode).map_err(with_path);
        }
        current = crate::openat_a(current, name, SEARCH | O::NOFOLLOW, 0).map_err(with_path)?;
        _close = Some(CloseOnDrop::new(current));
    }
    crate::openat_a(dir, b".", flags | O::NOFOLLOW, mode).map_err(with_path)
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
                libc::EMFILE | libc::ENFILE | libc::ENOMEM | libc::EBADF | libc::ENOTDIR => {
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
