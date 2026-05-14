use core::ptr::NonNull;

use enumset::{EnumSet, EnumSetType};

use bun_alloc as allocators;
#[allow(unused_imports)]
use bun_core::Generation;
#[allow(unused_imports)]
use bun_core::feature_flags as FeatureFlags;
use bun_sys::Fd;

#[allow(unused_imports)]
use crate::fs;
use crate::package_json::PackageJSON;
use crate::tsconfig_json::TSConfigJSON;

pub use allocators::IndexType;
use allocators::NOT_FOUND;

pub type Index = IndexType;

// ─────────────────────────────────────────────────────────────────────────────
// DirInfoRef — arena handle into the DirInfo BSSMap singleton.
//
// Resolver code threads `*mut DirInfo` (Zig: `*DirInfo`) pervasively and
// open-coded `unsafe { &*dir_info }` at ~50 read sites. The BSSMap backing
// store is process-lifetime and append-only (slots are never freed; `reset()`
// runs only at shutdown after all readers are gone), so a `Copy` handle that
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
    pub const unsafe fn from_raw(p: *mut DirInfo) -> Self {
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
    pub fn from_slot(slot: &mut DirInfo) -> Self {
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
    pub parent: Index,

    // A pointer to the enclosing dirInfo with a valid "browser" field in
    // package.json. We need this to remap paths after they have been resolved.
    pub enclosing_browser_scope: Index,
    // PORT NOTE: lifetime — `&'static` borrows below are ARENA-backed (the
    // resolver-owned PackageJSON/TSConfigJSON caches outlive every DirInfo).
    // Fields Zig typed `?*const T` (`package_json_for_browser_field`,
    // `enclosing_tsconfig_json` — dir_info.zig:12-13) are `Option<&'static T>`.
    // Fields Zig typed `?*T` (mutable) are `Option<NonNull<T>>` so
    // mut-provenance from the allocation site is preserved through to the
    // write/drop sites (a `*const→*mut` cast there would be UB under Stacked
    // Borrows). Read sites use the `.package_json()` / `.tsconfig_json()` /
    // `.package_json_for_dependencies()` accessors.
    pub package_json_for_browser_field: Option<&'static PackageJSON>,
    pub enclosing_tsconfig_json: Option<&'static TSConfigJSON>,

    /// package.json used for bundling
    /// it's the deepest one in the hierarchy with a "name" field
    /// or, if using `bun run`, the name field is optional
    /// https://github.com/oven-sh/bun/issues/229
    // PORT NOTE: Zig `?*PackageJSON` (mutable, dir_info.zig:19) but no write
    // site exists in resolver.zig or any caller — kept `Option<&'static>` for
    // ergonomics. If a write is ever ported, retype to `Option<NonNull<_>>`.
    pub enclosing_package_json: Option<&'static PackageJSON>,

    // PORT NOTE: Zig `?*PackageJSON` (mutable, dir_info.zig:21). `NonNull` (not
    // `&'static`) so `enqueue_dependency_to_resolve` can write
    // `package_manager_package_id` back through it (resolver.zig:2394) without
    // a const→mut provenance cast. Read via `.package_json_for_dependencies()`.
    pub package_json_for_dependencies: Option<NonNull<PackageJSON>>,

    // TODO(port): lifetime — slice into BSS-backed path storage; never individually freed
    pub abs_path: &'static [u8],
    pub entries: Index,
    /// Is there a "package.json" file?
    // PORT NOTE: Zig `?*PackageJSON` (mutable). `NonNull` (not `&'static`) so
    // `reset()` can `drop_in_place` without a const→mut provenance cast. Read
    // via `.package_json()`.
    pub package_json: Option<NonNull<PackageJSON>>,
    /// Is there a "tsconfig.json" file in this directory or a parent directory?
    // PORT NOTE: Zig `?*TSConfigJSON` (mutable). `NonNull` (not `&'static`) so
    // `reset()` can `drop_in_place` without a const→mut provenance cast. Read
    // via `.tsconfig_json()`.
    pub tsconfig_json: Option<NonNull<TSConfigJSON>>,
    /// If non-empty, this is the real absolute path resolving any symlinks
    // TODO(port): lifetime — slice into BSS-backed path storage; never individually freed
    pub abs_real_path: &'static [u8],

    pub flags: Flags,
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
            // PORT NOTE: Zig left this `= undefined`; using a zero-value placeholder.
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
/// merge loop); never freed until `reset()` at shutdown, after which no reader
/// exists.
#[inline]
fn arena_ref<T>(p: NonNull<T>) -> &'static T {
    // SAFETY: ARENA — see fn doc; pointee is process-lifetime, never freed
    // while a `DirInfo` reader is live.
    unsafe { &*p.as_ptr() }
}

impl DirInfo {
    /// Is there a "node_modules" subdirectory?
    #[inline]
    pub fn has_node_modules(&self) -> bool {
        self.flags.contains(Flags::HasNodeModules)
    }

    /// Is this a "node_modules" directory?
    #[inline]
    pub fn is_node_modules(&self) -> bool {
        self.flags.contains(Flags::IsNodeModules)
    }

    /// Is this inside a "node_modules" directory?
    #[inline]
    pub fn is_inside_node_modules(&self) -> bool {
        self.flags.contains(Flags::InsideNodeModules)
    }

    /// Read-only view of `package_json`. The field stores `NonNull` to preserve
    /// mut-provenance for `reset()`; callers that only read go through here.
    #[inline]
    pub fn package_json(&self) -> Option<&'static PackageJSON> {
        self.package_json.map(arena_ref)
    }

    /// Read-only view of `package_json_for_dependencies`. The field stores
    /// `NonNull` to preserve mut-provenance for the write at resolver.zig:2394;
    /// callers that only read go through here.
    #[inline]
    pub fn package_json_for_dependencies(&self) -> Option<&'static PackageJSON> {
        self.package_json_for_dependencies.map(arena_ref)
    }

    /// Read-only view of `tsconfig_json`. See `package_json()`.
    #[inline]
    pub fn tsconfig_json(&self) -> Option<&'static TSConfigJSON> {
        self.tsconfig_json.map(arena_ref)
    }

    pub fn has_parent_package(&self) -> bool {
        let Some(parent) = self.get_parent() else {
            return false;
        };
        !parent.is_node_modules()
    }

    pub fn get_file_descriptor(&self) -> Fd {
        if FeatureFlags::STORE_FILE_DESCRIPTORS {
            // Route through `entries_at` directly (returns `Option<&mut EntriesOption>`)
            // instead of round-tripping the safe `&mut DirEntry` through `get_entries`'s
            // `*mut` return just to deref it back here. With `generation = 0` the
            // generation-check re-read in `entries_at` is a no-op, so this is the
            // same lookup `get_entries(0)` performs.
            if let Some(fs::EntriesOption::Entries(entries)) =
                fs::FileSystem::instance().fs.entries_at(self.entries, 0)
            {
                return entries.fd;
            }
        }
        Fd::INVALID
    }

    /// Port of `getEntries` in `dir_info.zig` (returns `?*DirEntry`). Returns a
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
    pub fn get_entries_ref(&self, generation: Generation) -> Option<&'static fs::DirEntry> {
        let entries_ptr = fs::FileSystem::instance()
            .fs
            .entries_at(self.entries, generation)?;
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(&**entries),
            fs::EntriesOption::Err(_) => None,
        }
    }

    pub fn get_entries_const(&self) -> Option<&fs::DirEntry> {
        // SAFETY: read-only path; no other live `&mut EntriesOption` for this index
        // exists in this scope (resolver invariant).
        let entries_ptr = unsafe { fs::FileSystem::instance().fs.entries.at_index(self.entries) }?;
        match entries_ptr {
            fs::EntriesOption::Entries(entries) => Some(&**entries),
            fs::EntriesOption::Err(_) => None,
        }
    }

    pub fn get_parent(&self) -> Option<DirInfoRef> {
        ref_at_index(self.parent)
    }

    /// Handle to the enclosing browser-scope `DirInfo` slot. Frequently
    /// resolves back to *this* slot (resolver.zig:4161), which is why a
    /// `Copy` arena handle (not `&mut`) is returned — overlapping shared
    /// reads through `DirInfoRef::deref` are sound.
    pub fn get_enclosing_browser_scope(&self) -> Option<DirInfoRef> {
        ref_at_index(self.enclosing_browser_scope)
    }
}

