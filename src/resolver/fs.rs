use core::cell::RefCell;
use core::ffi::c_void;
use std::borrow::Cow;
use std::io::Write as _;

use bstr::BStr;

use bun_alloc::{AllocError, allocators};
use bun_collections::VecExt as _;
use bun_core::MutableString;
use bun_core::{FeatureFlags, Generation, ZStr, env_var};
use bun_paths::resolve_path::platform;
use bun_paths::strings;
use bun_paths::{MAX_PATH_BYTES, PathBuffer, SEP, resolve_path as path_handler};
use bun_ptr::Interned;
use bun_sys::{self, Fd};
use bun_threading::Mutex;

// scope tag renamed `fs` → `Fs` so it doesn't collide with `fs:` fn
// params (the `declare_scope!` macro emits a `static` with the tag name, and
// edition-2024 forbids fn params shadowing statics).
bun_core::define_scoped_log!(debug, Fs, hidden);

// `bun.strings.BOM` — BOM detection + UTF-16-LE-to-UTF-8 re-encoding
// (simdutf-backed). The canonical implementation lives in
// `bun_core::strings`; `bun_resolver::fs_full::BOM` re-exports it.
pub use bun_core::strings::BOM;

pub(crate) mod preallocate {
    pub(crate) mod counts {
        pub(crate) const DIR_ENTRY: usize = 2048;
        pub(crate) const FILES: usize = 4096;
    }
}

pub(crate) type DirnameStoreBacking =
    allocators::BSSStringList<{ preallocate::counts::DIR_ENTRY * 2 }, { 128 + 1 }>;
pub(crate) type FilenameStoreBacking =
    allocators::BSSStringList<{ preallocate::counts::FILES * 2 }, { 64 + 1 }>;
pub(crate) type EntryStoreBacking = allocators::BSSList<Entry, { preallocate::counts::FILES * 2 }>;

// Per-monomorphization singleton storage, emitted at the declare site via
// `bss_*!` macros (returns `*mut`).
bun_alloc::bss_string_list! { pub dirname_store_backing : preallocate::counts::DIR_ENTRY * 2, 128 + 1 }
bun_alloc::bss_string_list! { pub filename_store_backing : preallocate::counts::FILES * 2, 64 + 1 }
bun_alloc::bss_list! { pub entry_store_backing : Entry, preallocate::counts::FILES * 2 }

/// ZST handle resolving to the
/// `dirname_store_backing()` singleton on every call.
pub struct DirnameStore(());
/// ZST handle resolving to the `filename_store_backing()` singleton.
pub struct FilenameStore(());

static DIRNAME_STORE_ZST: DirnameStore = DirnameStore(());
static FILENAME_STORE_ZST: FilenameStore = FilenameStore(());

// `BSSStringList::append`/`append_lower_case`/`print` now take a raw
// `*mut Self` receiver (matching `BSSList::append`), so the
// inner `self.mutex` is the sole serialization point and no `&mut` is ever
// materialized before the lock is held. The previous outer `LazyLock<Mutex>`
// pair existed only to prevent aliased-`&mut`-before-lock UB under the old
// `&mut self` receiver; with the raw-ptr receiver that hazard is gone, so the
// outer locks (and their `LazyLock` slow-init / `.text` overhead on the
// startup path) are dropped.

macro_rules! string_store_impl {
    ($t:ty, $zst:ident, $backing:ident, $bty:ty) => {
        impl $t {
            #[inline]
            pub fn instance() -> &'static Self {
                &$zst
            }
            #[inline]
            fn backing() -> *mut $bty {
                // returns the raw `*mut` singleton.
                // `BSSStringList`'s mutating methods take `*mut Self` and lock
                // internally, so callers may pass this directly without ever
                // forming a `&mut`.
                $backing()
            }
            pub fn append(&self, value: &[u8]) -> core::result::Result<&'static [u8], AllocError> {
                // SAFETY: `backing()` is the live process-lifetime singleton;
                // `BSSStringList::append` serializes on its inner mutex. The
                // returned slice borrows the singleton's never-freed storage
                // (heap-owned by a `'static` `BSSStringList` or a leaked
                // mi_malloc), so widening to `'static` is sound.
                unsafe { <$bty>::append(Self::backing(), &value) }
            }
            /// Format directly
            /// into the store's tail (no intermediate `String`). See
            /// `BSSStringList::print` (bun_alloc) for the in-place writer.
            pub fn print(
                &self,
                args: core::fmt::Arguments<'_>,
            ) -> core::result::Result<&'static [u8], AllocError> {
                // SAFETY: see `append`.
                let s = unsafe { <$bty>::print(Self::backing(), args)? };
                // SAFETY: storage owned by the process-lifetime `BSSStringList`
                // singleton (never freed); `Interned` is the canonical proof type.
                Ok(unsafe { bun_ptr::Interned::assume(s) }.as_bytes())
            }
            #[inline]
            pub fn exists(&self, value: &[u8]) -> bool {
                // SAFETY: `backing()` is the live process-lifetime singleton;
                // `exists` only reads `backing_buf`'s pointer/len (set once at
                // init, never mutated), so a shared `&` is sound even concurrent
                // with `append`.
                unsafe { (*Self::backing()).exists(value) }
            }
        }
        impl strings::Appender for &'static $t {
            fn append(&mut self, s: &[u8]) -> core::result::Result<&[u8], AllocError> {
                // SAFETY: see `<$t>::append`. Returned `'static` narrows to the
                // trait's elided lifetime.
                unsafe { <$bty>::append(<$t>::backing(), &s) }
            }
            fn append_lower_case(&mut self, s: &[u8]) -> core::result::Result<&[u8], AllocError> {
                // SAFETY: see `append`.
                unsafe { <$bty>::append_lower_case(<$t>::backing(), s) }
            }
        }
    };
}
string_store_impl!(
    DirnameStore,
    DIRNAME_STORE_ZST,
    dirname_store_backing,
    DirnameStoreBacking
);
string_store_impl!(
    FilenameStore,
    FILENAME_STORE_ZST,
    filename_store_backing,
    FilenameStoreBacking
);

/// Pre-resolved `FilenameStore` appender for the `readdir` hot loop.
///
/// `<FilenameStore as Appender>::append` re-evaluates `filename_store_backing()`
/// (a `bss_singleton!` accessor: `Once::call_once` + `AtomicPtr::load`) on every
/// call. `add_entry` runs once per directory entry, so for the
/// @material-ui/icons-style 11,000-entry directories that's 11,000+ redundant
/// `Once` atomic checks per directory. Resolving once up front and carrying the
/// raw pointer across the loop drops that to a single check per `readdir`.
pub struct FilenameStoreAppender {
    backing: *mut FilenameStoreBacking,
}
impl FilenameStoreAppender {
    #[inline]
    pub fn new() -> Self {
        // One `Once` check, hoisted out of the per-entry loop.
        Self {
            backing: filename_store_backing(),
        }
    }
}
impl strings::Appender for FilenameStoreAppender {
    #[inline]
    fn append(&mut self, s: &[u8]) -> core::result::Result<&[u8], AllocError> {
        // SAFETY: `backing` is the live process-lifetime `bss_string_list!`
        // singleton; `BSSStringList::append` takes `*mut Self` and serializes on
        // its inner mutex (no aliased `&mut` is ever formed). Returned slice
        // borrows the singleton's never-freed storage.
        let r = unsafe { FilenameStoreBacking::append(self.backing, &s)? };
        // SAFETY: storage owned by the process-lifetime `BSSStringList` singleton
        // (never freed); `Interned` is the canonical proof type for this widen.
        Ok(unsafe { bun_ptr::Interned::assume(r) }.as_bytes())
    }
    #[inline]
    fn append_lower_case(&mut self, s: &[u8]) -> core::result::Result<&[u8], AllocError> {
        // SAFETY: see `append`.
        let r = unsafe { FilenameStoreBacking::append_lower_case(self.backing, s)? };
        // SAFETY: see `append`.
        Ok(unsafe { bun_ptr::Interned::assume(r) }.as_bytes())
    }
}

// PORTING.md §Global mutable state: highest-fd watermark, written from
// resolver pool / bundler / router and read from the file-limit check below.
// `AtomicCell` (not `RacyCell`) because those callers run on different
// threads. POSIX-only fd ceiling tracking (Windows handles aren't ordered
// ints) — `set_max_fd` early-returns on Windows; the static is still declared
// so the cross-platform `MAX_FD` symbol resolves.
#[cfg(not(windows))]
pub(crate) static MAX_FD: bun_core::AtomicCell<bun_sys::RawFd> = bun_core::AtomicCell::new(0);

pub(crate) struct FileSystem;

impl FileSystem {
    #[inline]
    pub(crate) fn set_max_fd(fd: bun_sys::RawFd) {
        #[cfg(windows)]
        {
            let _ = fd;
            return;
        }
        #[cfg(not(windows))]
        {
            if !FeatureFlags::STORE_FILE_DESCRIPTORS {
                return;
            }

            let _ = MAX_FD.fetch_update(|cur| (fd > cur).then_some(fd));
        }
    }
}

// dirname_store/filename_store are &'static singletons —
// nothing owned to free, so no `impl Drop`.

// ══════════════════════════════════════════════════════════════════════════
// CANONICAL Entry / DirEntry / EntryLookup family.
//
// This is the SINGLE definition. The inline `pub mod fs { … }` block in
// `lib.rs` re-exports these via `pub use crate::fs_full::{…}` and deletes its
// own copies (and its second `bss_list!{entry_store_backing}` singleton).
//
// `Entry::kind`/`symlink` are decoupled from a concrete `RealFS` type via the
// `EntryKindResolver` trait so this block does NOT depend on which of the two
// `RealFS` copies is in scope; both impl the trait by forwarding to their own
// `RealFS::kind`. Once the (separate) `RealFS`/`Implementation` dedup lands,
// the trait collapses to a single impl.
// ══════════════════════════════════════════════════════════════════════════

/// Decouples `Entry::kind`/`symlink` (the lazy-stat path) from a concrete
/// `RealFS` type. Both the `fs_full::RealFS` here and the inline-`fs::RealFS`
/// in `lib.rs` impl this by forwarding to their own `RealFS::kind`.
pub trait EntryKindResolver {
    fn resolve_kind(
        &mut self,
        dir: &[u8],
        base: &[u8],
        existing_fd: Fd,
        store_fd: bool,
    ) -> crate::CrateResult<EntryCache>;
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EntryKind {
    Dir,
    File,
}

#[derive(Clone, Copy)]
pub struct EntryCache {
    pub symlink: Interned,
    /// Too much code expects this to be 0
    /// don't make it bun.invalid_fd
    pub fd: Fd,
    pub kind: EntryKind,
}

impl Default for EntryCache {
    fn default() -> Self {
        Self {
            symlink: Interned::EMPTY,
            fd: Fd::INVALID,
            kind: EntryKind::File,
        }
    }
}

// `cache` / `need_stat` are lazily populated by `Entry::kind` /
// `Entry::symlink` while callers hold a shared
// `&Entry`. `EntryCache` is `Copy`, so `Cell` gives us safe
// `.get()/.set()` through `&self` — the per-entry `mutex` serializes every
// rewrite of these `Cell`s across threads (the `unsafe impl Sync for Entry`
// below opts back in under that external-locking discipline).
pub struct Entry {
    pub cache: core::cell::Cell<EntryCache>,
    pub dir: &'static [u8],

    pub base_: strings::StringOrTinyString,

    // Necessary because the hash table uses it as a key
    pub base_lowercase_: strings::StringOrTinyString,

    pub mutex: Mutex,
    pub need_stat: core::cell::Cell<bool>,

    pub abs_path: Interned,
}

impl Entry {
    /// Snapshot of the lazily-populated stat cache. `EntryCache` is `Copy`
    /// (3 word-sized fields), so by-value return is free and avoids the
    /// `&self → &interior` aliasing hazard the old `UnsafeCell` accessor had.
    #[inline(always)]
    pub fn cache(&self) -> EntryCache {
        self.cache.get()
    }

    /// Overwrite the whole cache (interior mutability via `Cell`).
    #[inline(always)]
    pub fn set_cache(&self, c: EntryCache) {
        self.cache.set(c);
    }

