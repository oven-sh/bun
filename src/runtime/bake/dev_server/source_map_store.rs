//! `DevServer.SourceMapStore` — refcounted source maps on
//! `/_bun/client/{id}.js.map`. Full body (`put_or_increment_ref_count`,
//! `serialize`, weak-ref sweep) lives in the gated
//! `../DevServer/SourceMapStore.rs` draft (blocked on `bun_sourcemap` VLQ
//! emit + `EventLoopTimer` arm/disarm).

use bun_collections::{linear_fifo::StaticBuffer, ArrayHashMap, LinearFifo, MultiArrayList};

use super::{packed_map, ChunkKind, EventLoopTimer, TimerTag};

// Re-export body types so `DevServer.rs` can name them via `source_map_store::*`.
pub use super::source_map_store_body::PutOrIncrementRefCount;

/// See `SourceId` for the bit layout.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
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
    /// BORROW_PARAM (LIFETIMES.tsv): `&entry.files` returned by `get`.
    _opaque_tail: (),
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
    /// Full body in gated `../DevServer/SourceMapStore.rs` draft.
    pub fn remove_or_upgrade_weak_ref(&mut self, _key: Key, _mode: RemoveOrUpgradeMode) -> bool {
        todo!("blocked_on: SourceMapStore::remove_or_upgrade_weak_ref")
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
