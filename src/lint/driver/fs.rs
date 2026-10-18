//! The file system.

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

/// `path` with a NUL behind it. One that no system takes is the empty path, which nothing is at.
fn terminated<'b>(path: &[u8], buffer: &'b mut PathBuffer) -> &'b ZStr {
    match path.len() < MAX_PATH_BYTES {
        true => z(path, buffer),
        false => ZStr::EMPTY,
    }
}

/// The same for the calls that are libuv's on Windows (`stat`, `lstat`, `realpath`, `rename`), which hands the path to the system
/// as it is. There 260 characters are the most, unless the path is written as Node writes every path.
fn for_libuv<'b>(path: &[u8], buffer: &'b mut PathBuffer) -> &'b ZStr {
    match cfg!(windows) && path.len() >= 240 {
        true => terminated(&paths::namespaced(path), buffer),
        false => terminated(path, buffer),
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    File,
    Directory,
}

/// What tells a file from every other: its device and its inode. On Windows, its volume and its file index.
pub(crate) type Identity = (u64, u64);

/// The identity of a file that has more names than the one it was found by: hard links.
fn identity_if_linked(found: &bun_sys::Stat) -> Option<Identity> {
    (found.st_nlink > 1).then_some((found.st_dev as _, found.st_ino as _))
}

/// What is at `path`, following links, its size, and [`identity_if_linked`]. `None`: nothing, or neither a file nor a
/// directory.
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

/// What is at `path`, which can be a link, its size, and [`identity_if_linked`].
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

/// What the link at `path` leads to. `Ok(None)`: neither a file nor a directory.
pub(crate) fn end_of_link(path: &[u8]) -> bun_sys::Result<Option<Kind>> {
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

/// Otherwise, opening a named pipe waits until someone opens it for writing, which may never happen.
fn open_without_waiting(path: &[u8]) -> bun_sys::Result<File> {
    let without_waiting = if cfg!(unix) { O::NONBLOCK } else { 0 };
    File::openat(Fd::cwd(), path, O::RDONLY | without_waiting, 0)
}

/// Everything in `file`, which [`open_without_waiting`] opened and which isn't a regular file.
fn read_stream(file: &File) -> bun_sys::Result<Vec<u8>> {
    // Reading does wait, for a writer that is there: `--config <(..)`.
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

/// `EFBIG` for a file that JavaScript could not hold as a string, as Node has an error for it, and for more than 64 MB of what is
/// no file: `/dev/null` and a pipe are read, and a link in a repository can lead to `/dev/zero`. A named pipe that nobody has
/// open for writing is empty.
pub(crate) fn read(path: &[u8]) -> bun_sys::Result<Vec<u8>> {
    let file = open_without_waiting(path)?;
    let found = file.stat()?;
    if matches!(bun_sys::kind_from_mode(found.st_mode as _), EntryKind::File) {
        let size = found.st_size as u64;
        if size > bun_lint::fix::MAX_STRING_LENGTH {
            return Err(too_large());
        }
        // One more, so that the end of the file is seen without growing.
        let mut text = Vec::with_capacity((size as usize).min(64 << 20) + 1);
        file.read_to_end_into(&mut text)?;
        return Ok(text);
    }
    read_stream(&file)
}

/// The text of the pipes that flags name. A pipe gives its text once, and a run reads some of these files more than once.
#[derive(Clone, Debug, Default)]
pub(crate) struct NamedPipes(Vec<(Vec<u8>, Vec<u8>)>);

impl NamedPipes {
    /// Reads those of `named` that are pipes. `named`: paths from `cwd`, as they are written. `Err`: what to tell the user.
    /// A pipe that nobody has open for writing is an error. Taken for empty, `--ignore-path` would ignore nothing. Waited for,
    /// a pipe in a checkout would hang the CI job that names its path.
    pub(crate) fn load(&mut self, cwd: &[u8], named: &[Vec<u8>]) -> Result<(), Vec<u8>> {
        for written in named.iter().filter(|_| cfg!(unix)) {
            let path = paths::resolve(cwd, &paths::from_native(written));
            if self.0.iter().any(|it| it.0 == path) {
                continue;
            }
            // Whoever reads the file later reports what is wrong with it.
            let Ok(file) = open_without_waiting(&path) else {
                continue;
            };
            let is_pipe = file.stat().is_ok_and(|found| {
                bun_sys::kind_from_mode(found.st_mode as _) == EntryKind::NamedPipe
            });
            if !is_pipe {
                continue;
            }
            let cannot_read = |why: &[u8]| [b"cannot read ", &written[..], b": ", why].concat();
            // A pipe that has had a writer hangs up at its end: `<(true)` is an empty file.
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

    /// [`read`], or what the pipe at `path` had.
    pub(crate) fn read(&self, path: &[u8]) -> bun_sys::Result<Vec<u8>> {
        match self.0.iter().find(|it| it.0 == path) {
            Some((_, text)) => Ok(text.clone()),
            None => read(path),
        }
    }
}

/// Fills `start` from the start of the file at `path`, and returns what has been read.
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
    /// The size of the file called `name` in the directory. 0 if it cannot be told. `None`: a link to what [`list`] leaves out.
    pub(crate) fn size_of(&self, name: &[u8]) -> Option<u64> {
        self.size_and_identity_of(name).map(|it| it.0)
    }

    /// The same, and [`identity_if_linked`].
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
    let real = bun_sys::realpath(for_libuv(path, &mut path_buffer_pool::get()), &mut buffer);
    Some(paths::from_native(real.ok()?))
}

/// The name of a temporary file. It's short and has nothing of the name of the file that it stands for, which can be as long as
/// a name can be. No two are called the same in a run: two threads have the same random numbers, and can write the same file,
/// which they have reached by two paths.
fn temporary_name() -> String {
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
            for_libuv(&from, &mut path_buffer_pool::get()),
            for_libuv(&to, &mut path_buffer_pool::get()),
        ),
        false => Err(error),
    })
}