// PORT NOTE: Zig `BSSMap` is a per-monomorphization singleton (`var instance` inside
// the comptime-returned struct). Rust `BSSMapInner<DirInfo, ..>` cannot host a
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
#[inline]
pub fn hash_map_instance() -> *mut HashMap {
    if let Some(p) = DIR_INFO_MAP.load() {
        return p.as_ptr();
    }
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
    pub fn set_present(&mut self, flag: Flags, present: bool) {
        self.set(flag, present);
    }
}
/// Body addresses individual flags as `DirInfo::Flag::X` (Zig nesting).
pub use Flags as Flag;

impl DirInfo {
    // TODO(port): in-place cache invalidation, not Drop — DirInfo lives in BSS-backed
    // allocators::BSSMap storage so Drop never fires naturally; callers invoke this
    // explicitly when invalidating the cache slot. Zig name was `deinit`.
    pub fn reset(&mut self) {
        if let Some(p) = self.package_json.take() {
            // SAFETY: `p` carries mut-provenance from `intern_package_json` (NonNull
            // derived from the arena's `&mut Box<PackageJSON>`); this is the sole
            // remaining owner at shutdown. `drop_in_place` releases its owned
            // resources in-place (storage itself is BSS/cache-owned and not freed
            // here, matching Zig `p.deinit()`).
            unsafe { core::ptr::drop_in_place(p.as_ptr()) };
        }
        if let Some(t) = self.tsconfig_json.take() {
            // SAFETY: `t` carries mut-provenance from `heap::alloc` in the
            // tsconfig merge loop; this is the sole remaining owner at shutdown.
            // `drop_in_place` releases its owned resources in-place (storage
            // itself is BSS/cache-owned and not freed here, matching Zig
            // `t.deinit()`).
            unsafe { core::ptr::drop_in_place(t.as_ptr()) };
        }
    }
}

