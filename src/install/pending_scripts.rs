//! `node_modules/.bun-pending-scripts`: the placed packages whose lifecycle scripts have not finished.

use bun_core::{ZBox, ZStr, strings};
use bun_sys::{self as sys, Fd, File};

/// From the project's root, which is the cwd of an install. So are the paths in the file.
const PATH: &ZStr = bun_core::zstr!("node_modules/.bun-pending-scripts");
/// Far more than the records of one install. A longer file is not read, and stays as it is.
const MAX_BYTES: usize = 1 << 20;

struct Unfinished {
    /// The hoisted tree whose `node_modules` has `folder`, or the isolated store entry.
    id: u32,
    folder: Box<[u8]>,
    /// Its path in the file. Empty when this install has not looked at the file.
    key: Box<[u8]>,
}

#[derive(Default)]
pub(crate) struct PendingScripts {
    unfinished: Vec<Unfinished>,
    /// Open, and locked while this install lives: the next one can tell a dead writer from this one.
    file: Option<File>,
    /// False under `--ignore-scripts`, while another install holds the lock, and after a failed write.
    writes: bool,
    /// What a dead install left: the paths with a `+` line and no later `-` line.
    stale: Vec<Box<[u8]>>,
}

enum Opened {
    /// With the size of the file.
    Locked(File, usize),
    Missing,
    /// Another install holds the lock, or the file cannot be opened or locked.
    Busy,
}

impl PendingScripts {
    /// Once per linker pass. `may_exist == false`: this pass made `node_modules`, so no file is there.
    pub(crate) fn load(&mut self, writes: bool, may_exist: bool) {
        // An earlier pass of this process has its own tree ids. What it left is in the file.
        self.unfinished.clear();
        self.file = None;
        self.stale.clear();
        self.writes = writes;
        // Not an `open`: its error for a file that is not there copies the path.
        if writes && may_exist && sys::exists_z(PATH) {
            self.open(false);
        }
    }

    /// Takes the lock, and reads what a dead install left.
    #[cold]
    fn open(&mut self, create: bool) {
        let opened = sys::openat(Fd::cwd(), PATH, open_flags(create), 0o644);
        let (file, size) = match lock(opened, create) {
            Opened::Locked(file, size) => (file, size),
            Opened::Missing => return,
            Opened::Busy => {
                self.writes = false;
                return;
            }
        };
        if size > MAX_BYTES {
            self.writes = false;
            return;
        }
        // By offset: on Windows `read_to_end` reads at the cursor, which `O::APPEND` moved.
        let mut bytes = vec![0u8; size];
        let read = file.pread_all(&mut bytes, 0).and_then(|len| {
            let (stale, whole) = parse(&bytes[..len]);
            // A dead install did not end its last line: what that line names was not placed yet.
            if whole < size {
                truncate(&file, whole)?;
            }
            Ok(stale)
        });
        match read {
            Ok(stale) => {
                self.stale = stale;
                self.file = Some(file);
            }
            // A file that cannot be read says nothing: it stays, like one that is locked.
            Err(_) => self.writes = false,
        }
    }

    /// A dead install left records. The linker compares them with the placements of this pass.
    #[inline]
    pub(crate) fn has_stale(&self) -> bool {
        !self.stale.is_empty()
    }

    pub(crate) fn is_stale(&self, key: &[u8]) -> bool {
        self.stale.iter().any(|stale| **stale == *key)
    }

    /// A stale package is in place behind the link at `key`.
    pub(crate) fn has_stale_behind(&self, key: &[u8]) -> bool {
        (self.stale.iter()).any(|stale| is_behind(stale, key) && is_in_place(stale))
    }

    /// The package at a stale `key` stays as it is: its scripts are not to run any more.
    pub(crate) fn forget_stale(&mut self, key: &[u8]) {
        if let Some(index) = self.stale.iter().position(|stale| **stale == *key) {
            self.stale.swap_remove(index);
            self.append(b'-', key);
        }
    }

