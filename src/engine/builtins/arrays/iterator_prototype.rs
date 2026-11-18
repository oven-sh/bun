use bun_engine_text::PropertyName;
use bun_engine_vm::{
    Attributes, ErrorType, IteratorRecord, MAX_SAFE_INTEGER, RealmSlot, RepeatedCall, RopeBuilder,
    Thrown, iterator_close_on_throw, iterator_close_quietly,
};

use super::hidden_function;
use crate::js::iterator_prototype as js;
use crate::prelude::*;

const ACCESSOR: Attributes = Attributes::DONT_ENUM.union(Attributes::CUSTOM_ACCESSOR);

static_table!(static PROPERTIES = [
    StaticProperty::custom(names::constructor, ACCESSOR, get_constructor, Some(set_on_receiver)),
    StaticProperty::made(names::toArray, |cx, _| hidden_function(cx, names::toArray, to_array, 0, Intrinsic::None).into()),
    StaticProperty::made(names::forEach, |cx, _| hidden_function(cx, names::forEach, for_each, 1, Intrinsic::None).into()),
    StaticProperty::builtin(names::some, js::some),
    StaticProperty::builtin(names::every, js::every),
    StaticProperty::builtin(names::find, js::find),
    StaticProperty::builtin(names::reduce, js::reduce),
    StaticProperty::builtin(names::map, js::map),
    StaticProperty::builtin(names::filter, js::filter),
    StaticProperty::builtin(names::take, js::take),
    StaticProperty::builtin(names::drop, js::drop),
    StaticProperty::builtin(names::flatMap, js::flatMap),
    StaticProperty::builtin(names::chunks, js::chunks),
    StaticProperty::builtin(names::windows, js::windows),
    StaticProperty::function(names::includes, includes, 1),
    StaticProperty::function(names::join, join, 1),
    StaticProperty::realm_slot(symbols::iterator, RealmSlot::iterator_prototype_iterator),
    StaticProperty::custom(symbols::toStringTag, ACCESSOR, get_to_string_tag, Some(set_on_receiver)),
    StaticProperty::builtin(symbols::dispose, js::dispose),
]);

define_object!(IteratorPrototype, "Iterator", PROPERTIES);

pub(crate) fn initialize_prototype(cx: &Cx) {
    let prototype = IteratorPrototype::create(cx, cx.object_prototype().into());
    cx.global().init_iterator_prototype(prototype);
}

#[native_abi]
fn get_constructor(cx: &mut Cx, _: Value, _: PropertyName<'_>) -> JsResult<Value> {
    Ok(cx.iterator_constructor().into())
}

#[native_abi]
fn get_to_string_tag(cx: &mut Cx, _: Value, _: PropertyName<'_>) -> JsResult<Value> {
    Ok(JsString::from_name(cx, names::Iterator).into())
}

/// SetterThatIgnoresPrototypeProperties
fn set_ignoring_prototype(
    cx: &mut Cx,
    this: Value,
    value: Value,
    name: PropertyName<'_>,
) -> JsResult<bool> {
    let Some(object) = this.as_object() else {
        let message = "SetterThatIgnoresPrototypeProperties expected |this| to be an object.";
        return Err(cx.throw_type_error(message));
    };
    if object == cx.iterator_prototype() {
        let message = "SetterThatIgnoresPrototypeProperties was called on a home object.";
        return Err(cx.throw_type_error(message));
    }
    if object.has_own_property(cx, name)? {
        object.set(cx, name, value, true)
    } else {
        object.create_data_property(cx, name, value, true)
    }
}

#[native_abi]
fn set_on_receiver(cx: &mut Cx, this: Value, value: Value, name: PropertyName<'_>) -> bool {
    set_ignoring_prototype(cx, this, value, name).unwrap_or(false)
}

fn this_iterator(cx: &Cx, frame: &CallFrame, message: &'static str) -> JsResult<Value> {
    let this = frame.this_value();
    if !this.is_object() {
        return Err(cx.throw_type_error(message));
    }
    Ok(this)
}

#[native_abi]
fn to_array(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "Iterator.prototype.toArray requires that |this| be an Object.";
    let iterator = this_iterator(cx, frame, message)?;
    (IteratorRecord::direct(cx, iterator)?.to_array(cx)).map(Into::into)
}

#[native_abi]
fn for_each(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "Iterator.prototype.forEach requires that |this| be an Object.";
    let (iterator, callback) = (this_iterator(cx, frame, message)?, frame.argument(0));
    if !callback.is_callable() {
        iterator_close_quietly(cx, iterator)?;
        let message = "Iterator.prototype.forEach requires the callback argument to be callable.";
        return Err(cx.throw_type_error(message));
    }
    let (callback, mut counter) = (RepeatedCall::new(cx, callback), 0u64);
    IteratorRecord::direct(cx, iterator)?.for_each(cx, |cx, value| {
        callback.call(cx, Value::UNDEFINED, [value, counter.into()])?;
        counter += 1;
        Ok(())
    })?;
    Ok(Value::UNDEFINED)
}

#[cold]
fn reject_skip_count(cx: &mut Cx, iterator: Value, error_type: ErrorType) -> Thrown {
    match iterator_close_quietly(cx, iterator) {
        Ok(()) => cx.throw_error(
            error_type,
            "Iterator.prototype.includes requires that the second argument is a non-negative safe integral Number or Infinity.",
        ),
        Err(thrown) => thrown,
    }
}

#[native_abi]
fn includes(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "Iterator.prototype.includes requires that |this| be an Object.";
    let iterator = this_iterator(cx, frame, message)?;
    let to_skip = match frame.argument(1) {
        Value::UNDEFINED => 0,
        count => match count.as_number().filter(|&it| it == it.trunc()) {
            Some(count @ (0.0..=MAX_SAFE_INTEGER | f64::INFINITY)) => count as u64,
            Some(_) => return Err(reject_skip_count(cx, iterator, ErrorType::RangeError)),
            None => return Err(reject_skip_count(cx, iterator, ErrorType::TypeError)),
        },
    };
    let mut record = IteratorRecord::direct(cx, iterator)?;
    for _ in 0..to_skip {
        if !record.step(cx)? {
            return Ok(Value::FALSE);
        }
    }
    while let Some(value) = record.step_value(cx)? {
        if value.same_value_zero(cx, frame.argument(0))? {
            record.close(cx)?;
            return Ok(Value::TRUE);
        }
    }
    Ok(Value::FALSE)
}

#[native_abi]
fn join(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "Iterator.prototype.join requires that |this| be an Object.";
    let iterator = this_iterator(cx, frame, message)?;
    let separator = match frame.argument(0) {
        Value::UNDEFINED => cx.small_strings.single_character(b','),
        separator => (separator.to_string(cx))
            .map_err(|thrown| iterator_close_on_throw(cx, iterator, thrown))?,
    };
    let (mut rope, mut is_first) = (RopeBuilder::default(), true);
    IteratorRecord::direct(cx, iterator)?.for_each(cx, |cx, value| {
        if !core::mem::take(&mut is_first) {
            rope.push(cx, separator)?;
        }
        if value.is_undefined_or_null() {
            return Ok(());
        }
        let string = value.to_string(cx)?;
        rope.push(cx, string)
    })?;
    Ok(rope.finish(cx).into())
}
