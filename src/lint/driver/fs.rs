//! File system helpers.

use crate::paths;
use bun_core::ZStr;
use bun_paths::resolve_path::z;
use bun_paths::{MAX_PATH_BYTES, PathBuffer, path_buffer_pool};
use bun_sema::util::FxHashSet;
use bun_sys::{EntryKind, Fd, File, O};
use bun_threading::Guarded;
use std::sync::atomic::{AtomicU32, Ordering};

/// `ENOENT: No such file or directory`
pub(crate) fn describe(error: &bun_sys::Error) -> Vec<u8> {
    [error.name(), b": ", error.msg().unwrap_or(b"unknown error")].concat()
}

/// Returns `path` with a trailing NUL. A path that's too long for any system becomes the empty path, where nothing
/// exists.
fn null_terminated<'b>(path: &[u8], buffer: &'b mut PathBuffer) -> &'b ZStr {
    match path.len() < MAX_PATH_BYTES {
        true => z(path, buffer),
        false => ZStr::EMPTY,
    }
}

/// Same, for the calls that go through libuv on Windows (`stat`, `lstat`, `realpath`, `rename`). libuv passes the path
/// to the system unchanged, which limits it to 260 characters unless it's in the namespaced form that Node uses for
/// every path.
fn for_libuv<'b>(path: &[u8], buffer: &'b mut PathBuffer) -> &'b ZStr {
    match cfg!(windows) && path.len() >= 240 {
        true => null_terminated(&paths::namespaced(path), buffer),
        false => null_terminated(path, buffer),
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    File,
    Directory,
}

/// Uniquely identifies a file: device and inode, or volume and file index on Windows.
pub(crate) type Identity = (u64, u64);

/// Returns the file's identity if it has more than one hard link.
fn identity_if_linked(found: &bun_sys::Stat) -> Option<Identity> {
    (found.st_nlink > 1).then_some((found.st_dev as _, found.st_ino as _))
}

/// Returns the kind and size of the file at `path`, following symlinks, plus [`identity_if_linked`]. Returns `None` if
/// nothing exists there, or if it's neither a file nor a directory.
pub(crate) fn stat(path: &[u8]) -> Option<(Kind, u64, Option<Identity>)> {
    let found = bun_sys::stat(for_libuv(path, &mut path_buffer_pool::get())).ok()?;
    let kind = match bun_sys::kind_from_mode(found.st_mode as _) {
        EntryKind::File => Kind::File,
        EntryKind::Directory => Kind::Directory,
        _ => return None,
    };
    Some((kind, found.st_size as u64, identity_if_linked(&found)))
}

