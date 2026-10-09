//! The file system.

use crate::paths;
use bun_core::ZStr;
use bun_paths::resolve_path::z;
use bun_paths::{MAX_PATH_BYTES, PathBuffer, path_buffer_pool};
use bun_sys::{EntryKind, Fd, File, O};
use std::sync::atomic::{AtomicU32, Ordering};

/// `ENOENT: No such file or directory`
pub(crate) fn describe(error: &bun_sys::Error) -> Vec<u8> {
    [error.name(), b": ", error.msg().unwrap_or(b"unknown error")].concat()
}

/// `path` with a NUL behind it. One that no system takes is the empty path, which nothing is at.
fn terminated<'b>(path: &[u8], buffer: &'b mut PathBuffer) -> &'b ZStr {
    match path.len() < MAX_PATH_BYTES {
        true => z(path, buffer),
        false => ZStr::EMPTY,
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    File,
    Directory,
}

/// What is at `path`, following links, and its size. `None`: nothing, or neither a file nor a
/// directory.
pub(crate) fn kind_and_size(path: &[u8]) -> Option<(Kind, u64)> {
    let found = bun_sys::stat(terminated(path, &mut path_buffer_pool::get())).ok()?;
    let kind = match bun_sys::kind_from_mode(found.st_mode as _) {
        EntryKind::File => Kind::File,
        EntryKind::Directory => Kind::Directory,
        _ => return None,
    };
    Some((kind, found.st_size as u64))
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum LinkKind {
    File,
    Directory,
    Link,
}

/// What is at `path`, which can be a link, and its size.
pub(crate) fn link_kind_and_size(path: &[u8]) -> Option<(LinkKind, u64)> {
    let found = bun_sys::lstat(terminated(path, &mut path_buffer_pool::get())).ok()?;
    let kind = match bun_sys::kind_from_mode(found.st_mode as _) {
        EntryKind::File => LinkKind::File,
        EntryKind::Directory => LinkKind::Directory,
        EntryKind::SymLink => LinkKind::Link,
        _ => return None,
    };
    Some((kind, found.st_size as u64))
}

pub(crate) fn kind(path: &[u8]) -> Option<Kind> {
    Some(kind_and_size(path)?.0)
}

/// The time of the last change of what is at `path` and its size, as text, and that time in
/// seconds.
pub(crate) fn stamp(path: &[u8]) -> Option<(Vec<u8>, i64)> {
    let found = bun_sys::stat(terminated(path, &mut path_buffer_pool::get())).ok()?;
    let changed = bun_sys::stat_mtime(&found);
    let text = format!("{}.{:09} {}", changed.sec, changed.nsec, found.st_size);
    Some((text.into_bytes(), changed.sec))
}

pub(crate) fn is_file(path: &[u8]) -> bool {
    kind(path) == Some(Kind::File)
}

pub(crate) fn read(path: &[u8]) -> bun_sys::Result<Vec<u8>> {
    File::read_from(Fd::cwd(), path)
}

/// The same for a file that is known to have `size` bytes, or had when it was looked at.
pub(crate) fn read_sized(path: &[u8], size: u64) -> bun_sys::Result<Vec<u8>> {
    let file = File::openat(Fd::cwd(), path, O::RDONLY, 0)?;
    // One more, so that the end of the file is seen without growing.
    let mut text = Vec::with_capacity((size as usize).min(64 << 20) + 1);
    file.read_to_end_into(&mut text)?;
    Ok(text)
}

/// Fills `start` from the start of the file at `path`, and returns what has been read.
pub(crate) fn read_start<'a>(path: &[u8], start: &'a mut [u8]) -> &'a [u8] {
    let read = File::openat(Fd::cwd(), path, O::RDONLY, 0).and_then(|file| file.read_all(start));
    start.get(..read.unwrap_or(0)).unwrap_or_default()
}

/// Whether the file at `path` starts with the few bytes `prefix`.
pub(crate) fn starts_with(path: &[u8], prefix: &[u8]) -> bool {
    let mut start = [0; 8];
    let read =
        File::openat(Fd::cwd(), path, O::RDONLY, 0).and_then(|file| file.read_all(&mut start));
    read.is_ok_and(|count| start[..count].starts_with(prefix))
}