    /// Update a single cache field. Read-modify-write is fine: callers hold
    /// the per-entry `mutex` so no torn writes; `EntryCache` is `Copy`.
    #[inline(always)]
    pub fn set_cache_fd(&self, fd: Fd) {
        let mut c = self.cache.get();
        c.fd = fd;
        self.cache.set(c);
    }

    #[inline(always)]
    pub fn set_cache_kind(&self, kind: EntryKind) {
        let mut c = self.cache.get();
        c.kind = kind;
        self.cache.set(c);
    }

    #[inline(always)]
    pub fn set_cache_symlink(&self, symlink: Interned) {
        let mut c = self.cache.get();
        c.symlink = symlink;
        self.cache.set(c);
    }

    #[inline]
    pub fn base(&self) -> &[u8] {
        self.base_.slice()
    }

    #[inline]
    pub fn base_lowercase(&self) -> &[u8] {
        self.base_lowercase_.slice()
    }

    /// Interned in DirnameStore.
    #[inline]
    pub fn dir(&self) -> &'static [u8] {
        self.dir
    }

    /// `Interned` is `Copy`.
    #[inline]
    pub fn abs_path(&self) -> Interned {
        self.abs_path
    }

    #[inline]
    pub fn set_abs_path(&mut self, p: Interned) {
        self.abs_path = p;
    }

    /// Stat-on-first-use.
    ///
    /// # Safety
    /// `fs` must point to a live `EntryKindResolver` (the process-global
    /// `RealFS` singleton in practice). `resolve_kind` must not re-enter
    /// this entry's `mutex` (it only performs syscalls and string interning).
    // `Entry` lives in the EntryStore BSSMap singleton. The lazy-stat rewrite
    // of `need_stat` / `cache` is serialized on the per-entry `mutex` here
    // (double-checked: the cached fast path stays lock-free). `fs` is `*mut`
    // so the call site does not require a second exclusive `&mut RealFS`
    // borrow while a `&mut Entry` (borrowed out of `RealFS.entries`) is live.
    // Generic over `R: EntryKindResolver` so this block is independent of
    // which `RealFS` copy `fs` points at (see file-top comment).
    pub unsafe fn kind<R: EntryKindResolver>(&self, fs: *mut R, store_fd: bool) -> EntryKind {
        if self.need_stat.get() {
            let _guard = self.mutex.lock_guard();
            if self.need_stat.get() {
                self.need_stat.set(false);
                // This is technically incorrect, but we are choosing not to handle errors here
                // SAFETY: `fs` points at the process-global RealFS singleton; `resolve_kind`
                // only does syscalls + string interning, so the short `&mut` cannot alias.
                match unsafe { &mut *fs }.resolve_kind(
                    self.dir,
                    self.base(),
                    self.cache().fd,
                    store_fd,
                ) {
                    Ok(c) => self.cache.set(c),
                    Err(_) => return self.cache().kind,
                }
            }
        }
        self.cache().kind
    }

    ///
    /// # Safety
    /// `fs` must point to a live `EntryKindResolver` (the process-global
    /// `RealFS` singleton in practice). See [`Entry::kind`].
    pub unsafe fn symlink<R: EntryKindResolver>(
        &self,
        fs: *mut R,
        store_fd: bool,
    ) -> &'static [u8] {
        if self.need_stat.get() {
            let _guard = self.mutex.lock_guard();
            if self.need_stat.get() {
                self.need_stat.set(false);
                // This error can happen if the file was deleted between the time the directory
                // was scanned and the time it was read
                // SAFETY: see the note on `Entry::kind`.
                match unsafe { &mut *fs }.resolve_kind(
                    self.dir,
                    self.base(),
                    self.cache().fd,
                    store_fd,
                ) {
                    Ok(c) => self.cache.set(c),
                    Err(_) => return b"",
                }
            }
        }
        self.cache().symlink.as_bytes()
    }
}

// `BSSList::append` requires `ValueType: Clone` (its overflow path
// retries with a copy). `Mutex`/`StringOrTinyString` aren't `Clone`, but for a
// freshly-constructed `Entry` (the only thing ever appended) a field-wise copy
// with a fresh `Mutex` is semantically equivalent to a by-value move.
impl Clone for Entry {
    fn clone(&self) -> Self {
        Self {
            cache: core::cell::Cell::new(self.cache.get()),
            dir: self.dir,
            base_: strings::StringOrTinyString::init(self.base_.slice()),
            base_lowercase_: strings::StringOrTinyString::init(self.base_lowercase_.slice()),
            mutex: Mutex::default(),
            need_stat: core::cell::Cell::new(self.need_stat.get()),
            abs_path: self.abs_path,
        }
    }
}

impl Default for Entry {
    fn default() -> Self {
        Self {
            cache: core::cell::Cell::new(EntryCache::default()),
            dir: b"",
            base_: strings::StringOrTinyString::init(b""),
            base_lowercase_: strings::StringOrTinyString::init(b""),
            mutex: Mutex::default(),
            need_stat: core::cell::Cell::new(true),
            abs_path: Interned::EMPTY,
        }
    }
}

// lifetime-generic, but resolver storage requires `'static`; in practice all
// three slices borrow process-lifetime interned data (`dir` → DirnameStore,
// `query` → FilenameStore copy made in `DirEntry::get`, `actual` → EntryStore).
#[derive(Clone, Copy)]
pub struct DifferentCase<'a> {
    pub dir: &'a [u8],
    pub query: &'a [u8],
    pub actual: &'a [u8],
}

// `entry` is a RAW `*mut Entry`. A safe
// `&self → &mut Entry` accessor would let two `get()` calls produce coexisting
// aliased `&mut Entry` (PORTING.md §Forbidden). Callers `unsafe { &mut *entry }`
// at each write site under the per-entry `Entry.mutex`.
pub struct EntryLookup<'a> {
    pub entry: *mut Entry,
    pub diff_case: Option<DifferentCase<'static>>,
    // tie the lookup's nominal lifetime to the DirEntry it came from
    _marker: core::marker::PhantomData<&'a Entry>,
}

impl<'a> EntryLookup<'a> {
    /// Shared borrow of the looked-up `Entry`.
    ///
    /// # Safety (encapsulated)
    /// `self.entry` is a slot in the process-lifetime `EntryStore` BSSMap
    /// singleton (see `dir_entry::EntryStore`); never freed. `Entry`'s
    /// only mutable state (`cache`) is behind `Cell`, so interior
    /// writes via `set_cache*()` do not alias this `&Entry`. The
    /// `PhantomData<&'a Entry>` ties the borrow to the `DirEntry` it was
    /// looked up from.
    #[inline(always)]
    pub fn entry(&self) -> &'a Entry {
        // SAFETY: ARENA — EntryStore-owned slot; see fn doc.
        unsafe { &*self.entry }
    }

    // former `entry_mut() -> &'a mut Entry` accessor removed
    // (zero callers). `Entry`'s only mutable state (`cache`) is `Cell`-backed,
    // so all mutation goes through `entry().set_cache*()` on a shared borrow;
    // no `&mut Entry` escape hatch is needed. Write sites that bypass the
    // accessor go through the raw `self.entry` field directly under the
    // per-entry `Entry.mutex` (see struct doc above).
}

/// `DirEntry` companion items: the entry map, the global entry store, and the
/// error pair type.
pub mod dir_entry {
    use super::{Entry, EntryStoreBacking};

    /// Lowercased-basename → entry-pointer map backing `DirEntry::data`.
    pub(crate) type EntryMap = bun_collections::StringHashMap<*mut Entry>;

    /// Process-wide append-only store that owns all `Entry` allocations.
    /// ZST handle resolving to the `entry_store_backing()` singleton.
    pub(crate) struct EntryStore(());

    impl EntryStore {
        #[inline]
        pub(crate) fn instance() -> *mut EntryStoreBacking {
            // returns the raw `*mut` singleton. Do NOT
            // materialize a `&'static mut` here — concurrent callers would alias.
            super::entry_store_backing()
        }
        /// Reserve an `Entry` slot in the store and return its uninitialized
        /// storage. The caller MUST fully initialize every field before any
        /// other code observes the slot (the index is already accounted in
        /// `used` so a later read past the watermark would see uninit bytes).
        ///
        /// This is the in-place-construction primitive for the `readdir` hot
        /// loop: `Entry` is ~168 bytes and the by-value `append` above forces a
        /// stack temporary + memcpy that Rust does not reliably NRVO across
        /// the call boundary. Reserving the slot first lets the per-field
        /// writes lower straight into the destination.
        #[inline(always)]
        pub(crate) fn append_uninit()
        -> core::result::Result<*mut core::mem::MaybeUninit<Entry>, bun_alloc::AllocError> {
            // SAFETY: `instance()` is the live `'static` `bss_list!` singleton;
            // `BSSList::append_uninit` takes `*mut Self` and serializes on its
            // own inner mutex.
            unsafe { EntryStoreBacking::append_uninit(Self::instance()) }
        }
    }

    /// Directory-read failure: the original error plus the error for the
    /// canonicalized path.
    #[derive(Clone, Copy)]
    pub struct Err {
        pub original_err: crate::Error,
        pub canonical_error: crate::Error,
    }
}

/// Per-entry hook invoked by `add_entry`/`readdir`.
pub trait DirEntryIterator {
    const IS_VOID: bool = false;
    fn next(&self, entry: &mut Entry, fd: Fd);
}

impl DirEntryIterator for () {
    const IS_VOID: bool = true;
    fn next(&self, _entry: &mut Entry, _fd: Fd) {}
}

impl<T: DirEntryIterator + ?Sized> DirEntryIterator for &T {
    const IS_VOID: bool = T::IS_VOID;
    #[inline]
    fn next(&self, entry: &mut Entry, fd: Fd) {
        (**self).next(entry, fd)
    }
}

pub struct DirEntry {
    // `dir` is interned in
    // DirnameStore (a process-lifetime BSSList), so `&'static` is correct.
    pub dir: &'static [u8],
    pub fd: Fd,
    pub generation: Generation,
    pub data: dir_entry::EntryMap,
    /// `false` marks a listing created without a full `readdir` (entry-point
    /// fast path); consumers that iterate must re-read it first.
    pub complete: bool,
}

impl DirEntry {
    pub fn init(dir: &'static [u8], generation: Generation) -> DirEntry {
        if FeatureFlags::VERBOSE_FS {
            bun_core::prettyln!("\n  {}", BStr::new(dir));
        }
        DirEntry {
            dir,
            data: dir_entry::EntryMap::default(),
            generation,
            fd: Fd::INVALID,
            complete: true,
        }
    }

    // Compatibility wrapper for callers outside the `readdir` hot loop —
    // resolves the `FilenameStore` singleton on demand. Hot-loop callers
    // should hoist `FilenameStoreAppender::new()` once and call
    // `add_entry_with_store` directly.
    #[inline]
    pub fn add_entry<I: DirEntryIterator>(
        &mut self,
        prev_map: Option<&mut dir_entry::EntryMap>,
        entry: &bun_sys::dir_iterator::IteratorResult,
        iterator: I,
    ) -> crate::CrateResult<()> {
        self.add_entry_with_store(prev_map, entry, &mut FilenameStoreAppender::new(), iterator)
    }

