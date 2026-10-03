//! The journal of packages whose lifecycle scripts have not finished, at
//! `node_modules/.bun-pending-scripts`.
//!
//! A package is verifiable (its `package.json` is in place) before any of its
//! lifecycle scripts has run, so a script that fails, or an install that is killed,
//! leaves a tree the next install would report as unchanged. The install that is
//! about to link such a package writes `+<path>` here first and `-<path>` once its
//! last script exited 0; `<path>` is the package directory relative to the project
//! root. The next install reads the file once and installs again every package that
//! is still pending.
//!
//! The writer holds an OS lock on the file for as long as it lives (`flock`; on
//! Windows the file is opened without sharing). A second install that finds the
//! lock taken leaves the journal and the packages in it alone: their scripts are
//! running right now.

use bun_core::strings;
use bun_paths::AutoAbsPath;
use bun_paths::path_options::AssumeOk as _;
use bun_sys::{self, Fd, File};

const JOURNAL: &[u8] = b".bun-pending-scripts";

#[derive(Default)]
pub struct PendingScripts {
    /// The journal, open and locked by this process.
    file: Option<File>,
    /// This install honors the journal (lifecycle scripts are enabled) and no other
    /// live install owns it.
    enabled: bool,
    /// Left pending by an install that failed or died.
    stale: Vec<Box<[u8]>>,
    /// Begun by this install and not done yet.
    begun: u32,
}

enum Opened {
    Owned(File),
    Missing,
    /// Another live install holds it, or it cannot be opened or locked.
    Busy,
}

impl PendingScripts {
    /// Read what an earlier install left pending. Without a call, or with
    /// `honor == false`, every other method does nothing.
    pub fn load(&mut self, honor: bool) {
        *self = Self::default();
        if !honor {
            return;
        }
        match open_locked(false) {
            Opened::Missing => self.enabled = true,
            Opened::Busy => {}
            Opened::Owned(file) => {
                self.enabled = true;
                if let Ok(bytes) = file.read_to_end() {
                    self.stale = parse(&bytes);
                }
                self.file = Some(file);
            }
        }
    }

    /// This install records the packages it links and retries the ones left pending.
    #[inline]
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    #[inline]
    pub fn has_stale(&self) -> bool {
        !self.stale.is_empty()
    }

    /// `path` was left pending by an earlier install.
    pub fn is_stale(&self, path: &[u8]) -> bool {
        self.stale.iter().any(|p| **p == *path)
    }

    /// Record that `path` is about to be linked and has scripts to run. On `true` the
    /// caller owes one `done(path)`.
    pub fn begin(&mut self, path: &[u8]) -> bool {
        if !self.enabled {
            return false;
        }
        if self.file.is_none() {
            match open_locked(true) {
                Opened::Owned(file) => self.file = Some(file),
                Opened::Missing | Opened::Busy => {
                    self.enabled = false;
                    return false;
                }
            }
        }
        self.forget_stale(path);
        self.append(b'+', path);
        self.begun += 1;
        true
    }

    /// The scripts of `path` finished, or it has none to run: after a `begin`, or for
    /// a stale path that this install does not run scripts for.
    pub fn done(&mut self, path: &[u8]) {
        if self.file.is_none() {
            return;
        }
        if !self.forget_stale(path) {
            self.begun = self.begun.saturating_sub(1);
        }
        self.append(b'-', path);
    }

    /// Every package was visited and every script of this install has exited: delete
    /// the journal unless something is still pending.
    pub fn finish(&mut self) {
        let Some(file) = self.file.take() else {
            return;
        };
        let mut still_pending = self.begun > 0;
        for path in self.stale.drain(..) {
            // a package this install did not visit; forget it once its directory is gone
            let mut abs = AutoAbsPath::init_top_level_dir();
            abs.append(&path).assume_ok();
            if bun_sys::directory_exists_at(Fd::cwd(), abs.slice_z()).unwrap_or(false) {
                still_pending = true;
            }
        }
        if still_pending {
            return;
        }
        let mut journal = journal_path();
        #[cfg(windows)]
        {
            // no sharing: the file cannot be deleted while our handle is open
            drop(file);
            let _ = bun_sys::unlink(journal.slice_z());
        }
        #[cfg(not(windows))]
        {
            // while we hold the lock, so that no other install can own the inode we unlink
            let _ = bun_sys::unlink(journal.slice_z());
            drop(file);
        }
    }

