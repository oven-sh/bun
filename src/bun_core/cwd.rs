//! The process working directory.
//!
//! Read from the operating system once, at process start ([`startup`]), and
//! again only when Bun changes directory (`bun_sys::chdir`/`fchdir` call
//! [`set`]). Code that needs the working directory reads it here with
//! [`get`] and joins onto it, rather than asking the OS again or keeping its
//! own copy.

use core::alloc::Layout;
use core::hash::{BuildHasherDefault, Hash, Hasher};
use core::mem::size_of;
use core::ptr;
use core::slice;
use core::sync::atomic::{AtomicPtr, Ordering};

use crate::{Mutex, PathBuffer, ZStr};

/// A recorded directory: the length, then the bytes and a NUL, in one
/// allocation, so that [`CWD`] is a thin pointer and [`get`] is two loads.
#[repr(C)]
struct Entry {
    len: usize,
    bytes: [u8; 0],
}

impl Entry {
    #[inline(always)]
    fn bytes(&self) -> &[u8] {
        // SAFETY: every `Entry` is followed in its allocation by `len` bytes
        // and a NUL (`EMPTY`, `set`).
        unsafe { slice::from_raw_parts(self.bytes.as_ptr(), self.len) }
    }
}

impl PartialEq for Entry {
    fn eq(&self, other: &Self) -> bool {
        self.bytes() == other.bytes()
    }
}
impl Eq for Entry {}
impl Hash for Entry {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.bytes().hash(state);
    }
}
impl hashbrown::Equivalent<&'static Entry> for [u8] {
    fn equivalent(&self, entry: &&'static Entry) -> bool {
        entry.bytes() == self
    }
}

#[repr(C)]
struct Empty {
    len: usize,
    nul: u8,
}
static EMPTY: Empty = Empty { len: 0, nul: 0 };

/// The current record; points at `EMPTY` until [`startup`], then at an
/// element of `VISITED`.
static CWD: AtomicPtr<Entry> = AtomicPtr::new(&EMPTY as *const Empty as *mut Entry);

/// Every directory recorded so far, one entry per distinct path, never freed:
/// paths derived from an earlier one may still be in use after a `chdir`, and
/// returning to a directory reuses its entry. Grows only with the number of
/// different directories the process changes into.
static VISITED: Mutex<
    Option<hashbrown::HashSet<&'static Entry, BuildHasherDefault<bun_wyhash::Wyhash>>>,
> = Mutex::new(None);

/// Why [`startup`] could not read the working directory, until a `chdir`
/// records one.
static UNREAD: Mutex<Option<crate::Error>> = Mutex::new(None);

/// The working directory as the OS reports it: absolute, no trailing
/// separator except for a filesystem root.
#[inline(always)]
pub fn get() -> &'static [u8] {
    // SAFETY: `CWD` always points at a live, never-freed `Entry`.
    unsafe { (*CWD.load(Ordering::Acquire)).bytes() }
}

/// [`get`], NUL-terminated.
#[inline(always)]
pub fn get_z() -> &'static ZStr {
    let bytes = get();
    // SAFETY: a NUL follows every entry's bytes.
    unsafe { ZStr::from_raw(bytes.as_ptr(), bytes.len()) }
}

/// Reads and records the working directory; call once at process start,
/// before anything calls [`get`]. If the OS cannot report one (removed, or an
/// ancestor is not searchable) the executable's directory stands in — how
/// Node starts from a deleted directory — and [`init`] reports the error to
/// commands that must not guess.
pub fn startup() {
    let mut buf = PathBuffer::uninit();
    match crate::getcwd(&mut buf) {
        Ok(cwd) => {
            set(cwd.as_bytes());
        }
        Err(err) => {
            let exe_dir: &[u8] = crate::self_exe_path()
                .ok()
                .and_then(|p| crate::dirname(p.as_bytes()))
                .filter(|d| d.len() < crate::MAX_PATH_BYTES)
                .unwrap_or(if cfg!(windows) { b"C:\\" } else { b"/" });
            set(exe_dir);
            *UNREAD.lock() = Some(err);
        }
    }
}

/// The working directory, or the error from [`startup`] if the OS could not
/// report one and nothing has been recorded since. For a command's first use,
/// where continuing from a stand-in directory would act on the wrong project.
pub fn init() -> crate::CrateResult<&'static [u8]> {
    match *UNREAD.lock() {
        Some(err) => Err(err),
        None => Ok(get()),
    }
}

/// Records `path` as the working directory. For [`startup`] and
/// `bun_sys::chdir`/`fchdir`, which have just read it back from the OS;
/// nothing else should need this.
pub fn set(path: &[u8]) -> &'static ZStr {
    let mut visited = VISITED.lock();
    let visited = visited.get_or_insert_with(Default::default);
    let entry: &'static Entry = match visited.get(path) {
        Some(e) => e,
        None => {
            let layout =
                Layout::from_size_align(size_of::<Entry>() + path.len() + 1, align_of::<Entry>())
                    .unwrap();
            // SAFETY: `layout` is non-zero-sized; the writes stay within it.
            let entry: &'static Entry = unsafe {
                let p = std::alloc::alloc(layout);
                if p.is_null() {
                    std::alloc::handle_alloc_error(layout);
                }
                p.cast::<usize>().write(path.len());
                let bytes = p.add(size_of::<Entry>());
                ptr::copy_nonoverlapping(path.as_ptr(), bytes, path.len());
                bytes.add(path.len()).write(0);
                &*p.cast::<Entry>()
            };
            let inserted = visited.insert(entry);
            debug_assert!(inserted, "cwd entry lookup and insert disagree");
            entry
        }
    };
    CWD.store(ptr::from_ref(entry).cast_mut(), Ordering::Release);
    *UNREAD.lock() = None;
    // SAFETY: a NUL follows every entry's bytes.
    unsafe { ZStr::from_raw(entry.bytes().as_ptr(), entry.len) }
}
