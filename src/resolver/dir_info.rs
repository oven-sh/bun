use core::ptr::NonNull;

use bun_alloc as allocators;
use bun_core::feature_flags as FeatureFlags;
use bun_sys::Fd;

use crate::dir_cache::DirCache;
use crate::fs;
use crate::package_json::PackageJSON;
use crate::tsconfig_json::TSConfigJSON;

pub use allocators::IndexType;
use allocators::{NOT_FOUND, UNASSIGNED};

pub type Index = IndexType;

// ─────────────────────────────────────────────────────────────────────────────
// DirInfoRef — arena handle into the DirInfo map of a `DirCache`.
//
// Resolver code threads `*mut DirInfo` pervasively and
// open-coded `unsafe { &*dir_info }` at ~50 read sites. The map's backing
// store is append-only (a slot is freed only with its cache), so a
// `Copy` handle that
// `Deref`s to `&DirInfo` is sound while the cache lives: the pointee outlives
// every holder, and no
// `&mut DirInfo` is ever materialized concurrently with a read — writes happen
// only inside `dir_info_uncached` while filling a freshly-`put` slot, before
// any handle to that slot escapes. All access is additionally serialized under
// the resolver mutex.
//
// A resolver holds a counted reference to its cache, so a handle it returned
// is good for as long as that resolver, or any other resolver of the same
// cache, is. For the process cache that is the life of the process. For the
// cache of a `Bun.build()` it is the build.
//
// `as_ptr()` exposes the raw `*mut` for the few callers that still need it
// (the `dir_info_uncached` fill path and `MatchResult.dir_info` round-trip).
// ─────────────────────────────────────────────────────────────────────────────

/// Non-owning, `Copy` handle to a `DirInfo` slot in the map of a `DirCache`.
/// `Deref<Target = DirInfo>` so call sites read `dir.abs_path` instead of
/// `unsafe { &*dir }.abs_path`.
///
/// Wraps [`bun_ptr::BackRef`] (the canonical non-owning back-reference type)
/// rather than open-coding `NonNull` + `unsafe as_ref` here: the cache
/// outlives every `DirInfoRef` it handed out (see the note above),
/// which is exactly the `BackRef` invariant, so the deref `unsafe` lives once
/// in `BackRef::get` instead of being re-derived per wrapper type.
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct DirInfoRef(bun_ptr::BackRef<DirInfo, bun_ptr::Mut>);

impl DirInfoRef {
    /// Wrap a raw slot pointer.
    ///
    /// # Safety
    /// `p` must be non-null and point to a `DirInfo` slot owned by the map
    /// (`HashMap` below) of a `DirCache` — i.e. obtained
    /// from `BSSMapInner::put` / `at_index`. The cache must remain live for
    /// the entire lifetime of every copy of the returned handle.
    #[inline]
    pub(crate) const unsafe fn from_raw(p: *mut DirInfo) -> Self {
        // SAFETY: caller contract — `p` is a non-null slot that
        // outlives every copy of the handle (the `BackRef` invariant).
        DirInfoRef(unsafe { bun_ptr::BackRef::from_raw_mut(p) })
    }

    /// Wrap a slot reference. A `&mut DirInfo` obtained from
    /// `BSSMapInner::at_index`/`put` is by construction a non-null slot in the
    /// map of a `DirCache` — the [`from_raw`](Self::from_raw) contract, with
    /// the cache's lifetime left to the caller as it is there.
    /// Centralizes the per-site `from_raw(ptr::from_mut(d))` open-coding at
    /// every `at_index` call.
    #[inline]
    pub(crate) fn from_slot(slot: &mut DirInfo) -> Self {
        DirInfoRef(bun_ptr::BackRef::new_mut(slot))
    }
}