pub(crate) fn kind_and_size(path: &[u8]) -> Option<(Kind, u64)> {
    stat(path).map(|(kind, size, _)| (kind, size))
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum LinkKind {
    File,
    Directory,
    Link,
}

/// Like [`stat`], but doesn't follow a symlink at `path`.
pub(crate) fn lstat(path: &[u8]) -> Option<(LinkKind, u64, Option<Identity>)> {
    let found = bun_sys::lstat(for_libuv(path, &mut path_buffer_pool::get())).ok()?;
    let kind = match bun_sys::kind_from_mode(found.st_mode as _) {
        EntryKind::File => LinkKind::File,
        EntryKind::Directory => LinkKind::Directory,
        EntryKind::SymLink => LinkKind::Link,
        _ => return None,
    };
    Some((kind, found.st_size as u64, identity_if_linked(&found)))
}

pub(crate) fn link_kind_and_size(path: &[u8]) -> Option<(LinkKind, u64)> {
    lstat(path).map(|(kind, size, _)| (kind, size))
}

/// Returns what the symlink at `path` resolves to. `Ok(None)` if that's neither a file nor a directory.
pub(crate) fn link_target_kind(path: &[u8]) -> bun_sys::Result<Option<Kind>> {
    let found = bun_sys::stat(for_libuv(path, &mut path_buffer_pool::get()))?;
    Ok(match bun_sys::kind_from_mode(found.st_mode as _) {
        EntryKind::File => Some(Kind::File),
        EntryKind::Directory => Some(Kind::Directory),
        _ => None,
    })
}

pub(crate) fn kind(path: &[u8]) -> Option<Kind> {
    Some(kind_and_size(path)?.0)
}

pub(crate) fn is_file(path: &[u8]) -> bool {
    kind(path) == Some(Kind::File)
}

fn too_large() -> bun_sys::Error {
    bun_sys::Error::from_code(bun_sys::E::EFBIG, bun_sys::Tag::read)
}

/// Opens `path` for reading without blocking. A blocking open of a named pipe waits for a writer that may never come.
fn open_nonblocking(path: &[u8]) -> bun_sys::Result<File> {
    let nonblocking = if cfg!(unix) { O::NONBLOCK } else { 0 };
    File::openat(Fd::cwd(), path, O::RDONLY | nonblocking, 0)
}

/// Reads `file` to the end. `file` isn't a regular file and was opened by [`open_nonblocking`].
fn read_stream(file: &File) -> bun_sys::Result<Vec<u8>> {
    // Reads do block while a writer is connected, e.g. `--config <(..)`.
    bun_sys::update_nonblocking(file.handle(), false)?;
    let (mut text, mut part) = (Vec::new(), vec![0; 64 << 10]);
    loop {
        match file.read(&mut part)? {
            0 => return Ok(text),
            read => text.extend_from_slice(&part[..read]),
        }
        if text.len() > 64 << 20 {
            return Err(too_large());
        }
    }
}

/// Reads the file at `path`. Fails with `EFBIG` if a regular file is too long for a JavaScript string, which is an
/// error in Node too, or after 64 MB of anything else. `/dev/null` and pipes have to be readable, but a symlink in a
/// repository can also point to `/dev/zero`. A named pipe with no writer reads as empty.
pub(crate) fn read(path: &[u8]) -> bun_sys::Result<Vec<u8>> {
    let file = open_nonblocking(path)?;
    let found = file.stat()?;
    if matches!(bun_sys::kind_from_mode(found.st_mode as _), EntryKind::File) {
        let size = found.st_size as u64;
        if size > bun_lint::fix::MAX_STRING_LENGTH {
            return Err(too_large());
        }
        // One extra byte, so the read that detects the end of the file doesn't grow the buffer.
        let mut text = Vec::with_capacity((size as usize).min(64 << 20) + 1);
        file.read_to_end_into(&mut text)?;
        return Ok(text);
    }
    read_stream(&file)
}

/// Contents of the named pipes passed to flags, keyed by path. A pipe can only be read once, but a run reads some of
/// these files more than once.
#[derive(Clone, Debug, Default)]
pub(crate) struct NamedPipes(Vec<(Vec<u8>, Vec<u8>)>);

impl NamedPipes {
    /// Reads and caches every path in `arguments` that is a pipe. The paths are as the user typed them, relative to
    /// `cwd`. `Err` is the message to show the user. A pipe with no writer is an error. Treating it as empty would make
    /// `--ignore-path` ignore nothing. Waiting for a writer would let a pipe in a checkout hang any CI job that passes
    /// its path.
    pub(crate) fn load(&mut self, cwd: &[u8], arguments: &[Vec<u8>]) -> Result<(), Vec<u8>> {
        for argument in arguments.iter().filter(|_| cfg!(unix)) {
            let path = paths::resolve(cwd, &paths::from_native(argument));
            if self.0.iter().any(|it| it.0 == path) {
                continue;
            }
            // The code that reads the file later reports the error.
            let Ok(file) = open_nonblocking(&path) else {
                continue;
            };
            let is_pipe = file.stat().is_ok_and(|found| {
                bun_sys::kind_from_mode(found.st_mode as _) == EntryKind::NamedPipe
            });
            if !is_pipe {
                continue;
            }
            let cannot_read = |why: &[u8]| [b"cannot read ", &argument[..], b": ", why].concat();
            // A pipe whose writer has closed it polls as hung up, so `<(true)` is an empty file and not an error.
            let had_writer = || bun_core::is_readable(file.handle()) == bun_core::Pollable::Hup;
            match read_stream(&file) {
                Ok(text) if text.is_empty() && !had_writer() => {
                    return Err(cannot_read(b"nothing is writing to this pipe"));
                }
                Ok(text) => self.0.push((path, text)),
                Err(error) => return Err(cannot_read(&describe(&error))),
            }
        }
        Ok(())
    }

    /// Returns the cached contents if `path` is a pipe that [`NamedPipes::load`] read. Otherwise calls [`read`].
    pub(crate) fn read(&self, path: &[u8]) -> bun_sys::Result<Vec<u8>> {
        match self.0.iter().find(|it| it.0 == path) {
            Some((_, text)) => Ok(text.clone()),
            None => read(path),
        }
    }
}

/// Reads the beginning of the file at `path` into `start`. Returns the bytes that were read.
pub(crate) fn read_start<'a>(path: &[u8], start: &'a mut [u8]) -> &'a [u8] {
    let read = File::openat(Fd::cwd(), path, O::RDONLY, 0).and_then(|file| file.read_all(start));
    start.get(..read.unwrap_or(0)).unwrap_or_default()
}

