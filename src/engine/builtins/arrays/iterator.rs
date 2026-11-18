//! `Iterator`, and the prototypes of the objects that it and its methods make.

use bun_engine_text::{StringRef, private_names};
use bun_engine_vm::{
    Attributes, CellKind, DontEnumMode, GlobalObject, JsArrayIterator, JsFinalObject, JsFunction,
    JsIterator, JsIteratorHelper, JsStringIterator, JsWrapForValidIterator, PropertyNameMode,
    RealmSlot, errors,
};

use super::hidden_function;
pub(crate) use super::iterator_prototype::initialize_prototype;
use crate::js;
use crate::prelude::*;

static_table!(static CONSTRUCTOR_PROPERTIES = [
    StaticProperty::position_of(names::length),
    StaticProperty::position_of(names::name),
    StaticProperty::position_of(names::prototype),
    StaticProperty::builtin(names::from, js::iterator_constructor::from),
    StaticProperty::builtin(names::concat, js::iterator_constructor::concat),
    StaticProperty::builtin(names::zip, js::iterator_constructor::zip),
    StaticProperty::builtin(names::zipKeyed, js::iterator_constructor::zipKeyed),
]);

define_constructor!(IteratorConstructor, CONSTRUCTOR_PROPERTIES, call, construct);

static_table!(static HELPER_PROPERTIES = [
    StaticProperty::builtin(names::next, js::iterator_helper_prototype::next),
    StaticProperty::builtin(names::r#return, js::iterator_helper_prototype::r#return),
    StaticProperty::string(symbols::toStringTag, names::iteratorHelper),
]);

define_object!(HelperPrototype, "Iterator Helper", HELPER_PROPERTIES);

static_table!(static WRAPPER_PROPERTIES = [
    StaticProperty::builtin(names::next, js::wrap_for_valid_iterator_prototype::next),
    StaticProperty::builtin(names::r#return, js::wrap_for_valid_iterator_prototype::r#return),
    StaticProperty::string(symbols::toStringTag, names::Iterator),
]);

define_object!(WrapperPrototype, "Iterator", WRAPPER_PROPERTIES);

static_table!(static STRING_ITERATOR_PROPERTIES = [
    StaticProperty::function(names::next, string_iterator_next, 0).with_intrinsic(Intrinsic::StringIteratorNext),
    StaticProperty::string(symbols::toStringTag, names::stringIterator),
]);

define_object!(
    StringIteratorPrototype,
    "String Iterator",
    STRING_ITERATOR_PROPERTIES
);

fn instance_shape<T: CellKind>(cx: &Cx, prototype: Gc<JsObject>) -> Gc<Shape> {
    let spec = ShapeSpec::of::<T>();
    Shape::create(cx, Some(cx.global()), prototype.into(), spec)
}

pub(super) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    let (global, iterator) = (cx.global(), cx.iterator_prototype());
    let symbol_iterator = |function, intrinsic| {
        let name = StringRef::from_literal("[Symbol.iterator]");
        JsFunction::native_with_intrinsic(cx, 0, &name, function, intrinsic)
    };
    match slot {
        RealmSlot::iterator_constructor => {
            let parent = cx.function_prototype();
            let constructor =
                IteratorConstructor::create(cx, parent, 0, names::Iterator, &iterator);
            global.init_iterator_constructor(constructor);
        }
        RealmSlot::iterator_prototype_iterator => {
            let function = symbol_iterator(return_this, Intrinsic::Iterator);
            global.init_iterator_prototype_iterator(function);
        }
        RealmSlot::iterator_shape => {
            global.init_iterator_shape(instance_shape::<JsIterator>(cx, iterator));
        }
        RealmSlot::iterator_result_shape => {
            let capacity = JsFinalObject::optimal_inline_capacity(2);
            let mut shape = Shape::for_empty_object(cx, global, cx.object_prototype(), capacity);
            for name in [names::value, names::done] {
                shape = shape.add_property_transition(cx, name, Attributes::NONE).0;
            }
            global.init_iterator_result_shape(shape);
        }
        RealmSlot::array_iterator_shape => {
            let prototype = cx.array_iterator_prototype();
            global.init_array_iterator_shape(instance_shape::<JsArrayIterator>(cx, prototype));
        }
        RealmSlot::string_prototype_iterator => {
            let function = symbol_iterator(create_string_iterator, Intrinsic::StringIterator);
            global.init_string_prototype_iterator(function);
        }
        RealmSlot::string_iterator_prototype | RealmSlot::string_iterator_shape => {
            let prototype = StringIteratorPrototype::create(cx, iterator.into());
            global.init_string_iterator_prototype(prototype);
            global.init_string_iterator_shape(instance_shape::<JsStringIterator>(cx, prototype));
        }
        RealmSlot::iterator_helper_prototype | RealmSlot::iterator_helper_shape => {
            let prototype = HelperPrototype::create(cx, iterator.into());
            global.init_iterator_helper_prototype(prototype);
            global.init_iterator_helper_shape(instance_shape::<JsIteratorHelper>(cx, prototype));
        }
        RealmSlot::wrap_for_valid_iterator_shape => {
            let prototype = WrapperPrototype::create(cx, iterator.into());
            let shape = instance_shape::<JsWrapForValidIterator>(cx, prototype);
            global.init_wrap_for_valid_iterator_shape(shape);
        }
        RealmSlot::private_iterator_helper_create => {
            let (name, intrinsic) = (
                private_names::iteratorHelperCreate,
                Intrinsic::IteratorHelperCreate,
            );
            let function = hidden_function(cx, name, create_helper, 2, intrinsic);
            global.init_private_iterator_helper_create(function);
        }
        RealmSlot::private_wrap_for_valid_iterator_create => {
            let (name, intrinsic) = (
                private_names::wrapForValidIteratorCreate,
                Intrinsic::WrapForValidIteratorCreate,
            );
            let function = hidden_function(cx, name, create_wrapper, 2, intrinsic);
            global.init_private_wrap_for_valid_iterator_create(function);
        }
        RealmSlot::private_is_iterator_instance => {
            let name = private_names::isIteratorInstance;
            let function = hidden_function(cx, name, is_instance, 1, Intrinsic::None);
            global.init_private_is_iterator_instance(function);
        }
        RealmSlot::private_own_keys => {
            let function =
                hidden_function(cx, names::ownKeys, own_keys, 1, Intrinsic::ReflectOwnKeys);
            global.init_private_own_keys(function);
        }
        _ => return false,
    }
    true
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(cx.throw_type_error("calling Iterator constructor without new is invalid"))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    if new_target == callee.into() {
        return Err(cx.throw_type_error("Iterator cannot be constructed directly"));
    }
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::iterator_shape)?;
    Ok(JsIterator::create(cx, shape).into())
}