    /// `bun patch <pkg>` replaced the package at `dir` with a copy for the user to edit. Close
    /// whatever is pending for that directory; `bun patch --commit` installs the patched
    /// package and runs its scripts.
    pub fn forget_directory(&mut self, dir: &bun_core::ZStr) {
        self.load(true);
        if let (true, Ok(edited)) = (self.has_stale(), bun_sys::stat(dir)) {
            let same: Vec<Box<[u8]>> = self
                .stale
                .iter()
                .filter(|path| {
                    let mut abs = AutoAbsPath::init_top_level_dir();
                    abs.append(path).assume_ok();
                    matches!(
                        bun_sys::stat(abs.slice_z()),
                        Ok(st) if st.st_ino == edited.st_ino && st.st_dev == edited.st_dev
                    )
                })
                .cloned()
                .collect();
            for path in same {
                self.done(&path);
            }
        }
        self.finish();
    }

    fn forget_stale(&mut self, path: &[u8]) -> bool {
        match self.stale.iter().position(|p| **p == *path) {
            Some(i) => {
                self.stale.swap_remove(i);
                true
            }
            None => false,
        }
    }

    fn append(&self, kind: u8, path: &[u8]) {
        let Some(file) = &self.file else {
            return;
        };
        let mut record = Vec::with_capacity(path.len() + 2);
        record.push(kind);
        record.extend_from_slice(path);
        record.push(b'\n');
        // One write per record: the file is opened for append, so a record is whole or absent.
        let _ = file.write_all(&record);
    }
}

fn journal_path() -> AutoAbsPath {
    let mut path = AutoAbsPath::init_top_level_dir();
    path.append(b"node_modules").assume_ok();
    path.append(JOURNAL).assume_ok();
    path
}

/// The paths that have a `+` record and no later `-` record. A last line without a
/// newline was cut off by a kill and is ignored.
fn parse(bytes: &[u8]) -> Vec<Box<[u8]>> {
    let mut pending: Vec<Box<[u8]>> = Vec::new();
    let mut rest = bytes;
    while let Some(end) = strings::index_of_char_usize(rest, b'\n') {
        let line = &rest[..end];
        rest = &rest[end + 1..];
        let Some((&kind, path)) = line.split_first() else {
            continue;
        };
        if path.is_empty() {
            continue;
        }
        let at = pending.iter().position(|p| **p == *path);
        match (kind, at) {
            (b'+', None) => pending.push(Box::from(path)),
            (b'-', Some(i)) => {
                pending.swap_remove(i);
            }
            _ => {}
        }
    }
    pending
}

#[cfg(not(windows))]
fn open_locked(create: bool) -> Opened {
    use bun_sys::O;
    let mut path = journal_path();
    let flags =
        O::RDWR | O::APPEND | O::CLOEXEC | O::NOFOLLOW | if create { O::CREAT } else { 0 };
    // Twice: the previous owner can delete the file between our open and our lock.
    for _ in 0..2 {
        let file = match File::openat(Fd::cwd(), path.slice(), flags, 0o644) {
            Ok(file) => file,
            Err(err) if err.get_errno() == bun_sys::E::ENOENT => return Opened::Missing,
            Err(_) => return Opened::Busy,
        };
        if !bun_sys::try_flock_exclusive(file.handle) {
            return Opened::Busy;
        }
        // The lock is on the inode. It only means ownership if that inode is still at the path.
        if let (Ok(ours), Ok(at_path)) = (bun_sys::fstat(file.handle), bun_sys::stat(path.slice_z()))
        {
            if ours.st_ino == at_path.st_ino && ours.st_dev == at_path.st_dev {
                return Opened::Owned(file);
            }
        }
    }
    if create { Opened::Busy } else { Opened::Missing }
}

#[cfg(windows)]
fn open_locked(create: bool) -> Opened {
    use bun_sys::windows as w;
    let mut path = journal_path();
    let mut wbuf = bun_paths::w_path_buffer_pool::get();
    let wide = bun_paths::string_paths::to_w_path(&mut wbuf.0[..], path.slice());
    match bun_sys::open_file_at_windows(
        Fd::INVALID,
        wide,
        bun_sys::NtCreateFileOptions {
            access_mask: w::FILE_READ_DATA
                | w::FILE_READ_ATTRIBUTES
                | w::FILE_APPEND_DATA
                | w::SYNCHRONIZE,
            disposition: if create { w::FILE_OPEN_IF } else { w::FILE_OPEN },
            options: w::FILE_NON_DIRECTORY_FILE | w::FILE_SYNCHRONOUS_IO_NONALERT,
            // every other open fails while this handle lives, and Windows closes it when the process dies
            sharing_mode: 0,
            ..Default::default()
        },
    ) {
        Ok(fd) => Opened::Owned(File::from_fd(fd)),
        Err(err) if err.get_errno() == bun_sys::E::ENOENT => Opened::Missing,
        Err(_) => Opened::Busy,
    }
}