pub(crate) fn read_stdin() -> bun_sys::Result<Vec<u8>> {
    let mut all = Vec::new();
    File::stdin().read_to_end_into(&mut all)?;
    Ok(all)
}

pub(crate) struct Entry {
    pub(crate) name: Vec<u8>,
    /// False for a symlink to a directory, like `fs.Dirent.isDirectory()`.
    pub(crate) is_directory: bool,
    pub(crate) is_link: bool,
}

/// A listed directory that's still open.
pub(crate) struct Listing {
    directory: bun_sys::Dir,
    /// In no particular order.
    pub(crate) entries: Vec<Entry>,
}

impl Listing {
    /// Returns the size of the file `name` in the directory, or 0 if it can't be determined. `None` for a symlink to
    /// something that [`list`] skips.
    pub(crate) fn size_of(&self, name: &[u8]) -> Option<u64> {
        self.size_and_identity_of(name).map(|it| it.0)
    }

    /// Like [`Listing::size_of`], plus [`identity_if_linked`].
    pub(crate) fn size_and_identity_of(&self, name: &[u8]) -> Option<(u64, Option<Identity>)> {
        let found = bun_sys::fstatat(self.directory.fd(), z(name, &mut path_buffer_pool::get()));
        let Ok(found) = found else {
            return Some((0, None));
        };
        match bun_sys::kind_from_mode(found.st_mode as _) {
            EntryKind::File | EntryKind::Directory => {
                Some((found.st_size as u64, identity_if_linked(&found)))
            }
            _ => None,
        }
    }
}

/// Lists the directory at `path`. `None` if it can't be listed.
pub(crate) fn list(path: &[u8]) -> Option<Listing> {
    let directory = bun_sys::Dir::from_fd(bun_sys::open_dir_absolute(path).ok()?);
    let mut found = Vec::new();
    let mut entries = bun_sys::iterate_dir(directory.fd());
    while let Ok(Some(entry)) = entries.next() {
        let name = entry.name.slice_u8();
        let kind = match entry.kind {
            // This file system doesn't report the kind along with the name.
            EntryKind::Unknown => {
                match bun_sys::lstatat(directory.fd(), z(name, &mut path_buffer_pool::get())) {
                    Ok(found) => bun_sys::kind_from_mode(found.st_mode as _),
                    Err(_) => continue,
                }
            }
            kind => kind,
        };
        // Opening a pipe can block forever, and pipes, sockets and devices aren't files to read anyway.
        if !matches!(
            kind,
            EntryKind::File | EntryKind::Directory | EntryKind::SymLink
        ) {
            continue;
        }
        found.push(Entry {
            name: name.to_vec(),
            is_directory: kind == EntryKind::Directory,
            is_link: kind == EntryKind::SymLink,
        });
    }
    Some(Listing {
        directory,
        entries: found,
    })
}

