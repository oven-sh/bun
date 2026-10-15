//! The packages that an install placed and whose lifecycle scripts have not finished.
//!
//! The list is in memory for the install itself: a script that fails discards what is on it. It is
//! also in `node_modules/.bun-pending-scripts` for the next install, because an install that dies
//! discards nothing. A record is `+<path>` before the package is placed and `-<path>` after its
//! last script, where `<path>` is the package's directory from the project's root. The install that
//! writes holds `flock` on the file, so the next install can tell a dead writer from one whose
//! scripts still run. It discards what a dead writer left and places it again.

use bun_core::{ZBox, ZStr, strings};
use bun_sys::{self as sys, Fd, File};

/// From the project's root, which is the cwd of an install. So are the paths in the file.
const PATH: &ZStr = bun_core::zstr!("node_modules/.bun-pending-scripts");
/// Far more than the records of one install. What is past it is not read.
const MAX_BYTES: usize = 1 << 20;

struct Unfinished {
    /// The hoisted tree whose `node_modules` has `folder`, or the isolated store entry.
    id: u32,
    folder: Box<[u8]>,
    /// Its path in the file. Empty when this install does not write the file.
    key: Box<[u8]>,
}

#[derive(Default)]
pub(crate) struct PendingScripts {
    unfinished: Vec<Unfinished>,
    /// Open and locked by this install.
    file: Option<File>,
    /// False under `--ignore-scripts` and `bun patch`, and while another install holds the lock.
    writes: bool,
    /// What a dead install left.
    stale: Vec<Box<[u8]>>,
    /// The file of a dead install lost bytes: it may have listed any placement.
    all_stale: bool,
}

enum Opened {
    Locked(File),
    Missing,
    /// Another install holds the lock, or the file cannot be opened or locked.
    Busy,
}

impl PendingScripts {
    /// Once per linker pass, before the first package. `writes == false` leaves the file as it is.
    /// `may_exist == false`: this pass made `node_modules`, so there is no file to look for.
    pub(crate) fn load(&mut self, writes: bool, may_exist: bool) {
        // An earlier pass of this process has its own tree ids. What it left is in the file.
        self.unfinished.clear();
        self.file = None;
        self.stale.clear();
        self.all_stale = false;
        self.writes = writes;
        // Not an `open`: its error for a file that is not there copies the path.
        if writes && may_exist && sys::exists_z(PATH) {
            self.load_found();
        }
    }

    #[cold]
    fn load_found(&mut self) {
        match lock(sys::openat(Fd::cwd(), PATH, open_flags(false), 0), false) {
            Opened::Missing => {}
            Opened::Busy => self.writes = false,
            Opened::Locked(file) => {
                // By offset: on Windows `read_to_end` reads at the cursor, which `O::APPEND` moved.
                let mut bytes = vec![0u8; file.get_end_pos().unwrap_or(0).min(MAX_BYTES)];
                let len = file.pread_all(&mut bytes, 0).unwrap_or(0);
                (self.stale, self.all_stale) = parse(&bytes[..len]);
                self.file = Some(file);
            }
        }
    }

    /// A dead install left records. The linker compares them with the placements of this pass.
    #[inline]
    pub(crate) fn has_stale(&self) -> bool {
        self.all_stale || !self.stale.is_empty()
    }

    pub(crate) fn is_stale(&self, key: &[u8]) -> bool {
        self.all_stale || self.stale.iter().any(|stale| **stale == *key)
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
        let key = if self.writes {
            self.write_begin(key())
        } else {
            Box::default()
        };
        self.unfinished.push(Unfinished {
            id,
            folder: Box::from(folder),
            key,
        });
    }

