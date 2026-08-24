//! The process working directory.
//!
//! Read from the operating system when the process starts ([`init`] /
//! [`init_or_exe_dir`]) and again only when Bun changes directory
//! (`bun_sys::chdir` calls [`refresh`]). Code that needs the working
//! directory reads it here with [`get`] and joins onto it, rather than
//! asking the OS again or keeping its own copy.

use core::ptr;
use core::sync::atomic::{AtomicPtr, Ordering};

use crate::{Mutex, PathBuffer, ZStr};

/// The current record; null until first read. Points at an entry of
/// `VISITED`, which is never freed.
static CWD: AtomicPtr<&'static ZStr> = AtomicPtr::new(ptr::null_mut());

/// Every directory recorded so far. Paths derived from an earlier one may
/// still be in use after a `chdir`, so entries live for the rest of the
/// process; returning to a directory reuses its entry.
static VISITED: Mutex<Vec<&'static &'static ZStr>> = Mutex::new(Vec::new());

/// The working directory: absolute, symlink-free (as the OS reports it), no
/// trailing separator except for a filesystem root.
#[inline]
pub fn get() -> &'static ZStr {
    let cwd = CWD.load(Ordering::Acquire);
    if !cwd.is_null() {
        // SAFETY: non-null values are leaked `VISITED` entries.
        return unsafe { *cwd };
    }
    first_read()
}

/// Nothing recorded yet: read it now. If even that fails, answer with the
/// executable's directory for this call without recording it, so [`init`]
/// still reports the error to a caller that must not guess.
#[cold]
fn first_read() -> &'static ZStr {
    match refresh() {
        Ok(cwd) => cwd,
        Err(_) => exe_dir(),
    }
}

/// Reads and records the working directory unless already recorded. Fails
/// if the OS cannot report one (e.g. the directory was deleted).
pub fn init() -> crate::CrateResult<&'static ZStr> {
    let cwd = CWD.load(Ordering::Acquire);
    if !cwd.is_null() {
        // SAFETY: as in `get`.
        return Ok(unsafe { *cwd });
    }
    refresh()
}

/// [`init`], but where the OS cannot report a working directory, records the
/// executable's directory instead — how Node starts from a deleted directory,
/// leaving `process.cwd()` to report the error.
pub fn init_or_exe_dir() -> &'static ZStr {
    init().unwrap_or_else(|_| record(exe_dir().as_bytes()))
}

/// Re-reads the working directory from the OS and records it.
pub fn refresh() -> crate::CrateResult<&'static ZStr> {
    let mut buf = PathBuffer::uninit();
    let read = crate::getcwd(&mut buf)?;
    Ok(record(read.as_bytes()))
}

fn record(path: &[u8]) -> &'static ZStr {
    let mut visited = VISITED.lock();
    let entry: &'static &'static ZStr = match visited.iter().find(|e| e.as_bytes() == path) {
        Some(e) => e,
        None => {
            let bytes: &'static [u8] =
                Box::leak(crate::ZBox::from_bytes(path).into_boxed_slice_with_nul());
            let entry: &'static &'static ZStr =
                Box::leak(Box::new(ZStr::from_slice_with_nul(bytes)));
            visited.push(entry);
            entry
        }
    };
    CWD.store(ptr::from_ref(entry).cast_mut(), Ordering::Release);
    entry
}

fn exe_dir() -> &'static ZStr {
    static EXE_DIR: std::sync::OnceLock<&'static ZStr> = std::sync::OnceLock::new();
    EXE_DIR.get_or_init(|| {
        let dir: &[u8] = crate::self_exe_path()
            .ok()
            .and_then(|p| crate::dirname(p.as_bytes()))
            .unwrap_or(if cfg!(windows) { b"C:\\" } else { b"/" });
        let bytes: &'static [u8] =
            Box::leak(crate::ZBox::from_bytes(dir).into_boxed_slice_with_nul());
        ZStr::from_slice_with_nul(bytes)
    })
}