/// Returns `path` with symlinks resolved and every name spelled as its directory stores it.
pub(crate) fn real_path(path: &[u8]) -> Option<Vec<u8>> {
    let mut buffer = path_buffer_pool::get();
    let real = bun_sys::realpath(for_libuv(path, &mut path_buffer_pool::get()), &mut buffer);
    Some(paths::from_native(real.ok()?))
}

/// Returns a name for a temporary file. It's short and doesn't reuse any of the target file's name, which may already
/// be at the maximum length. The counter makes names unique within a run. The random number doesn't: every thread
/// generates the same sequence, and two threads can write the same file if they reached it by different paths.
fn temporary_name() -> String {
    static COUNT: AtomicU32 = AtomicU32::new(0);
    let count = COUNT.fetch_add(1, Ordering::Relaxed);
    format!(".{:016x}{count:x}.tmp", bun_core::fast_random())
}

/// Renames the file at `from` to `to`, replacing any file there.
fn rename(from: &[u8], to: &[u8]) -> bun_sys::Result<()> {
    let (from, to) = (
        paths::to_native(from.to_vec()),
        paths::to_native(to.to_vec()),
    );
    // On Windows, this call can also replace a file that's open for reading. Not every file system supports it.
    bun_sys::renameat(
        Fd::cwd(),
        null_terminated(&from, &mut path_buffer_pool::get()),
        Fd::cwd(),
        null_terminated(&to, &mut path_buffer_pool::get()),
    )
    .or_else(|error| match cfg!(windows) {
        true => bun_sys::rename(
            for_libuv(&from, &mut path_buffer_pool::get()),
            for_libuv(&to, &mut path_buffer_pool::get()),
        ),
        false => Err(error),
    })
}

fn remove(path: &[u8]) {
    let path = paths::to_native(path.to_vec());
    let _ = bun_sys::unlinkat(
        Fd::cwd(),
        null_terminated(&path, &mut path_buffer_pool::get()),
    );
}

/// Returns a file's extended attributes: tags, ACL, security label. A file renamed over it doesn't inherit them. `None`
/// if they can't be read.
#[cfg(unix)]
fn attributes(file: &File) -> Option<Vec<(Vec<u8>, Vec<u8>)>> {
    bun_sys::extended_attributes(file.handle()).ok()
}

/// A file's metadata before it's replaced.
struct Before {
    stat: bun_sys::Stat,
    #[cfg(unix)]
    attributes: Option<Vec<(Vec<u8>, Vec<u8>)>>,
}

/// Writes a temporary file next to the one at `real`, then renames it over `real`. `old` is the existing file's
/// metadata. Returns `false` if nothing changed: the directory isn't writable, the new file would have a different
/// owner or lack one of the old file's attributes, or the old file is in use.
fn replace(real: &[u8], text: &[u8], old: &Before) -> bun_sys::Result<bool> {
    let before = &old.stat;
    let directory = &real[..real.len() - paths::basename(real).len()];
    let temporary = [directory, temporary_name().as_bytes()].concat();
    let mode = before.st_mode as bun_sys::Mode & 0o7777;
    let Ok(file) = File::openat(
        Fd::cwd(),
        &temporary,
        O::RDWR | O::CREAT | O::EXCL | O::CLOEXEC,
        mode,
    ) else {
        return Ok(false);
    };
    let write_result = file.stat().and_then(|created| {
        if (created.st_uid, created.st_gid) != (before.st_uid, before.st_gid) {
            return Ok(false);
        }
        // The directory gives a new file its label and default ACL, normally the same ones it gave the old file.
        #[cfg(unix)]
        {
            if old.attributes.is_none() || attributes(&file) != old.attributes {
                return Ok(false);
            }
        }
        // Restore the bits that `umask` cleared.
        if cfg!(unix) && created.st_mode as bun_sys::Mode & 0o7777 != mode {
            bun_sys::fchmod(file.handle(), mode)?;
        }
        file.write_all(text).map(|()| true)
    });
    drop(file);
    let is_replaced = matches!(write_result, Ok(true)) && rename(&temporary, real).is_ok();
    if !is_replaced {
        remove(&temporary);
    }
    write_result.map(|_| is_replaced)
}

