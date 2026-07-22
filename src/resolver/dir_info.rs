use core::ptr::NonNull;

use bun_alloc as allocators;
use bun_core::Generation;
use bun_core::feature_flags as FeatureFlags;
use bun_sys::Fd;

use crate::fs;
use crate::package_json::PackageJSON;
use crate::tsconfig_json::TSConfigJSON;

pub use allocators::IndexType;
use allocators::{NOT_FOUND, UNASSIGNED};

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
// only inside `dir_info_uncached` while filling a freshly-`put` slot, before
// any handle to that slot escapes. All access is additionally serialized under
// the resolver mutex.
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
pub struct DirInfoRef(bun_ptr::BackRef<DirInfo>);

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
        DirInfoRef(unsafe { bun_ptr::BackRef::from_raw(p) })
    }

    /// Wrap a BSSMap slot reference. Safe: a `&mut DirInfo` obtained from
    /// `BSSMapInner::at_index`/`put` is by construction a non-null slot in the
    /// process-lifetime BSSMap singleton — exactly the [`from_raw`] contract.
    /// Centralizes the per-site `from_raw(ptr::from_mut(d))` open-coding at
    /// every `at_index` call.
    #[inline]
    pub(crate) fn from_slot(slot: &mut DirInfo) -> Self {
        DirInfoRef(bun_ptr::BackRef::new_mut(slot))
    }

    /// Raw pointer to the underlying slot. Preserves mut-provenance from the
    /// BSSMap allocation site for the `dir_info_uncached` fill path.
    #[inline]
    pub const fn as_ptr(self) -> *mut DirInfo {
        self.0.as_ptr()
    }
}

impl core::ops::Deref for DirInfoRef {
    type Target = DirInfo;
    #[inline]
    fn deref(&self) -> &DirInfo {
        // ARENA — `self.0` is a slot in the process-lifetime BSSMap singleton
        // (see type-level doc). The slot is never freed and never aliased by a
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
            package_json_for_dependencies: None,
            abs_path: b"",
            entries: Index::default(),
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
            // `entries_at(_, 0)` never re-reads (`u16 < 0` is always false), so the
            // lock it would take covers no mutation; go through the same plain
            // `at_index` lookup `get_entries_const` uses.
            return self.get_entries_const().map_or(Fd::INVALID, |e| e.fd);
        }
        Fd::INVALID
    }

    /// Returns a
    /// raw pointer (not `&'static mut`) because the BSSMap singleton is
    /// shared-mutable and Rust forbids manufacturing aliased `&mut`. Callers
    /// dereference at the use site where exclusivity is locally provable.
    pub fn get_entries(&self, generation: Generation) -> Option<*mut fs::DirEntry> {
        let entries_ptr = fs::FileSystem::instance()
            .fs
            .entries_at(self.entries, generation)?;
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(std::ptr::from_mut(*entries)),
            fs::EntriesOption::Err(_) => None,
        }
    }

    /// Shared-borrow variant of [`get_entries`](Self::get_entries) for the
    /// read-only call sites (`.get()`, `.fd`, iteration). The `DirEntry` is a
    /// slot in the BSSMap-backed `EntriesOptionMap` singleton (ARENA — process
    /// lifetime), so a `&'static` reborrow of the `&'static mut` returned by
    /// `entries_at` is sound and needs no `unsafe` here. Prefer this over
    /// `get_entries` + per-site raw deref whenever the caller only reads.
    pub(crate) fn get_entries_ref(&self, generation: Generation) -> Option<&'static fs::DirEntry> {
        let entries_ptr = fs::FileSystem::instance()
            .fs
            .entries_at(self.entries, generation)?;
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(&**entries),
            fs::EntriesOption::Err(_) => None,
        }
    }

    /// [`get_entries_ref`](Self::get_entries_ref) for call sites that already
    /// hold `entries_mutex` (the mutex is non-recursive); see
    /// [`RealFS::entries_at_locked`](fs::RealFS::entries_at_locked).
    pub(crate) fn get_entries_ref_locked(&self, generation: Generation) -> Option<&'static fs::DirEntry> {
        let entries_ptr = fs::FileSystem::instance()
            .fs
            .entries_at_locked(self.entries, generation)?;
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(&**entries),
            fs::EntriesOption::Err(_) => None,
        }
    }

    pub fn get_entries_const(&self) -> Option<&fs::DirEntry> {
        let entries_ptr = fs::FileSystem::instance()
            .fs
            .entries
            .at_index(self.entries)?;
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(&**entries),
            fs::EntriesOption::Err(_) => None,
        }
    }

    #[inline]
    pub(crate) fn get_parent(&self) -> Option<DirInfoRef> {
        ref_at_index(self.parent)
    }

    /// Handle to the enclosing browser-scope `DirInfo` slot. Frequently
    /// resolves back to *this* slot, which is why a
    /// `Copy` arena handle (not `&mut`) is returned — overlapping shared
    /// reads through `DirInfoRef::deref` are sound.
    pub(crate) fn get_enclosing_browser_scope(&self) -> Option<DirInfoRef> {
        ref_at_index(self.enclosing_browser_scope)
    }
}

