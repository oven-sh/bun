use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, AtomicU64};

use bun_alloc as allocators;
use bun_core::Generation;
use bun_core::feature_flags as FeatureFlags;
use bun_sys::Fd;

use crate::fs;
use crate::package_json::{PackageID, PackageJSON};
use crate::tsconfig_json::{ConfigSource, TSConfigJSON};

pub use allocators::IndexType;
use allocators::{NOT_FOUND, UNASSIGNED};

pub type Index = IndexType;

/// Who asks the caches for a fact. It is a type of the lookup, not a field: a `Resolver` is copied while it runs.
pub(crate) trait Asker: Copy {
    /// False for `Trusting`, whose code is the code without any check.
    const CHECKS: bool;
    /// The generation that a cached fact is compared with. 0 for `Trusting`.
    fn generation(self) -> Generation;
}

/// Takes every cached fact as it is.
#[derive(Clone, Copy)]
pub(crate) struct Trusting;

/// Takes a cached fact as it is only if it was read or checked at this generation, which is never 0.
#[derive(Clone, Copy)]
pub(crate) struct Checked(pub(crate) Generation);

impl Asker for Trusting {
    const CHECKS: bool = false;
    #[inline(always)]
    fn generation(self) -> Generation {
        0
    }
}

impl Asker for Checked {
    const CHECKS: bool = true;
    #[inline(always)]
    fn generation(self) -> Generation {
        self.0
    }
}

/// Runs `$body` with `$asker` bound to the asker that `$generation` stands for: `Trusting` for 0, else `Checked`.
macro_rules! dispatch_asker {
    ($generation:expr, |$asker:ident| $body:expr) => {
        match $generation {
            0 => {
                let $asker = $crate::dir_info::Trusting;
                $body
            }
            generation => {
                let $asker = $crate::dir_info::Checked(generation);
                $body
            }
        }
    };
}
pub(crate) use dispatch_asker;

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
// `stamp` and the two listing versions are atomics: a lookup that checks a slot stores them through `&DirInfo`.
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

    /// Wrap a BSSMap slot reference. Safe: a `&mut DirInfo` obtained from
    /// `BSSMapInner::at_index`/`put` is by construction a non-null slot in the
    /// process-lifetime BSSMap singleton — exactly the [`from_raw`] contract.
    /// Centralizes the per-site `from_raw(ptr::from_mut(d))` open-coding at
    /// every `at_index` call.
    #[inline]
    pub(crate) fn from_slot(slot: &mut DirInfo) -> Self {
        DirInfoRef(bun_ptr::BackRef::new_mut(slot))
    }

    /// The address of the slot. A directory that is read again after a drop gets another slot.
    #[inline]
    pub(crate) fn as_ptr(self) -> *const DirInfo {
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
    // A slot is filled once and a directory that changed gets a new one, so this index is read without locking the cache.
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

    /// The generation of the lookup that last read these facts from disk or found them unchanged. 0: one that checks nothing.
    pub(crate) stamp: AtomicU64,
    /// `DirEntry::version` of the listing when the facts that come from it were last derived.
    pub(crate) listing_version: AtomicU32,
    /// The same for the listing of the parent, which gives `abs_real_path`.
    pub(crate) parent_listing_version: AtomicU32,
    pub(crate) rare: Option<Box<RareFacts>>,
}

/// What few directories have: a config file that gave no parsed value, what reading the config files logged, a package id.
#[derive(Default)]
pub(crate) struct RareFacts {
    /// `package.json` was listed as a file and gave no `PackageJSON`.
    pub(crate) unparsed_package_json: Option<ConfigSource>,
    /// `tsconfig.json` or `jsconfig.json` was listed as a file and gave no `TSConfigJSON`: that file, then each other file that was read for it.
    pub(crate) unparsed_tsconfig: Vec<ConfigSource>,
    /// A lookup that checks the slot and keeps it writes these again: the readers logged them only when they filled it.
    pub(crate) package_json_msgs: Vec<bun_ast::Msg>,
    pub(crate) tsconfig_msgs: Vec<bun_ast::Msg>,
    /// Set for a package of the global cache, which has no parent: `Resolver::dir_info_for_resolution` filled the slot.
    pub(crate) package_id: Option<PackageID>,
}

impl RareFacts {
    pub(crate) fn is_empty(&self) -> bool {
        self.unparsed_package_json.is_none()
            && self.unparsed_tsconfig.is_empty()
            && self.package_json_msgs.is_empty()
            && self.tsconfig_msgs.is_empty()
            && self.package_id.is_none()
    }
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
            entries: Index::default(),
            package_json: None,
            tsconfig_json: None,
            abs_real_path: b"",
            flags: Flags::empty(),
            stamp: AtomicU64::new(0),
            listing_version: AtomicU32::new(0),
            parent_listing_version: AtomicU32::new(0),
            rare: None,
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

    /// The id that the package manager gave this directory, if it is a package of the global cache.
    #[inline]
    pub(crate) fn package_id(&self) -> Option<PackageID> {
        self.rare.as_deref().and_then(|rare| rare.package_id)
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
    /// `&'static` returned by `entries_at_locked` is sound and needs no
    /// `unsafe` here. The `.data` map must only be probed/iterated while the
    /// lock is held; use [`get_entry_as`](Self::get_entry_as) for one-shot lookups.
    pub fn get_entries_ref_locked(&self, generation: Generation) -> Option<&'static fs::DirEntry> {
        if generation == 0 {
            self.entries_ref_locked_as(Trusting)
        } else {
            self.entries_ref_locked_as(Checked(generation))
        }
    }

    /// The listing as `asker` may use it. Caller holds `entries_mutex`.
    #[inline]
    pub(crate) fn entries_ref_locked_as<A: Asker>(
        &self,
        asker: A,
    ) -> Option<&'static fs::DirEntry> {
        fs::FileSystem::instance()
            .fs
            .entries_at_locked(self.entries, asker)?
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
    #[inline]
    pub(crate) fn get_entry_as<A: Asker>(&self, asker: A, query: &[u8]) -> Option<fs::EntryLookup> {
        let rfs = &mut fs::FileSystem::instance().fs;
        // `MutexGuard` stores the mutex by raw pointer, so holding it does not
        // keep `rfs` borrowed.
        let _lock = rfs.entries_mutex.lock_guard();
        rfs.entries_at_locked(self.entries, asker)?
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

/// `bun:internal-for-testing`: `DirInfo` slots filled so far. None is freed: a directory read again counts twice.
pub fn slots_used() -> usize {
    // SAFETY: the singleton lives for the process, and `slots_used` takes the map's mutex.
    unsafe { (*hash_map_instance()).slots_used() }
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
        /// A `package.json` file was listed, whether or not it parsed.
        const HasPackageJsonFile = 1 << 3;
        /// A `tsconfig.json` or `jsconfig.json` file was listed, whether or not it loaded.
        const HasTsconfigFile   = 1 << 4;
        /// The resolver that filled the slot reads `package.json` files. One that does not leaves no fact about that file.
        const ReadsPackageJson  = 1 << 5;
        /// The same for `tsconfig.json` and `jsconfig.json`.
        const ReadsTsconfig     = 1 << 6;
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
