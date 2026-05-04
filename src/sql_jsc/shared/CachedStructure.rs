use bun_jsc::{JSGlobalObject, JSValue, Strong};
// TODO(port): `jsc.JSObject.ExternColumnIdentifier` — exact Rust path TBD in bun_jsc
use bun_jsc::ExternColumnIdentifier;

#[derive(Default)]
pub struct CachedStructure {
    pub structure: Strong, // Strong.Optional = .empty
    /// only populated if more than jsc.JSC__JSObject__maxInlineCapacity fields otherwise the structure will contain all fields inlined
    pub fields: Option<Box<[ExternColumnIdentifier]>>,
}

impl CachedStructure {
    pub fn has(&self) -> bool {
        self.structure.has() || self.fields.is_some()
    }

    pub fn js_value(&self) -> Option<JSValue> {
        self.structure.get()
    }

    pub fn set(
        &mut self,
        global_object: &JSGlobalObject,
        value: Option<JSValue>,
        fields: Option<Box<[ExternColumnIdentifier]>>,
    ) {
        if let Some(v) = value {
            self.structure.set(global_object, v);
        }
        self.fields = fields;
    }
}

// PORT NOTE: Zig `deinit` only freed owned fields:
//   - `structure.deinit()`  → handled by `impl Drop for Strong`
//   - per-element `name.deinit()` + `default_allocator.free(fields)`
//     → handled by `Drop` on `Box<[ExternColumnIdentifier]>` (each element drops itself)
// so no explicit `impl Drop` body is needed.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/shared/CachedStructure.zig (32 lines)
//   confidence: high
//   todos:      1
//   notes:      ExternColumnIdentifier import path needs confirming; deinit collapsed into field Drops
// ──────────────────────────────────────────────────────────────────────────