pub(crate) fn read_stdin() -> bun_sys::Result<Vec<u8>> {
    let mut all = Vec::new();
    let mut buffer = vec![0; 64 * 1024];
    loop {
        match bun_sys::read(Fd::stdin(), &mut buffer)? {
            0 => return Ok(all),
            count => all.extend_from_slice(&buffer[..count]),
        }
    }
}

pub(crate) struct Entry {
    pub(crate) name: Vec<u8>,
    /// Not a link to one: like `fs.Dirent.isDirectory()`.
    pub(crate) is_directory: bool,
    pub(crate) is_link: bool,
}

/// A directory that has been listed, and is still open.
pub(crate) struct Listing {
    directory: bun_sys::Dir,
    /// In no particular order.
    pub(crate) entries: Vec<Entry>,
}

impl Listing {
    /// The size of the file called `name` in the directory. 0 if it cannot be told.
    pub(crate) fn size_of(&self, name: &[u8]) -> u64 {
        let found = bun_sys::fstatat(self.directory.fd(), z(name, &mut path_buffer_pool::get()));
        found.map_or(0, |found| found.st_size as u64)
    }
}

/// Lists the directory at `path`. `None` if it cannot be listed.
pub(crate) fn list(path: &[u8]) -> Option<Listing> {
    let directory = bun_sys::Dir::from_fd(bun_sys::open_dir_absolute(path).ok()?);
    let mut found = Vec::new();
    let mut entries = bun_sys::iterate_dir(directory.fd());
    while let Ok(Some(entry)) = entries.next() {
        let name = entry.name.slice_u8();
        let kind = match entry.kind {
            // The file system does not tell with the name.
            EntryKind::Unknown => {
                match bun_sys::lstatat(directory.fd(), z(name, &mut path_buffer_pool::get())) {
                    Ok(found) => bun_sys::kind_from_mode(found.st_mode as _),
                    Err(_) => continue,
                }
            }
            kind => kind,
        };
        // To open a pipe can take for ever, and neither it nor a socket or a device is a file to read.
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

/// `path` without links, with every name as its directory has it.
pub(crate) fn real_path(path: &[u8]) -> Option<Vec<u8>> {
    let mut buffer = path_buffer_pool::get();
    let real = bun_sys::realpath(terminated(path, &mut path_buffer_pool::get()), &mut buffer);
    Some(paths::from_native(real.ok()?))
}

/// What a temporary file is called after the name of the file that it stands for. No two are called the same in a run: two threads
/// have the same random numbers, and can write the same file, which they have reached by two paths.
fn temporary_suffix() -> String {
    static COUNT: AtomicU32 = AtomicU32::new(0);
    let count = COUNT.fetch_add(1, Ordering::Relaxed);
    format!(".{:016x}{count:x}.tmp", bun_core::fast_random())
}

/// Gives the file at `from` the name `to`, in place of what has it.
fn rename(from: &[u8], to: &[u8]) -> bun_sys::Result<()> {
    let (from, to) = (
        paths::to_native(from.to_vec()),
        paths::to_native(to.to_vec()),
    );
    // On Windows this one also replaces a file that somebody is reading. Not every file system has it.
    bun_sys::renameat(
        Fd::cwd(),
        terminated(&from, &mut path_buffer_pool::get()),
        Fd::cwd(),
        terminated(&to, &mut path_buffer_pool::get()),
    )
    .or_else(|error| match cfg!(windows) {
        true => bun_sys::rename(
            terminated(&from, &mut path_buffer_pool::get()),
            terminated(&to, &mut path_buffer_pool::get()),
        ),
        false => Err(error),
    })
}

fn remove(path: &[u8]) {
    let path = paths::to_native(path.to_vec());
    let _ = bun_sys::unlinkat(Fd::cwd(), terminated(&path, &mut path_buffer_pool::get()));
}

/// Writes a file next to the one at `real`, which then takes its name. `before`: what the latter is like. `false`: nothing has
/// changed: nothing can be added to the directory, the new file would belong to somebody else, or the old one is in use.
fn replace(real: &[u8], text: &[u8], before: &bun_sys::Stat) -> bun_sys::Result<bool> {
    let temporary = [real, temporary_suffix().as_bytes()].concat();
    let mode = before.st_mode as bun_sys::Mode & 0o7777;
    let Ok(file) = File::openat(
        Fd::cwd(),
        &temporary,
        O::RDWR | O::CREAT | O::EXCL | O::CLOEXEC,
        mode,
    ) else {
        return Ok(false);
    };
    let written = file.stat().and_then(|created| {
        if (created.st_uid, created.st_gid) != (before.st_uid, before.st_gid) {
            return Ok(false);
        }
        // What `umask` has taken away.
        if cfg!(unix) && created.st_mode as bun_sys::Mode & 0o7777 != mode {
            bun_sys::fchmod(file.handle(), mode)?;
        }
        file.write_all(text).map(|()| true)
    });
    drop(file);
    let is_replaced = matches!(written, Ok(true)) && rename(&temporary, real).is_ok();
    if !is_replaced {
        remove(&temporary);
    }
    written.map(|_| is_replaced)
}

/// Replaces the text of the file at `real`, a path of the system without links: by a file that takes its name, so that nobody
/// reads a part of `text`, where that leaves all else as it is. Otherwise in place, as ESLint and Prettier write every file.
fn write_through(real: &[u8], text: &[u8]) -> bun_sys::Result<()> {
    // Who may not write a file may not replace it either.
    let before = File::openat(Fd::cwd(), real, O::RDWR | O::CLOEXEC | O::NOFOLLOW, 0)?.stat()?;
    // A file with two names would be two files afterwards.
    if before.st_nlink <= 1 && replace(real, text, &before)? {
        return Ok(());
    }
    let flags = O::WRONLY | O::TRUNC | O::CLOEXEC | O::NOFOLLOW;
    File::openat(Fd::cwd(), real, flags, 0)?.write_all(text)
}

/// The nearest directory from `cwd` upward that has a `.git`, or else `cwd`. Without links.
fn repository(cwd: &[u8]) -> Option<Vec<u8>> {
    let cwd = real_path(cwd)?;
    let has_git = |it: &&[u8]| link_kind_and_size(&paths::join(it, b".git")).is_some();
    let found = paths::ancestors(&cwd).find(has_git).map(<[u8]>::to_vec);
    Some(found.unwrap_or(cwd))
}

/// Replaces the text of the file at `path`, which exists. What links to the file still does. `Err`: why it is not written.
/// A link below `cwd`, the working directory, is not followed out of the repository: nobody reads the links of a checkout.
pub(crate) fn write_atomically(cwd: &[u8], path: &[u8], text: &[u8]) -> Result<(), Vec<u8>> {
    let mut buffer = path_buffer_pool::get();
    let real = bun_sys::realpath(terminated(path, &mut path_buffer_pool::get()), &mut buffer)
        .map_err(|error| describe(&error))?
        .to_vec();
    // `bun lint` has the path as the system writes it.
    let (path, portable) = (paths::from_native(path), paths::from_native(&real));
    if portable != path
        && paths::inside(cwd, &path).is_some()
        && !repository(cwd).is_some_and(|it| paths::inside(&it, &portable).is_some())
    {
        return Err(b"A link leads out of the repository.".to_vec());
    }
    write_through(&real, text).map_err(|error| describe(&error))
}

/// Writes a file that need not exist, so that nobody ever reads a part of `text`, and makes the
/// directories that it is in.
pub(crate) fn write_new_atomically(path: &[u8], text: &[u8]) -> bun_sys::Result<()> {
    let temporary = [path, temporary_suffix().as_bytes()].concat();
    let written = write_new(&temporary, text).and_then(|()| rename(&temporary, path));
    if written.is_err() {
        remove(&temporary);
    }
    written
}

/// Writes a file that need not exist, and makes the directories that it is in.
pub(crate) fn write_new(path: &[u8], text: &[u8]) -> bun_sys::Result<()> {
    File::make_open(path, O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC, 0o666)?.write_all(text)
}
