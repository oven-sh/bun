use bun_engine_vm::{Element, with_element_type};

use super::prototype::valid_this;
use super::relative_index;
use crate::prelude::*;

const NOT_FOUND: Value = Value::int32(-1);

#[native_abi]
pub(super) fn includes(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, length) = valid_this(cx, frame)?;
    if length == 0 {
        return Ok(Value::FALSE);
    }
    let start = relative_index(cx, frame.argument(1), length, 0)?;
    let needle = frame.argument(0);
    if needle.is_undefined() {
        // What is no longer there reads as undefined.
        return Ok((start.max(this.length()) < length).into());
    }
    let no_gc = cx.no_gc();
    let found = with_element_type!(this.element_type(), T => T::exactly(needle).is_some_and(|needle| {
        this.typed::<T>().elements(&no_gc).clamped(start..length).contains(needle)
    }));
    Ok(found.into())
}

#[native_abi]
pub(super) fn index_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, length) = valid_this(cx, frame)?;
    if length == 0 {
        return Ok(NOT_FOUND);
    }
    let start = relative_index(cx, frame.argument(1), length, 0)?;
    let (needle, no_gc) = (frame.argument(0), cx.no_gc());
    let found = with_element_type!(this.element_type(), T => T::exactly(needle).and_then(|needle| {
        this.typed::<T>().elements(&no_gc).clamped(start..length).index_of(needle)
    }));
    Ok(found.map_or(NOT_FOUND, |index| (start + index).into()))
}

#[native_abi]
pub(super) fn last_index_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, length) = valid_this(cx, frame)?;
    if length == 0 {
        return Ok(NOT_FOUND);
    }
    let mut end = length;
    if let Some(from) = frame.arguments().get(1) {
        let mut from = from.to_integer_or_infinity(cx)?;
        if from < 0.0 {
            from += length as f64;
        }
        end = end.min((from + 1.0) as usize);
    }
    let (needle, no_gc) = (frame.argument(0), cx.no_gc());
    let found = with_element_type!(this.element_type(), T => T::exactly(needle).and_then(|needle| {
        this.typed::<T>().elements(&no_gc).clamped(0..end).last_index_of(needle)
    }));
    Ok(found.map_or(NOT_FOUND, Value::from))
}
