//! `Function`, errors, `eval`, `ShadowRealm` and `console`.

mod console;
mod error;
mod eval;
pub(crate) mod function;
mod shadow_realm;

use bun_engine_vm::{
    CellKind, JsBoundFunction, JsCallee, JsCustomGetterFunction, JsCustomSetterFunction,
    JsNativeClosure, JsRemoteFunction, RealmSlot, RealmWatchpoint,
};

use crate::prelude::*;
use crate::watchpoints::Conditions;

fn shape_of<T: CellKind>(cx: &Cx) -> Gc<Shape> {
    let prototype = cx.function_prototype().into();
    Shape::create(cx, Some(cx.global()), prototype, ShapeSpec::of::<T>())
}

pub(crate) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    use RealmSlot::*;
    let global = cx.global();
    match slot {
        function_constructor => function::initialize_constructor(cx),
        function_prototype_call => function::initialize_call(cx),
        function_prototype_apply => function::initialize_apply(cx),
        function_prototype_has_instance => function::initialize_has_instance(cx),
        throw_type_error_function | throw_type_error_accessor => function::initialize_thrower(cx),
        absent_callee => global.init_absent_callee(JsCallee::create_absent(cx)),
        bound_function_shape => {
            global.init_bound_function_shape(shape_of::<JsBoundFunction>(cx));
        }
        custom_getter_function_shape => {
            global.init_custom_getter_function_shape(shape_of::<JsCustomGetterFunction>(cx));
        }
        custom_setter_function_shape => {
            global.init_custom_setter_function_shape(shape_of::<JsCustomSetterFunction>(cx));
        }
        native_closure_shape => {
            global.init_native_closure_shape(shape_of::<JsNativeClosure>(cx));
        }
        remote_function_shape => {
            global.init_remote_function_shape(shape_of::<JsRemoteFunction>(cx));
        }
        eval_function => eval::initialize(cx),
        shadow_realm_constructor | shadow_realm_shape => shadow_realm::initialize(cx),
        console_object => console::initialize(cx),
        _ => return error::initialize_slot(cx, slot),
    }
    true
}

pub(crate) fn add_conditions(_: &Cx, _: RealmWatchpoint, _: &mut Conditions<'_>) -> bool {
    false
}