/// Writes `text` at offset 0 of `file`. On failure, returns the error and the number of bytes already written.
fn write_at_start(file: &File, text: &[u8]) -> Result<(), (bun_sys::Error, usize)> {
    let mut bytes_written = 0;
    while bytes_written < text.len() {
        match bun_sys::pwrite(file.handle(), &text[bytes_written..], bytes_written as i64) {
            Ok(0) => {
                let error = bun_sys::Error::from_code(bun_sys::E::EIO, bun_sys::Tag::write);
                return Err((error, bytes_written));
            }
            Ok(count) => bytes_written += count,
            Err(error) => return Err((error, bytes_written)),
        }
    }
    Ok(())
}

/// Overwrites the file at `real` with `text`. Truncates it to the new length only after all of `text` is written. If
/// the write fails partway (disk full, quota, file size limit), restores the old text.
fn overwrite(real: &[u8], text: &[u8]) -> Result<(), Vec<u8>> {
    let flags = O::RDWR | O::CLOEXEC | O::NOFOLLOW;
    let (file, old) = File::openat(Fd::cwd(), real, flags, 0)
        .and_then(|file| file.read_to_end().map(|old| (file, old)))
        .map_err(|error| describe(&error))?;
    let truncate_to = |length: usize| bun_sys::ftruncate(file.handle(), length as i64);
    let (error, bytes_written) = match write_at_start(&file, text) {
        Ok(()) => match truncate_to(text.len()) {
            Ok(()) => return Ok(()),
            Err(error) => (error, text.len()),
        },
        Err(failed) => failed,
    };
    // Restore only the overwritten bytes. A file size limit also rejects rewriting existing bytes past the limit, and
    // on macOS it rejects truncating to the file's current length if that is past the limit.
    let restored = write_at_start(&file, &old[..bytes_written.min(old.len())])
        .map_err(|(error, _)| error)
        .and_then(|()| match bytes_written > old.len() {
            true => truncate_to(old.len()),
            false => Ok(()),
        });
    let mut why = describe(&error);
    if restored.is_err() {
        why.extend_from_slice(b". The file may be damaged: its old text could not be put back");
    }
    Err(why)
}

/// Replaces the text of the file at `real`, a native path with symlinks resolved. Renames a new file over it, so no
/// reader sees partial text, if that preserves everything else about the file. Otherwise overwrites it in place, like
/// ESLint and Prettier always do.
fn write_through(real: &[u8], text: &[u8]) -> Result<(), Vec<u8>> {
    let is_replaced = || -> bun_sys::Result<bool> {
        // If you can't write a file, you shouldn't be able to replace it either.
        let file = File::openat(Fd::cwd(), real, O::RDWR | O::CLOEXEC | O::NOFOLLOW, 0)?;
        let before = Before {
            stat: file.stat()?,
            #[cfg(unix)]
            attributes: attributes(&file),
        };
        // Windows can't rename over an open file.
        drop(file);
        // Renaming over one hard link would detach it from the others.
        Ok(before.stat.st_nlink <= 1 && replace(real, text, &before)?)
    };
    match is_replaced() {
        Ok(true) => Ok(()),
        Ok(false) => overwrite(real, text),
        Err(error) => Err(describe(&error)),
    }
}

