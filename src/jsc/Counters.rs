use crate::{CallFrame, JSGlobalObject, JSValue, JsResult};

#[repr(C)]
#[derive(Debug, Default, Clone, Copy)]
pub struct Counters {
    pub spawn_sync_blocking: i32,
    pub spawn_memfd: i32,
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

// Called through the `$rust(...)` js2native codegen, which emits the extern
// trampoline (`generate-js2native.ts` wraps this in `host_fn::host_fn_static`),
// so no `#[bun_jsc::host_fn]` attribute is needed here.
pub fn create_counters_object(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: bun_vm() returns the per-thread VirtualMachine singleton; caller is on the JS thread.
    global.bun_vm().counters.to_js(global)
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Field {
    #[strum(serialize = "spawnSync_blocking")]
    SpawnSyncBlocking,
    #[strum(serialize = "spawn_memfd")]
    SpawnMemfd,
}