    pub fn add_entry_with_store<I: DirEntryIterator>(
        &mut self,
        prev_map: Option<&mut dir_entry::EntryMap>,
        entry: &bun_sys::dir_iterator::IteratorResult,
        filename_store: &mut FilenameStoreAppender,
        iterator: I,
    ) -> crate::CrateResult<()> {
        use bun_sys::FileKind as DK;
        // `entry.name.slice()` is OS-native (`&[u16]` on Windows); the
        // entry-store / hashmap key in `data` is UTF-8, so use the eagerly-
        // transcoded `slice_u8()`.
        let name_slice = entry.name.slice_u8();
        let found_kind: Option<EntryKind> = match entry.kind {
            DK::Directory => Some(EntryKind::Dir),
            DK::File => Some(EntryKind::File),

            // For a symlink, we will need to stat the target later
            DK::SymLink
            // Some filesystems return `.unknown` from getdents() no matter the actual kind of the file
            // (often because it would be slow to look up the kind). If we get this, then code that
            // needs the kind will have to find it out later by calling stat().
            | DK::Unknown => None,

            DK::BlockDevice
            | DK::CharacterDevice
            | DK::NamedPipe
            | DK::UnixDomainSocket
            | DK::Whiteout
            | DK::Door
            | DK::EventPort => return Ok(()),
        };

        // Lowercase the entry basename once. The same bytes drive the
        // previous-generation case-insensitive probe, the new entry's
        // lowercased key, *and* the insert into `self.data` — and the hash is
        // computed once here (`name_hash`) rather than re-derived by the probe
        // and again by the insert. A stack scratch covers the common short
        // case (matches `DirEntry::get`); only a basename longer than
        // `MAX_PATH_BYTES` — which `getdents`/`FindNextFile` can't produce —
        // would touch the heap.
        let mut name_lc_buf = PathBuffer::uninit();
        let name_lc_heap: Option<bun_collections::StringHashMapContext::PrehashedCaseInsensitive> =
            if name_slice.len() <= MAX_PATH_BYTES {
                None
            } else {
                Some(
                    bun_collections::StringHashMapContext::PrehashedCaseInsensitive::init(
                        name_slice,
                    ),
                )
            };
        let name_lc: &[u8] = match &name_lc_heap {
            Some(p) => &p.input[..],
            None => strings::copy_lowercase_if_needed(name_slice, &mut name_lc_buf[..]),
        };
        let name_hash = self.data.hash_key(name_lc);

        let stored: *mut Entry = 'brk: {
            if let Some(map) = prev_map {
                // `data` keys are the lowercased basenames, so an exact match on
                // `name_lc` is the case-insensitive match — and reuses
                // `name_hash` instead of re-hashing.
                if let Some(&existing_ptr) = map.get_hashed(name_hash, name_lc) {
                    // SAFETY: EntryStore-owned pointer, valid for lifetime of store
                    let existing = unsafe { &mut *existing_ptr };
                    // `MutexGuard` stores a `BackRef<Mutex>` (lifetime-erased), so
                    // holding it does not borrow `existing` — the field writes
                    // below remain unconstrained. Replaces the manual
                    // `lock()` + `scopeguard(addr_of!(mutex), |m| (*m).unlock())`
                    // backref-deref pair.
                    let _guard = existing.mutex.lock_guard();
                    existing.dir = self.dir;

                    existing.need_stat.set(
                        existing.need_stat.get()
                            || found_kind.is_none()
                            || Some(existing.cache().kind) != found_kind,
                    );
                    // TODO: is this right?
                    if Some(existing.cache().kind) != found_kind {
                        // if found_kind is null, we have set need_stat above, so we
                        // store an arbitrary kind
                        existing.set_cache_kind(found_kind.unwrap_or(EntryKind::File));
                        existing.set_cache_symlink(Interned::EMPTY);
                    }
                    break 'brk existing_ptr;
                }
            }

            // Reserve the destination slot first so each field write below
            // lowers straight into the store —
            // avoids a ~168-byte `Entry` stack temporary + memcpy per entry.
            let slot = dir_entry::EntryStore::append_uninit()?;
            // SAFETY: `slot` is a freshly-reserved uninit cell exclusively
            // owned by this thread (`append_uninit` bumped the index under the
            // store's inner mutex). Every field is written exactly once below
            // before the cell is observed via `*mut Entry`.
            unsafe {
                use core::ptr::addr_of_mut;
                let p = (*slot).as_mut_ptr();
                // name_slice only lives for the duration of the iteration.
                // `init*_append_if_needed` are `#[inline(always)]` so the
                // 32-byte `StringOrTinyString` is built directly into `*p`
                // with no intermediate stack copy.
                addr_of_mut!((*p).base_).write(strings::StringOrTinyString::init_append_if_needed(
                    name_slice,
                    filename_store,
                )?);
                // `name_lc` is already ASCII-lowercased, so interning it as-is
                // is byte-identical to `init_lower_case_append_if_needed(name_slice, ..)`
                // and skips a second lowercase pass over the basename. Moreover,
                // when the basename has no uppercase bytes (the overwhelmingly
                // common case on Linux), `copy_lowercase_if_needed` returns the
                // *input slice unchanged* — so `name_lc` points at the same bytes
                // `base_` just interned. Detect that and copy `base_` instead of
                // a second `init_append_if_needed`: `StringOrTinyString` is `Copy`
                // (a 32-byte memcpy for inline ≤31B names), and for longer names
                // this reuses the single `FilenameStore` slot rather than
                // appending the same bytes twice.
                let base_lowercase = if core::ptr::eq(name_lc.as_ptr(), name_slice.as_ptr()) {
                    (*p).base_
                } else {
                    strings::StringOrTinyString::init_append_if_needed(name_lc, filename_store)?
                };
                addr_of_mut!((*p).base_lowercase_).write(base_lowercase);
                addr_of_mut!((*p).dir).write(self.dir);
                addr_of_mut!((*p).mutex).write(Mutex::new());
                // Call "stat" lazily for performance. The "@material-ui/icons" package
                // contains a directory with over 11,000 entries in it and running "stat"
                // for each entry was a big performance issue for that package.
                addr_of_mut!((*p).need_stat).write(core::cell::Cell::new(found_kind.is_none()));
                addr_of_mut!((*p).cache).write(core::cell::Cell::new(EntryCache {
                    symlink: Interned::EMPTY,
                    // if found_kind is null, we have set need_stat above, so we
                    // store an arbitrary kind
                    kind: found_kind.unwrap_or(EntryKind::File),
                    fd: Fd::INVALID,
                }));
                addr_of_mut!((*p).abs_path).write(Interned::EMPTY);
                p
            }
        };

        // SAFETY: just produced from EntryStore append or prev_map lookup
        let stored_ref = unsafe { &mut *stored };

        // PERF: the
        // generic `put` here would heap-box a second key copy. `base_lowercase`
        // points either into the `Entry`'s inline `StringOrTinyString` buffer
        // (≤31B names) or into the process-static `FilenameStore`; the `Entry`
        // itself lives in the process-lifetime `EntryStore` BSSList, so in
        // both cases the bytes are address-stable for the life of the process.
        // Widen to `'static` and store the slice directly.
        // SAFETY: `stored` is an `EntryStore` slot (never freed, never moved);
        // `base_lowercase_` is never mutated after construction.
        let key: &'static [u8] =
            unsafe { &*core::ptr::from_ref::<[u8]>((*stored).base_lowercase()) };
        // `(*stored).base_lowercase()` equals `name_lc` byte-for-byte (a fresh
        // entry interned `name_lc`; a recycled one matched it exactly above), so
        // `name_hash` is its hash too — insert without re-hashing.
        self.data.put_static_key_hashed(name_hash, key, stored)?;

        if !I::IS_VOID {
            iterator.next(stored_ref, self.fd);
        }

        if FeatureFlags::VERBOSE_FS {
            // re-borrow `base()` after the `iterator.next` mutable borrow ends.
            let stored_name = stored_ref.base();
            if found_kind == Some(EntryKind::Dir) {
                bun_core::prettyln!("   + {}/", BStr::new(stored_name));
            } else {
                bun_core::prettyln!("   + {}", BStr::new(stored_name));
            }
        }

        Ok(())
    }

    // `query_` borrow detached from the returned Entry lifetime so
    // callers can pass a slice into the same threadlocal buffer they then
    // mutate; on a case mismatch the query bytes are interned into the
    // process-lifetime `FilenameStore` so `DifferentCase<'static>` holds a
    // genuinely `'static` slice. The store does not dedup, so
    // repeated lookups of the same case-mismatched specifier (e.g. watch-mode
    // rebuilds with a busted resolution cache) each intern a fresh copy that
    // is never freed; accepted because the mismatch arm is a warning/error
    // path and each copy is small. The intern goes through `handle_oom`
    // (abort).
    pub fn get<'a>(&'a self, query_: &[u8]) -> Option<EntryLookup<'a>> {
        if query_.is_empty() || query_.len() > MAX_PATH_BYTES {
            return None;
        }
        let mut scratch_lookup_buffer = PathBuffer::uninit();

        let query = strings::copy_lowercase_if_needed(query_, &mut scratch_lookup_buffer[..]);
        let &result_ptr = self.data.get(query)?;
        // SAFETY: EntryStore-owned pointer, valid for lifetime of store; read-only
        // borrow here only to compare basename — never overlaps a writer.
        let basename = unsafe { &*result_ptr }.base();
        if !strings::eql_long(basename, query_, true) {
            return Some(EntryLookup {
                entry: result_ptr,
                diff_case: Some(DifferentCase {
                    dir: self.dir,
                    // intern a copy of the caller's (possibly
                    // threadlocal-buffer-backed) slice so the `'static` in
                    // `DifferentCase<'static>` is real, not discipline-based.
                    query: bun_core::handle_oom(FilenameStore::instance().append(query_)),
                    // SAFETY: `basename` borrows EntryStore (process-lifetime).
                    actual: unsafe { &*core::ptr::from_ref::<[u8]>(basename) },
                }),
                _marker: core::marker::PhantomData,
            });
        }

        Some(EntryLookup {
            entry: result_ptr,
            diff_case: None,
            _marker: core::marker::PhantomData,
        })
    }

    /// Looks up a cached entry by name. Takes a `&'static [u8]` that is
    /// already lowercase, so no per-call lowercasing buffer is needed.
    pub fn get_comptime_query<'a>(&'a self, query_lower: &'static [u8]) -> Option<EntryLookup<'a>> {
        let &result_ptr = self.data.get(query_lower)?;
        // SAFETY: EntryStore-owned pointer; read-only basename compare.
        let basename = unsafe { &*result_ptr }.base();

        if basename != query_lower {
            return Some(EntryLookup {
                entry: result_ptr,
                diff_case: Some(DifferentCase {
                    dir: self.dir,
                    query: query_lower,
                    // SAFETY: `basename` borrows EntryStore (process-lifetime).
                    actual: unsafe { &*core::ptr::from_ref::<[u8]>(basename) },
                }),
                _marker: core::marker::PhantomData,
            });
        }

        Some(EntryLookup {
            entry: result_ptr,
            diff_case: None,
            _marker: core::marker::PhantomData,
        })
    }

    /// True if a cached entry exists for the given already-lowercase name.
    pub fn has_comptime_query(&self, query_lower: &'static [u8]) -> bool {
        self.data.contains_key(query_lower)
    }

    /// Cached open directory fd, or
    /// `Fd::INVALID` when the resolver did not retain it.
    #[inline]
    pub fn fd(&self) -> Fd {
        self.fd
    }

    /// Yields the raw
    /// `*mut Entry` value for each cached file — NOT `&mut Entry`, because
    /// the map hands out raw pointers with no exclusivity guarantee;
    /// callers reborrow at the use site under `entries_mutex`.
    #[inline]
    pub fn iter(&self) -> impl Iterator<Item = *mut Entry> + '_ {
        self.data.values().copied()
    }
}

// `data` drops itself and `dir` is interned in DirnameStore (see the comment
// on `DirEntry::dir`). Body would be empty, so no `impl Drop`.

impl bun_dotenv::DirEntryProbe for DirEntry {
    #[inline]
    fn has_comptime_query(&self, query_lower: &'static [u8]) -> bool {
        DirEntry::has_comptime_query(self, query_lower)
    }
}

/// Compat re-exports for callers that named the seam-type aliases.
pub use EntryKind as FsEntryKind;
pub use dir_entry::Err as DirEntryErr;

// pub fn statBatch(fs: *FileSystemEntry, paths: []string) ![]?Stat {
// }
// pub fn stat(fs: *FileSystemEntry, path: string) !Stat {
// }
// pub fn readFile(fs: *FileSystemEntry, path: string) ?string {
// }
// pub fn readDir(fs: *FileSystemEntry, path: string) ?[]string {
// }

// ──────────────────────────────────────────────────────────────────────────
// RealFS
// ──────────────────────────────────────────────────────────────────────────

pub(crate) type EntriesOptionMap =
    allocators::BSSMapInner<EntriesOption, { preallocate::counts::DIR_ENTRY }, true>;

// Per-monomorphization singleton storage for `EntriesOption.Map`.
bun_alloc::bss_map_inner! { pub entries_option_map : EntriesOption, preallocate::counts::DIR_ENTRY, true }

/// ZST handle over the `entries_option_map()` singleton; keeps `RealFS.entries`
/// field-shaped without inlining the (large) backing array.
///
/// All map access goes through [`EntriesGuard`] (obtained via
/// [`RealFS::entries_locked`]), which holds `entries_mutex` as the structural
/// proof-of-exclusivity and exposes the operations as safe methods. The former
/// per-method `unsafe fn` surface (each requiring "caller holds
/// `entries_mutex`") has been removed now that every call site uses the guard.
pub struct EntriesMap(());
impl EntriesMap {
    #[inline]
    pub const fn new() -> Self {
        Self(())
    }
}