#[native_abi]
fn return_this(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(frame.this_value())
}

#[native_abi]
fn create_helper(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(JsIteratorHelper::create(cx, frame.argument(0), frame.argument(1)).into())
}

#[native_abi]
fn create_wrapper(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(JsWrapForValidIterator::create(cx, frame.argument(0), frame.argument(1)).into())
}

/// OrdinaryHasInstance(%Iterator%, value)
#[native_abi]
fn is_instance(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let prototype = cx.iterator_prototype().into();
    JsObject::default_has_instance(cx, frame.argument(0), prototype).map(Into::into)
}

#[native_abi]
fn own_keys(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = frame.argument(0).to_object(cx)?;
    let kinds = PropertyNameMode::StringsAndSymbols;
    (object.own_keys_array(cx, kinds, DontEnumMode::Include)).map(Into::into)
}

#[native_abi]
fn create_string_iterator(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = (frame.this_value()).require_object_coercible(cx, errors::TYPE_ERROR)?;
    let string = this.to_string(cx)?;
    Ok(JsStringIterator::create(cx, string).into())
}

#[native_abi]
fn string_iterator_next(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(iterator) = frame.this_value().downcast::<JsStringIterator>() else {
        return Err(cx.throw_type_error(
            "%StringIteratorPrototype%.next requires that |this| be a String Iterator instance",
        ));
    };
    bun_engine_vm::direct::string::string_iterator_next(cx, iterator).map(Into::into)
}
