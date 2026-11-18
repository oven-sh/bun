//! `Promise`, generators, async functions and disposable stacks.

mod async_generator;
mod async_iterator;
mod disposable_stack;
mod function_kinds;
mod private;
mod promise_combinators;
mod promise_constructor;
mod promise_prototype;

use bun_engine_text::PropertyName;
use bun_engine_vm::{
    Attributes, CellKind, JsAsyncFunctionGenerator, JsFunctionWithFields, RealmSlot,
    RealmWatchpoint,
};

use crate::prelude::*;
use crate::watchpoints::Conditions;

pub(crate) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    use RealmSlot::*;
    let global = cx.global();
    match slot {
        promise_prototype | promise_constructor | promise_shape => {
            self::promise_constructor::initialize(cx);
        }
        promise_prototype_then => self::promise_prototype::initialize_then(cx),
        promise_capability_shape => {
            let properties = [names::resolve, names::reject, names::promise];
            global.init_promise_capability_shape(record_shape(cx, &properties));
        }
        fulfilled_outcome_shape => {
            global.init_fulfilled_outcome_shape(record_shape(cx, &[names::status, names::value]));
        }
        rejected_outcome_shape => {
            global.init_rejected_outcome_shape(record_shape(cx, &[names::status, names::reason]));
        }
        function_with_fields_shape => {
            let shape = instance_shape::<JsFunctionWithFields>(cx, cx.function_prototype().into());
            global.init_function_with_fields_shape(shape);
        }
        generator_function_prototype
        | generator_function_shape
        | generator_prototype
        | generator_shape => function_kinds::initialize_generators(cx),
        async_function_prototype | async_function_shape => {
            function_kinds::initialize_async_functions(cx);
        }
        async_function_generator_shape => {
            let shape = instance_shape::<JsAsyncFunctionGenerator>(cx, Value::NULL);
            global.init_async_function_generator_shape(shape);
        }
        async_generator_function_prototype
        | async_generator_function_shape
        | async_generator_prototype
        | async_generator_shape => function_kinds::initialize_async_generators(cx),
        async_generator_prototype_next => async_generator::initialize_next(cx),
        async_iterator_prototype => async_iterator::initialize(cx),
        async_iterator_prototype_async_iterator => async_iterator::initialize_async_iterator(cx),
        async_from_sync_iterator_shape => async_iterator::initialize_from_sync(cx),
        disposable_stack_constructor | disposable_stack_shape => disposable_stack::initialize(cx),
        disposable_stack_prototype_dispose => disposable_stack::initialize_dispose(cx),
        async_disposable_stack_constructor | async_disposable_stack_shape => {
            disposable_stack::initialize_async(cx);
        }
        async_disposable_stack_prototype_dispose => disposable_stack::initialize_dispose_async(cx),
        _ => return private::initialize_slot(cx, slot),
    }
    true
}

pub(crate) fn add_conditions(
    cx: &Cx,
    which: RealmWatchpoint,
    conditions: &mut Conditions<'_>,
) -> bool {
    match which {
        RealmWatchpoint::PromiseThen => {
            conditions.pristine(&cx.promise_prototype(), names::then);
            conditions.absent(&cx.object_prototype(), names::then, Value::NULL);
        }
        RealmWatchpoint::PromiseResolve => {
            conditions.pristine(&cx.promise_constructor(), names::resolve);
        }
        RealmWatchpoint::PromiseSpecies => {
            conditions.pristine(&cx.promise_prototype(), names::constructor);
            conditions.pristine(&cx.promise_constructor(), symbols::species);
        }
        _ => return false,
    }
    true
}

fn instance_shape<T: CellKind>(cx: &Cx, prototype: Value) -> Gc<Shape> {
    Shape::create(cx, Some(cx.global()), prototype, ShapeSpec::of::<T>())
}

/// Of an ordinary object with these data properties.
fn record_shape(cx: &Cx, properties: &[PropertyName<'_>]) -> Gc<Shape> {
    let empty = Shape::for_empty_object(cx, cx.global(), cx.object_prototype(), properties.len());
    properties.iter().fold(empty, |shape, &name| {
        shape.add_property_transition(cx, name, Attributes::NONE).0
    })
}