/// RAII guard over the `entries_option_map()` singleton: holds
/// `RealFS.entries_mutex` for its lifetime and exposes the map operations as
/// **safe** methods. Obtaining this guard is the proof-of-exclusivity that
/// every `unsafe { self.entries.* }` call site previously had to re-assert in
/// a SAFETY comment — the lock is now structurally tied to the access, so the
/// raw-pointer escape (`unsafe { &mut *entries_option_map() }`) lives in
/// exactly one place ([`map_mut`]) instead of at ~dozen call sites.
///
/// `bun_threading::MutexGuard` stores the mutex by raw pointer (no borrow of
/// `RealFS`), so holding an `EntriesGuard` does **not** keep `&self`/`&mut self`
/// borrowed — callers may freely re-borrow `self` for `readdir`/`open_dir`/
/// `read_directory_error` while the guard is live (matching the prior
/// `let _g = self.entries_mutex.lock_guard()` pattern).
pub(crate) struct EntriesGuard {
    _lock: bun_threading::MutexGuard,
}
impl EntriesGuard {
    /// Single `unsafe` deref site for the `entries_option_map()` singleton.
    ///
    /// Private: `&self → &mut Map` is sound only because `self._lock` is the
    /// proof-of-exclusivity (`entries_mutex` held), the map lives in a
    /// disjoint static allocation, and every caller below uses the borrow
    /// for one map operation then drops it — no two `&mut` overlap. Do NOT
    /// expose publicly (would let safe code create aliased `&mut`).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn map_mut(&self) -> &mut EntriesOptionMap {
        // SAFETY: `self._lock` holds `entries_mutex` for this guard's whole
        // lifetime — sole `&mut` to the process-static singleton. The returned
        // borrow is tied to `&self` (the guard), so it cannot outlive the lock.
        unsafe { &mut *entries_option_map() }
    }

    pub(crate) fn get_or_put(
        &self,
        key: &[u8],
    ) -> core::result::Result<allocators::Result, AllocError> {
        self.map_mut().get_or_put(key)
    }
    pub(crate) fn at_index(&self, index: allocators::IndexType) -> Option<*mut EntriesOption> {
        let r = self.map_mut().at_index(index)?;
        Some(std::ptr::from_mut::<EntriesOption>(r))
    }
    pub(crate) fn put(
        &self,
        result: &mut allocators::Result,
        value: EntriesOption,
    ) -> core::result::Result<*mut EntriesOption, AllocError> {
        let r = self.map_mut().put(result, value)?;
        Ok(std::ptr::from_mut::<EntriesOption>(r))
    }
    pub(crate) fn mark_not_found(&self, result: allocators::Result) {
        self.map_mut().mark_not_found(result)
    }
    pub(crate) fn remove(&self, key: &[u8]) -> bool {
        self.map_mut().remove(key)
    }
}

pub struct RealFS {
    pub entries_mutex: Mutex,
    pub entries: EntriesMap,
    pub cwd: &'static [u8], // interned (process-lifetime)
    pub file_limit: usize,
    pub file_quota: usize,
}

pub(crate) mod limit {
    // PORTING.md §Global mutable state: written once at init in
    // `adjust_ulimit`, read elsewhere — Atomic for the scalar, RacyCell for
    // the POD struct (no Atomic<Rlimit>).
    #[cfg(unix)]
    pub(crate) static HANDLES: core::sync::atomic::AtomicUsize =
        core::sync::atomic::AtomicUsize::new(0);
    #[cfg(unix)]
    pub(crate) static HANDLES_BEFORE: bun_core::RacyCell<bun_sys::posix::Rlimit> =
        // SAFETY: all-zero is a valid Rlimit (POD)
        bun_core::RacyCell::new(bun_core::ffi::zeroed());
}

thread_local! {
    static TEMP_ENTRIES_OPTION: RefCell<core::mem::MaybeUninit<EntriesOption>> =
        const { RefCell::new(core::mem::MaybeUninit::uninit()) };
}

impl RealFS {
    fn platform_temp_dir_compute() -> &'static [u8] {
        // Try TMPDIR, TMP, and TEMP in that order, matching Node.js.
        // https://github.com/nodejs/node/blob/e172be269890702bf2ad06252f2f152e7604d76c/src/node_credentials.cc#L132
        if let Some(dir) = env_var::TMPDIR::get_not_empty()
            .or_else(env_var::TMP::get_not_empty)
            .or_else(env_var::TEMP::get_not_empty)
        {
            if dir.len() > 1 && dir[dir.len() - 1] == SEP {
                return &dir[0..dir.len() - 1];
            }
            return dir;
        }

        #[cfg(target_os = "windows")]
        {
            // https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-gettemppathw#remarks
            if let Some(windir) = env_var::SYSTEMROOT::get().or_else(env_var::WINDIR::get) {
                let mut v = Vec::new();
                write!(
                    &mut v,
                    "{}\\Temp",
                    BStr::new(strings::without_trailing_slash(windir))
                )
                .expect("oom");
                return DirnameStore::instance().append(&v).expect("oom");
            }

            if let Some(profile) = env_var::HOME::get() {
                let mut buf = PathBuffer::uninit();
                let parts: [&[u8]; 1] = [b"AppData\\Local\\Temp"];
                let out = path_handler::join_abs_string_buf::<platform::Loose>(
                    profile,
                    &mut buf[..],
                    &parts,
                );
                return DirnameStore::instance().append(out).expect("oom");
            }

            let mut tmp_buf = PathBuffer::uninit();
            let n =
                bun_sys::getcwd(&mut tmp_buf[..]).expect("Failed to get cwd for platformTempDir");
            let cwd = &tmp_buf[..n];
            let root = path_handler::windows_filesystem_root(cwd);
            let mut v = Vec::new();
            write!(
                &mut v,
                "{}\\Windows\\Temp",
                BStr::new(strings::without_trailing_slash(root))
            )
            .expect("oom");
            return DirnameStore::instance().append(&v).expect("oom");
        }
        #[cfg(target_os = "macos")]
        {
            return b"/private/tmp";
        }
        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        {
            #[cfg(target_os = "android")]
            {
                return b"/data/local/tmp";
            }
            #[cfg(not(target_os = "android"))]
            {
                return b"/tmp";
            }
        }
    }

    pub fn platform_temp_dir() -> &'static [u8] {
        static ONCE: bun_core::Once<&'static [u8]> = bun_core::Once::new();
        ONCE.call(Self::platform_temp_dir_compute)
    }

    pub fn tmpdir_path() -> &'static [u8] {
        env_var::BUN_TMPDIR::get_not_empty().unwrap_or_else(Self::platform_temp_dir)
    }

    pub fn open_tmp_dir(&self) -> crate::CrateResult<bun_sys::Dir> {
        #[cfg(windows)]
        {
            // The generic `open_dir_absolute` path goes through `open_a(.., O::DIRECTORY, 0)`
            // and on Windows `O::DIRECTORY == 0`, so the directory dispatch in
            // `openat_windows_impl` is never taken and the handle lacks
            // FILE_DIRECTORY_FILE/FILE_LIST_DIRECTORY — `openat(&tmp_dir, name, ..)`
            // in `TmpfileWindows::create` would then fail.
            return bun_sys::open_dir_at_windows_a(
                Fd::INVALID,
                Self::tmpdir_path(),
                bun_sys::WindowsOpenDirOptions {
                    iterable: true,
                    can_rename_or_delete: false,
                    read_only: true,
                    ..Default::default()
                },
            )
            .map(bun_sys::Dir::from_fd)
            .map_err(Into::into);
        }
        #[cfg(not(windows))]
        {
            bun_sys::Dir::open(Self::tmpdir_path()).map_err(Into::into)
        }
    }

    /// Lock `entries_mutex` and return an [`EntriesGuard`] exposing safe
    /// accessors to the entries singleton. Replaces the
    /// `let _g = self.entries_mutex.lock_guard(); unsafe { self.entries.* }`
    /// pattern — the guard *is* the proof the SAFETY precondition holds.
    #[inline]
    pub fn entries_locked(&self) -> EntriesGuard {
        EntriesGuard {
            _lock: self.entries_mutex.lock_guard(),
        }
    }

    pub fn entries_at(
        &mut self,
        index: allocators::IndexType,
        generation: Generation,
    ) -> Option<*mut EntriesOption> {
        // Locking is required here: every
        // `EntriesMap` method auto-refs the global `BSSMapInner` to `&mut self`, and a
        // concurrent `read_directory_with_iterator` (which *does* lock) would otherwise
        // alias that `&mut` — UB under Stacked Borrows. `EntriesGuard` holds
        // `entries_mutex` for the whole operation so the `&mut BSSMapInner` is
        // exclusive; it does not borrow `self`, so the `&mut self` calls below
        // (`readdir`, `read_directory_error`) remain unconstrained while held.
        let map = self.entries_locked();

        // `at_index` returns a raw `*mut EntriesOption`.
        // Form short-lived `&mut` only at each use site below;
        // never hand a `&'static mut` back to the caller.
        let existing_ptr = map.at_index(index)?;
        // SAFETY: `entries_mutex` held; no other `&mut` to this slot in scope.
        if let EntriesOption::Entries(entries) = unsafe { &mut *existing_ptr } {
            if entries.generation < generation || !entries.complete {
                let dir_path = entries.dir;
                // capture raw ptrs to the in-place `DirEntry` fields, then
                // drop the short-lived `&mut` before re-borrowing `self` for
                // `readdir` / `read_directory_error`.
                let entries_ptr: *mut DirEntry = &raw mut **entries;
                // SAFETY: derive `prev_map_ptr` FROM `entries_ptr` so both raw ptrs
                // share one provenance root. Writing `&mut entries.data` here would
                // call `Box::deref_mut` a second time, which under Stacked Borrows
                // retags the whole `DirEntry` and invalidates `entries_ptr` — making
                // the later `*entries_ptr = new_entry` UB.
                let prev_map_ptr: *mut dir_entry::EntryMap =
                    unsafe { core::ptr::addr_of_mut!((*entries_ptr).data) };
                let handle_dir = match bun_sys::Dir::open(dir_path) {
                    Ok(h) => h,
                    Err(err) => {
                        // SAFETY: `entries_mutex` held; sole access to this slot.
                        unsafe { (*prev_map_ptr).clear() };
                        return Some(
                            self.read_directory_error(Some(&map), dir_path, err.into())
                                .expect("unreachable"),
                        );
                    }
                };
                let new_entry = match self.readdir(
                    false,
                    // `handle_dir` drops at end of this block; never publish.
                    false,
                    // SAFETY: `entries_mutex` held; `readdir` does not touch
                    // `self.entries`, so this `&mut EntryMap` is unaliased.
                    Some(unsafe { &mut *prev_map_ptr }),
                    dir_path,
                    generation,
                    &handle_dir,
                    (),
                ) {
                    Ok(e) => e,
                    Err(err) => {
                        // SAFETY: see above.
                        unsafe { (*prev_map_ptr).clear() };
                        return Some(
                            self.read_directory_error(Some(&map), dir_path, err)
                                .expect("unreachable"),
                        );
                    }
                };
                // SAFETY: `entries_mutex` held; sole access to this slot.
                unsafe {
                    (*prev_map_ptr).clear();
                    *entries_ptr = new_entry;
                }
            }
        }

        map.at_index(index)
    }

    pub fn get_default_temp_dir() -> &'static [u8] {
        env_var::BUN_TMPDIR::get().unwrap_or_else(Self::platform_temp_dir)
    }

    pub fn need_to_close_files(&self) -> bool {
        if !FeatureFlags::STORE_FILE_DESCRIPTORS {
            return true;
        }

        #[cfg(windows)]
        {
            // 'false' is okay here because windows gives you a seemingly unlimited number of open
            // file handles, while posix has a lower limit.
            //
            // This limit does not extend to the C-Runtime which is only 512 to 8196 or so,
            // but we know that all resolver-related handles are not C-Runtime handles because
            // `setMaxFd` on Windows (besides being a no-op) only takes in `HANDLE`.
            //
            // Handles are automatically closed when the process exits as stated here:
            // https://learn.microsoft.com/en-us/windows/win32/procthread/terminating-a-process
            // But in a crazy experiment to find the upper-bound of the number of open handles,
            // I found that opening upwards of 500k to a million handles in a single process
            // would cause the process to hang while closing. This might just be Windows slowly
            // closing the handles, not sure. This is likely not something to worry about.
            //
            // If it is decided that not closing files ever is a bad idea. This should be
            // replaced with some form of intelligent count of how many files we opened.
            // On POSIX we can get away with measuring how high `fd` gets because it typically
            // assigns these descriptors in ascending order (1 2 3 ...). Windows does not
            // guarantee this.
            return false;
        }

        #[cfg(not(windows))]
        {
            // If we're not near the max amount of open files, don't worry about it.
            !(self.file_limit > 254 && self.file_limit > (MAX_FD.load() as usize + 1) * 2)
        }
    }

    /// Returns `true` if an entry was removed
    pub fn bust_entries_cache(&mut self, file_path: &[u8]) -> bool {
        // Locking is required here:
        // `EntriesMap::remove` auto-refs the global `BSSMapInner` to `&mut self`, and a
        // concurrent `read_directory_with_iterator` (which *does* lock) would otherwise
        // alias that `&mut` — UB. `&mut self` alone proves nothing cross-thread since
        // `EntriesMap` is a ZST handle over a process-global singleton.
        self.entries_locked().remove(file_path)
    }

    // Always try to max out how many files we can keep open
    pub fn adjust_ulimit() -> crate::CrateResult<usize> {
        #[cfg(not(unix))]
        {
            return Ok(usize::MAX);
        }

        #[cfg(unix)]
        {
            let resource = bun_sys::posix::RlimitResource::NOFILE;
            let mut lim = bun_sys::posix::getrlimit(resource)?;
            // SAFETY: single init-time write
            unsafe { limit::HANDLES_BEFORE.write(lim) };

            // Cap at 1<<20 to match Node.js. On macOS the hard limit defaults to
            // RLIM_INFINITY; raising soft anywhere near INT_MAX breaks child processes
            // that read the limit into an int.
            // https://github.com/nodejs/node/blob/v25.9.0/src/node.cc#L621-L627
            // https://github.com/postgres/postgres/blob/fee2b3ea2ecd0da0c88832b37ac0d9f6b3bfb9a9/src/backend/storage/file/fd.c#L1072
            // https://discord.com/channels/876711213126520882/1316342194176790609/1318175562367242271
            let target = {
                // musl has extremely low defaults, so ensure at least 163840 there.
                #[cfg(target_env = "musl")]
                let max = lim.max.max(163840);
                #[cfg(not(target_env = "musl"))]
                let max = lim.max;
                max.min(1 << 20)
            };
            if lim.cur < target {
                let mut raised = lim;
                raised.cur = target;
                // Don't lower the hard limit (Node only touches rlim_cur). The @max
                // is for the musl branch above, which may raise past the current hard.
                raised.max = lim.max.max(target);
                if bun_sys::posix::setrlimit(resource, raised).is_ok() {
                    lim.cur = raised.cur;
                }
            }

            limit::HANDLES.store(
                usize::try_from(lim.cur).expect("int cast"),
                core::sync::atomic::Ordering::Relaxed,
            );
            Ok(usize::try_from(lim.cur).expect("int cast"))
        }
    }

    pub fn init(cwd: &'static [u8]) -> RealFS {
        let file_limit = Self::adjust_ulimit().expect("unreachable");

        // Touch the EntriesOptionMap singleton so it's initialized.
        let _ = entries_option_map();

        RealFS {
            entries_mutex: Mutex::default(),
            entries: EntriesMap::new(),
            cwd,
            file_limit,
            file_quota: file_limit,
        }
    }
}