/// Returns the nearest directory, starting at `directory` and walking up, that contains `.git` or `.jj`. Ignore files
/// use the same rule.
fn find_repository_root(directory: &[u8]) -> Option<&[u8]> {
    let is_root = |it: &&[u8]| {
        [&b".git"[..], b".jj"]
            .iter()
            .any(|name| link_kind_and_size(&paths::join(it, name)).is_some())
    };
    paths::ancestors(directory).find(is_root)
}

/// Returns the real path of the repository that contains `cwd`, or of `cwd` if it isn't in a repository.
fn repository(cwd: &[u8]) -> Option<Vec<u8>> {
    let cwd = real_path(cwd)?;
    let found = find_repository_root(&cwd).map(<[u8]>::to_vec);
    Some(found.unwrap_or(cwd))
}

const ESCAPES_REPOSITORY: &[u8] = b"it is a symlink to a file outside the repository";

/// True if `path` is inside `cwd` but its symlinks lead outside the repository. `real` is the real path of `path`.
fn escapes_repository(cwd: &[u8], path: &[u8], real: &[u8]) -> bool {
    // `bun lint` passes native paths.
    let (portable, real) = (paths::from_native(path), paths::from_native(real));
    real != portable
        && paths::inside(cwd, &portable).is_some()
        && !repository(cwd).is_some_and(|it| paths::inside(&it, &real).is_some())
}

/// Real paths of the files that a run has written. Two paths can lead to one file (a symlink, different letter case),
/// and two threads replacing the same file at the same time sometimes fail on Windows. Hard links each have their own
/// real path, so `bun fmt` detects those by [`Identity`].
#[derive(Default)]
pub(crate) struct WrittenFiles(Guarded<FxHashSet<Vec<u8>>>);

/// Replaces the text of the existing file at `path`. Links to the file stay intact. `Err` is the reason it wasn't
/// written. A symlink inside `cwd`, the working directory, isn't followed out of the repository, because nobody reviews
/// the symlinks in a checkout. A file that's already in `already_written` is skipped.
pub(crate) fn write_atomically(
    already_written: &WrittenFiles,
    cwd: &[u8],
    path: &[u8],
    text: &[u8],
) -> Result<(), Vec<u8>> {
    let resolve = || {
        let mut buffer = path_buffer_pool::get();
        bun_sys::realpath(for_libuv(path, &mut path_buffer_pool::get()), &mut buffer)
            .map(<[u8]>::to_vec)
            .map_err(|error| describe(&error))
    };
    let mut real = resolve()?;
    // When an open file is renamed over, NTFS moves it to a special directory. The real path points there if another
    // thread, which reached the file by a different path, replaced it after it was opened here. Resolving again finds
    // the new file.
    if cfg!(windows) && escapes_repository(cwd, path, &real) {
        real = resolve()?;
    }
    if escapes_repository(cwd, path, &real) {
        return Err(ESCAPES_REPOSITORY.to_vec());
    }
    if !already_written.0.lock().insert(real.clone()) {
        return Ok(());
    }
    write_through(&real, text)
}

/// Returns the real path of `path`, where the file and some of its parent directories may not exist yet. A dangling
/// symlink is followed to where the file would be created.
fn real_path_of_new(path: &[u8]) -> bun_sys::Result<Vec<u8>> {
    let mut path = path.to_vec();
    let (mut missing, mut followed): (Vec<Vec<u8>>, Vec<Vec<u8>>) = (Vec::new(), Vec::new());
    let fails = |code| bun_sys::Error::from_code(code, bun_sys::Tag::open);
    loop {
        if let Some(real) = real_path(&path) {
            let missing = missing.iter().rev();
            return Ok(missing.fold(real, |it, name| paths::join(&it, name)));
        }
        let parent = paths::dirname(&path).to_vec();
        if matches!(link_kind_and_size(&path), Some((LinkKind::Link, _))) {
            if followed.contains(&path) {
                return Err(fails(bun_sys::E::ELOOP));
            }
            let (mut link, mut target) = (path_buffer_pool::get(), path_buffer_pool::get());
            let len = bun_sys::readlink(for_libuv(&path, &mut link), &mut target[..])?;
            let target = paths::from_native(&target[..len]);
            followed.push(path);
            path = paths::resolve(&real_path(&parent).unwrap_or(parent), &target);
        } else if parent.len() < path.len() {
            missing.push(paths::basename(&path).to_vec());
            path = parent;
        } else {
            return Err(fails(bun_sys::E::ENOENT));
        }
    }
}

