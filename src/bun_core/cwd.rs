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
use core::ptr::{self, NonNull};
use core::slice;
use core::sync::atomic::{AtomicPtr, Ordering};

use crate::{Mutex, PathBuffer, ZStr};

/// Header of a recorded directory; `len` bytes and a NUL follow it in the
/// same allocation, so that [`CWD`] is a thin pointer and [`get`] is two
/// loads. Only ever handled by raw pointer, so the pointer keeps provenance
/// over the whole allocation.
#[repr(C)]
struct Entry {
    len: usize,
    bytes: [u8; 0],
}

/// # Safety
/// `p` is `EMPTY` or a `set` allocation (never freed): `len` bytes and a NUL
/// follow the header.
#[inline(always)]
unsafe fn entry_bytes(p: *const Entry) -> &'static [u8] {
    // SAFETY: per the contract above, `len` initialized bytes follow `*p`.
    unsafe { slice::from_raw_parts(ptr::addr_of!((*p).bytes).cast::<u8>(), (*p).len) }
}

#[derive(Clone, Copy)]
struct EntryPtr(NonNull<Entry>);
// SAFETY: points at immutable, never-freed memory.
unsafe impl Send for EntryPtr {}
// SAFETY: as above.
unsafe impl Sync for EntryPtr {}
impl EntryPtr {
    #[inline(always)]
    fn bytes(self) -> &'static [u8] {
        // SAFETY: every `EntryPtr` comes from `set`.
        unsafe { entry_bytes(self.0.as_ptr()) }
    }
}
impl PartialEq for EntryPtr {
    fn eq(&self, other: &Self) -> bool {
        self.bytes() == other.bytes()
    }
}
impl Eq for EntryPtr {}
impl Hash for EntryPtr {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.bytes().hash(state);
    }
}
impl hashbrown::Equivalent<EntryPtr> for [u8] {
    fn equivalent(&self, entry: &EntryPtr) -> bool {
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
/// element of `STATE.visited`.
static CWD: AtomicPtr<Entry> = AtomicPtr::new(ptr::addr_of!(EMPTY) as *mut Entry);

struct State {
    /// Every directory recorded so far, one entry per distinct path, never
    /// freed: paths derived from an earlier one may still be in use after a
    /// `chdir`, and returning to a directory reuses its entry. Grows only with
    /// the number of different directories the process changes into.
    visited: Option<hashbrown::HashSet<EntryPtr, BuildHasherDefault<bun_wyhash::Wyhash>>>,
    /// Why [`startup`] could not read the working directory, until a `chdir`
    /// records one.
    unread: Option<crate::Error>,
}
static STATE: Mutex<State> = Mutex::new(State {
    visited: None,
    unread: None,
});

/// The working directory as the OS reports it: absolute, no trailing
/// separator except for a filesystem root.
#[inline(always)]
pub fn get() -> &'static [u8] {
    let p = CWD.load(Ordering::Acquire);
    debug_assert!(
        !ptr::eq(p, ptr::addr_of!(EMPTY).cast()),
        "cwd::get() before cwd::startup()"
    );
    // SAFETY: `CWD` always points at `EMPTY` or a `set` allocation.
    unsafe { entry_bytes(p) }
}

/// Changes whenever the working directory does; for caches of values derived
/// from it.
#[inline(always)]
pub fn version() -> *const () {
    CWD.load(Ordering::Acquire).cast()
}

/// [`get`], NUL-terminated.
#[inline(always)]
pub fn get_z() -> &'static ZStr {
    let p = CWD.load(Ordering::Acquire);
    debug_assert!(
        !ptr::eq(p, ptr::addr_of!(EMPTY).cast()),
        "cwd::get_z() before cwd::startup()"
    );
    // SAFETY: as for `get`; a NUL follows the bytes.
    unsafe { ZStr::from_raw(ptr::addr_of!((*p).bytes).cast::<u8>(), (*p).len) }
}

/// Reads and records the working directory; call once at process start,
/// before anything calls [`get`]. If the OS cannot report one (removed, or an
/// ancestor is not searchable) the executable's directory stands in — how
/// Node starts from a deleted directory — and [`require`] reports the error
/// to commands that must not guess.
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
                .filter(|d| crate::path_sep::is_absolute_native(d))
                .unwrap_or(if cfg!(windows) { b"C:\\" } else { b"/" });
            set(exe_dir);
            STATE.lock().unread = Some(err);
        }
    }
}

/// The working directory, or the error from [`startup`] if the OS could not
/// report one and nothing has been recorded since. For a command's first use,
/// where continuing from a stand-in directory would act on the wrong project.
pub fn require() -> crate::CrateResult<&'static [u8]> {
    match STATE.lock().unread {
        Some(err) => Err(err),
        None => Ok(get()),
    }
}

/// Records `path` as the working directory. For [`startup`] and
/// `bun_sys::chdir`/`fchdir`, which have just read it back from the OS;
/// nothing else should need this.
pub fn set(path: &[u8]) {
    let mut state = STATE.lock();
    let visited = state.visited.get_or_insert_with(Default::default);
    let entry: EntryPtr = match visited.get(path) {
        Some(e) => *e,
        None => {
            let layout =
                Layout::from_size_align(size_of::<Entry>() + path.len() + 1, align_of::<Entry>())
                    .unwrap();
            // SAFETY: `layout` is non-zero-sized and `Entry`-aligned; the
            // writes stay within it.
            #[expect(clippy::cast_ptr_alignment, reason = "layout is Entry-aligned")]
            let entry = unsafe {
                let p = std::alloc::alloc(layout).cast::<Entry>();
                let Some(entry) = NonNull::new(p) else {
                    std::alloc::handle_alloc_error(layout)
                };
                ptr::addr_of_mut!((*p).len).write(path.len());
                let bytes = ptr::addr_of_mut!((*p).bytes).cast::<u8>();
                ptr::copy_nonoverlapping(path.as_ptr(), bytes, path.len());
                bytes.add(path.len()).write(0);
                EntryPtr(entry)
            };
            let inserted = visited.insert(entry);
            debug_assert!(inserted, "cwd entry lookup and insert disagree");
            entry
        }
    };
    state.unread = None;
    CWD.store(entry.0.as_ptr(), Ordering::Release);
}