#[derive(Default, Clone, Copy)]
pub struct ModKey {
    pub inode: u64, // u64 covers libc stat `ino_t`
    pub size: u64,
    pub mtime: i128,
    pub mode: u32, // u32 covers libc stat `mode_t`
}

impl ModKey {
    /// Writes `basename` + `-` + the hex hash into `out` and returns the
    /// written prefix.
    pub fn hash_name<'out>(
        &self,
        basename: &[u8],
        out: &'out mut [u8],
    ) -> crate::CrateResult<&'out [u8]> {
        let hex_int = self.hash();

        let len = out.len();
        let mut cursor = &mut out[..];
        // `BStr`'s `Display` would
        // lossily emit U+FFFD for non-UTF-8 bytes (and 1→3 expand), so write
        // the basename verbatim via raw `io::Write`.
        cursor
            .write_all(basename)
            .map_err(|_| crate::Error::Sys(bun_errno::SystemErrno::ENOSPC))?;
        cursor
            .write_all(b"-")
            .map_err(|_| crate::Error::Sys(bun_errno::SystemErrno::ENOSPC))?;
        write!(&mut cursor, "{:x}", hex_int)
            .map_err(|_| crate::Error::Sys(bun_errno::SystemErrno::ENOSPC))?;
        let written = len - cursor.len();
        Ok(&out[..written])
    }

    pub fn hash(&self) -> u64 {
        let mut hash_bytes = [0u8; 32];
        // We shouldn't just read the contents of the ModKey into memory
        // The hash should be deterministic across computers and operating systems.
        // inode is non-deterministic across volumes within the same compuiter
        // so if we're not going to do a full content hash, we should use mtime and size.
        // even mtime is debatable.
        hash_bytes[0..8].copy_from_slice(&self.size.to_le_bytes());
        hash_bytes[8..24].copy_from_slice(&self.mtime.to_le_bytes());
        debug_assert!(hash_bytes[24..].len() == 8);
        hash_bytes[24..32].copy_from_slice(&0u64.to_ne_bytes());
        bun_wyhash::hash(&hash_bytes)
    }

    pub fn generate(_: &mut RealFS, _: &[u8], file: &bun_sys::File) -> crate::CrateResult<ModKey> {
        let stat = file.stat()?;

        const NS_PER_S: i128 = 1_000_000_000;
        // `bun_sys::Stat` is `libc::stat`; reconstruct `mtime` (i128
        // ns) from `st_mtime` (sec) +
        // `st_mtime_nsec` (ns). The `libc` crate flattens BSD/Darwin `st_mtimespec` into
        // `st_mtime`/`st_mtime_nsec`, so the access is uniform on all `unix`.
        #[cfg(unix)]
        let mtime: i128 = (stat.st_mtime as i128) * NS_PER_S + stat.st_mtime_nsec as i128;
        #[cfg(windows)]
        let mtime: i128 = (stat.mtim.sec as i128) * NS_PER_S + stat.mtim.nsec as i128;
        let seconds = mtime / NS_PER_S;

        // We can't detect changes if the file system zeros out the modification time
        if seconds == 0 && NS_PER_S == 0 {
            return Err(crate::Error::Unusable);
        }

        // Don't generate a modification key if the file is too new
        let now = bun_core::time::nano_timestamp();
        let now_seconds = now / NS_PER_S;
        // NOTE: `seconds > seconds` is always false; kept to preserve existing behavior
        #[allow(clippy::eq_op)]
        if seconds > seconds || (seconds == now_seconds && mtime > now) {
            return Err(crate::Error::Unusable);
        }

        Ok(ModKey {
            inode: stat.st_ino,
            size: stat.st_size as u64,
            mtime,
            mode: stat.st_mode as u32,
            // .uid = stat.
        })
    }
}

impl RealFS {
    pub fn mod_key_with_file(
        &mut self,
        path: &[u8],
        file: &bun_sys::File,
    ) -> crate::CrateResult<ModKey> {
        ModKey::generate(self, path, file)
    }

    pub fn mod_key(&mut self, path: &[u8]) -> crate::CrateResult<ModKey> {
        let file = bun_sys::open_file(path, bun_sys::OpenFlags::READ_ONLY)?;
        self.mod_key_with_file(path, &file)
    }
}

pub enum EntriesOption {
    Entries(Box<DirEntry>),
    Err(dir_entry::Err),
}

// SAFETY: ARENA — `EntriesOption` holds a `Box<DirEntry>` whose `data` map stores
// `*mut Entry` into the BSSList singleton. All access is serialized through
// `RealFS.entries_mutex`. The raw-pointer
// fields are the only thing blocking auto-Sync (needed for `bss_map_inner!`'s
// `SyncUnsafeCell` static).
unsafe impl Sync for EntriesOption {}
// SAFETY: same invariant as the `Sync` impl above.
unsafe impl Send for EntriesOption {}

// SAFETY: same ARENA contract as `EntriesOption` — `Entry` lives in the
// `BSSList` singleton; `*mut Entry` raw pointers are the only !Send/!Sync field.
unsafe impl Sync for Entry {}
// SAFETY: same invariant as the `Sync` impl above.
unsafe impl Send for Entry {}

impl RealFS {
    pub fn open_dir(&self, unsafe_dir_string: &[u8]) -> crate::CrateResult<bun_sys::Dir> {
        // On Windows this must go through `open_dir_at_windows_a` with
        // iterable + read_only so the resulting handle has FILE_LIST_DIRECTORY +
        // FILE_DIRECTORY_FILE and can be iterated by `readdir`. The generic
        // `open_a(.., O::DIRECTORY, 0)` path doesn't work here because on Windows
        // `O::DIRECTORY == 0` (sys/lib.rs), so the `(flags & O::DIRECTORY) != 0`
        // dispatch in `openat_windows_impl` is never taken and the path is opened
        // via the *file* NtCreateFile branch.
        #[cfg(windows)]
        let dirfd = bun_sys::open_dir_at_windows_a(
            Fd::INVALID,
            unsafe_dir_string,
            bun_sys::WindowsOpenDirOptions {
                iterable: true,
                no_follow: false,
                read_only: true,
                ..Default::default()
            },
        );
        #[cfg(not(windows))]
        let dirfd = bun_sys::open_a(unsafe_dir_string, bun_sys::O::DIRECTORY, 0);

        let fd = dirfd?;
        Ok(bun_sys::Dir::from_fd(fd))
    }

    fn readdir<I: DirEntryIterator>(
        &mut self,
        store_fd: bool,
        // Whether `handle`'s fd outlives this call — gates `DirEntry.fd`
        // publication so callers don't cache a dead fd.
        publish_fd: bool,
        prev_map: Option<&mut dir_entry::EntryMap>,
        dir_: &'static [u8],
        generation: Generation,
        handle: &bun_sys::Dir,
        iterator: I,
    ) -> crate::CrateResult<DirEntry> {
        let handle_fd = handle.fd();
        let mut iter = bun_sys::iterate_dir(handle_fd);
        let mut dir = DirEntry::init(dir_, generation);
        let mut prev_map = prev_map;
        // PERF: on a re-read, the previous entry count is the best
        // capacity guess we have — reserving it up-front avoids the
        // grow-then-rehash-every-key cascade hashbrown otherwise pays
        // (perf showed `RawTable::reserve_rehash` as the dominant `add_entry`
        // cost).
        if let Some(prev) = prev_map.as_deref() {
            dir.data.reserve(prev.len());
        }

        if store_fd {
            FileSystem::set_max_fd(handle_fd.native());
        }
        if publish_fd {
            dir.fd = handle_fd;
        }

        // PERF: pre-size `dir.data` from `prev_map` to skip the log2(N) rehash
        // chain on watch-mode re-reads (directory size rarely jumps), and fall
        // back to a small floor for cold reads. Do NOT collect dirents into a
        // `Vec` first — that costs N `push`es + ~log2(N) Vec grows just to learn
        // the count, and forces every `Name` allocation to outlive the loop.
        // Stream `getdents64` straight into `add_entry`. Floor at 64 even when
        // a `prev_map` exists but is tiny/empty — a directory that just grew
        // would otherwise rebuild `data` from a zero-capacity table.
        dir.data
            .ensure_unused_capacity(prev_map.as_deref().map(|m| m.count()).unwrap_or(0).max(64))?;

        // Hoist the `FilenameStore` singleton resolution (Once + LazyLock atomic
        // checks) out of the per-entry loop.
        let mut filename_store = FilenameStoreAppender::new();

        while let Some(entry_) = iter.next()? {
            debug!("readdir entry {}", BStr::new(entry_.name.slice_u8()));

            dir.add_entry_with_store(
                prev_map.as_deref_mut(),
                &entry_,
                &mut filename_store,
                &iterator,
            )?;
        }

        debug!(
            "readdir({}, {}) = {}",
            print_handle(handle_fd),
            BStr::new(dir_),
            dir.data.count()
        );

        Ok(dir)
    }

