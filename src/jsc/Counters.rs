use core::cell::Cell;

use crate::bindgen::JsHeap;
use crate::generated_bindgen::counters::CountersObject;

#[repr(C)]
#[derive(Debug, Default, Clone)]
pub struct Counters {
    pub(crate) spawn_sync_blocking: Cell<i32>,
    pub(crate) spawn_memfd: Cell<i32>,
}

impl Counters {
    pub fn mark(&self, tag: Field) {
        let slot = match tag {
            Field::SpawnSyncBlocking => &self.spawn_sync_blocking,
            Field::SpawnMemfd => &self.spawn_memfd,
        };
        slot.set(slot.get().saturating_add(1));
    }
}

pub(crate) fn create_counters_object(heap: &JsHeap<'_>) -> CountersObject {
    // SAFETY: only the VM is taken from it.
    let counters = &unsafe { heap.global() }.bun_vm().counters;
    CountersObject {
        spawn_sync_blocking: counters.spawn_sync_blocking.get(),
        spawn_memfd: counters.spawn_memfd.get(),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Field {
    #[strum(serialize = "spawnSync_blocking")]
    SpawnSyncBlocking,
    #[strum(serialize = "spawn_memfd")]
    SpawnMemfd,
}
