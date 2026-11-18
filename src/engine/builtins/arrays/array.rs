use bun_engine_text::{PropertyName, private_names};
use bun_engine_vm::{
    Attributes, IterationKind, JsArray, JsArrayIterator, JsFunction, JsObjectInit, RealmSlot,
};

use super::{copy, join, mutate, search, sort};
use crate::js::{array_iterator_prototype, array_prototype as js};
use crate::prelude::*;

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::realm_slot(names::toString, RealmSlot::array_prototype_to_string),
    StaticProperty::realm_slot(names::values, RealmSlot::array_prototype_values),
    StaticProperty::function(names::toLocaleString, join::to_locale_string, 0),
    StaticProperty::function(names::concat, copy::concat, 1).with_intrinsic(Intrinsic::ArrayConcat),
    StaticProperty::function(names::fill, mutate::fill, 1),
    StaticProperty::function(names::join, join::join, 1).with_intrinsic(Intrinsic::ArrayJoin),
    StaticProperty::function(names::pop, mutate::pop, 0).with_intrinsic(Intrinsic::ArrayPop),
    StaticProperty::function(names::push, mutate::push, 1).with_intrinsic(Intrinsic::ArrayPush),
    StaticProperty::function(names::reverse, mutate::reverse, 0),
    StaticProperty::function(names::shift, mutate::shift, 0).with_intrinsic(Intrinsic::ArrayShift),
    StaticProperty::function(names::slice, copy::slice, 2).with_intrinsic(Intrinsic::ArraySlice),
    StaticProperty::function(names::sort, sort::sort, 1).with_intrinsic(Intrinsic::ArraySort),
    StaticProperty::function(names::splice, mutate::splice, 2).with_intrinsic(Intrinsic::ArraySplice),
    StaticProperty::function(names::unshift, mutate::unshift, 1).with_intrinsic(Intrinsic::ArrayUnshift),
    StaticProperty::builtin(names::every, js::every),
    StaticProperty::builtin(names::forEach, js::forEach),
    StaticProperty::builtin(names::some, js::some),
    StaticProperty::function(names::indexOf, search::index_of, 1).with_intrinsic(Intrinsic::ArrayIndexOf),
    StaticProperty::function(names::lastIndexOf, search::last_index_of, 1),
    StaticProperty::builtin(names::filter, js::filter),
    StaticProperty::function(names::flat, copy::flat, 0),
    StaticProperty::builtin(names::flatMap, js::flatMap),
    StaticProperty::builtin(names::reduce, js::reduce),
    StaticProperty::builtin(names::reduceRight, js::reduceRight),
    StaticProperty::builtin(names::map, js::map),
    StaticProperty::function(names::keys, keys, 0).with_intrinsic(Intrinsic::ArrayKeys),
    StaticProperty::function(names::entries, entries, 0).with_intrinsic(Intrinsic::ArrayEntries),
    StaticProperty::builtin(names::find, js::find),
    StaticProperty::builtin(names::findLast, js::findLast),
    StaticProperty::builtin(names::findIndex, js::findIndex),
    StaticProperty::builtin(names::findLastIndex, js::findLastIndex),
    StaticProperty::function(names::includes, search::includes, 1).with_intrinsic(Intrinsic::ArrayIncludes),
    StaticProperty::function(names::copyWithin, mutate::copy_within, 2),
    StaticProperty::builtin(names::at, js::at),
    StaticProperty::function(names::toReversed, copy::to_reversed, 0),
    StaticProperty::function(names::toSorted, sort::to_sorted, 1),
    StaticProperty::function(names::toSpliced, copy::to_spliced, 2),
    StaticProperty::function(names::with, copy::with, 2),
    StaticProperty::realm_slot(names::constructor, RealmSlot::array_constructor),
    StaticProperty::realm_slot(symbols::iterator, RealmSlot::array_prototype_values),
    StaticProperty::made(symbols::unscopables, make_unscopables).with(Attributes::READ_ONLY),
    StaticProperty::function(private_names::entries, entries, 0).with_intrinsic(Intrinsic::ArrayEntries),
    StaticProperty::builtin(private_names::forEach, js::forEach),
    StaticProperty::function(private_names::includes, search::includes, 1).with_intrinsic(Intrinsic::ArrayIncludes),
    StaticProperty::function(private_names::indexOf, search::index_of, 1).with_intrinsic(Intrinsic::ArrayIndexOf),
    StaticProperty::function(private_names::keys, keys, 0).with_intrinsic(Intrinsic::ArrayKeys),
    StaticProperty::builtin(private_names::map, js::map),
    StaticProperty::function(private_names::pop, mutate::pop, 0).with_intrinsic(Intrinsic::ArrayPop),
    StaticProperty::function(private_names::shift, mutate::shift, 0).with_intrinsic(Intrinsic::ArrayShift),
    StaticProperty::realm_slot(private_names::values, RealmSlot::array_prototype_values),
]);

