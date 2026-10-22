use crate::bindgen::JsHeap;
use crate::{JSGlobalObject, JSValue, JsResult};

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

    pub fn to_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let obj = JSValue::create_empty_object(global, 2);
        obj.put(
            global,
            b"spawnSync_blocking",
            JSValue::js_number_from_int32(self.spawn_sync_blocking),
        );
        obj.put(
            global,
            b"spawn_memfd",
            JSValue::js_number_from_int32(self.spawn_memfd),
        );
        Ok(obj)
    }
}

pub(crate) fn create_counters_object(heap: &JsHeap<'_>) -> JsResult<JSValue> {
    // SAFETY: the object is new and plain, and its properties are defined and not set.
    let global = unsafe { heap.global() };
    global.bun_vm().counters.to_js(global)
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Field {
    #[strum(serialize = "spawnSync_blocking")]
    SpawnSyncBlocking,
    #[strum(serialize = "spawn_memfd")]
    SpawnMemfd,
}
