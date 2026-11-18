use bun_engine_text::private_names;
use bun_engine_vm::{
    GlobalObject, IterationKind, JsFunction, JsSet, JsSetIterator, RealmSlot, Thrown, errors,
    for_each_in_iterable,
};

use super::presize::Presizer;
use super::set_methods::{
    difference, intersection, is_disjoint_from, is_subset_of, is_superset_of, symmetric_difference,
    union,
};
use super::{get_adder, instance_shape};
use crate::define::species_getter;
use crate::js;
use crate::prelude::*;

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::add, add, 1).with_intrinsic(Intrinsic::SetAdd),
    StaticProperty::function(names::clear, clear, 0),
    StaticProperty::function(names::delete, delete, 1).with_intrinsic(Intrinsic::SetDelete),
    StaticProperty::function(names::entries, entries, 0).with_intrinsic(Intrinsic::SetEntries),
    StaticProperty::builtin(names::forEach, js::set_prototype::forEach),
    StaticProperty::function(names::has, has, 1).with_intrinsic(Intrinsic::SetHas),
    StaticProperty::realm_slot(names::keys, RealmSlot::set_prototype_values),
    StaticProperty::getter(names::size, size).with_intrinsic(Intrinsic::SetSize),
    StaticProperty::realm_slot(names::values, RealmSlot::set_prototype_values),
    StaticProperty::function(names::union, union, 1),
    StaticProperty::function(names::intersection, intersection, 1),
    StaticProperty::function(names::difference, difference, 1),
    StaticProperty::function(names::symmetricDifference, symmetric_difference, 1),
    StaticProperty::function(names::isSubsetOf, is_subset_of, 1),
    StaticProperty::function(names::isSupersetOf, is_superset_of, 1),
    StaticProperty::function(names::isDisjointFrom, is_disjoint_from, 1),
    StaticProperty::realm_slot(symbols::iterator, RealmSlot::set_prototype_values),
    StaticProperty::string(symbols::toStringTag, names::Set),
    StaticProperty::function(private_names::add, add, 1).with_intrinsic(Intrinsic::SetAdd),
    StaticProperty::function(private_names::clear, clear, 0),
    StaticProperty::function(private_names::delete, delete, 1).with_intrinsic(Intrinsic::SetDelete),
    StaticProperty::function(private_names::entries, entries, 0).with_intrinsic(Intrinsic::SetEntries),
    StaticProperty::builtin(private_names::forEach, js::set_prototype::forEach),
    StaticProperty::function(private_names::has, has, 1).with_intrinsic(Intrinsic::SetHas),
    StaticProperty::realm_slot(private_names::keys, RealmSlot::set_prototype_values),
    StaticProperty::getter(private_names::size, size).with_intrinsic(Intrinsic::SetSize),
    StaticProperty::realm_slot(private_names::values, RealmSlot::set_prototype_values),
]);

define_object!(SetPrototype, "Set", PROTOTYPE_PROPERTIES);

static_table!(static CONSTRUCTOR_PROPERTIES = [
    StaticProperty::getter(symbols::species, species_getter).with_intrinsic(Intrinsic::SpeciesGetter),
]);

define_constructor!(SetConstructor, CONSTRUCTOR_PROPERTIES, call, construct);

static_table!(static ITERATOR_PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::next, next, 0).with_intrinsic(Intrinsic::SetIteratorNext),
    StaticProperty::string(symbols::toStringTag, names::setIterator),
]);

define_object!(
    SetIteratorPrototype,
    "Set Iterator",
    ITERATOR_PROTOTYPE_PROPERTIES
);

pub(super) fn initialize(cx: &Cx) {
    let (global, prototype) = (
        cx.global(),
        SetPrototype::create(cx, cx.object_prototype().into()),
    );
    let constructor =
        SetConstructor::create(cx, cx.function_prototype(), 0, names::Set, &prototype);
    global.init_set_shape(instance_shape::<JsSet>(cx, prototype));
    global.init_set_prototype(prototype);
    global.init_set_constructor(constructor);
}

pub(super) fn initialize_values(cx: &Cx) {
    let name = names::values.to_identifier().into_string();
    let function = JsFunction::native_with_intrinsic(cx, 0, &name, values, Intrinsic::SetValues);
    cx.global().init_set_prototype_values(function);
}

pub(super) fn initialize_iterator(cx: &Cx) {
    let prototype = SetIteratorPrototype::create(cx, cx.iterator_prototype().into());
    let shape = instance_shape::<JsSetIterator>(cx, prototype);
    cx.global().init_set_iterator_shape(shape);
    cx.global().init_set_iterator_prototype(prototype);
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(errors::throw_called_without_new(cx, "Set"))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::set_shape)?;
    let iterable = frame.argument(0);
    if iterable.is_undefined_or_null() {
        return Ok(JsSet::create_with_shape(cx, shape).into());
    }
    if !JsSet::is_add_pristine(cx, &shape) {
        let set = JsSet::create_with_shape(cx, shape);
        let message = "'add' property of a Set should be callable.";
        let adder = get_adder(cx, &set, names::add, message)?;
        for_each_in_iterable(cx, iterable, |cx, value| {
            cx.call(adder.into(), set.into(), &[value]).map(|_| ())
        })?;
        return Ok(set.into());
    }
    if let Some(source) = iterable.downcast::<JsSet>()
        && source.is_iteration_pristine(cx)
    {
        return source.clone_with_shape(cx, shape).map(Into::into);
    }
    let set = JsSet::create_with_shape(cx, shape);
    let mut presizer = Presizer::new(iterable);
    for_each_in_iterable(cx, iterable, |cx, value| {
        presizer.will_add(cx, &set);
        set.add(cx, value)
    })?;
    set.shrink_if_sparse(cx);
    Ok(set.into())
}

#[inline(always)]
pub(super) fn this_set(cx: &Cx, frame: &CallFrame) -> JsResult<Gc<JsSet>> {
    let this = frame.this_value();
    this.downcast().ok_or_else(|| throw_not_a_set(cx, this))
}

#[cold]
fn throw_not_a_set(cx: &Cx, this: Value) -> Thrown {
    if this.is_cell() {
        cx.throw_type_error("Set operation called on non-Set object")
    } else {
        errors::throw_not_an_object(cx, this)
    }
}

#[native_abi]
fn add(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let set = this_set(cx, frame)?;
    set.add(cx, frame.argument(0))?;
    Ok(set.into())
}

#[native_abi]
fn clear(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    this_set(cx, frame)?.clear(cx);
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn delete(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let set = this_set(cx, frame)?;
    set.remove(cx, frame.argument(0)).map(Into::into)
}

#[native_abi]
fn has(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let set = this_set(cx, frame)?;
    set.has(cx, frame.argument(0)).map(Into::into)
}

#[native_abi]
fn size(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(this_set(cx, frame)?.size().into())
}

#[native_abi]
fn entries(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let set = this_set(cx, frame)?;
    Ok(JsSetIterator::create(cx, set, IterationKind::Entries).into())
}

#[native_abi]
fn values(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let set = this_set(cx, frame)?;
    Ok(JsSetIterator::create(cx, set, IterationKind::Values).into())
}

#[native_abi]
fn next(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(iterator) = frame.this_value().downcast::<JsSetIterator>() else {
        let message = "%SetIteratorPrototype%.next requires that |this| be a Set Iterator instance";
        return Err(cx.throw_type_error(message));
    };
    let value = iterator.next(cx)?;
    Ok(cx
        .new_iterator_result(value.unwrap_or_default(), value.is_none())
        .into())
}