    fn read_directory_error(
        &mut self,
        entries: Option<&EntriesGuard>,
        dir: &[u8],
        err: crate::Error,
    ) -> Result<*mut EntriesOption, AllocError> {
        if FeatureFlags::ENABLE_ENTRY_CACHE {
            // Caller holds `entries_mutex` exactly when `ENABLE_ENTRY_CACHE` is true
            // (both call paths gate the lock on the same flag), so the guard is
            // always `Some` here.
            let entries = entries.expect("caller holds entries_mutex when ENABLE_ENTRY_CACHE");
            let mut get_or_put_result = entries.get_or_put(dir)?;
            if err == crate::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                entries.mark_not_found(get_or_put_result);
                return Ok(TEMP_ENTRIES_OPTION.with_borrow_mut(|slot| {
                    slot.write(EntriesOption::Err(dir_entry::Err {
                        original_err: err,
                        canonical_error: err,
                    }));
                    // threadlocal storage outlives caller;
                    // return raw `*mut` — caller forms a short-lived `&mut` at use site.
                    slot.as_mut_ptr()
                }));
            } else {
                let opt = entries.put(
                    &mut get_or_put_result,
                    EntriesOption::Err(dir_entry::Err {
                        original_err: err,
                        canonical_error: err,
                    }),
                )?;
                return Ok(opt);
            }
        }

        Ok(TEMP_ENTRIES_OPTION.with_borrow_mut(|slot| {
            slot.write(EntriesOption::Err(dir_entry::Err {
                original_err: err,
                canonical_error: err,
            }));
            // threadlocal storage outlives caller;
            // return raw `*mut` — caller forms a short-lived `&mut` at use site.
            slot.as_mut_ptr()
        }))
    }

    pub fn read_directory(
        &mut self,
        dir_: &[u8],
        handle_: Option<&bun_sys::Dir>,
        generation: Generation,
        store_fd: bool,
    ) -> crate::CrateResult<*mut EntriesOption> {
        self.read_directory_with_iterator(dir_, handle_, generation, store_fd, ())
    }

    // One of the learnings here
    //
    //   Closing file descriptors yields significant performance benefits on Linux
    //
    // It was literally a 300% performance improvement to bundling.
    // https://twitter.com/jarredsumner/status/1655787337027309568
    // https://twitter.com/jarredsumner/status/1655714084569120770
    // https://twitter.com/jarredsumner/status/1655464485245845506
    /// Caller borrows the returned EntriesOption. When `FeatureFlags::ENABLE_ENTRY_CACHE` is `false`,
    /// it is not safe to store this pointer past the current function call.
    ///
    /// returns a raw `*mut EntriesOption`, not
    /// `&'static mut`. Handing out `&'static mut` from a safe `pub fn` would let two callers
    /// (sequential or across the resolver thread pool) each hold a live `&mut` aliasing the
    /// same BSSMap slot — instant UB under Rust's `&mut` noalias model. Callers form a
    /// short-lived `&mut` at the use site under whatever serialization they already perform.
    pub fn read_directory_with_iterator<I: DirEntryIterator>(
        &mut self,
        dir_maybe_trail_slash: &[u8],
        maybe_handle: Option<&bun_sys::Dir>,
        generation: Generation,
        store_fd: bool,
        iterator: I,
    ) -> crate::CrateResult<*mut EntriesOption> {
        let dir = strings::paths::without_trailing_slash_windows_path(dir_maybe_trail_slash);

        crate::Resolver::assert_valid_cache_key(dir);
        let mut cache_result: Option<allocators::Result> = None;
        // `EntriesGuard` holds the
        // mutex by raw pointer (no borrow of `self`), so the `&mut self` calls below
        // (`open_dir`, `readdir`, `read_directory_error`) remain unconstrained while
        // the lock is held.
        let entries_guard = if FeatureFlags::ENABLE_ENTRY_CACHE {
            Some(self.entries_locked())
        } else {
            None
        };

        let mut in_place: Option<*mut DirEntry> = None;

        if let Some(entries) = entries_guard.as_ref() {
            cache_result = Some(entries.get_or_put(dir)?);

            let cr = cache_result.as_ref().unwrap();
            if cr.has_checked_if_exists() {
                if let Some(cached_result) = entries.at_index(cr.index) {
                    // SAFETY: `entries_mutex` held; form a short-lived `&mut` for the
                    // match only — the raw `*mut` is what escapes to the caller.
                    match unsafe { &mut *cached_result } {
                        EntriesOption::Err(_) => return Ok(cached_result),
                        EntriesOption::Entries(e) if e.generation >= generation && e.complete => {
                            return Ok(cached_result);
                        }
                        EntriesOption::Entries(e) => {
                            in_place = Some(&raw mut **e);
                        }
                    }
                } else if cr.status == allocators::ItemStatus::NotFound && generation == 0 {
                    return Ok(TEMP_ENTRIES_OPTION.with_borrow_mut(|slot| {
                        slot.write(EntriesOption::Err(dir_entry::Err {
                            original_err: crate::Error::Sys(bun_errno::SystemErrno::ENOENT),
                            canonical_error: crate::Error::Sys(bun_errno::SystemErrno::ENOENT),
                        }));
                        // threadlocal storage outlives caller; return raw `*mut`.
                        slot.as_mut_ptr()
                    }));
                }
            }
        }

        let had_handle = maybe_handle.is_some();
        let mut _opened: Option<bun_sys::Dir> = None;
        let handle: &bun_sys::Dir = match maybe_handle {
            Some(h) => h,
            None => match self.open_dir(dir) {
                Ok(h) => {
                    _opened = Some(h);
                    _opened.as_ref().unwrap()
                }
                Err(err) => {
                    return Ok(self.read_directory_error(entries_guard.as_ref(), dir, err)?);
                }
            },
        };

        // if we get this far, it's a real directory, so we can just store the dir name.
        // An in-place refresh always keeps the slot's existing interned name: callers
        // spell the same directory with and without a trailing slash, and rewriting
        // `dir` to the other spelling races every unlocked `Entry::dir()` reader.
        let dir: &'static [u8] = if let Some(existing) = in_place {
            // SAFETY: in_place points to BSSMap-owned DirEntry
            unsafe { (*existing).dir }
        } else if !had_handle {
            DirnameStore::instance().append(dir_maybe_trail_slash)?
        } else {
            // Intern into DirnameStore so the cache entry never dangles — `append` is a
            // bump-pointer copy and dedups against the singleton, so cost is bounded.
            DirnameStore::instance().append(dir)?
        };

        // Cache miss: read the directory entries
        let prev = in_place.map(|p| {
            // SAFETY: BSSMap-owned, no aliasing here
            unsafe { &mut (*p).data }
        });
        let publish_fd = store_fd && (had_handle || !self.need_to_close_files());
        let mut entries = match self.readdir(
            store_fd, publish_fd, prev, dir, generation, handle, iterator,
        ) {
            Ok(e) => e,
            Err(err) => {
                if let Some(existing) = in_place {
                    // SAFETY: see above
                    unsafe { (*existing).data.clear() };
                }
                return Ok(self.read_directory_error(entries_guard.as_ref(), dir, err)?);
            }
        };

        // Capture before `handle`'s borrow of `_opened` ends.
        let handle_fd = handle.fd();

        // `readdir` succeeded. If the resolver caches fds, hand the
        // freshly-opened one off.
        if !had_handle && store_fd && !self.need_to_close_files() {
            if let Some(d) = _opened.take() {
                let _ = d.into_raw();
            }
        }

        if let Some(map) = entries_guard.as_ref() {
            if publish_fd && !entries.fd.is_valid() {
                entries.fd = handle_fd;
            }

            // The slot owns a
            // `Box<DirEntry>`; calling `put` again on an already-populated slot would drop the
            // old Box (use-after-free if `in_place` aliases it) or leak it. Split the two cases:
            //  - in_place Some → write through the existing pointer, return the existing slot.
            //  - in_place None → fresh Box::new, hand it to `put`.
            let out = match in_place {
                Some(p) => {
                    // SAFETY: `p` points at the `DirEntry` inside the `Box<DirEntry>` already
                    // owned by `self.entries` at `cache_result.index`; no other borrow exists
                    // (entries_mutex held). Clearing the stale map then assigning the freshly
                    // built entries struct in place — no drop of the owning Box.
                    unsafe {
                        (*p).data.clear();
                        *p = entries;
                    }
                    let idx = cache_result.as_ref().unwrap().index;
                    map.at_index(idx)
                        .expect("in_place entry must exist in BSSMap")
                }
                None => {
                    let result = EntriesOption::Entries(Box::new(entries));
                    map.put(cache_result.as_mut().unwrap(), result)?
                }
            };

            return Ok(out);
        }

        Ok(TEMP_ENTRIES_OPTION.with_borrow_mut(|slot| {
            slot.write(EntriesOption::Entries(Box::new(entries)));
            // threadlocal storage outlives caller; return raw `*mut`.
            slot.as_mut_ptr()
        }))
    }

    pub fn read_file_with_handle<'p, 'buf, const USE_SHARED_BUFFER: bool, const STREAM: bool>(
        &mut self,
        path: &'p [u8],
        size_: Option<usize>,
        file: &bun_sys::File,
        shared_buffer: &'buf mut MutableString,
    ) -> crate::CrateResult<PathContentsPair<'p, 'buf>> {
        read_file_with_handle_impl::<USE_SHARED_BUFFER, STREAM>(path, size_, file, shared_buffer)
    }

    /// Thin forward to `read_file_with_handle_impl`.
    pub fn read_file_with_handle_and_allocator<
        'p,
        'buf,
        const USE_SHARED_BUFFER: bool,
        const STREAM: bool,
    >(
        &mut self,
        path: &'p [u8],
        size_hint: Option<usize>,
        file: &bun_sys::File,
        shared_buffer: &'buf mut MutableString,
    ) -> crate::CrateResult<PathContentsPair<'p, 'buf>> {
        read_file_with_handle_impl::<USE_SHARED_BUFFER, STREAM>(
            path,
            size_hint,
            file,
            shared_buffer,
        )
    }
}

// ══════════════════════════════════════════════════════════════════════════
// CANONICAL: read-file-with-handle (stat → grow → pread-loop → BOM-strip)
//
// One body, three entry points:
//   • `read_file_with_handle_impl`  — free fn, const-generic, returns
//     `PathContentsPair`. No `&mut RealFS` needed: the only
//     `self` uses are `setMaxFd` (a static) and
//     `readFileError` (a no-op in release).
//   • `RealFS::read_file_with_handle_and_allocator` — keeps the existing
//     fs.rs:2121 signature for spec-shape fidelity; thin forward.
//   • `read_file_contents` — runtime-bool → const-generic dispatcher for the
//     two `cache::Fs` callers (resolver/lib.rs + bundler/cache.rs), which take
//     `use_shared_buffer`/`stream` at runtime and want only the bytes.
// ══════════════════════════════════════════════════════════════════════════

/// Runtime-bool → const-generic dispatcher for `cache::Fs::read_file{,_shared}`.
/// Returns just the contents (`Cow::Borrowed` ⇢ shared-buffer arm,
/// `Cow::Owned` ⇢ heap arm); callers `.map(Contents::from)` to tag provenance.
pub fn read_file_contents<'buf>(
    file: &bun_sys::File,
    path: &[u8],
    use_shared_buffer: bool,
    shared: &'buf mut MutableString,
    stream: bool,
) -> crate::CrateResult<Cow<'buf, [u8]>> {
    match (use_shared_buffer, stream) {
        (true, true) => read_file_with_handle_impl::<true, true>(path, None, file, shared),
        (true, false) => read_file_with_handle_impl::<true, false>(path, None, file, shared),
        (false, true) => read_file_with_handle_impl::<false, true>(path, None, file, shared),
        (false, false) => read_file_with_handle_impl::<false, false>(path, None, file, shared),
    }
    .map(|p| p.contents)
}

