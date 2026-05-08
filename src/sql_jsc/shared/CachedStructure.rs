use crate::jsc::{ExternColumnIdentifier, JSGlobalObject, JSValue, StrongOptional};

#[derive(Default)]
pub struct CachedStructure {
    pub structure: StrongOptional, // Strong.Optional = .empty
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
//   - `structure.deinit()`  → handled by `impl Drop for StrongOptional`
//   - per-element `name.deinit()` + `default_allocator.free(fields)`
//     → handled by `Drop` on `Box<[ExternColumnIdentifier]>` (each element drops itself)
// so no explicit `impl Drop` body is needed.

// ported from: src/sql_jsc/shared/CachedStructure.zig
