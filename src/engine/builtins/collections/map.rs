use bun_engine_text::private_names;
use bun_engine_vm::{
    Attributes, GlobalObject, HashedKey, IterationKind, JsFunction, JsMap, JsMapIterator,
    RealmSlot, Thrown, errors, for_each_in_iterable,
};

use super::presize::Presizer;
use super::{get_adder, instance_shape, key_and_value};
use crate::define::species_getter;
use crate::js;
use crate::prelude::*;

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::clear, clear, 0),
    StaticProperty::function(names::delete, delete, 1).with_intrinsic(Intrinsic::MapDelete),
    StaticProperty::realm_slot(names::entries, RealmSlot::map_prototype_entries),
    StaticProperty::builtin(names::forEach, js::map_prototype::forEach),
    StaticProperty::function(names::get, get, 1).with_intrinsic(Intrinsic::MapGet),
    StaticProperty::function(names::has, has, 1).with_intrinsic(Intrinsic::MapHas),
    StaticProperty::function(names::keys, keys, 0).with_intrinsic(Intrinsic::MapKeys),
    StaticProperty::function(names::set, set, 2).with_intrinsic(Intrinsic::MapSet),
    StaticProperty::function(names::getOrInsert, get_or_insert, 2),
    StaticProperty::function(names::getOrInsertComputed, get_or_insert_computed, 2),
    StaticProperty::getter(names::size, size).with_intrinsic(Intrinsic::MapSize),
    StaticProperty::function(names::values, values, 0).with_intrinsic(Intrinsic::MapValues),
    StaticProperty::realm_slot(symbols::iterator, RealmSlot::map_prototype_entries),
    StaticProperty::string(symbols::toStringTag, names::Map),
    StaticProperty::function(private_names::clear, clear, 0),
    StaticProperty::function(private_names::delete, delete, 1).with_intrinsic(Intrinsic::MapDelete),
    StaticProperty::realm_slot(private_names::entries, RealmSlot::map_prototype_entries),
    StaticProperty::builtin(private_names::forEach, js::map_prototype::forEach),
    StaticProperty::function(private_names::get, get, 1).with_intrinsic(Intrinsic::MapGet),
    StaticProperty::function(private_names::has, has, 1).with_intrinsic(Intrinsic::MapHas),
    StaticProperty::function(private_names::keys, keys, 0).with_intrinsic(Intrinsic::MapKeys),
    StaticProperty::function(private_names::set, set, 2).with_intrinsic(Intrinsic::MapSet),
    StaticProperty::getter(private_names::size, size).with_intrinsic(Intrinsic::MapSize),
    StaticProperty::function(private_names::values, values, 0).with_intrinsic(Intrinsic::MapValues),
]);

define_object!(MapPrototype, "Map", PROTOTYPE_PROPERTIES);

// The first three are there for the order.
static_table!(static CONSTRUCTOR_PROPERTIES = [
    StaticProperty::number(names::length, 0.0).without(Attributes::DONT_DELETE),
    StaticProperty::string(names::name, names::Map),
    StaticProperty::realm_slot(names::prototype, RealmSlot::map_prototype).with(Attributes::CONSTANT),
    StaticProperty::builtin(names::groupBy, js::map_constructor::groupBy),
    StaticProperty::getter(symbols::species, species_getter).with_intrinsic(Intrinsic::SpeciesGetter),
]);

define_constructor!(MapConstructor, CONSTRUCTOR_PROPERTIES, call, construct);

static_table!(static ITERATOR_PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::next, next, 0).with_intrinsic(Intrinsic::MapIteratorNext),
    StaticProperty::string(symbols::toStringTag, names::mapIterator),
]);

define_object!(
    MapIteratorPrototype,
    "Map Iterator",
    ITERATOR_PROTOTYPE_PROPERTIES
);

pub(super) fn initialize(cx: &Cx) {
    let (global, prototype) = (
        cx.global(),
        MapPrototype::create(cx, cx.object_prototype().into()),
    );
    let constructor =
        MapConstructor::create(cx, cx.function_prototype(), 0, names::Map, &prototype);
    global.init_map_shape(instance_shape::<JsMap>(cx, prototype));
    global.init_map_prototype(prototype);
    global.init_map_constructor(constructor);
}

pub(super) fn initialize_entries(cx: &Cx) {
    let name = names::entries.to_identifier().into_string();
    let function = JsFunction::native_with_intrinsic(cx, 0, &name, entries, Intrinsic::MapEntries);
    cx.global().init_map_prototype_entries(function);
}