/// Arena-backed twin of the `USE_SHARED_BUFFER = false` arm of
/// [`read_file_with_handle_impl`]: the returned bytes live
/// in `arena` so they are bulk-freed when the per-call `MimallocArena` is
/// `mi_heap_destroy`'d (`TranspilerJob::run` / `ParseTask`), instead of
/// round-tripping through the worker thread's *default* mimalloc heap (which
/// is never destroyed and retains the segment for the process lifetime).
///
/// Returns `(ptr, len)` into `arena`-owned memory; a sentinel NUL is written
/// at `ptr[len]` (not counted in `len`).
pub fn read_file_contents_in_arena(
    file: &bun_sys::File,
    path: &[u8],
    arena: &bun_alloc::Arena,
) -> crate::CrateResult<(core::ptr::NonNull<u8>, usize)> {
    let _ = path;
    FileSystem::set_max_fd(file.handle().native());

    let mut initial_buf = [0u8; 16384];

    // Optimization: don't call stat() unless the file is big enough that we
    // need to dynamically allocate memory to read it.
    let read_count = file.read_all(&mut initial_buf)?;
    if read_count + 1 < initial_buf.len() {
        // Own the buffer in `arena`; trailing NUL not in len.
        // Allocate UNINITIALIZED (no zero-fill):
        // `copy_from_slice` initializes `[..read_count]` and
        // `finish_arena_contents` writes the trailing NUL at `[read_count]`.
        let buf = arena_alloc_uninit_bytes(arena, read_count + 1);
        buf[..read_count].copy_from_slice(&initial_buf[..read_count]);
        return Ok(finish_arena_contents(arena, buf, read_count));
    }
    let initial_len = read_count;

    // Skip the extra file.stat() call when possible (size_hint is always None
    // on this path — `cache::Fs::read_file_with_allocator` never passes one).
    let size = file.get_end_pos()?;
    debug!("stat({}) = {}", file.handle(), size);

    if size == 0 {
        return Ok((core::ptr::NonNull::dangling(), 0));
    }

    // Arena-owned `[u8; cap + 1]` instead of `vec![0u8; size + 1]` — this is
    // the load-bearing change vs. `read_file_with_handle_impl::<false, _>`.
    // The buffer is UNINITIALIZED; the
    // `copy_from_slice` + `read_all` below cover `[..total]` and
    // `finish_arena_contents` writes the trailing NUL at `[total]`.
    //
    // The file can grow or shrink between `get_end_pos()` above and the read
    // below — a hot-reload writes a file while it is being parsed. Size the
    // buffer for whichever of {stat size, bytes already read} is larger so the
    // `initial_buf` copy can never overflow, and read only into `buf[..cap]`
    // (leaving `buf[cap]` for the trailing NUL) so a file that grew mid-read is
    // truncated to the stat'd size instead of overrunning the NUL slot — which
    // otherwise made `finish_arena_contents`'s `buf[total] = 0` a bounds-check
    // panic (observed crashing `bun --hot` on large source maps).
    let cap = size.max(initial_len);
    let buf = arena_alloc_uninit_bytes(arena, cap + 1);
    buf[..initial_len].copy_from_slice(&initial_buf[..initial_len]);

    let read_count = file.read_all(&mut buf[initial_len..cap])?;
    let total = read_count + initial_len;
    debug!("read({}, {}) = {}", file.handle(), size, read_count);

    Ok(finish_arena_contents(arena, buf, total))
}

/// Allocate `len` bytes from `arena` left **uninitialized** (no zero-fill),
/// returned as a raw `&mut [u8]`.
///
/// The caller must write every byte before reading it; the file-content readers
/// do (`copy_from_slice` of the already-read prefix + `File::read_all` for the
/// rest + a trailing NUL written by [`finish_arena_contents`]). Skipping the
/// memset is the point: this buffer is the per-transpiled-module file-content
/// allocation, and zeroing a fresh mimalloc arena page for every module showed
/// up as the single largest `memset` callchain in the transpiler profile.
#[inline]
#[allow(clippy::mut_from_ref)]
fn arena_alloc_uninit_bytes(arena: &bun_alloc::Arena, len: usize) -> &mut [u8] {
    let slot = arena.alloc_uninit_slice::<u8>(len);
    // SAFETY: `u8` has no invalid bit patterns and `slot` is storage owned
    // exclusively by this fresh arena allocation, so forming a `&mut [u8]` view
    // over it is sound provided every byte is written before being read (the
    // doc-comment contract, upheld by all callers).
    unsafe { core::slice::from_raw_parts_mut(slot.as_mut_ptr().cast::<u8>(), len) }
}

/// Strip BOM in-place (UTF-8) or via a fresh arena copy (UTF-16), write the
/// trailing NUL, and return `(ptr, len)`. `buf.len() >= total + 1`.
#[inline]
fn finish_arena_contents(
    arena: &bun_alloc::Arena,
    buf: &mut [u8],
    mut total: usize,
) -> (core::ptr::NonNull<u8>, usize) {
    if let Some(bom) = BOM::detect(&buf[..total]) {
        debug!("Convert {} BOM", bom.tag_name());
        match bom {
            BOM::Utf8 => {
                let n = BOM::UTF8_BYTES.len();
                buf.copy_within(n..total, 0);
                total -= n;
            }
            other => {
                // Rare path (UTF-16 source on the concurrent transpiler) —
                // re-encode via the global-heap helper, then copy into the
                // arena so the *retained* bytes still land there.
                let converted = other.remove_and_convert_to_utf8_and_free(buf[..total].to_vec());
                let dst = arena.alloc_slice_fill_copy::<u8>(converted.len() + 1, 0);
                dst[..converted.len()].copy_from_slice(&converted);
                // SAFETY: `dst` is a non-null arena slice of length ≥ 1.
                let ptr = unsafe { core::ptr::NonNull::new_unchecked(dst.as_mut_ptr()) };
                return (ptr, converted.len());
            }
        }
    }
    debug_assert!(buf.len() > total);
    buf[total] = 0;
    // SAFETY: `buf` is a non-null arena slice (len ≥ 1 on every path that
    // reaches here; the `size == 0` / empty cases return earlier).
    let ptr = unsafe { core::ptr::NonNull::new_unchecked(buf.as_mut_ptr()) };
    (ptr, total)
}

pub fn read_file_with_handle_impl<'p, 'buf, const USE_SHARED_BUFFER: bool, const STREAM: bool>(
    path: &'p [u8],
    size_hint: Option<usize>,
    file: &bun_sys::File,
    shared_buffer: &'buf mut MutableString,
) -> crate::CrateResult<PathContentsPair<'p, 'buf>> {
    // allocator param dropped (global mimalloc)
    FileSystem::set_max_fd(file.handle().native());

    // in the `USE_SHARED_BUFFER` branch, `file_contents` borrows
    // `shared_buffer.list`; tracked as a raw (ptr, len) pair so borrowck doesn't tie the
    // slice to `&mut shared_buffer` across the read/truncate/grow loop. The final slice is
    // reconstituted with `from_raw_parts`. The
    // non-shared-buffer branch owns its allocation and returns early with `Cow::Owned`.
    // Definite-init: the read `loop` below assigns both before any `break`/read; the
    // `else` (non-shared-buffer) arm always early-returns.
    let mut file_contents_ptr: *const u8;
    let mut file_contents_len: usize;
    // When we're serving a JavaScript-like file over HTTP, we do not want to cache the contents in memory
    // This imposes a performance hit because not reading from disk is faster than reading from disk
    // Part of that hit is allocating a temporary buffer to store the file contents in
    // As a mitigation, we can just keep one buffer forever and re-use it for the parsed files
    if USE_SHARED_BUFFER {
        shared_buffer.reset();

        // Skip the extra file.stat() call when possible
        let mut size = match size_hint {
            Some(s) => s,
            None => file.get_end_pos()?,
        };
        debug!("stat({}) = {}", file.handle(), size);

        // Skip the pread call for empty files
        // Otherwise will get out of bounds errors
        // plus it's an unnecessary syscall
        if size == 0 {
            if USE_SHARED_BUFFER {
                shared_buffer.reset();
                return Ok(PathContentsPair {
                    path: Path::init(path),
                    contents: Cow::Borrowed(b""),
                });
            } else {
                return Ok(PathContentsPair {
                    path: Path::init(path),
                    contents: Cow::Borrowed(b""),
                });
            }
        }

        let mut bytes_read: u64 = 0;
        shared_buffer.grow_by(size + 1)?;
        // SAFETY: u8; `read_all` overwrites the exposed tail before any read.
        unsafe { shared_buffer.list.expand_to_capacity() };

        // if you press save on a large file we might not read all the
        // bytes in the first few pread() calls. we only handle this on
        // stream because we assume that this only realistically happens
        // during HMR
        loop {
            // We use pread to ensure if the file handle was open, it doesn't seek from the last position
            let read_count = file.read_all(&mut shared_buffer.list[bytes_read as usize..])?;
            shared_buffer
                .list
                .truncate(read_count + bytes_read as usize);
            file_contents_ptr = shared_buffer.list.as_ptr();
            file_contents_len = shared_buffer.list.len();
            debug!("read({}, {}) = {}", file.handle(), size, read_count);

            if STREAM {
                // check again that stat() didn't change the file size
                // another reason to only do this when stream
                let new_size = file.get_end_pos()?;

                bytes_read += read_count as u64;

                // don't infinite loop is we're still not reading more
                if read_count == 0 {
                    break;
                }

                if (bytes_read as usize) < new_size {
                    shared_buffer.grow_by(new_size - size)?;
                    // SAFETY: u8; `read_all` overwrites the exposed tail before any read.
                    unsafe { shared_buffer.list.expand_to_capacity() };
                    size = new_size;
                    continue;
                }
            }
            break;
        }

        if shared_buffer.list.capacity() > file_contents_len {
            // SAFETY: capacity > len, so writing one byte past len is in-bounds
            unsafe {
                *shared_buffer.list.as_mut_ptr().add(file_contents_len) = 0;
            }
        }

        // `file_contents_len == shared_buffer.list.len()` here (set by `truncate` in
        // the read loop above); borrow the Vec directly so the slice ends before the
        // `&mut shared_buffer.list` reborrow inside the BOM branch.
        if let Some(bom) = BOM::detect(&shared_buffer.list[..file_contents_len]) {
            debug!("Convert {} BOM", bom.tag_name());
            // We pre-set `list.len` to the un-BOM'd payload length so the helper sees the
            // correct logical size (the read loop above truncated to `file_contents_len`).
            shared_buffer.list.truncate(file_contents_len);
            let converted = bom.remove_and_convert_to_utf8_without_dealloc(&mut shared_buffer.list);
            file_contents_ptr = converted.as_ptr();
            file_contents_len = converted.len();
        }
    } else {
        let mut initial_buf = [0u8; 16384];

        // Optimization: don't call stat() unless the file is big enough
        // that we need to dynamically allocate memory to read it.
        let initial_read: &[u8] = if size_hint.is_none() {
            let buf: &mut [u8] = &mut initial_buf;
            let read_count = file.read_all(buf)?;
            if read_count + 1 < buf.len() {
                // Own the buffer; the returned `Cow::Owned` frees it on the
                // caller's drop. The trailing
                // NUL sentinel is not part of `contents`.
                // Allocate exact (no zero-fill): `extend_from_slice` + `push`
                // initialize all `read_count + 1` bytes, then `truncate` drops
                // the sentinel from the logical length.
                let mut allocation: Vec<u8> = Vec::with_capacity(read_count + 1);
                allocation.extend_from_slice(&buf[..read_count]);
                allocation.push(0);
                allocation.truncate(read_count);

                if let Some(bom) = BOM::detect(&allocation) {
                    debug!("Convert {} BOM", bom.tag_name());
                    allocation = bom.remove_and_convert_to_utf8_and_free(allocation);
                }

                return Ok(PathContentsPair {
                    path: Path::init(path),
                    contents: Cow::Owned(allocation),
                });
            }

            &initial_buf[..read_count]
        } else {
            &initial_buf[..0]
        };

        // Skip the extra file.stat() call when possible
        let size = match size_hint {
            Some(s) => s,
            None => file.get_end_pos()?,
        };
        debug!("stat({}) = {}", file.handle(), size);

        // Allocate UNINITIALIZED (no zero-fill):
        // `extend_from_slice` writes the prefix, `read_all` writes
        // the tail, then `set_len` exposes only the initialized `..total`.
        let mut buf: Vec<u8> = Vec::with_capacity(size + 1);
        buf.extend_from_slice(initial_read);

        if size == 0 {
            return Ok(PathContentsPair {
                path: Path::init(path),
                contents: Cow::Borrowed(b""),
            });
        }

        let tail_len = size + 1 - initial_read.len();
        let tail = &mut buf.spare_capacity_mut()[..tail_len];
        // stick a zero at the end
        tail[tail_len - 1].write(0);
        // SAFETY: `read_all` only writes into the slice (never reads uninitialized
        // bytes); `MaybeUninit<u8>` and `u8` have identical layout, so handing
        // the spare-capacity tail as `&mut [u8]` to a write-only sink is sound.
        let read_count = file.read_all(unsafe {
            core::slice::from_raw_parts_mut(tail.as_mut_ptr().cast::<u8>(), tail_len)
        })?;
        let total = read_count + initial_read.len();
        debug!("read({}, {}) = {}", file.handle(), size, read_count);
        // SAFETY: capacity ≥ `size + 1` ≥ `total`; bytes `..initial_read.len()`
        // were written by `extend_from_slice` and `initial_read.len()..total` by
        // `read_all` above.
        unsafe { buf.set_len(total) };

        if let Some(bom) = BOM::detect(&buf) {
            debug!("Convert {} BOM", bom.tag_name());
            buf = bom.remove_and_convert_to_utf8_and_free(buf);
        }

        return Ok(PathContentsPair {
            path: Path::init(path),
            contents: Cow::Owned(buf),
        });
    }

    // `file_contents_ptr` always equals `shared_buffer.list.as_ptr()` on every
    // shared-buffer path above (read loop and BOM rewrite both anchor at index 0), so we
    // re-derive the final slice safely from `shared_buffer` with the real `'buf` lifetime
    // instead of fabricating `'static` via `from_raw_parts`.
    debug_assert!(core::ptr::eq(
        file_contents_ptr,
        shared_buffer.list.as_ptr()
    ));
    let _ = file_contents_ptr;
    let file_contents: &'buf [u8] = &shared_buffer.list[..file_contents_len];
    Ok(PathContentsPair {
        path: Path::init(path),
        contents: Cow::Borrowed(file_contents),
    })
}

