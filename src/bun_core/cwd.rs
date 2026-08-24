//! The process working directory.
//!
//! Read from the operating system when the process starts ([`init`] /
//! [`init_or_exe_dir`]) and again only when Bun changes directory
//! (`bun_sys::chdir` calls [`set`]). Code that needs the working directory
//! reads it here with [`get`] and joins onto it, rather than asking the OS
//! again or keeping its own copy.

use core::ptr;
use core::sync::atomic::{AtomicPtr, Ordering};

use crate::{Mutex, Once, PathBuffer, ZStr};

/// A recorded directory. `&ZStr` is a fat pointer, so entries are boxed to
/// give [`CWD`] a thin pointer to swap.
struct Entry(&'static ZStr);

/// The current record; null until first read. Points at an element of
/// `VISITED`.
static CWD: AtomicPtr<Entry> = AtomicPtr::new(ptr::null_mut());

/// Every directory recorded so far, one entry per distinct path, never freed:
/// paths derived from an earlier one may still be in use after a `chdir`, and
/// returning to a directory reuses its entry. Grows only with the number of
/// different directories the process changes into.
static VISITED: Mutex<Vec<&'static Entry>> = Mutex::new(Vec::new());

fn recorded() -> Option<&'static ZStr> {
    let cwd = CWD.load(Ordering::Acquire);
    // SAFETY: non-null values are leaked `VISITED` elements.
    (!cwd.is_null()).then(|| unsafe { (*cwd).0 })
}

/// The working directory: absolute, symlink-free (as the OS reports it), no
/// trailing separator except for a filesystem root.
#[inline]
pub fn get() -> &'static [u8] {
    z().as_bytes()
}

/// [`get`], NUL-terminated.
#[inline]
pub fn z() -> &'static ZStr {
    match recorded() {
        Some(cwd) => cwd,
        None => first_read(),
    }
}

/// Nothing recorded yet: read it now. If even that fails, answer with the
/// executable's directory for this call without recording it, so [`init`]
/// still reports the error to a caller that must not guess.
#[cold]
fn first_read() -> &'static ZStr {
    read().unwrap_or_else(|_| exe_dir())
}

/// Reads and records the working directory unless already recorded. Fails
/// if the OS cannot report one (removed, or an ancestor is not searchable).
pub fn init() -> crate::CrateResult<&'static [u8]> {
    match recorded() {
        Some(cwd) => Ok(cwd.as_bytes()),
        None => read().map(ZStr::as_bytes),
    }
}

/// [`init`], but where the OS cannot report a working directory, records the
/// executable's directory instead — how Node starts from a deleted directory,
/// leaving `process.cwd()` to report the error.
pub fn init_or_exe_dir() -> &'static [u8] {
    init().unwrap_or_else(|_| set(exe_dir().as_bytes()).as_bytes())
}

/// Records `path` as the working directory. For `bun_sys::chdir`, which has
/// just read it back from the OS; nothing else should need this.
pub fn set(path: &[u8]) -> &'static ZStr {
    let mut visited = VISITED.lock();
    let entry: &'static Entry = match visited.iter().find(|e| e.0.as_bytes() == path) {
        Some(e) => e,
        None => {
            let bytes: &'static [u8] =
                Box::leak(crate::ZBox::from_bytes(path).into_boxed_slice_with_nul());
            let entry: &'static Entry = Box::leak(Box::new(Entry(ZStr::from_slice_with_nul(bytes))));
            visited.push(entry);
            entry
        }
    };
    CWD.store(ptr::from_ref(entry).cast_mut(), Ordering::Release);
    entry.0
}

fn read() -> crate::CrateResult<&'static ZStr> {
    let mut buf = PathBuffer::uninit();
    let read = crate::getcwd(&mut buf)?;
    Ok(set(read.as_bytes()))
}

fn exe_dir() -> &'static ZStr {
    static EXE_DIR: Once<&'static ZStr> = Once::new();
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
