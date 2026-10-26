use crate::bindgen::JsHeap;
use crate::generated_bindgen::counters::CountersObject;

#[repr(C)]
#[derive(Debug, Default, Clone, Copy)]
pub struct Counters {
    pub(crate) spawn_sync_blocking: i32,
    pub(crate) spawn_memfd: i32,
}

impl Counters {
    pub fn mark(&mut self, tag: Field) {
        let slot = match tag {
            Field::SpawnSyncBlocking => &mut self.spawn_sync_blocking,
            Field::SpawnMemfd => &mut self.spawn_memfd,
        };
        *slot = slot.saturating_add(1);
    }
}

pub(crate) fn create_counters_object(heap: &JsHeap<'_>) -> CountersObject {
    // SAFETY: only the VM is taken from it.
    let counters = unsafe { heap.global() }.bun_vm().counters;
    CountersObject {
        spawn_sync_blocking: counters.spawn_sync_blocking,
        spawn_memfd: counters.spawn_memfd,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Field {
    #[strum(serialize = "spawnSync_blocking")]
    SpawnSyncBlocking,
    #[strum(serialize = "spawn_memfd")]
    SpawnMemfd,
}
