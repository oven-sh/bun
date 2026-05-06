//! `DevServer.SourceMapStore` — refcounted source maps on
//! `/_bun/client/{id}.js.map`. Full body (`put_or_increment_ref_count`,
//! `serialize`, weak-ref sweep) lives in the gated
//! `../DevServer/SourceMapStore.rs` draft (blocked on `bun_sourcemap` VLQ
//! emit + `EventLoopTimer` arm/disarm).

use bun_collections::{linear_fifo::StaticBuffer, ArrayHashMap, LinearFifo, MultiArrayList};

use super::{packed_map, ChunkKind, EventLoopTimer, TimerTag};

/// Result of `SourceMapStore::put_or_increment_ref_count` (Zig: `PutOrIncrementRefCount`).
/// Defined locally over the stub `Entry` so `DevServer.rs` and
/// `incremental_graph::take_source_map` agree on the entry type; the gated
/// body draft has its own copy over its own `Entry`.
pub enum PutOrIncrementRefCount<'a> {
    /// Newly inserted; caller must populate `files`/`paths`.
    Uninitialized(&'a mut Entry),
    /// Existing entry; ref_count was bumped.
    Shared(&'a mut Entry),
}

/// See `SourceId` for the bit layout.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Default)]
pub struct Key(pub u64);
impl Key {
    #[inline] pub const fn init(v: u64) -> Self { Self(v) }
    #[inline] pub const fn get(self) -> u64 { self.0 }
}

/// `packed struct(u64)`: bit 0 = `ChunkKind`; for `.InitialResponse` the
/// top 32 bits are `client_script_generation`; for `.HmrChunk` bits 1..64
/// are a sequential ID.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct SourceId(pub u64);
impl SourceId {
    #[inline] pub const fn kind(self) -> ChunkKind {
        // SAFETY: ChunkKind is #[repr(u8)] with variants {0,1}.
        unsafe { core::mem::transmute::<u8, ChunkKind>((self.0 & 1) as u8) }
    }
    #[inline] pub const fn initial_response_generation_id(self) -> u32 { (self.0 >> 32) as u32 }
}

pub const WEAK_REF_EXPIRY_SECONDS: i64 = 10;
pub const WEAK_REF_ENTRY_MAX: usize = 16;

#[derive(Copy, Clone)]
pub struct WeakRef {
    pub key: Key,
    pub deadline: i64,
}

pub struct Entry {
    pub ref_count: u32,
    pub files: MultiArrayList<packed_map::Shared>,
    /// Approximate retained-memory cost of this entry's source-map data;
    /// reported to the HMR client so it can budget eviction.
    pub overlapping_memory_cost: u32,
    /// BORROW_PARAM (LIFETIMES.tsv): `&entry.files` returned by `get`.
    _opaque_tail: (),
}

impl Entry {
    /// `SourceMapStore.Entry.deinit` — full body in gated draft.
    pub fn deinit(&mut self) {
        // Drop releases `files`; ref_count must be 0.
        debug_assert_eq!(self.ref_count, 0);
    }

    /// `SourceMapStore.Entry.renderJSON` — full body in gated draft.
    pub fn render_json<D>(
        &self,
        _dev: &D,
        _kind: ChunkKind,
        _side: crate::bake::Side,
    ) -> Result<Vec<u8>, bun_core::Error> {
        todo!("blocked_on: SourceMapStore::Entry::render_json body un-gate")
    }
}

impl Default for Entry {
    fn default() -> Self {
        Self { ref_count: 0, files: Default::default(), overlapping_memory_cost: 0, _opaque_tail: () }
    }
}

/// Action for `SourceMapStore::remove_or_upgrade_weak_ref` (Zig: `WeakRefOp`).
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum RemoveOrUpgradeMode {
    Remove,
    Upgrade,
}

pub struct SourceMapStore {
    pub entries: ArrayHashMap<Key, Entry>,
    pub weak_refs: LinearFifo<WeakRef, StaticBuffer<WeakRef, WEAK_REF_ENTRY_MAX>>,
    pub weak_ref_sweep_timer: EventLoopTimer,
}
impl SourceMapStore {
    /// `SourceMapStore.empty` (Zig: `.{}` field-init).
    pub fn empty() -> Self {
        todo!("blocked_on: SourceMapStore::empty — LinearFifo/EventLoopTimer field defaults")
    }

    /// Full body in gated `../DevServer/SourceMapStore.rs` draft.
    pub fn add_weak_ref(&mut self, _key: Key) {
        // TODO(port): SourceMapStore.addWeakRef — full body in gated draft.
    }

    pub fn remove_or_upgrade_weak_ref(&mut self, _key: Key, _mode: RemoveOrUpgradeMode) -> bool {
        todo!("blocked_on: SourceMapStore::remove_or_upgrade_weak_ref")
    }

    /// Spec DevServer/SourceMapStore.zig `sweepWeakRefs` — pop expired
    /// weak-refs, decrement, reschedule. Called from the high-tier
    /// `EventLoopTimer` dispatch with the raw `*EventLoopTimer` (Zig recovers
    /// the store via `@fieldParentPtr("weak_ref_sweep_timer", t)`).
    pub fn sweep_weak_refs(
        _t: *mut EventLoopTimer,
        _now: &bun_event_loop::EventLoopTimer::Timespec,
    ) {
        todo!("blocked_on: SourceMapStore::sweep_weak_refs body un-gate")
    }

    /// Full body in gated `../DevServer/SourceMapStore.rs` draft.
    pub fn put_or_increment_ref_count(
        &mut self,
        _script_id: Key,
        _ref_count: u32,
    ) -> Result<PutOrIncrementRefCount<'_>, bun_alloc::AllocError> {
        todo!("blocked_on: SourceMapStore::put_or_increment_ref_count body un-gate")
    }

    pub fn unref(&mut self, key: Key) {
        self.unref_count(key, 1);
    }

    pub fn unref_count(&mut self, key: Key, count: u32) {
        let Some(index) = self.entries.get_index(&key) else {
            debug_assert!(false);
            return;
        };
        self.unref_at_index(index, count);
    }

    fn unref_at_index(&mut self, index: usize, count: u32) {
        let e = &mut self.entries.values_mut()[index];
        e.ref_count -= count;
        if e.ref_count == 0 {
            // Drop runs Entry::drop (was e.deinit()).
            self.entries.swap_remove_at(index);
        }
    }
}
impl Default for SourceMapStore {
    fn default() -> Self {
        Self {
            entries: ArrayHashMap::new(),
            weak_refs: LinearFifo::<WeakRef, StaticBuffer<WeakRef, WEAK_REF_ENTRY_MAX>>::init(),
            weak_ref_sweep_timer: EventLoopTimer::init_paused(TimerTag::DevServerSweepSourceMaps),
        }
    }
}