impl core::ops::Deref for DirInfoRef {
    type Target = DirInfo;
    #[inline]
    fn deref(&self) -> &DirInfo {
        // ARENA — `self.0` is a slot in the map of a live `DirCache`
        // (see type-level doc). The slot is never aliased by a
        // live `&mut DirInfo` while a `DirInfoRef` is held: writes occur only
        // in `dir_info_uncached` against a freshly-`put` slot before any handle
        // escapes, under the resolver mutex. The deref `unsafe` is centralised
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
    pub(crate) parent: Option<DirInfoRef>,

    // A pointer to the enclosing dirInfo with a valid "browser" field in
    // package.json. We need this to remap paths after they have been resolved.
    // It is this slot itself when this directory's package.json has one.
    pub(crate) enclosing_browser_scope: Option<DirInfoRef>,
    // lifetime — `&'static` borrows below are ARENA-backed (the `DirCache`
    // owns every PackageJSON/TSConfigJSON and frees it no earlier than this
    // DirInfo).
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

    // lifetime — slice into the cache's path storage; never individually freed
    pub abs_path: &'static [u8],
    /// The slot of this directory's listing in the listing map of the same
    /// cache. Null until `dir_info_uncached` fills it in.
    pub(crate) entries: *mut fs::EntriesOption,
    /// Is there a "package.json" file?
    // `NonNull` (not `&'static`) preserves mut-provenance. Read via `.package_json()`.
    pub package_json: Option<NonNull<PackageJSON>>,
    /// Is there a "tsconfig.json" file in this directory or a parent directory?
    // `NonNull` (not `&'static`) preserves mut-provenance. Read via `.tsconfig_json()`.
    pub(crate) tsconfig_json: Option<NonNull<TSConfigJSON>>,
    /// If non-empty, this is the real absolute path resolving any symlinks
    // lifetime — slice into the cache's path storage; never individually freed
    pub abs_real_path: &'static [u8],

    pub(crate) flags: Flags,
}

impl Default for DirInfo {
    fn default() -> Self {
        Self {
            parent: None,
            enclosing_browser_scope: None,
            package_json_for_browser_field: None,
            enclosing_tsconfig_json: None,
            enclosing_package_json: None,
            package_json_for_module_type: None,
            package_json_for_dependencies: None,
            abs_path: b"",
            entries: core::ptr::null_mut(),
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
/// `tsconfig_json`). The pointee is owned by the `DirCache` of this `DirInfo`
/// (see `DirCache::own_package_json` / `own_tsconfig`), which frees it no
/// earlier than itself.
#[inline]
fn arena_ref<T>(p: NonNull<T>) -> &'static T {
    // SAFETY: ARENA — see fn doc; the pointee is never freed
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

    /// The listing of this directory, for call sites that already hold the
    /// `entries_mutex` of the cache (the mutex is non-recursive). The
    /// `DirEntry` lives as long as the cache. The `.data` map must only be
    /// probed/iterated while the lock is held; use
    /// [`get_entry`](Self::get_entry) for one-shot lookups.
    pub fn get_entries_ref_locked(&self) -> Option<&'static fs::DirEntry> {
        // SAFETY: `entries` is null or a slot of the listing map of the cache
        // that owns this `DirInfo`.
        unsafe { self.entries.as_ref() }?.as_entries()
    }

    /// Lookup of one basename in this directory's cached listing, performed
    /// in a single `entries_mutex` critical section of `cache`, the cache
    /// that owns this `DirInfo`. The returned lookup wraps a raw pointer into
    /// the `Entry` store of the cache, which stays valid after the lock is
    /// dropped.
    pub(crate) fn get_entry(
        &self,
        cache: &DirCache,
        query: &[u8],
    ) -> Option<fs::EntryLookup<'static>> {
        let _lock = cache.entries_mutex.lock_guard();
        self.get_entries_ref_locked()?.get(query)
    }

    /// As-cached listing access with no locking.
    /// Scalar fields (`fd`, `dir`) may be read through this unlocked; the
    /// `.data` map must only be probed/iterated while the `entries_mutex` of
    /// the cache is held.
    pub fn get_entries_const(&self) -> Option<&fs::DirEntry> {
        // SAFETY: see `get_entries_ref_locked`.
        unsafe { self.entries.as_ref() }?.as_entries()
    }

    #[inline]
    pub(crate) fn get_parent(&self) -> Option<DirInfoRef> {
        self.parent
    }

    /// Handle to the enclosing browser-scope `DirInfo` slot. Frequently
    /// resolves back to *this* slot, which is why a
    /// `Copy` arena handle (not `&mut`) is returned — overlapping shared
    /// reads through `DirInfoRef::deref` are sound.
    pub(crate) fn get_enclosing_browser_scope(&self) -> Option<DirInfoRef> {
        self.enclosing_browser_scope
    }
}

/// Slot pointer for `index` in `map`, derived from the raw map pointer so its
/// provenance survives later `&mut HashMap` retags that would pop a pointer
/// projected through a transient borrow.
/// Returns `None` for the `NOT_FOUND` / `UNASSIGNED` sentinels.
///
/// # Safety
/// `map` is the live `DirInfo` map of a `DirCache`, a non-sentinel `index`
/// must have been assigned by its `put` (slot initialized), and the caller
/// must hold the resolver mutex.
pub(crate) unsafe fn slot_ptr_at(map: *mut HashMap, index: Index) -> Option<*mut DirInfo> {
    if index.index() == NOT_FOUND.index() || index.index() == UNASSIGNED.index() {
        return None;
    }
    if index.is_overflow() {
        // SAFETY: assigned overflow index; resolver mutex held.
        Some(std::ptr::from_mut::<DirInfo>(unsafe {
            (*map).overflow_list.at_index_mut(index)
        }))
    } else {
        // SAFETY: raw place read of a `Copy` scalar.
        let used = u32::from(unsafe { (*map).backing_buf_used });
        // Unconditional assert: keep the inherent `at_index` panic-on-bad-index
        // failure mode rather than handing out an out-of-bounds pointer.
        assert!(
            index.index() < used,
            "dir cache slot index {} out of bounds (used: {used})",
            index.index(),
        );
        // SAFETY: in-bounds initialized slot; raw place projection keeps the
        // map pointer's provenance.
        Some(unsafe {
            core::ptr::addr_of_mut!((*map).backing_buf)
                .cast::<DirInfo>()
                .add(index.index() as usize)
        })
    }
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

/// Insert `value` at `result`'s slot and return a retag-durable slot pointer
/// (see [`slot_ptr_at`]). Takes a raw map pointer, not `&mut self`: a
/// protected `&mut` receiver would be invalidated when `slot_ptr_at` goes
/// through the map pointer.
///
/// # Safety
/// `map` must be the live `DirInfo` map of a `DirCache` and the caller must
/// hold the resolver mutex.
pub(crate) unsafe fn put_slot(
    map: *mut HashMap,
    result: &mut allocators::Result,
    value: DirInfo,
) -> core::result::Result<*mut DirInfo, crate::Error> {
    // SAFETY: `map` is live; resolver mutex held. The auto-ref
    // `&mut *map` ends when `put` returns, before `slot_ptr_at` runs.
    unsafe { (*map).put(result, value) }.map_err(crate::Error::from)?;
    // SAFETY: `put` just assigned a non-sentinel, initialized index.
    Ok(unsafe { slot_ptr_at(map, result.index) }.expect("put assigned a non-sentinel index"))
}
