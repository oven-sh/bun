use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSObject, JSValue, JsResult};

#[derive(Default, Clone, Copy)]
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
        Ok(JSObject::create(*self, global)?.to_js())
    }
}

#[bun_jsc::host_fn]
pub fn create_counters_object(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/Counters.zig (23 lines)
//   confidence: high
//   todos:      1
//   notes:      JSObject::create needs reflection shim or manual property puts in Phase B
// ──────────────────────────────────────────────────────────────────────────