#[cell(name = "Array", shared_type = DerivedArray, static_table = PROTOTYPE_PROPERTIES)]
struct ArrayPrototype {
    base: JsArray,
}

static_table!(static ITERATOR_PROTOTYPE_PROPERTIES = [
    StaticProperty::builtin(names::next, array_iterator_prototype::next),
    StaticProperty::string(symbols::toStringTag, names::arrayIterator),
]);

define_object!(
    ArrayIteratorPrototype,
    "Array Iterator",
    ITERATOR_PROTOTYPE_PROPERTIES
);

pub(crate) fn initialize_prototype(cx: &Cx) {
    let (global, parent) = (cx.global(), cx.object_prototype().into());
    let spec = ShapeSpec::of::<ArrayPrototype>().array_without_elements();
    let shape = Shape::create_dictionary(cx, Some(global), parent, spec);
    let base = JsArray::init(JsObjectInit::new(cx, shape));
    let prototype = cx.allocate::<ArrayPrototype>(ArrayPrototypeInit { base });
    global.init_array_prototype(prototype.upcast());
    global.create_array_shapes(cx);
    let name = names::values.to_identifier().into_string();
    let values = JsFunction::native_with_intrinsic(cx, 0, &name, values, Intrinsic::ArrayValues);
    global.init_array_prototype_values(values);
    let parent = cx.iterator_prototype().into();
    global.init_array_iterator_prototype(ArrayIteratorPrototype::create(cx, parent));
}

const UNSCOPABLES: [PropertyName<'static>; 16] = [
    names::at,
    names::copyWithin,
    names::entries,
    names::fill,
    names::find,
    names::findIndex,
    names::findLast,
    names::findLastIndex,
    names::flat,
    names::flatMap,
    names::includes,
    names::keys,
    names::toReversed,
    names::toSorted,
    names::toSpliced,
    names::values,
];

fn make_unscopables(cx: &Cx, _: &JsObject) -> Value {
    let unscopables = cx.new_object_with_null_prototype();
    unscopables.convert_to_dictionary(cx);
    for name in UNSCOPABLES {
        unscopables.put_direct(cx, name, Value::TRUE, Attributes::NONE);
    }
    unscopables.into()
}

#[inline(always)]
fn create_iterator(cx: &mut Cx, frame: &CallFrame, kind: IterationKind) -> JsResult<Value> {
    let object = frame.this_value().to_object(cx)?;
    Ok(JsArrayIterator::create(cx, object, kind).into())
}

#[native_abi]
fn keys(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    create_iterator(cx, frame, IterationKind::Keys)
}

#[native_abi]
fn values(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    create_iterator(cx, frame, IterationKind::Values)
}

#[native_abi]
fn entries(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    create_iterator(cx, frame, IterationKind::Entries)
}

pub(super) fn initialize_to_string(cx: &Cx) {
    let name = names::toString.to_identifier().into_string();
    let function = JsFunction::native(cx, 0, &name, join::to_string);
    cx.global().init_array_prototype_to_string(function);
}
