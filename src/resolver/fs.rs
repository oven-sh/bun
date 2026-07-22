use std::borrow::Cow;
use std::io::Write as _;

use bstr::BStr;

use bun_alloc::{AllocError, allocators};
use bun_collections::VecExt as _;
use bun_core::MutableString;
use bun_core::{FeatureFlags, Generation};
use bun_paths::strings;
use bun_paths::{MAX_PATH_BYTES, PathBuffer};
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

mod preallocate {
    pub(crate) mod counts {
        pub(crate) const FILES: usize = 4096;
    }
}

pub(crate) type FilenameStoreBacking =
    allocators::BSSStringList<{ preallocate::counts::FILES * 2 }, { 64 + 1 }>;
pub(crate) type EntryStoreBacking = allocators::BSSList<Entry, { preallocate::counts::FILES * 2 }>;

// Per-monomorphization singleton storage, emitted at the declare site via
// `bss_*!` macros (returns `*mut`).
bun_alloc::bss_string_list! { pub filename_store_backing : preallocate::counts::FILES * 2, 64 + 1 }
bun_alloc::bss_list! { pub entry_store_backing : Entry, preallocate::counts::FILES * 2 }

/// ZST handle resolving to the `filename_store_backing()` singleton.
struct FilenameStore(());

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
            pub(crate) fn instance() -> &'static Self {
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
            pub(crate) fn append(
                &self,
                value: &[u8],
            ) -> core::result::Result<&'static [u8], AllocError> {
                // SAFETY: `backing()` is the live process-lifetime singleton;
                // `BSSStringList::append` serializes on its inner mutex. The
                // returned slice borrows the singleton's never-freed storage
                // (heap-owned by a `'static` `BSSStringList` or a leaked
                // mi_malloc), so widening to `'static` is sound.
                unsafe { <$bty>::append(Self::backing(), &value) }
            }
        }
    };
}
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
    pub(crate) fn new() -> Self {
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

// dirname_store/filename_store are &'static singletons —
// nothing owned to free, so no `impl Drop`.

// ══════════════════════════════════════════════════════════════════════════
// CANONICAL Entry / DirEntry / EntryLookup family.
//
// This is the SINGLE definition. The inline `pub mod fs { … }` block in
// `lib.rs` re-exports these via `pub use crate::fs_full::{…}` and deletes its
// own copies (and its second `bss_list!{entry_store_backing}` singleton).
//
// `Entry::kind`/`symlink` are decoupled from the concrete `RealFS` type via the
// `EntryKindResolver` trait so this block does not depend on `crate::fs::RealFS`.
// ══════════════════════════════════════════════════════════════════════════

/// Decouples `Entry::kind`/`symlink` (the lazy-stat path) from the concrete
/// `RealFS` type; the inline-`fs::RealFS` in `lib.rs` impls this by forwarding
/// to `RealFS::kind`.
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
    pub(crate) symlink: Interned,
    /// Too much code expects this to be 0
    /// don't make it bun.invalid_fd
    pub fd: Fd,
    pub(crate) kind: EntryKind,
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

    /// Update a single cache field. Read-modify-write is fine: callers hold
    /// the per-entry `mutex` so no torn writes; `EntryCache` is `Copy`.
    #[inline(always)]
    pub fn set_cache_fd(&self, fd: Fd) {
        let mut c = self.cache.get();
        c.fd = fd;
        self.cache.set(c);
    }

    #[inline(always)]
    pub(crate) fn set_cache_kind(&self, kind: EntryKind) {
        let mut c = self.cache.get();
        c.kind = kind;
        self.cache.set(c);
    }

    #[inline(always)]
    pub(crate) fn set_cache_symlink(&self, symlink: Interned) {
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
    pub(crate) unsafe fn symlink<R: EntryKindResolver>(
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
    pub(crate) entry: *mut Entry,
    pub(crate) diff_case: Option<DifferentCase<'static>>,
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
    pub(crate) generation: Generation,
    pub data: dir_entry::EntryMap,
}

impl DirEntry {
    pub(crate) fn init(dir: &'static [u8], generation: Generation) -> DirEntry {
        if FeatureFlags::VERBOSE_FS {
            bun_core::prettyln!("\n  {}", BStr::new(dir));
        }
        DirEntry {
            dir,
            data: dir_entry::EntryMap::default(),
            generation,
            fd: Fd::INVALID,
        }
    }

    // Compatibility wrapper for callers outside the `readdir` hot loop —
    // resolves the `FilenameStore` singleton on demand. Hot-loop callers
    // should hoist `FilenameStoreAppender::new()` once and call
    // `add_entry_with_store` directly.

    pub(crate) fn add_entry_with_store<I: DirEntryIterator>(
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
    pub(crate) fn get_comptime_query<'a>(
        &'a self,
        query_lower: &'static [u8],
    ) -> Option<EntryLookup<'a>> {
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
}

// `data` drops itself and `dir` is interned in DirnameStore (see the comment
// on `DirEntry::dir`). Body would be empty, so no `impl Drop`.

impl bun_dotenv::DirEntryProbe for DirEntry {
    #[inline]
    fn has_comptime_query(&self, query_lower: &'static [u8]) -> bool {
        DirEntry::has_comptime_query(self, query_lower)
    }
}

// pub fn statBatch(fs: *FileSystemEntry, paths: []string) ![]?Stat {
// }
// pub fn stat(fs: *FileSystemEntry, path: string) !Stat {
// }
// pub fn readFile(fs: *FileSystemEntry, path: string) ?string {
// }
// pub fn readDir(fs: *FileSystemEntry, path: string) ?[]string {
// }

#[derive(Default, Clone, Copy)]
pub struct ModKey {
    pub inode: u64, // u64 covers libc stat `ino_t`
    pub(crate) size: u64,
    pub(crate) mtime: i128,
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

    pub(crate) fn hash(&self) -> u64 {
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
}

// SAFETY: ARENA — `Entry` lives in the `BSSList` singleton; `*mut Entry` raw
// pointers are the only !Send/!Sync field. All access is serialized through
// `RealFS.entries_mutex`.
unsafe impl Sync for Entry {}
// SAFETY: same invariant as the `Sync` impl above.
unsafe impl Send for Entry {}

// ══════════════════════════════════════════════════════════════════════════
// CANONICAL: read-file-with-handle (stat → grow → pread-loop → BOM-strip)
//
// One body, two entry points:
//   • `read_file_with_handle_impl`  — free fn, const-generic, returns
//     `PathContentsPair`. No `&mut RealFS` needed: the only
//     `self` uses are `setMaxFd` (a static) and
//     `readFileError` (a no-op in release).
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
    crate::fs::FileSystem::set_max_fd(file.handle().native());

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
    crate::fs::FileSystem::set_max_fd(file.handle().native());

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
// ──────────────────────────────────────────────────────────────────────────

pub struct PathContentsPair<'a, 'buf> {
    pub path: Path<'a>,
    /// `Owned` for the heap-allocated branch (caller frees on drop); `Borrowed`
    /// for the shared-buffer branch (points into the caller's `MutableString`,
    /// tied to `'buf` — see the note in `read_file_with_handle_impl`).
    pub(crate) contents: Cow<'buf, [u8]>,
}

// `Path` / `PathName` — re-exported from the canonical `bun_paths::fs` via
// `crate::fs` (D090). This module (`fs_full`) is private + link-dead until
// re-exported wholesale; the local impl bodies (`dupe_alloc` full
// short-circuiting, `non_unique_name_string`, `json_stringify`, etc.) were
// never reachable and are dropped — `crate::fs::PathResolverExt` carries the
// live resolver-tier methods.
pub(crate) use crate::fs::Path;

#[path = "fs/stat_hash.rs"]
pub mod stat_hash;