fn remove(path: &[u8]) {
    let path = paths::to_native(path.to_vec());
    let _ = bun_sys::unlinkat(Fd::cwd(), terminated(&path, &mut path_buffer_pool::get()));
}

/// The tags of a file, its ACL, its label: what a file that takes its name does not take over. `None`: they cannot be read.
#[cfg(unix)]
fn attributes(file: &File) -> Option<Vec<(Vec<u8>, Vec<u8>)>> {
    bun_sys::extended_attributes(file.handle()).ok()
}

/// What the file at a path is like.
struct Before {
    stat: bun_sys::Stat,
    #[cfg(unix)]
    attributes: Option<Vec<(Vec<u8>, Vec<u8>)>>,
}

/// Writes a file next to the one at `real`, which then takes its name. `old`: what the latter is like. `false`: nothing has
/// changed: nothing can be added to the directory, the new file would belong to somebody else or be without an attribute of the
/// old one, or the old one is in use.
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
    let written = file.stat().and_then(|created| {
        if (created.st_uid, created.st_gid) != (before.st_uid, before.st_gid) {
            return Ok(false);
        }
        // The directory gives a new file a label, and an ACL if it has one for that: the same as it gave the old one.
        #[cfg(unix)]
        {
            if old.attributes.is_none() || attributes(&file) != old.attributes {
                return Ok(false);
            }
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

/// Writes `text` over the start of `file`. `Err`: why it stopped, and how many bytes it had written by then.
fn write_at_start(file: &File, text: &[u8]) -> Result<(), (bun_sys::Error, usize)> {
    let mut written = 0;
    while written < text.len() {
        match bun_sys::pwrite(file.handle(), &text[written..], written as i64) {
            Ok(0) => {
                let error = bun_sys::Error::from_code(bun_sys::E::EIO, bun_sys::Tag::write);
                return Err((error, written));
            }
            Ok(count) => written += count,
            Err(error) => return Err((error, written)),
        }
    }
    Ok(())
}

/// Writes `text` into the file at `real`. The file is only cut to its new length once all of `text` is in it. If that fails
/// partway (disk full, quota, file size limit), the old text is put back.
fn overwrite(real: &[u8], text: &[u8]) -> Result<(), Vec<u8>> {
    let flags = O::RDWR | O::CLOEXEC | O::NOFOLLOW;
    let (file, old) = File::openat(Fd::cwd(), real, flags, 0)
        .and_then(|file| file.read_to_end().map(|old| (file, old)))
        .map_err(|error| describe(&error))?;
    let cut_to = |length: usize| bun_sys::ftruncate(file.handle(), length as i64);
    let (error, written) = match write_at_start(&file, text) {
        Ok(()) => match cut_to(text.len()) {
            Ok(()) => return Ok(()),
            Err(error) => (error, text.len()),
        },
        Err(failed) => failed,
    };
    // Only what was overwritten: a file size limit also refuses to write bytes past it that are already there, and on macOS
    // to set a length past it that the file already has.
    let restored = write_at_start(&file, &old[..written.min(old.len())])
        .map_err(|(error, _)| error)
        .and_then(|()| match written > old.len() {
            true => cut_to(old.len()),
            false => Ok(()),
        });
    let mut why = describe(&error);
    if restored.is_err() {
        why.extend_from_slice(b". The file may be damaged: its old text could not be put back");
    }
    Err(why)
}

/// Replaces the text of the file at `real`, a path of the system without links: by a file that takes its name, so that nobody
/// reads a part of `text`, where that leaves all else as it is. Otherwise in place, as ESLint and Prettier write every file.
fn write_through(real: &[u8], text: &[u8]) -> Result<(), Vec<u8>> {
    let is_replaced = || -> bun_sys::Result<bool> {
        // If you can't write a file, you shouldn't be able to replace it either.
        let file = File::openat(Fd::cwd(), real, O::RDWR | O::CLOEXEC | O::NOFOLLOW, 0)?;
        let before = Before {
            stat: file.stat()?,
            #[cfg(unix)]
            attributes: attributes(&file),
        };
        // On Windows nothing takes the name of a file that is open.
        drop(file);
        // A file with two names would be two files afterwards.
        Ok(before.stat.st_nlink <= 1 && replace(real, text, &before)?)
    };
    match is_replaced() {
        Ok(true) => Ok(()),
        Ok(false) => overwrite(real, text),
        Err(error) => Err(describe(&error)),
    }
}

/// The nearest directory from `cwd` upward that has a `.git` or a `.jj`, as for the ignore files, or else `cwd`. Without links.
fn repository(cwd: &[u8]) -> Option<Vec<u8>> {
    let cwd = real_path(cwd)?;
    let is_root = |it: &&[u8]| {
        [&b".git"[..], b".jj"]
            .iter()
            .any(|name| link_kind_and_size(&paths::join(it, name)).is_some())
    };
    let found = paths::ancestors(&cwd).find(is_root).map(<[u8]>::to_vec);
    Some(found.unwrap_or(cwd))
}

const LEADS_OUT: &[u8] = b"it is a symlink to a file outside the repository";

/// Whether `path`, which is below `cwd`, gets to `real`, its path without links, by a link that leads out of the repository.
fn leads_out(cwd: &[u8], path: &[u8], real: &[u8]) -> bool {
    // `bun lint` has the path as the system writes it.
    let (portable, real) = (paths::from_native(path), paths::from_native(real));
    real != portable
        && paths::inside(cwd, &portable).is_some()
        && !repository(cwd).is_some_and(|it| paths::inside(&it, &real).is_some())
}

/// The real paths of the files that a run has written. Two paths can lead to one file (a link, a letter in the other case), and
/// two threads that replace the same file at the same time fail now and then on Windows. Two hard links have a real path each:
/// `bun fmt` knows them by [`Identity`].
#[derive(Default)]
pub(crate) struct Written(Guarded<FxHashSet<Vec<u8>>>);

/// Replaces the text of the file at `path`, which exists. What links to the file still does. `Err`: why it is not written.
/// A link below `cwd`, the working directory, is not followed out of the repository: nobody reads the links of a checkout.
/// A file that is in `written` already is left as it is.
pub(crate) fn write_atomically(
    written: &Written,
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
    // NTFS keeps a file that is open and has lost its name to another in a directory of its own. That is where this one is if
    // another thread, which has reached it by another path, has replaced it since it was opened here. The new one has the name.
    if cfg!(windows) && leads_out(cwd, path, &real) {
        real = resolve()?;
    }
    if leads_out(cwd, path, &real) {
        return Err(LEADS_OUT.to_vec());
    }
    if !written.0.lock().insert(real.clone()) {
        return Ok(());
    }
    write_through(&real, text)
}

/// `path` without links, where the file and some of the directories that it is in need not exist. A link to nothing is followed to
/// where the file would be made.
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

/// The identity of what keeps nothing that is written to it: a pipe, a socket, a terminal, `/dev/null`.
fn identity_if_stream(found: &bun_sys::Stat) -> Option<Identity> {
    let kind = bun_sys::kind_from_mode(found.st_mode as _);
    (!matches!(kind, EntryKind::File | EntryKind::Directory))
        .then_some((found.st_dev as _, found.st_ino as _))
}

/// Writes `text` to `stream`, which `path` leads to. Nothing is made, replaced or cut.
fn write_to_stream(cwd: &[u8], path: &[u8], stream: Identity, text: &[u8]) -> Result<(), Vec<u8>> {
    // `/dev/stdout` that is a pipe has no path without links, and nothing in a repository is without one.
    let real = real_path(path);
    let is_refused = match &real {
        Some(real) => leads_out(cwd, path, real),
        None => paths::inside(cwd, &paths::from_native(path)).is_some(),
    };
    if is_refused {
        return Err(LEADS_OUT.to_vec());
    }
    let (checked, last_link) = match &real {
        Some(real) => (&real[..], O::NOFOLLOW),
        None => (path, 0),
    };
    let file = File::openat(Fd::cwd(), checked, O::WRONLY | O::CLOEXEC | last_link, 0)
        .map_err(|error| describe(&error))?;
    let opened = file.stat().map_err(|error| describe(&error))?;
    // Something else can be there by now, and a file would keep the rest of its text. The links of `path` can lead elsewhere too.
    let is_as_checked = |opened: Identity| real.is_some() || opened == stream;
    match identity_if_stream(&opened).is_some_and(is_as_checked) {
        true => file.write_all(text).map_err(|error| describe(&error)),
        false => Err(b"it was replaced while it was opened".to_vec()),
    }
}

/// Writes a file that need not exist, and makes the directories that it is in. `Err`: why it is not written. As for
/// [`write_atomically`], a link below `cwd` is not followed out of the repository. A pipe or a device gets `text`: `/dev/stdout`.
pub(crate) fn write_new(cwd: &[u8], path: &[u8], text: &[u8]) -> Result<(), Vec<u8>> {
    if cfg!(unix)
        && let Ok(found) = bun_sys::stat(for_libuv(path, &mut path_buffer_pool::get()))
        && let Some(stream) = identity_if_stream(&found)
    {
        return write_to_stream(cwd, path, stream, text);
    }
    let real = real_path_of_new(path).map_err(|error| describe(&error))?;
    if leads_out(cwd, path, &real) {
        return Err(LEADS_OUT.to_vec());
    }
    // Open the path that was checked, not `path`, and follow no link that has appeared there since.
    let flags = O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC | O::NOFOLLOW;
    File::make_open(&real, flags, 0o666)
        .and_then(|file| file.write_all(text))
        .map_err(|error| describe(&error))
}