    fn write_begin(&mut self, key: Vec<u8>) -> Box<[u8]> {
        if !is_record(&key) {
            return Box::default();
        }
        if self.file.is_none() {
            match lock(sys::openat(Fd::cwd(), PATH, open_flags(true), 0o644), true) {
                Opened::Locked(file) => self.file = Some(file),
                Opened::Missing | Opened::Busy => {
                    self.writes = false;
                    return Box::default();
                }
            }
        }
        if let Some(index) = self.stale.iter().position(|stale| **stale == *key) {
            self.stale.swap_remove(index);
        }
        self.append(b'+', &key);
        key.into_boxed_slice()
    }

    /// The package has no script left to run. Nothing happens for one that is not listed.
    pub(crate) fn done(&mut self, id: u32, folder: &[u8]) {
        if let Some(index) = self.position(id, folder) {
            let unfinished = self.unfinished.swap_remove(index);
            self.append(b'-', &unfinished.key);
        }
    }

    /// A script failed: `remove` takes each listed package out of `node_modules`.
    pub(crate) fn discard(&mut self, mut remove: impl FnMut(u32, &[u8])) {
        for unfinished in core::mem::take(&mut self.unfinished) {
            remove(unfinished.id, &unfinished.folder);
            self.append(b'-', &unfinished.key);
        }
    }

    /// After the last script of a pass. Deletes the file unless something is still listed.
    /// `restricted`: the pass did not come to every placement of the project.
    pub(crate) fn finish(&mut self, restricted: bool) {
        let Some(file) = self.file.take() else {
            return;
        };
        // A stale package the pass did not come to stays listed while it is in place.
        let unvisited = self.stale.drain(..).any(|key| {
            sys::directory_exists_at(Fd::cwd(), &ZBox::from_bytes(&key)).unwrap_or(false)
        });
        let listed = (self.unfinished.iter()).any(|unfinished| !unfinished.key.is_empty());
        if !listed && !unvisited && !(restricted && self.all_stale) {
            // Before the lock goes, so that no other install can hold the file this removes.
            let _ = sys::unlinkat(Fd::cwd(), PATH);
        }
        self.all_stale = false;
        drop(file);
    }

    /// `bun patch <pkg>` put a copy to edit at `dir`: the next install is not to replace it.
    #[cold]
    pub(crate) fn forget_directory(&mut self, dir: &ZStr) {
        self.load(true, true);
        if let (false, Ok(edited)) = (self.stale.is_empty(), sys::stat(dir)) {
            let same: Vec<Box<[u8]>> = (self.stale.iter())
                .filter(|key| {
                    sys::fstatat(Fd::cwd(), &ZBox::from_bytes(key))
                        .is_ok_and(|st| st.st_ino == edited.st_ino && st.st_dev == edited.st_dev)
                })
                .cloned()
                .collect();
            for key in same {
                self.forget_stale(&key);
            }
        }
        self.finish(true);
    }

    fn position(&self, id: u32, folder: &[u8]) -> Option<usize> {
        (self.unfinished.iter()).position(|listed| listed.id == id && *listed.folder == *folder)
    }

    fn append(&self, kind: u8, key: &[u8]) {
        let Some(file) = &self.file else {
            return;
        };
        if key.is_empty() {
            return;
        }
        let mut record = Vec::with_capacity(key.len() + 2);
        record.push(kind);
        record.extend_from_slice(key);
        record.push(b'\n');
        // One `write` to a file opened for append: a record is whole or absent.
        let _ = file.write_all(&record);
    }
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

/// The paths with a `+` record and no later `-` record, and whether bytes are lost: the file is
/// empty, or a kill cut its last line. Then nothing says which placements it listed.
#[cold]
fn parse(bytes: &[u8]) -> (Vec<Box<[u8]>>, bool) {
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
    (pending, bytes.is_empty() || !rest.is_empty())
}

/// `opened` is a first open of the file. It is opened again once: its last owner can delete it
/// between an open and the lock.
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
            return Opened::Locked(file);
        }
        if !again {
            break;
        }
        opened = sys::openat(Fd::cwd(), PATH, open_flags(create), 0o644);
    }
    if create {
        Opened::Busy
    } else {
        Opened::Missing
    }
}