pub(super) fn initialize_iterator(cx: &Cx) {
    let prototype = MapIteratorPrototype::create(cx, cx.iterator_prototype().into());
    let shape = instance_shape::<JsMapIterator>(cx, prototype);
    cx.global().init_map_iterator_shape(shape);
    cx.global().init_map_iterator_prototype(prototype);
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(errors::throw_called_without_new(cx, "Map"))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::map_shape)?;
    let iterable = frame.argument(0);
    if iterable.is_undefined_or_null() {
        return Ok(JsMap::create_with_shape(cx, shape).into());
    }
    if !JsMap::is_set_pristine(cx, &shape) {
        let map = JsMap::create_with_shape(cx, shape);
        let message = "'set' property of a Map should be callable.";
        let adder = get_adder(cx, &map, names::set, message)?;
        for_each_in_iterable(cx, iterable, |cx, entry| {
            let (key, value) = key_and_value(cx, entry, errors::TYPE_ERROR)?;
            cx.call(adder.into(), map.into(), &[key, value]).map(|_| ())
        })?;
        return Ok(map.into());
    }
    if let Some(source) = iterable.downcast::<JsMap>()
        && source.is_iteration_pristine(cx)
    {
        return source.clone_with_shape(cx, shape).map(Into::into);
    }
    let map = JsMap::create_with_shape(cx, shape);
    let mut presizer = Presizer::new(iterable);
    for_each_in_iterable(cx, iterable, |cx, entry| {
        let (key, value) = key_and_value(cx, entry, errors::TYPE_ERROR)?;
        presizer.will_add(cx, &map);
        map.set(cx, key, value)
    })?;
    map.shrink_if_sparse(cx);
    Ok(map.into())
}

#[inline(always)]
fn this_map(cx: &Cx, frame: &CallFrame) -> JsResult<Gc<JsMap>> {
    let this = frame.this_value();
    this.downcast().ok_or_else(|| throw_not_a_map(cx, this))
}

#[cold]
fn throw_not_a_map(cx: &Cx, this: Value) -> Thrown {
    if this.is_cell() {
        cx.throw_type_error("Map operation called on non-Map object")
    } else {
        errors::throw_not_an_object(cx, this)
    }
}

#[native_abi]
fn clear(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    this_map(cx, frame)?.clear(cx);
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn delete(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let map = this_map(cx, frame)?;
    map.remove(cx, frame.argument(0)).map(Into::into)
}

#[native_abi]
fn get(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    this_map(cx, frame)?.get(cx, frame.argument(0))
}

#[native_abi]
fn has(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let map = this_map(cx, frame)?;
    map.has(cx, frame.argument(0)).map(Into::into)
}

#[native_abi]
fn set(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let map = this_map(cx, frame)?;
    map.set(cx, frame.argument(0), frame.argument(1))?;
    Ok(map.into())
}

#[native_abi]
fn get_or_insert(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    this_map(cx, frame)?.get_or_insert(cx, frame.argument(0), frame.argument(1))
}

#[native_abi]
fn get_or_insert_computed(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (map, callback) = (this_map(cx, frame)?, frame.argument(1));
    if !callback.is_callable() {
        let message =
            "Map.prototype.getOrInsertComputed requires the callback argument to be callable.";
        return Err(cx.throw_type_error(message));
    }
    let key = HashedKey::new(cx, frame.argument(0))?;
    if let Some(existing) = map.find_hashed(key) {
        return Ok(existing);
    }
    let value = cx.call(callback, Value::UNDEFINED, &[key.value()])?;
    map.set_hashed(cx, key, value)?;
    Ok(value)
}

#[native_abi]
fn size(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(this_map(cx, frame)?.size().into())
}

fn iterator(cx: &Cx, frame: &CallFrame, kind: IterationKind) -> JsResult<Value> {
    Ok(JsMapIterator::create(cx, this_map(cx, frame)?, kind).into())
}

#[native_abi]
fn entries(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    iterator(cx, frame, IterationKind::Entries)
}

#[native_abi]
fn keys(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    iterator(cx, frame, IterationKind::Keys)
}

#[native_abi]
fn values(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    iterator(cx, frame, IterationKind::Values)
}

#[native_abi]
fn next(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(iterator) = frame.this_value().downcast::<JsMapIterator>() else {
        let message = "%MapIteratorPrototype%.next requires that |this| be a Map Iterator instance";
        return Err(cx.throw_type_error(message));
    };
    let value = iterator.next(cx)?;
    Ok(cx
        .new_iterator_result(value.unwrap_or_default(), value.is_none())
        .into())
}