// `BSSMapInner<DirInfo, ..>` cannot host a
// per-generic-instantiation static on stable, so the singleton pointer lives here at
// the use site and `bun_alloc::BSSMapInner::init()` hands back the storage.
// PORTING.md §Global mutable state: lazy singleton. `AtomicCell` over the
// `Option<NonNull<_>>` because resolver-pool threads race on first access;
// the load/CAS below makes the publish itself data-race-free. (The map's
// *contents* are still guarded by the resolver mutex.)
static DIR_INFO_MAP: bun_core::AtomicCell<Option<NonNull<HashMap>>> =
    bun_core::AtomicCell::new(None);

/// Raw pointer to the lazy DirInfo BSSMap singleton. Callers reborrow
/// per-access under the resolver mutex — PORTING.md §Global mutable state.
#[inline(always)]
pub(crate) fn hash_map_instance() -> *mut HashMap {
    if let Some(p) = DIR_INFO_MAP.load() {
        return p.as_ptr();
    }
    hash_map_instance_init()
}

#[cold]
#[inline(never)]
fn hash_map_instance_init() -> *mut HashMap {
    // First access: initialize and publish. Resolver init is single-threaded
    // in practice, but use CAS so a race (if it ever happens) doesn't tear
    // the pointer; the loser's `init()` result is leaked, which is fine for
    // a process-lifetime BSS-backed singleton.
    let new = HashMap::init();
    match DIR_INFO_MAP.compare_exchange(None, Some(new)) {
        Ok(_) => new.as_ptr(),
        Err(existing) => existing.unwrap().as_ptr(),
    }
}

/// Look up a `DirInfo` slot in the process-lifetime BSSMap singleton by index
/// and wrap it as a [`DirInfoRef`]. Single `unsafe` deref site for
/// `hash_map_instance()` index reads; `get_parent` /
/// `get_enclosing_browser_scope` route through here so callers stay safe.
#[inline]
fn ref_at_index(index: Index) -> Option<DirInfoRef> {
    // SAFETY: ARENA — `hash_map_instance()` is the never-null BSSMap singleton
    // (process-lifetime; never freed). Resolver mutex held by caller serializes
    // mutation. `at_index` yields a slot satisfying `DirInfoRef`'s invariant.
    unsafe { (*hash_map_instance()).at_index(index) }.map(DirInfoRef::from_slot)
}

/// Slot pointer for `index`, derived from the raw singleton so its provenance
/// is rooted in the `DIR_INFO_MAP` static — it survives later `&mut HashMap`
/// retags that would pop a pointer projected through a transient borrow.
/// Returns `None` for the `NOT_FOUND` / `UNASSIGNED` sentinels.
///
/// # Safety
/// A non-sentinel `index` must have been assigned by `put` (slot initialized),
/// and the caller must hold the resolver mutex.
pub(crate) unsafe fn slot_ptr_at(index: Index) -> Option<*mut DirInfo> {
    if index.index() == NOT_FOUND.index() || index.index() == UNASSIGNED.index() {
        return None;
    }
    let raw = hash_map_instance();
    if index.is_overflow() {
        // SAFETY: assigned overflow index; resolver mutex held.
        Some(std::ptr::from_mut::<DirInfo>(unsafe {
            (*raw).overflow_list.at_index_mut(index)
        }))
    } else {
        // SAFETY: raw place read of a `Copy` scalar.
        let used = u32::from(unsafe { (*raw).backing_buf_used });
        // Unconditional assert: keep the inherent `at_index` panic-on-bad-index
        // failure mode rather than handing out an out-of-bounds pointer.
        assert!(
            index.index() < used,
            "dir cache slot index {} out of bounds (used: {used})",
            index.index(),
        );
        // SAFETY: in-bounds initialized slot; raw place projection keeps the
        // static's root provenance.
        Some(unsafe {
            core::ptr::addr_of_mut!((*raw).backing_buf)
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
/// through the singleton's root tag.
///
/// # Safety
/// `map` must be the live `hash_map_instance()` singleton and the caller must
/// hold the resolver mutex.
pub(crate) unsafe fn put_slot(
    map: *mut HashMap,
    result: &mut allocators::Result,
    value: DirInfo,
) -> core::result::Result<*mut DirInfo, crate::Error> {
    debug_assert!(core::ptr::eq(
        map.cast_const(),
        hash_map_instance().cast_const()
    ));
    // SAFETY: `map` is the live singleton; resolver mutex held. The auto-ref
    // `&mut *map` ends when `put` returns, before `slot_ptr_at` runs.
    unsafe { (*map).put(result, value) }.map_err(crate::Error::from)?;
    // SAFETY: `put` just assigned a non-sentinel, initialized index.
    Ok(unsafe { slot_ptr_at(result.index) }.expect("put assigned a non-sentinel index"))
}
