//! The process's working directory.
//!
//! Read from the OS when the process starts ([`startup`]) and again after each
//! change of directory (`bun_sys::chdir` and `fchdir` call [`set`]). Nothing
//! else writes it. Bun changes directory on its main thread only, so one
//! thread writes and any thread reads.

use core::ptr;
use core::sync::atomic::{AtomicPtr, Ordering};
use std::collections::BTreeMap;
use std::sync::OnceLock;

use crate::{Mutex, PathBuffer, ZStr};

struct Recorded {
    /// Ends with a NUL.
    path: Box<[u8]>,
    /// Why the OS could not name the working directory, if `path` is the
    /// directory standing in for it.
    error: Option<crate::Error>,
}

impl Recorded {
    fn new(path: &[u8], error: Option<crate::Error>) -> Self {
        let mut bytes = Vec::with_capacity(path.len() + 1);
        bytes.extend_from_slice(path);
        bytes.push(0);
        Self {
            path: bytes.into_boxed_slice(),
            error,
        }
    }

    #[inline]
    fn path(&self) -> &ZStr {
        ZStr::from_slice_with_nul(&self.path)
    }
}

/// One word, so a reader on another thread has the directory from before a
/// change or the one from after it, never part of each.
static CURRENT: AtomicPtr<Recorded> = AtomicPtr::new(ptr::null_mut());

/// Every directory the OS has named, by name. None is freed, which is what
/// lets [`get`] return `'static`, and going back to one finds it here, so
/// there is one for each directory and not one for each change.
static NAMED: Mutex<BTreeMap<&'static [u8], &'static Recorded>> = Mutex::new(BTreeMap::new());

static STAND_IN: OnceLock<Recorded> = OnceLock::new();

#[inline]
fn current() -> &'static Recorded {
    let recorded = CURRENT.load(Ordering::Acquire);
    // SAFETY: null, or a `&'static Recorded` that `make_current` stored.
    unsafe { recorded.as_ref() }.expect("bun_core::cwd::startup() has not run")
}

fn make_current(recorded: &'static Recorded) {
    CURRENT.store(ptr::from_ref(recorded).cast_mut(), Ordering::Release);
}

/// Absolute, as the OS names it, with no trailing separator unless it is a
/// filesystem root.
///
/// If the OS could not name the working directory when the process started
/// (it was removed, say), this is the executable's directory until a change of
/// directory succeeds. That lets `bun file.js` start, as `node file.js` does.
/// A command that acts on the project it was run in calls [`require`].
#[inline]
pub fn get() -> &'static [u8] {
    get_z().as_bytes()
}

/// [`get`], NUL-terminated.
#[inline]
pub fn get_z() -> &'static ZStr {
    current().path()
}

/// [`get`], or the OS's error if it could not name the working directory.
pub fn require() -> crate::CrateResult<&'static [u8]> {
    match current().error {
        Some(error) => Err(error),
        None => Ok(get()),
    }
}

/// Called once, from `main`, before anything reads the working directory.
pub fn startup() {
    let mut buf = PathBuffer::ZEROED;
    match crate::getcwd(&mut buf) {
        Ok(cwd) => set(cwd.as_bytes()),
        Err(error) => {
            let exe_dir = crate::self_exe_path()
                .ok()
                .and_then(|exe| crate::dirname(exe.as_bytes()))
                // Readers copy this into path buffers, and a path from
                // /proc/self/exe is not bounded by their size.
                .filter(|dir| dir.len() < crate::MAX_PATH_BYTES)
                .unwrap_or(if cfg!(windows) { b"C:\\" } else { b"/" });
            make_current(STAND_IN.get_or_init(|| Recorded::new(exe_dir, Some(error))));
        }
    }
}

/// For [`startup`] and `bun_sys`, with what the OS calls the working
/// directory.
pub fn set(path: &[u8]) {
    let mut named = NAMED.lock();
    let recorded = match named.get(path) {
        Some(recorded) => *recorded,
        None => {
            let recorded: &'static Recorded = Box::leak(Box::new(Recorded::new(path, None)));
            named.insert(recorded.path().as_bytes(), recorded);
            recorded
        }
    };
    make_current(recorded);
}