    /// Before a package is placed, if its scripts are to run. `key`: its path, for the file.
    pub(crate) fn begin(&mut self, id: u32, folder: &[u8], key: impl FnOnce() -> Vec<u8>) {
        if self.position(id, folder).is_some() {
            return;
        }
        let mut key = if self.writes || !self.stale.is_empty() {
            key()
        } else {
            Vec::new()
        };
        if !is_record(&key) {
            key.clear();
        } else if self.writes && self.file.is_none() {
            self.open(true);
            self.writes = self.file.is_some();
        }
        // It is placed again now: no more what the dead install left.
        if let Some(index) = self.stale.iter().position(|stale| **stale == *key) {
            self.stale.swap_remove(index);
        }
        self.append(b'+', &key);
        self.unfinished.push(Unfinished {
            id,
            folder: Box::from(folder),
            key: key.into_boxed_slice(),
        });
    }

    /// The package has no script left to run. Nothing happens for one that is not listed.
    pub(crate) fn done(&mut self, id: u32, folder: &[u8]) {
        if let Some(index) = self.position(id, folder) {
            let unfinished = self.unfinished.swap_remove(index);
            self.append(b'-', &unfinished.key);
        }
    }

    /// A script failed: `remove` takes each listed package out of `node_modules`. Ends the pass.
    pub(crate) fn discard(&mut self, mut remove: impl FnMut(u32, &[u8])) {
        let stale = core::mem::take(&mut self.stale);
        let in_place: Vec<_> = stale.iter().filter(|key| is_in_place(key)).collect();
        let mut unfinished = core::mem::take(&mut self.unfinished);
        // A nested tree has the higher id, and is behind the link of a workspace in its parent.
        unfinished.sort_by_key(|unfinished| core::cmp::Reverse(unfinished.id));
        for unfinished in unfinished {
            // A link stays, and stays listed, while it leads to a stale package.
            if !(in_place.iter()).any(|stale| is_behind(stale, &unfinished.key)) {
                remove(unfinished.id, &unfinished.folder);
                self.append(b'-', &unfinished.key);
            }
        }
        self.close(!in_place.is_empty());
    }

    /// After the last script of a pass: deletes the file unless something is still listed.
    pub(crate) fn finish(&mut self) {
        // A stale package that the pass did not come to stays listed while it is in place.
        let unvisited = self.stale.drain(..).any(|key| is_in_place(&key));
        self.close(unvisited);
    }

    fn close(&mut self, unvisited: bool) {
        if self.file.is_some() && self.unfinished.is_empty() && !unvisited {
            // Before the lock goes, so that no other install can hold the file this removes.
            let _ = sys::unlinkat(Fd::cwd(), PATH);
        }
        self.file = None;
    }

    /// `bun patch <pkg>` put a copy to edit at `dir`: the next install is not to replace it.
    #[cold]
    pub(crate) fn forget_directory(&mut self, dir: &ZStr) {
        let (writes, may_exist) = (true, true);
        self.load(writes, may_exist);
        if let (false, Ok(root)) = (self.stale.is_empty(), sys::stat(bun_core::zstr!("."))) {
            // A stale package goes with all that is in it: `dir`, and each directory above it.
            let mut taken = Vec::new();
            let mut above = Some(dir.as_bytes());
            while let Some(path) = above {
                match sys::stat(&ZBox::from_bytes(path)) {
                    Ok(st) if (st.st_dev, st.st_ino) != (root.st_dev, root.st_ino) => {
                        taken.push((st.st_dev, st.st_ino));
                    }
                    _ => break,
                }
                above = bun_paths::dirname(path).filter(|parent| parent.len() < path.len());
            }
            // `lstat`: of a workspace only the link goes, not the directory that it names.
            let same: Vec<Box<[u8]>> = (self.stale.iter())
                .filter(|key| {
                    sys::lstat(&ZBox::from_bytes(key))
                        .is_ok_and(|st| taken.contains(&(st.st_dev, st.st_ino)))
                })
                .cloned()
                .collect();
            for key in same {
                self.forget_stale(&key);
            }
        }
        self.finish();
    }

