use crate::{CallFrame, JSGlobalObject, JSValue, JsResult};

#[repr(C)]
#[derive(Debug, Default, Clone, Copy)]
pub struct Counters {
    pub spawn_sync_blocking: i32,
    pub spawn_memfd: i32,
}

impl Counters {
    pub fn mark(&mut self, tag: Field) {
        // PORT NOTE: Zig used `comptime tag` + `@field(this, @tagName(tag))` reflection;
        // Rust dispatches via match. Demoted to runtime arg (not used in a type position).
        // PERF(port): was comptime monomorphization — profile in Phase B.
        let slot = match tag {
            Field::SpawnSyncBlocking => &mut self.spawn_sync_blocking,
            Field::SpawnMemfd => &mut self.spawn_memfd,
        };
        *slot = slot.saturating_add(1);
    }

    pub fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        // TODO(port): `JSObject::create(struct_value, global)` relies on field reflection in Zig
        // (builds an object with one property per struct field). Phase B: hand-roll the two
        // `put` calls or add a small derive.
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

// TODO(port): proc-macro — `#[bun_jsc::host_fn]` emits the `extern "sysv64"`/"C"
// trampoline. Until the macro crate exists, expose the Zig-shape signature
// directly; the trampoline is wired by codegen.
pub fn create_counters_object(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: bun_vm() returns the per-thread VirtualMachine singleton; caller is on the JS thread.
    global.bun_vm().counters.to_js(global)
}

// Zig: `const Field = std.meta.FieldEnum(Counters);`
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Field {
    #[strum(serialize = "spawnSync_blocking")]
    SpawnSyncBlocking,
    #[strum(serialize = "spawn_memfd")]
    SpawnMemfd,
}

// ported from: src/jsc/Counters.zig
