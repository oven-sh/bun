//! `node_modules/.bun-pending-scripts` lists the packages that are in place and whose lifecycle
//! scripts did not finish. A record is `+<path>` before the package is placed and `-<path>` after
//! its last script, where `<path>` is the package's directory from the project's root. The install
//! that writes holds `flock` on the file: the next install can tell a dead writer from one whose
//! scripts still run, and installs what a dead writer left again.

use bun_core::{ZBox, ZStr, strings};
use bun_sys::{self as sys, Fd, File};

/// From the project's root, which is the cwd of an install. So are the paths in the file.
const PATH: &ZStr = bun_core::zstr!("node_modules/.bun-pending-scripts");
/// Far more than the records of one install. What is past it is not read.
const MAX_BYTES: usize = 1 << 20;

#[derive(Default)]
pub(crate) struct PendingScripts {
    /// Open and locked by this install.
    file: Option<File>,
    /// False under `--ignore-scripts` and `bun patch`, and while another install holds the lock.
    enabled: bool,
    /// What a dead install left.
    stale: Vec<Box<[u8]>>,
    /// What this install lists and has not finished.
    begun: Vec<Box<[u8]>>,
}

enum Opened {
    Locked(File),
    Missing,
    /// Another install holds the lock, or the file cannot be opened or locked.
    Busy,
}

impl PendingScripts {
    /// Once per install, before the first package. With `honor == false` the file is left as it is.
    pub(crate) fn load(&mut self, honor: bool) {
        *self = Self::default();
        if !honor {
            return;
        }
        match open_locked(false) {
            Opened::Missing => self.enabled = true,
            Opened::Busy => {}
            Opened::Locked(file) => {
                self.enabled = true;
                // By offset: on Windows `read_to_end` reads at the cursor, which `O::APPEND` moved.
                let mut bytes = vec![0u8; file.get_end_pos().unwrap_or(0).min(MAX_BYTES)];
                if let Ok(len) = file.pread_all(&mut bytes, 0) {
                    self.stale = parse(&bytes[..len]);
                }
                self.file = Some(file);
            }
        }
    }

    /// This install has listed a package, or a dead install has.
    #[inline]
    pub(crate) fn is_open(&self) -> bool {
        self.file.is_some()
    }

    #[inline]
    pub(crate) fn has_stale(&self) -> bool {
        !self.stale.is_empty()
    }

    pub(crate) fn is_stale(&self, path: &[u8]) -> bool {
        self.stale.iter().any(|stale| **stale == *path)
    }

    /// Before `path` is placed, if its scripts are to run. True: it is listed until `done(path)`.
    pub(crate) fn begin(&mut self, path: &[u8]) -> bool {
        if !self.enabled || strings::contains_char(path, b'\n') {
            return false;
        }
        if self.begun.iter().any(|begun| **begun == *path) {
            return true;
        }
        if self.file.is_none() {
            match open_locked(true) {
                Opened::Locked(file) => self.file = Some(file),
                Opened::Missing | Opened::Busy => {
                    self.enabled = false;
                    return false;
                }
            }
        }
        remove(&mut self.stale, path);
        self.append(b'+', path);
        self.begun.push(Box::from(path));
        true
    }

    /// `path` has no script left to run, or is not in place any more. No-op for a path not listed.
    pub(crate) fn done(&mut self, path: &[u8]) {
        if remove(&mut self.begun, path) || remove(&mut self.stale, path) {
            self.append(b'-', path);
        }
    }

    /// After the last script of this install. Deletes the file unless something is still listed.
    pub(crate) fn finish(&mut self) {
        let Some(file) = self.file.take() else {
            return;
        };
        // A stale package this install did not come to stays listed while it is in place.
        let unvisited = self.stale.drain(..).any(|path| {
            sys::directory_exists_at(Fd::cwd(), &ZBox::from_bytes(&path)).unwrap_or(false)
        });
        if self.begun.is_empty() && !unvisited {
            // Before the lock goes, so that no other install can hold the file this removes.
            let _ = sys::unlinkat(Fd::cwd(), PATH);
        }
        drop(file);
    }

    /// `bun patch <pkg>` put a copy to edit at `dir`: the next install is not to replace it.
    pub(crate) fn forget_directory(&mut self, dir: &ZStr) {
        self.load(true);
        if let (true, Ok(edited)) = (self.has_stale(), sys::stat(dir)) {
            let same: Vec<Box<[u8]>> = (self.stale.iter())
                .filter(|path| {
                    sys::fstatat(Fd::cwd(), &ZBox::from_bytes(path))
                        .is_ok_and(|st| st.st_ino == edited.st_ino && st.st_dev == edited.st_dev)
                })
                .cloned()
                .collect();
            for path in same {
                self.done(&path);
            }
        }
        self.finish();
    }

    fn append(&self, kind: u8, path: &[u8]) {
        let Some(file) = &self.file else {
            return;
        };
        let mut record = Vec::with_capacity(path.len() + 2);
        record.push(kind);
        record.extend_from_slice(path);
        record.push(b'\n');
        // One `write` to a file opened for append: a record is whole or absent.
        let _ = file.write_all(&record);
    }
}

fn remove(paths: &mut Vec<Box<[u8]>>, path: &[u8]) -> bool {
    match paths.iter().position(|listed| **listed == *path) {
        Some(index) => {
            paths.swap_remove(index);
            true
        }
        None => false,
    }
}

/// The paths with a `+` record and no later `-` record. A last line that a kill cut is ignored.
fn parse(bytes: &[u8]) -> Vec<Box<[u8]>> {
    let mut pending: Vec<Box<[u8]>> = Vec::new();
    let mut rest = bytes;
    while let Some(end) = strings::index_of_char_usize(rest, b'\n') {
        let line = &rest[..end];
        rest = &rest[end + 1..];
        match line.split_first() {
            Some((b'+', path)) if !path.is_empty() && !pending.iter().any(|p| **p == *path) => {
                pending.push(Box::from(path));
            }
            Some((b'-', path)) => {
                remove(&mut pending, path);
            }
            _ => {}
        }
    }
    pending
}

fn open_locked(create: bool) -> Opened {
    use sys::O;
    let flags = O::RDWR | O::APPEND | O::CLOEXEC | O::NOFOLLOW | if create { O::CREAT } else { 0 };
    // Twice: the last owner can delete the file between this open and this lock.
    for _ in 0..2 {
        let file = match File::openat(Fd::cwd(), PATH.as_bytes(), flags, 0o644) {
            Ok(file) => file,
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
    }
    if create {
        Opened::Busy
    } else {
        Opened::Missing
    }
}
