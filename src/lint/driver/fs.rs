//! The file system.

use bun_paths::path_buffer_pool;
use bun_paths::resolve_path::z;
use bun_sys::{EntryKind, Fd, File, O};
use std::sync::atomic::{AtomicU32, Ordering};

/// `ENOENT: No such file or directory`
pub(crate) fn describe(error: &bun_sys::Error) -> Vec<u8> {
    [error.name(), b": ", error.msg().unwrap_or(b"unknown error")].concat()
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    File,
    Directory,
}

/// What is at `path`, following links, and its size. `None`: nothing, or neither a file nor a
/// directory.
pub(crate) fn kind_and_size(path: &[u8]) -> Option<(Kind, u64)> {
    let found = bun_sys::stat(z(path, &mut path_buffer_pool::get())).ok()?;
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
    let found = bun_sys::lstat(z(path, &mut path_buffer_pool::get())).ok()?;
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
    let found = bun_sys::stat(z(path, &mut path_buffer_pool::get())).ok()?;
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

/// `path` without links.
pub(crate) fn real_path(path: &[u8]) -> Option<Vec<u8>> {
    let mut buffer = path_buffer_pool::get();
    Some(
        bun_sys::realpath(z(path, &mut path_buffer_pool::get()), &mut buffer)
            .ok()?
            .to_vec(),
    )
}

/// What a temporary file is called after the name of the file that it stands for. No two are called the same in a run: two threads
/// have the same random numbers, and can write the same file, which they have reached by two paths.
fn temporary_suffix() -> String {
    static COUNT: AtomicU32 = AtomicU32::new(0);
    let count = COUNT.fetch_add(1, Ordering::Relaxed);
    format!(".{:016x}{count:x}.tmp", bun_core::fast_random())
}

/// Replaces the file at `path`, which exists, so that nobody ever reads a part of `text`: writes
/// another file next to it, which then takes its name. What links to the file still does.
pub(crate) fn write_atomically(path: &[u8], text: &[u8]) -> bun_sys::Result<()> {
    let mut buffer = path_buffer_pool::get();
    let real = bun_sys::realpath(z(path, &mut path_buffer_pool::get()), &mut buffer)?.to_vec();
    let mode =
        bun_sys::stat(z(&real, &mut path_buffer_pool::get()))?.st_mode as bun_sys::Mode & 0o7777;
    let temporary = [&real[..], temporary_suffix().as_bytes()].concat();
    let written = File::openat(
        Fd::cwd(),
        &temporary,
        O::WRONLY | O::CREAT | O::EXCL | O::CLOEXEC,
        mode,
    )
    .and_then(|file| file.write_all(text))
    .and_then(|()| {
        bun_sys::rename(
            z(&temporary, &mut path_buffer_pool::get()),
            z(&real, &mut path_buffer_pool::get()),
        )
    });
    if written.is_err() {
        let _ = bun_sys::unlink(z(&temporary, &mut path_buffer_pool::get()));
    }
    written
}

/// Writes a file that need not exist, so that nobody ever reads a part of `text`, and makes the
/// directories that it is in.
pub(crate) fn write_new_atomically(path: &[u8], text: &[u8]) -> bun_sys::Result<()> {
    let temporary = [path, temporary_suffix().as_bytes()].concat();
    let written = write_new(&temporary, text).and_then(|()| {
        bun_sys::rename(
            z(&temporary, &mut path_buffer_pool::get()),
            z(path, &mut path_buffer_pool::get()),
        )
    });
    if written.is_err() {
        let _ = bun_sys::unlink(z(&temporary, &mut path_buffer_pool::get()));
    }
    written
}

/// Writes a file that need not exist, and makes the directories that it is in.
pub(crate) fn write_new(path: &[u8], text: &[u8]) -> bun_sys::Result<()> {
    File::make_open(path, O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC, 0o666)?.write_all(text)
}
