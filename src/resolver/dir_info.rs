use core::ptr::NonNull;

use bun_alloc as allocators;
use bun_core::Generation;
use bun_core::feature_flags as FeatureFlags;
use bun_sys::Fd;

use crate::fs;
use crate::package_json::PackageJSON;
use crate::tsconfig_json::TSConfigJSON;

pub use allocators::IndexType;
use allocators::NOT_FOUND;

pub type Index = IndexType;

// ─────────────────────────────────────────────────────────────────────────────
// DirInfoRef — arena handle into the DirInfo BSSMap singleton.
//
// Resolver code threads `*mut DirInfo` pervasively and
// open-coded `unsafe { &*dir_info }` at ~50 read sites. The BSSMap backing
// store is process-lifetime and append-only (slots are never freed), so a
// `Copy` handle that
// `Deref`s to `&DirInfo` is sound: the pointee outlives every holder, and no
// `&mut DirInfo` is ever materialized concurrently with a read — writes happen
// only inside `dir_info_uncached` while filling a freshly-`put` slot. The resolver mutex covers `put` and the fill in `dir_info_cached_maybe_log`, but not in `dir_info_for_resolution`.
//
// `as_ptr()` exposes the raw `*mut` for the few callers that still need it
// (the `dir_info_uncached` fill path and `MatchResult.dir_info` round-trip).
// ─────────────────────────────────────────────────────────────────────────────

/// Non-owning, `Copy` handle to a `DirInfo` slot in the BSSMap singleton.
/// `Deref<Target = DirInfo>` so call sites read `dir.abs_path` instead of
/// `unsafe { &*dir }.abs_path`.
///
/// Wraps [`bun_ptr::BackRef`] (the canonical non-owning back-reference type)
/// rather than open-coding `NonNull` + `unsafe as_ref` here: the BSSMap
/// singleton strictly outlives every `DirInfoRef` (slots are never freed),
/// which is exactly the `BackRef` invariant, so the deref `unsafe` lives once
/// in `BackRef::get` instead of being re-derived per wrapper type.
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct DirInfoRef(bun_ptr::BackRef<DirInfo, bun_ptr::Mut>);

impl DirInfoRef {
    /// Wrap a raw BSSMap slot pointer.
    ///
    /// # Safety
    /// `p` must be non-null and point to a `DirInfo` slot owned by the
    /// process-lifetime BSSMap singleton (`HashMap` below) — i.e. obtained
    /// from `BSSMapInner::put` / `at_index`. The slot must remain live for
    /// the entire lifetime of every copy of the returned handle (always true
    /// for BSSMap slots: they are never individually freed).
    #[inline]
    pub(crate) const unsafe fn from_raw(p: *mut DirInfo) -> Self {
        // SAFETY: caller contract — `p` is a non-null BSSMap slot that
        // outlives every copy of the handle (the `BackRef` invariant).
        DirInfoRef(unsafe { bun_ptr::BackRef::from_raw_mut(p) })
    }
}

impl core::ops::Deref for DirInfoRef {
    type Target = DirInfo;
    #[inline]
    fn deref(&self) -> &DirInfo {
        // ARENA — `self.0` is a slot in the process-lifetime BSSMap singleton
        // (see type-level doc). The slot is never freed and never aliased by a
        // live `&mut DirInfo` while a `DirInfoRef` is held: writes occur only
        // in `dir_info_uncached` against a freshly-`put` slot (the type-level doc names the lock and its gap). The deref `unsafe` is centralised
        // in `BackRef::get`.
        self.0.get()
    }
}

impl core::fmt::Debug for DirInfoRef {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_tuple("DirInfoRef").field(&self.0.as_ptr()).finish()
    }
}

pub struct DirInfo {
    // These objects are immutable, so we can just point to the parent directory
    // and avoid having to lock the cache again
    pub(crate) parent: Index,

