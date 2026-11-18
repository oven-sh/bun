//! Structs and arrays, which are Exported GC Objects (js-api) for scripts.

use bun_engine_macros::object_ops;
use bun_engine_vm::heap::visit_children_of;
use bun_engine_vm::{
    CellType, CellTypeRange, Class, ClassOps, DeletePropertySlot, DontEnumMode, Extends, GcFree,
    JsCell, PropertyDescriptor, PropertyNameList, PropertySlot, PutPropertySlot, TypeFlags,
    Visitor, ascii_literal,
};
use bun_engine_wasm_runtime::find_references;

use crate::object_shape::ObjectShape;
use crate::owned::host_cell;
use crate::prelude::*;

/// What both have in common.
#[repr(C)]
struct WasmObject {
    header: JsCell,
}

impl WasmObject {
    #[inline(always)]
    fn visit(&self, visitor: &mut Visitor) {
        self.header.trace_fields(visitor);
        // SAFETY: the run time takes the header from such a shape, and references are stored at once.
        unsafe {
            let shape = self.header.shape().cast_unchecked::<ObjectShape>();
            let object = host_cell((&self.header).into());
            find_references(object, shape.object_type(), |first, count| {
                visitor.append_words(first, count);
            });
        }
    }
}

const CANNOT_SET: &str = "Cannot set property for WebAssembly GC object";
const CANNOT_DELETE: &str = "Cannot delete property for WebAssembly GC object";

#[object_ops]
impl WasmObject {
    fn get_own_property_slot(
        &self,
        _: &mut Cx,
        _: PropertyName<'_>,
        _: &mut PropertySlot,
    ) -> JsResult<bool> {
        Ok(false)
    }

    fn get_own_property_slot_by_index(
        &self,
        _: &mut Cx,
        _: u32,
        _: &mut PropertySlot,
    ) -> JsResult<bool> {
        Ok(false)
    }

    fn put(
        &self,
        cx: &mut Cx,
        _: PropertyName<'_>,
        _: Value,
        _: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        Err(cx.throw_type_error(CANNOT_SET))
    }

    fn put_by_index(&self, cx: &mut Cx, _: u32, _: Value, _: bool) -> JsResult<bool> {
        Err(cx.throw_type_error(CANNOT_SET))
    }

    fn delete_property(
        &self,
        cx: &mut Cx,
        _: PropertyName<'_>,
        _: &mut DeletePropertySlot,
    ) -> JsResult<bool> {
        Err(cx.throw_type_error(CANNOT_DELETE))
    }

    fn delete_property_by_index(&self, cx: &mut Cx, _: u32) -> JsResult<bool> {
        Err(cx.throw_type_error(CANNOT_DELETE))
    }

    fn own_property_names(
        &self,
        _: &mut Cx,
        _: &mut PropertyNameList,
        _: DontEnumMode,
    ) -> JsResult<()> {
        Ok(())
    }

    fn define_own_property(
        &self,
        cx: &mut Cx,
        _: PropertyName<'_>,
        _: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        let message = "Cannot define property for WebAssembly GC object";
        cx.reject(should_throw, message)
    }

    fn get_prototype_of(&self, _: &mut Cx) -> JsResult<Value> {
        Ok(Value::NULL)
    }

    fn set_prototype_of(&self, cx: &mut Cx, _: Value, should_throw: bool) -> JsResult<bool> {
        let message = "Cannot set prototype of WebAssembly GC object";
        cx.reject(should_throw, message)
    }

    fn is_extensible(&self, _: &mut Cx) -> JsResult<bool> {
        Ok(false)
    }

    fn prevent_extensions(&self, cx: &mut Cx) -> JsResult<bool> {
        let message = "Cannot run preventExtensions operation on WebAssembly GC object";
        Err(cx.throw_type_error(message))
    }
}

macro_rules! classes {
    ($($name:ident, $class:ident, $class_name:literal;)*) => {$(
        #[repr(transparent)]
        pub(crate) struct $name(WasmObject);

        static $class: Class =
            Class::new::<$name>(ascii_literal!($class_name), None, CellTypeRange::NONE);

        impl !GcFree for $name {}

        // SAFETY: the type of the cell has no storage, so nothing takes the second word for it.
        unsafe impl<T> Extends<T> for $name where JsObject: Extends<T> {}

        // SAFETY: the shape tells where the references are.
        unsafe impl CellKind for $name {
            type Base = JsObject;
            type Init = !;

            const CLASS: &'static Class = &$class;
            const CELL_TYPE: CellType = CellType::WasmGcObject;
            const FLAGS: TypeFlags = WasmObject::OVERRIDE_FLAGS
                .union(TypeFlags::INTERCEPTS_INDEXED_ACCESS)
                .union(TypeFlags::PROHIBITS_PROPERTY_CACHING);
            const HOLDS_CLASS: bool = false;
            const OPS: ClassOps = {
                let mut ops = WasmObject::override_ops(JsObject::OPS);
                ops.visit_children = visit_children_of::<$name>;
                ops
            };

            fn is(cell: &JsCell) -> bool {
                cell.class().is(Self::CLASS)
            }

            fn shape_of(init: &!) -> Gc<Shape> {
                *init
            }

            unsafe fn initialize(_: *mut Self, init: !) {
                init
            }

            #[inline]
            fn trace_fields(&self, visitor: &mut Visitor) {
                if !visitor.puts_off_current_cell() {
                    self.0.visit(visitor);
                }
            }
        }
    )*};
}

classes! {
    WasmStruct, STRUCT_CLASS, "WebAssembly.Struct";
    WasmArray, ARRAY_CLASS, "WebAssembly.Array";
}