// Goal: Really fast, low allocation directory map exploiting cache locality where we don't worry about lifetimes much.
// 1. Don't store the keys or values of directories that don't exist
// 2. Don't expect a provided key to exist after it's queried
// 3. Store whether a directory has been queried and whether that query was successful.
// 4. Allocate onto the https://en.wikipedia.org/wiki/.bss#BSS_in_C instead of the heap, so we can avoid memory leaks
//
// PORT NOTE: Zig `BSSMap(DirInfo, COUNT, store_keys=false, est_key_len=128, rm_slash=true)`;
// Rust splits the comptime branch — `store_keys=false` → `BSSMapInner<V, COUNT, RM_SLASH>`.
// `est_key_len` is unused on the inner shape. COUNT mirrors `fs::preallocate::counts::DIR_ENTRY`.
pub type HashMap = allocators::BSSMapInner<DirInfo, 2048, true>;

/// Resolver-side extension trait adapting `BSSMapInner`'s inherent surface to
/// the resolver's error type (`bun_core::Error`) and pointer-return shape, plus
/// `values_mut` which has no inherent equivalent. The four name-colliding
/// methods are shadowed by inherent methods under dot-syntax (Rust resolves
/// inherent before trait), so the bodies below delegate without recursing.
pub trait HashMapExt {
    fn get_or_put(
        &mut self,
        key: &[u8],
    ) -> core::result::Result<crate::__phase_a_body::allocators::Result, bun_core::Error>;
    fn put(
        &mut self,
        result: &mut crate::__phase_a_body::allocators::Result,
        value: DirInfo,
    ) -> core::result::Result<*mut DirInfo, bun_core::Error>;
    fn mark_not_found(&mut self, result: crate::__phase_a_body::allocators::Result);
    fn remove(&mut self, key: &[u8]) -> bool;
    fn values_mut(&mut self) -> core::slice::IterMut<'_, DirInfo>;
}
impl HashMapExt for HashMap {
    #[inline]
    fn get_or_put(
        &mut self,
        key: &[u8],
    ) -> core::result::Result<crate::__phase_a_body::allocators::Result, bun_core::Error> {
        // Dot-syntax picks inherent `BSSMapInner::get_or_put` (inherent > trait); not recursive.
        self.get_or_put(key).map_err(Into::into)
    }
    #[inline]
    fn put(
        &mut self,
        result: &mut crate::__phase_a_body::allocators::Result,
        value: DirInfo,
    ) -> core::result::Result<*mut DirInfo, bun_core::Error> {
        // Spec bun_alloc.zig:615 `put(self: *Self, result: *Result, value) !*ValueType` —
        // `result.index` is written back, so `&mut`. Inherent returns `&mut DirInfo`;
        // erase to `*mut` so callers can stash it past borrowck. NOTE (Stacked Borrows):
        // this erasure does NOT make the pointer survive a sibling `&mut HashMap` Unique
        // retag of the same `BSSMapInner` allocation — `backing_buf` is inline, so a fresh
        // `&mut *dir_cache()` pops every tag derived here. Callers MUST derive all slot
        // pointers from a single bound `&mut HashMap` (see resolver.rs `dir_info_cached_*`).
        // TODO(port): derive via `addr_of_mut!` from the raw singleton (SharedReadWrite
        // provenance) so slot pointers survive sibling retags outright.
        self.put(result, value)
            .map(|v| std::ptr::from_mut::<DirInfo>(v))
            .map_err(Into::into)
    }
    #[inline]
    fn mark_not_found(&mut self, result: crate::__phase_a_body::allocators::Result) {
        // Inherent `BSSMapInner::mark_not_found` (inherent > trait); not recursive.
        self.mark_not_found(result)
    }
    #[inline]
    fn remove(&mut self, key: &[u8]) -> bool {
        // Inherent `BSSMapInner::remove` (inherent > trait); not recursive.
        self.remove(key)
    }
    #[inline]
    fn values_mut(&mut self) -> core::slice::IterMut<'_, DirInfo> {
        // Spec resolver.zig:602 `for (r.dir_cache.values()) |*di|` — backing_buf slice
        // only (overflow_list excluded, matching Zig `BSSMapType` which exposes no
        // overflow iterator). Inherent `values()` already returns `&mut [DirInfo]`.
        self.values().iter_mut()
    }
}

// ported from: src/resolver/dir_info.zig