    fn position(&self, id: u32, folder: &[u8]) -> Option<usize> {
        (self.unfinished.iter()).position(|listed| listed.id == id && *listed.folder == *folder)
    }

    /// A line `+<path>` before a package is placed, `-<path>` after its last script.
    fn append(&mut self, kind: u8, key: &[u8]) {
        let Some(file) = &self.file else {
            return;
        };
        if key.is_empty() || !self.writes {
            return;
        }
        let mut line = Vec::with_capacity(key.len() + 2);
        line.push(kind);
        line.extend_from_slice(key);
        line.push(b'\n');
        // One `write` to a file opened for append: a line is whole or absent.
        if let Err(err) = file.write_all(&line) {
            bun_core::warn!(
                "failed to record pending lifecycle scripts in <b>{}<r>: {}",
                bstr::BStr::new(PATH.as_bytes()),
                err,
            );
            self.writes = false;
        }
    }
}

/// An error is not "gone": a record stays while nothing says that its package is gone.
fn is_in_place(key: &[u8]) -> bool {
    sys::directory_exists_at(Fd::cwd(), &ZBox::from_bytes(key)).unwrap_or(true)
}

fn is_behind(path: &[u8], link: &[u8]) -> bool {
    !link.is_empty()
        && path.len() > link.len()
        && path.starts_with(link)
        && matches!(path[link.len()], b'/' | b'\\')
}

/// On Windows a write is at the cursor, which `O::APPEND` moved to the end once.
fn truncate(file: &File, len: usize) -> sys::Maybe<()> {
    sys::ftruncate(file.handle, len as i64)?;
    file.seek_to(len as u64)
}

fn open_flags(create: bool) -> i32 {
    use sys::O;
    O::RDWR | O::APPEND | O::NOFOLLOW | if create { O::CREAT } else { 0 }
}

/// A path that an install writes: relative, without a line break, a NUL or a `..`.
fn is_record(key: &[u8]) -> bool {
    !key.is_empty()
        && strings::index_of_any(key, b"\n\0").is_none()
        && !bun_paths::is_absolute(key)
        && !strings::split_any(key, b"/\\").any(|part| part == b"..")
}

/// The paths with a `+` line and no later `-` line, and where the whole lines end.
#[cold]
fn parse(bytes: &[u8]) -> (Vec<Box<[u8]>>, usize) {
    let mut pending: Vec<Box<[u8]>> = Vec::new();
    let mut rest = bytes;
    while let Some(end) = strings::index_of_char_usize(rest, b'\n') {
        let line = &rest[..end];
        rest = &rest[end + 1..];
        let Some((kind, key)) = line.split_first() else {
            continue;
        };
        let listed = pending.iter().position(|pending| **pending == *key);
        match (kind, listed) {
            (b'+', None) if is_record(key) => pending.push(Box::from(key)),
            (b'-', Some(index)) => {
                pending.swap_remove(index);
            }
            _ => {}
        }
    }
    (pending, bytes.len() - rest.len())
}

/// Opens the file again once: its last owner can delete it between an open and the lock.
#[cold]
fn lock(mut opened: sys::Maybe<Fd>, create: bool) -> Opened {
    for again in [true, false] {
        let file = match opened {
            Ok(fd) => File::from_fd(fd),
            Err(err) if err.get_errno() == sys::E::ENOENT => return Opened::Missing,
            Err(_) => return Opened::Busy,
        };
        if !matches!(
            sys::flock(file.handle, sys::FileLockMode::Exclusive, true),
            Ok(true)
        ) {
            return Opened::Busy;
        }
        // The lock is on the file, not on its name. It counts while the name still leads to it.
        if let (Ok(locked), Ok(named)) = (sys::fstat(file.handle), sys::fstatat(Fd::cwd(), PATH))
            && locked.st_ino == named.st_ino
            && locked.st_dev == named.st_dev
        {
            return Opened::Locked(file, locked.st_size as usize);
        }
        if !again {
            break;
        }
        opened = sys::openat(Fd::cwd(), PATH, open_flags(create), 0o644);
    }
    Opened::Busy
}