    // A pointer to the enclosing dirInfo with a valid "browser" field in
    // package.json. We need this to remap paths after they have been resolved.
    pub(crate) enclosing_browser_scope: Index,
    // lifetime — `&'static` borrows below are ARENA-backed (the
    // resolver-owned PackageJSON/TSConfigJSON caches outlive every DirInfo).
    // Read-only fields (`package_json_for_browser_field`,
    // `enclosing_tsconfig_json`) are `Option<&'static T>`.
    // Fields with write sites are `Option<NonNull<T>>` so
    // mut-provenance from the allocation site is preserved through to the
    // write/drop sites (a `*const→*mut` cast there would be UB under Stacked
    // Borrows). Read sites use the `.package_json()` / `.tsconfig_json()` /
    // `.package_json_for_dependencies()` accessors.
    pub(crate) package_json_for_browser_field: Option<&'static PackageJSON>,
    pub(crate) enclosing_tsconfig_json: Option<&'static TSConfigJSON>,

    /// package.json used for bundling
    /// it's the deepest one in the hierarchy with a "name" field
    /// or, if using `bun run`, the name field is optional
    /// https://github.com/oven-sh/bun/issues/229
    // No write site exists in any caller — kept `Option<&'static>` for
    // ergonomics. If a write is ever added, retype to `Option<NonNull<_>>`.
    pub enclosing_package_json: Option<&'static PackageJSON>,

    /// The nearest package.json in this directory or above it, with or without
    /// a "name". The bundler takes the module type of a `.js`-like file in this
    /// directory from its "type" (`finalize_result`), as esbuild does. The
    /// lookup does not stop at a "node_modules" directory, so a package with no
    /// package.json of its own gets the one above it. `enclosing_package_json`
    /// skips a nameless package.json.
    pub package_json_for_module_type: Option<&'static PackageJSON>,

    // `NonNull` (not `&'static`) so `enqueue_dependency_to_resolve` can write
    // `package_manager_package_id` back through it without a const→mut
    // provenance cast. Read via `.package_json_for_dependencies()`.
    pub(crate) package_json_for_dependencies: Option<NonNull<PackageJSON>>,

    // lifetime — slice into BSS-backed path storage; never individually freed
    pub abs_path: &'static [u8],
    pub(crate) entries: Index,
    /// Is there a "package.json" file?
    // `NonNull` (not `&'static`) preserves mut-provenance. Read via `.package_json()`.
    pub package_json: Option<NonNull<PackageJSON>>,
    /// Is there a "tsconfig.json" file in this directory or a parent directory?
    // `NonNull` (not `&'static`) preserves mut-provenance. Read via `.tsconfig_json()`.
    pub(crate) tsconfig_json: Option<NonNull<TSConfigJSON>>,
    /// If non-empty, this is the real absolute path resolving any symlinks
    // lifetime — slice into BSS-backed path storage; never individually freed
    pub abs_real_path: &'static [u8],

    pub(crate) flags: Flags,
}

impl Default for DirInfo {
    fn default() -> Self {
        Self {
            parent: NOT_FOUND,
            enclosing_browser_scope: NOT_FOUND,
            package_json_for_browser_field: None,
            enclosing_tsconfig_json: None,
            enclosing_package_json: None,
            package_json_for_module_type: None,
            package_json_for_dependencies: None,
            abs_path: b"",
            entries: NOT_FOUND,
            package_json: None,
            tsconfig_json: None,
            abs_real_path: b"",
            flags: Flags::empty(),
        }
    }
}

/// Dereference an arena-interned `NonNull<T>` to `&'static T`.
///
/// Single deref site for the three `Option<NonNull<_>>` read accessors on
/// [`DirInfo`] (`package_json` / `package_json_for_dependencies` /
/// `tsconfig_json`). The pointee is interned in the resolver's process-lifetime
/// PackageJSON / TSConfigJSON arena (see `intern_package_json` / the tsconfig
/// merge loop); never freed for the life of the process.
#[inline]
fn arena_ref<T>(p: NonNull<T>) -> &'static T {
    // SAFETY: ARENA — see fn doc; pointee is process-lifetime, never freed
    // while a `DirInfo` reader is live.
    unsafe { &*p.as_ptr() }
}

impl DirInfo {
    /// Is there a "node_modules" subdirectory?
    #[inline]
    pub(crate) fn has_node_modules(&self) -> bool {
        self.flags.contains(Flags::HasNodeModules)
    }

    /// Is this a "node_modules" directory?
    #[inline]
    pub(crate) fn is_node_modules(&self) -> bool {
        self.flags.contains(Flags::IsNodeModules)
    }

