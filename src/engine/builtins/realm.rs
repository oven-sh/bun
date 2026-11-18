use bun_engine_vm::{Environment, InternalFieldTuple, RealmSlot};

use crate::prelude::*;
use crate::{arrays, buffers, collections, control, functions, fundamental, js, numbers, text};

pub fn initialize_realm(cx: &Cx) {
    fundamental::object_prototype::initialize(cx);
    functions::function::initialize_prototype(cx);
    arrays::iterator::initialize_prototype(cx);
    arrays::array::initialize_prototype(cx);
    text::string::initialize_prototype(cx);
    Environment::create_shapes(cx);
    let context = InternalFieldTuple::create(cx, Value::UNDEFINED, Value::UNDEFINED);
    cx.global().init_async_context(context);
}

/// Sets the slot, and those that come with it. False if it belongs to another crate.
pub fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    if slot == RealmSlot::internal_field_tuple_shape {
        let (global, spec) = (cx.global(), ShapeSpec::of::<InternalFieldTuple>());
        let shape = Shape::create(cx, Some(global), Value::NULL, spec);
        global.init_internal_field_tuple_shape(shape);
        return true;
    }
    js::initialize_slot(cx, slot)
        || arrays::initialize_slot(cx, slot)
        || buffers::initialize_slot(cx, slot)
        || collections::initialize_slot(cx, slot)
        || control::initialize_slot(cx, slot)
        || functions::initialize_slot(cx, slot)
        || fundamental::initialize_slot(cx, slot)
        || numbers::initialize_slot(cx, slot)
        || text::initialize_slot(cx, slot)
}
