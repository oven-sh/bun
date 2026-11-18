use bun_engine_macros::cell;

use crate::{Cx, FieldArray, Gc, JsCell, JsObject, JsObjectInit, Shape, TypeFlags, Value, Vm};

/// Where `get_internal_field` and `put_internal_field` find the fields of an object that has any.
pub const OFFSET_OF_INTERNAL_FIELDS: usize = size_of::<JsObject>();

#[cell(name = "InternalFieldTuple", cell_type = InternalFieldTuple, export = "engine_class_InternalFieldTuple")]
pub struct InternalFieldTuple {
    base: JsObject,
    pub fields: FieldArray<Value, 2>,
}

impl InternalFieldTuple {
    pub fn create_with_shape(vm: &Vm, shape: Gc<Shape>, a: Value, b: Value) -> Gc<Self> {
        vm.allocate::<InternalFieldTuple>(InternalFieldTupleInit {
            base: JsObjectInit::new(vm, shape),
            fields: [a, b],
        })
    }

    pub fn create(cx: &Cx, a: Value, b: Value) -> Gc<InternalFieldTuple> {
        Self::create_with_shape(cx, cx.internal_field_tuple_shape(), a, b)
    }
}

/// A cell that means something by its identity.
#[cell(cell_type = Sentinel, flags = TypeFlags::SHAPE_IS_IMMORTAL)]
pub struct Sentinel {
    base: JsCell,
}

impl Sentinel {
    pub fn create(vm: &Vm) -> Gc<Sentinel> {
        vm.allocate::<Sentinel>(SentinelInit {
            base: vm.shapes.sentinel(),
        })
    }
}