    /// Is this inside a "node_modules" directory?
    #[inline]
    pub(crate) fn is_inside_node_modules(&self) -> bool {
        self.flags.contains(Flags::InsideNodeModules)
    }

    /// Read-only view of `package_json`. The field stores `NonNull` to preserve
    /// mut-provenance; callers that only read go through here.
    #[inline]
    pub fn package_json(&self) -> Option<&'static PackageJSON> {
        self.package_json.map(arena_ref)
    }

    /// Read-only view of `package_json_for_dependencies`. The field stores
    /// `NonNull` to preserve mut-provenance for the write in
    /// `enqueue_dependency_to_resolve`;
    /// callers that only read go through here.
    #[inline]
    pub(crate) fn package_json_for_dependencies(&self) -> Option<&'static PackageJSON> {
        self.package_json_for_dependencies.map(arena_ref)
    }

    /// Read-only view of `tsconfig_json`. See `package_json()`.
    #[inline]
    pub fn tsconfig_json(&self) -> Option<&'static TSConfigJSON> {
        self.tsconfig_json.map(arena_ref)
    }

    pub fn get_file_descriptor(&self) -> Fd {
        if FeatureFlags::STORE_FILE_DESCRIPTORS {
            // Scalar field read; see `get_entries_const` for the contract.
            return self.get_entries_const().map_or(Fd::INVALID, |e| e.fd);
        }
        Fd::INVALID
    }

    /// Generation-checked listing accessor for call sites that already hold
    /// `entries_mutex` (the mutex is non-recursive); see
    /// [`RealFS::entries_at_locked`](fs::RealFS::entries_at_locked). The
    /// `DirEntry` is a slot in the BSSMap-backed `EntriesOptionMap` singleton
    /// (ARENA — process lifetime), so a `&'static` reborrow of the
    /// `&'static mut` returned by `entries_at_locked` is sound and needs no
    /// `unsafe` here. The `.data` map must only be probed/iterated while the
    /// lock is held; use [`get_entry`](Self::get_entry) for one-shot lookups.
    pub fn get_entries_ref_locked(&self, generation: Generation) -> Option<&'static fs::DirEntry> {
        fs::FileSystem::instance()
            .fs
            .entries_at_locked(self.entries, generation)?
            .as_entries()
    }

    /// Generation-checked lookup of one basename in this directory's cached
    /// listing, performed in a single `entries_mutex` critical section. A
    /// concurrent resolver with a newer generation rewrites the `DirEntry` in
    /// place under that lock ([`RealFS::entries_at_locked`](fs::RealFS::entries_at_locked)
    /// drops the old `data` map's buckets), so probing the map after the lock
    /// is released can walk freed buckets. The returned lookup wraps a raw
    /// pointer into the process-lifetime `EntryStore`, which stays valid after
    /// the lock is dropped.
    pub(crate) fn get_entry(
        &self,
        generation: Generation,
        query: &[u8],
    ) -> Option<fs::EntryLookup<'static>> {
        let rfs = &mut fs::FileSystem::instance().fs;
        // `MutexGuard` stores the mutex by raw pointer, so holding it does not
        // keep `rfs` borrowed.
        let _lock = rfs.entries_mutex.lock_guard();
        rfs.entries_at_locked(self.entries, generation)?
            .as_entries()?
            .get(query)
    }

    /// As-cached listing access with no generation check and no locking.
    /// Scalar fields (`fd`, `dir`) may be read through this unlocked; the
    /// `.data` map must only be probed/iterated while `entries_mutex` is held
    /// (a concurrent stale-generation re-read rewrites it in place).
    pub fn get_entries_const(&self) -> Option<&fs::DirEntry> {
        fs::FileSystem::instance()
            .fs
            .entries
            .at_index(self.entries)?
            .as_entries()
    }

    #[inline]
    pub(crate) fn get_parent(&self) -> Option<DirInfoRef> {
        // SAFETY: `parent` is a link of this `DirInfo`.
        unsafe { ref_at_link(self.parent) }
    }

    /// Handle to the enclosing browser-scope `DirInfo` slot. Frequently
    /// resolves back to *this* slot, which is why a
    /// `Copy` arena handle (not `&mut`) is returned — overlapping shared
    /// reads through `DirInfoRef::deref` are sound.
    pub(crate) fn get_enclosing_browser_scope(&self) -> Option<DirInfoRef> {
        // SAFETY: `enclosing_browser_scope` is a link of this `DirInfo`.
        unsafe { ref_at_link(self.enclosing_browser_scope) }
    }
}