impl RealFS {
    pub fn kind(
        &mut self,
        dir_: &[u8],
        base: &[u8],
        existing_fd: Fd,
        store_fd: bool,
    ) -> crate::CrateResult<EntryCache> {
        #[cfg(windows)]
        let _ = (existing_fd, store_fd);
        let mut cache = EntryCache {
            kind: EntryKind::File,
            symlink: Interned::EMPTY,
            fd: Fd::INVALID,
        };

        let dir = dir_;
        let combo: [&[u8]; 2] = [dir, base];
        let mut outpath = PathBuffer::uninit();
        let entry_path =
            path_handler::join_abs_string_buf::<platform::Auto>(self.cwd, &mut outpath[..], &combo);
        let entry_path_len = entry_path.len();

        outpath[entry_path_len + 1] = 0;
        outpath[entry_path_len] = 0;

        let absolute_path_c = ZStr::from_buf(&outpath[..], entry_path_len);

        #[cfg(windows)]
        {
            let file = bun_sys::get_file_attributes(absolute_path_c)
                .ok_or(crate::Error::Sys(bun_errno::SystemErrno::ENOENT))?;
            // A Windows reparse point carries FILE_ATTRIBUTE_DIRECTORY iff
            // the link is a directory link (junctions always do; symlinks
            // do iff created with SYMBOLIC_LINK_FLAG_DIRECTORY; AppExec
            // links and file symlinks don't), so this is already the
            // correct `Entry.Kind` without following the chain.
            cache.kind = if file.is_directory {
                EntryKind::Dir
            } else {
                EntryKind::File
            };
            if !file.is_reparse_point {
                return Ok(cache);
            }

            // For the realpath, open the path and let the kernel follow
            // every hop, then `GetFinalPathNameByHandle` (same as libuv's
            // `uv_fs_realpath`). The previous manual readlink+join loop
            // resolved relative targets against `dirname(absolute_path_c)`,
            // but that path may itself contain unresolved intermediate
            // symlinks (e.g. with the isolated linker's global virtual
            // store, `node_modules/.bun/<pkg>` is a symlink into
            // `<cache>/links/`, and the dep symlinks inside point at
            // siblings via `..\..\<dep>-<hash>`). Windows resolves
            // relative reparse targets against the *real* parent, so the
            // join landed in the project-side `.bun/` instead of
            // `<cache>/links/`, the re-stat returned FileNotFound, the
            // error was swallowed at `Entry.kind`, and a directory symlink
            // was permanently misclassified as `.file` — surfacing as
            // EISDIR at module load time.
            use bun_sys::windows as w;
            let mut wbuf = bun_paths::w_path_buffer_pool::get();
            let wpath = strings::paths::to_kernel32_path(&mut *wbuf, absolute_path_c.as_bytes());
            // SAFETY: `wpath` is NUL-terminated WTF-16 backed by the pooled
            // `WPathBuffer`; null SECURITY_ATTRIBUTES / template handle are
            // documented-valid for `CreateFileW`.
            let handle = unsafe {
                w::kernel32::CreateFileW(
                    wpath.as_ptr(),
                    0,
                    w::FILE_SHARE_READ | w::FILE_SHARE_WRITE | w::FILE_SHARE_DELETE,
                    core::ptr::null_mut(),
                    w::OPEN_EXISTING,
                    // FILE_FLAG_BACKUP_SEMANTICS lets us open directories;
                    // omitting FILE_FLAG_OPEN_REPARSE_POINT makes Windows
                    // follow the full reparse chain to the final target.
                    w::FILE_FLAG_BACKUP_SEMANTICS,
                    core::ptr::null_mut(),
                )
            };
            // Dangling link / loop / EACCES: `cache.kind` is already set
            // from the link's own directory bit, which is correct for all
            // of those. `Entry.kind`/`Entry.symlink` swallow errors and
            // fall back to the `.file` placeholder anyway, so returning
            // the half-populated cache is strictly better than `try`.
            // Empty `cache.symlink` makes the resolver fall back to
            // `parent.abs_real_path + base`.
            if handle == w::INVALID_HANDLE_VALUE {
                return Ok(cache);
            }
            scopeguard::defer! {
                // SAFETY: `handle` ≠ INVALID_HANDLE_VALUE (checked above).
                let _ = unsafe { w::CloseHandle(handle) };
            }

            let mut info: w::BY_HANDLE_FILE_INFORMATION =
                // SAFETY: all-zero is a valid BY_HANDLE_FILE_INFORMATION (POD)
                unsafe { bun_core::ffi::zeroed_unchecked() };
            // SAFETY: `handle` is a valid file handle for the scope.
            if unsafe { w::GetFileInformationByHandle(handle, &mut info) } != 0 {
                cache.kind = if info.dwFileAttributes & w::FILE_ATTRIBUTE_DIRECTORY != 0 {
                    EntryKind::Dir
                } else {
                    EntryKind::File
                };
            }

            let mut buf2 = bun_paths::path_buffer_pool::get();
            // `Fd` packs the kernel handle into its `u64` backing on Windows;
            // round-trip via `usize` (HANDLE is pointer-sized).
            match bun_sys::get_fd_path(Fd::from_native(handle as usize as u64), &mut *buf2) {
                bun_sys::Result::Ok(real) => {
                    cache.symlink = Interned::from_static(FilenameStore::instance().append(real)?);
                }
                bun_sys::Result::Err(_) => {}
            }
            return Ok(cache);
        }

        #[cfg(not(windows))]
        {
            let stat = bun_sys::lstat(absolute_path_c)?;
            let mut file_kind = bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode);
            let is_symlink = file_kind == bun_sys::FileKind::SymLink;

            let mut symlink: &[u8] = b"";

            if is_symlink {
                let file: Fd = if let Some(valid) = existing_fd.unwrap_valid() {
                    valid
                } else if store_fd {
                    bun_sys::open_file_absolute_z(absolute_path_c, bun_sys::OpenFlags::READ_ONLY)?
                        .into_raw()
                } else {
                    // O_PATH is
                    // Linux-only; macOS/BSD use O_RDONLY. Both add O_NOCTTY|O_CLOEXEC.
                    #[cfg(any(target_os = "linux", target_os = "android"))]
                    let flags = bun_sys::O::PATH | bun_sys::O::CLOEXEC | bun_sys::O::NOCTTY;
                    #[cfg(not(any(target_os = "linux", target_os = "android")))]
                    let flags = bun_sys::O::RDONLY | bun_sys::O::CLOEXEC | bun_sys::O::NOCTTY;
                    bun_sys::open(absolute_path_c, flags, 0)?
                };
                FileSystem::set_max_fd(file.native());

                // close-or-store must run on
                // BOTH success and error paths — use scopeguard so it happens even if
                // stat()/get_fd_path() return early with `?`.
                let need_to_close_files = self.need_to_close_files();
                let cache_ptr: *mut EntryCache = &raw mut cache;
                let _guard = scopeguard::guard(file, move |file| {
                    if (!store_fd || need_to_close_files) && !existing_fd.is_valid() {
                        let _ = bun_sys::close(file);
                    } else if FeatureFlags::STORE_FILE_DESCRIPTORS {
                        // SAFETY: `cache_ptr` points into a stack local that outlives this guard.
                        unsafe { (*cache_ptr).fd = file };
                    }
                });

                let file_stat = bun_sys::fstat(*_guard)?;
                symlink = bun_sys::get_fd_path(*_guard, &mut outpath)?;
                file_kind = bun_sys::kind_from_mode(file_stat.st_mode as bun_sys::Mode);
            }

            debug_assert!(file_kind != bun_sys::FileKind::SymLink);

            if file_kind == bun_sys::FileKind::Directory {
                cache.kind = EntryKind::Dir;
            } else {
                cache.kind = EntryKind::File;
            }
            if !symlink.is_empty() {
                cache.symlink = Interned::from_static(FilenameStore::instance().append(symlink)?);
            }

            Ok(cache)
        }
    }

    //         // Stores the file entries for directories we've listed before
    // entries_mutex: std.Mutex
    // entries      map[string]entriesOrErr

    // // If true, do not use the "entries" cache
    // doNotCacheEntries bool
}

impl EntryKindResolver for RealFS {
    #[inline(always)]
    fn resolve_kind(
        &mut self,
        dir: &[u8],
        base: &[u8],
        existing_fd: Fd,
        store_fd: bool,
    ) -> crate::CrateResult<EntryCache> {
        self.kind(dir, base, existing_fd, store_fd)
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct PathContentsPair<'a, 'buf> {
    pub path: Path<'a>,
    /// `Owned` for the heap-allocated branch (caller frees on drop); `Borrowed`
    /// for the shared-buffer branch (points into the caller's `MutableString`,
    /// tied to `'buf` — see the note in `read_file_with_handle_and_allocator`).
    pub contents: Cow<'buf, [u8]>,
}

// `Path` / `PathName` — re-exported from the canonical `bun_paths::fs` via
// `crate::fs` (D090). This module (`fs_full`) is private + link-dead until
// re-exported wholesale; the local impl bodies (`dupe_alloc` full
// short-circuiting, `non_unique_name_string`, `json_stringify`, etc.) were
// never reachable and are dropped — `crate::fs::PathResolverExt` carries the
// live resolver-tier methods.
pub(crate) use crate::fs::Path;

thread_local! {
    static NORMALIZE_BUF: RefCell<[u8; 1024]> = const { RefCell::new([0u8; 1024]) };
    static JOIN_BUF: RefCell<[u8; 1024]> = const { RefCell::new([0u8; 1024]) };
}

/// Display wrapper for fd-like handles (i32 / *anyopaque / FD).
pub(crate) struct PrintHandle<T>(pub T);

pub(crate) fn print_handle<T>(handle: T) -> PrintHandle<T> {
    PrintHandle(handle)
}

impl core::fmt::Display for PrintHandle<i32> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}", self.0)
    }
}
// PrintHandle<c_int> overlaps PrintHandle<i32> on every supported target — dropped.
impl core::fmt::Display for PrintHandle<*mut c_void> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{:p}", self.0)
    }
}
impl core::fmt::Display for PrintHandle<Fd> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[path = "fs/stat_hash.rs"]
pub mod stat_hash;