/// Returns the identity of anything that doesn't store writes: a pipe, a socket, a terminal, `/dev/null`.
fn identity_if_stream(found: &bun_sys::Stat) -> Option<Identity> {
    let kind = bun_sys::kind_from_mode(found.st_mode as _);
    (!matches!(kind, EntryKind::File | EntryKind::Directory))
        .then_some((found.st_dev as _, found.st_ino as _))
}

/// Writes `text` to `stream`, which is what `path` resolved to. Doesn't create, replace or truncate anything.
fn write_to_stream(cwd: &[u8], path: &[u8], stream: Identity, text: &[u8]) -> Result<(), Vec<u8>> {
    // `/dev/stdout` has no real path when it's a pipe, but everything in a repository has one. So a path inside `cwd`
    // with no real path is rejected only if `cwd` is in a repository. `/dev/stdout` still works from `/` and `/dev`.
    let real = real_path(path);
    let is_rejected = match &real {
        Some(real) => escapes_repository(cwd, path, real),
        None => {
            paths::inside(cwd, &paths::from_native(path)).is_some()
                && real_path(cwd).is_none_or(|cwd| find_repository_root(&cwd).is_some())
        }
    };
    if is_rejected {
        return Err(ESCAPES_REPOSITORY.to_vec());
    }
    let (checked, last_link) = match &real {
        Some(real) => (&real[..], O::NOFOLLOW),
        None => (path, 0),
    };
    let file = File::openat(Fd::cwd(), checked, O::WRONLY | O::CLOEXEC | last_link, 0)
        .map_err(|error| describe(&error))?;
    let opened = file.stat().map_err(|error| describe(&error))?;
    // Something else may be at that path by now. A regular file isn't truncated here, so it would keep the tail of its
    // old text. If `path` itself was opened, its symlinks may point elsewhere too, so the identity has to match.
    let is_as_checked = |opened: Identity| real.is_some() || opened == stream;
    match identity_if_stream(&opened).is_some_and(is_as_checked) {
        true => file.write_all(text).map_err(|error| describe(&error)),
        false => Err(b"it was replaced while it was opened".to_vec()),
    }
}

/// Writes a file that may not exist yet, and creates its parent directories. `Err` is the reason it wasn't written.
/// Like [`write_atomically`], doesn't follow a symlink inside `cwd` out of the repository. A pipe or a device, such as
/// `/dev/stdout`, is written to directly.
pub(crate) fn write_new(cwd: &[u8], path: &[u8], text: &[u8]) -> Result<(), Vec<u8>> {
    if cfg!(unix)
        && let Ok(found) = bun_sys::stat(for_libuv(path, &mut path_buffer_pool::get()))
        && let Some(stream) = identity_if_stream(&found)
    {
        return write_to_stream(cwd, path, stream, text);
    }
    let real = real_path_of_new(path).map_err(|error| describe(&error))?;
    if escapes_repository(cwd, path, &real) {
        return Err(ESCAPES_REPOSITORY.to_vec());
    }
    // Open the path that was checked, not `path`, and don't follow a symlink that was created there since the check.
    let flags = O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC | O::NOFOLLOW;
    File::make_open(&real, flags, 0o666)
        .and_then(|file| file.write_all(text))
        .map_err(|error| describe(&error))
}