// `BSSMapInner<DirInfo, ..>` cannot host a
// per-generic-instantiation static on stable, so the singleton pointer lives here at
// the use site and `bun_alloc::BSSMapInner::init()` hands back the storage.
// PORTING.md §Global mutable state: lazy singleton. `AtomicCell` over the
// `Option<NonNull<_>>` because resolver-pool threads race on first access;
// the load/CAS below makes the publish itself data-race-free.
static DIR_INFO_MAP: bun_core::AtomicCell<Option<NonNull<HashMap>>> =
    bun_core::AtomicCell::new(None);

/// The lazy DirInfo BSSMap singleton — PORTING.md §Global mutable state.
#[inline(always)]
pub(crate) fn hash_map_instance() -> &'static HashMap {
    let map = match DIR_INFO_MAP.load() {
        Some(map) => map,
        None => hash_map_instance_init(),
    };
    // SAFETY: `HashMap::init()` initialized the map, and nothing frees it.
    unsafe { map.as_ref() }
}

#[cold]
#[inline(never)]
fn hash_map_instance_init() -> NonNull<HashMap> {
    // First access: initialize and publish. Resolver init is single-threaded
    // in practice, but use CAS so a race (if it ever happens) doesn't tear
    // the pointer; the loser's `init()` result is leaked, which is fine for
    // a process-lifetime BSS-backed singleton.
    let new = HashMap::init();
    match DIR_INFO_MAP.compare_exchange(None, Some(new)) {
        Ok(_) => new,
        Err(existing) => existing.unwrap(),
    }
}

/// The slot of a link in the process-lifetime BSSMap singleton. A link is the
/// `parent` or the `enclosing_browser_scope` of a `DirInfo`. It takes no lock.
///
/// SAFETY: `link` must be a link. A link is a sentinel, or an index that `put`
/// on the singleton assigned before `dir_info_uncached`, the only writer of
/// the two fields, filled the `DirInfo` that stores it.
#[inline]
unsafe fn ref_at_link(link: Index) -> Option<DirInfoRef> {
    // SAFETY: that is the contract of `ref_in`.
    unsafe { ref_in(hash_map_instance(), link) }
}

/// The slot of `index` in `map`. The handle stays valid across every later call on the map.
///
/// SAFETY: `index` must be a sentinel, or an index that `put` on `map` assigned,
/// and that `put` must happen-before this call (the contract of `BSSMapInner::at_index`).
#[inline]
pub(crate) unsafe fn ref_in(map: &'static HashMap, index: Index) -> Option<DirInfoRef> {
    // SAFETY: caller contract. `put` wrote the slot before the table had the
    // index, and nothing frees a slot of a `'static` map, so the slot holds a
    // `DirInfo` for as long as a handle lives, which is `DirInfoRef`'s invariant.
    // The type-level doc of `DirInfoRef` says when that `DirInfo` can still change.
    unsafe { Some(DirInfoRef::from_raw(map.at_index(index)?.as_ptr())) }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
    pub struct Flags: u8 {
        /// This directory is a node_modules directory
        const IsNodeModules     = 1 << 0;
        /// This directory has a node_modules subdirectory
        const HasNodeModules    = 1 << 1;
        const InsideNodeModules = 1 << 2;
    }
}
impl Flags {
    #[inline]
    pub(crate) fn set_present(&mut self, flag: Flags, present: bool) {
        self.set(flag, present);
    }
}
/// Allows addressing individual flags as `DirInfo::Flag::X`.
pub use Flags as Flag;

// Goal: Really fast, low allocation directory map exploiting cache locality where we don't worry about lifetimes much.
// 1. Don't store the keys or values of directories that don't exist
// 2. Don't expect a provided key to exist after it's queried
// 3. Store whether a directory has been queried and whether that query was successful.
// 4. Allocate onto the https://en.wikipedia.org/wiki/.bss#BSS_in_C instead of the heap, so we can avoid memory leaks
//
// COUNT mirrors `fs::preallocate::counts::DIR_ENTRY`.
pub type HashMap = allocators::BSSMapInner<DirInfo, 2048, true>;
