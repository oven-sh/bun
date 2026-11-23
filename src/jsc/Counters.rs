use core::cell::Cell;

use crate::bindgen::JsHeap;
use crate::generated_bindgen::counters::CountersObject;

#[repr(C)]
#[derive(Debug, Default)]
pub struct Counters {
    spawn_sync_blocking: Cell<i32>,
    spawn_memfd: Cell<i32>,
    fs_cached_hit: Cell<i32>,
    fs_cached_miss: Cell<i32>,
}

impl Counters {
    pub fn mark(&self, tag: Field) {
        let slot = match tag {
            Field::SpawnSyncBlocking => &self.spawn_sync_blocking,
            Field::SpawnMemfd => &self.spawn_memfd,
            Field::FsCachedHit => &self.fs_cached_hit,
            Field::FsCachedMiss => &self.fs_cached_miss,
        };
        slot.update(|n| n.saturating_add(1));
    }
}

pub(crate) fn create_counters_object(heap: &JsHeap<'_>) -> CountersObject {
    // SAFETY: only the VM is taken from it.
    let counters = &unsafe { heap.global() }.bun_vm().counters;
    CountersObject {
        spawn_sync_blocking: counters.spawn_sync_blocking.get(),
        spawn_memfd: counters.spawn_memfd.get(),
        fs_cached_hit: counters.fs_cached_hit.get(),
        fs_cached_miss: counters.fs_cached_miss.get(),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Field {
    #[strum(serialize = "spawnSync_blocking")]
    SpawnSyncBlocking,
    #[strum(serialize = "spawn_memfd")]
    SpawnMemfd,
    /// An async `node:fs` operation that `bun_sys::cached` answered on the JS thread.
    #[strum(serialize = "fs_cached_hit")]
    FsCachedHit,
    /// One that it asked the kernel about in vain (not one that it did not ask about).
    #[strum(serialize = "fs_cached_miss")]
    FsCachedMiss,
}
