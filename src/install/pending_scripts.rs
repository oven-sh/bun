//! `node_modules/.bun-pending-scripts` lists the packages that are in place and whose lifecycle
//! scripts did not finish. A record is `+<path>` before the package is placed and `-<path>` after its
//! last script, where `<path>` is the package's directory from the project's root. The install that
//! writes holds `flock` on the file: the next install can tell a dead writer from one whose scripts
//! still run, and installs what a dead writer left again.

use bun_core::{ZStr, strings};
use bun_paths::AutoAbsPath;
use bun_paths::path_options::AssumeOk as _;
use bun_sys::{self as sys, Fd, File};

const NAME: &[u8] = b".bun-pending-scripts";

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
                if let Ok(bytes) = file.read_to_end() {
                    self.stale = parse(&bytes);
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

    /// `path` has no script left to run, or is not in place any more. Nothing for a path not listed.
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
            let mut abs = AutoAbsPath::init_top_level_dir();
            abs.append(&path).assume_ok();
            sys::directory_exists_at(Fd::cwd(), abs.slice_z()).unwrap_or(false)
        });
        if self.begun.is_empty() && !unvisited {
            // Before the lock goes, so that no other install can hold the file this removes.
            let _ = sys::unlink(file_path().slice_z());
        }
        drop(file);
    }

    /// `bun patch <pkg>` put a copy to edit at `dir`: the next install is not to replace it.
    pub(crate) fn forget_directory(&mut self, dir: &ZStr) {
        self.load(true);
        if let (true, Ok(edited)) = (self.has_stale(), sys::stat(dir)) {
            let same: Vec<Box<[u8]>> = (self.stale.iter())
                .filter(|path| {
                    let mut abs = AutoAbsPath::init_top_level_dir();
                    abs.append(path).assume_ok();
                    sys::stat(abs.slice_z())
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

fn file_path() -> AutoAbsPath {
    let mut path = AutoAbsPath::init_top_level_dir();
    path.append(b"node_modules").assume_ok();
    path.append(NAME).assume_ok();
    path
}

/// The paths with a `+` record and no later `-` record. A kill can cut the last line: it is ignored.
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
    let mut path = file_path();
    let flags = O::RDWR | O::APPEND | O::CLOEXEC | O::NOFOLLOW | if create { O::CREAT } else { 0 };
    // Twice: the last owner can delete the file between this open and this lock.
    for _ in 0..2 {
        let file = match File::openat(Fd::cwd(), path.slice(), flags, 0o644) {
            Ok(file) => file,
            Err(err) if err.get_errno() == sys::E::ENOENT => return Opened::Missing,
            Err(_) => return Opened::Busy,
        };
        if !matches!(sys::flock(file.handle, sys::FileLockMode::Exclusive, true), Ok(true)) {
            return Opened::Busy;
        }
        // The lock is on the file, not on its name: it counts only while the name still leads to it.
        if let (Ok(locked), Ok(named)) = (sys::fstat(file.handle), sys::stat(path.slice_z()))
            && locked.st_ino == named.st_ino
            && locked.st_dev == named.st_dev
        {
            return Opened::Locked(file);
        }
    }
    if create { Opened::Busy } else { Opened::Missing }
}
