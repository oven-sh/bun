use core::ops::Range;

use bun_engine_vm::Direction;

use super::{receiver, this_object};
use crate::prelude::*;

#[inline(always)]
fn find_index<const DIRECTION: Direction>(
    cx: &mut Cx,
    object: &JsObject,
    mut range: Range<u64>,
    needle: Value,
) -> JsResult<Value> {
    if let Some(index) = object.try_index_of::<DIRECTION>(cx, range.clone(), needle)? {
        return Ok(index.map_or(Value::int32(-1), Value::from));
    }
    while let Some(index) = match DIRECTION {
        Direction::Forward => range.next(),
        Direction::Backward => range.next_back(),
    } {
        if let Some(element) = object.get_index_if_has_property(cx, index)?
            && needle.strict_equals(cx, element)?
        {
            return Ok(index.into());
        }
        cx.check_traps()?;
    }
    Ok(Value::int32(-1))
}

#[inline(always)]
fn try_find(cx: &mut Cx, frame: &CallFrame) -> Option<Option<usize>> {
    let (array, &[needle]) = (frame.this_value().as_exact_array()?, frame.arguments()) else {
        return None;
    };
    array.try_find(&cx.no_gc(), needle)
}

#[native_abi]
pub(super) fn index_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    match try_find(cx, frame) {
        Some(index) => Ok(Value::int32(index.map_or(-1, |index| index as i32))),
        None => index_of_in_any(cx, frame),
    }
}

#[inline(never)]
fn index_of_in_any(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = receiver(cx, frame.this_value())?;
    let length = object.length_of_array_like(cx)?;
    if length == 0 {
        return Ok(Value::int32(-1));
    }
    let start = frame.argument(1).to_relative_index(cx, length, 0)?;
    find_index::<{ Direction::Forward }>(cx, &object, start..length, frame.argument(0))
}

#[native_abi]
pub(super) fn last_index_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = receiver(cx, frame.this_value())?;
    let length = object.length_of_array_like(cx)?;
    if length == 0 {
        return Ok(Value::int32(-1));
    }
    let mut end = length;
    if let Some(from) = frame.arguments().get(1) {
        let from = from.to_integer_or_infinity(cx)?;
        let last = if from < 0.0 {
            from + length as f64
        } else {
            from
        };
        end = ((last + 1.0) as u64).min(length);
    }
    find_index::<{ Direction::Backward }>(cx, &object, 0..end, frame.argument(0))
}

#[native_abi]
pub(super) fn includes(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    match try_find(cx, frame) {
        Some(index) => Ok(index.is_some().into()),
        None => includes_in_any(cx, frame),
    }
}

#[inline(never)]
fn includes_in_any(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = this_object!(cx, frame, "includes")?;
    let length = object.length_of_array_like(cx)?;
    if length == 0 {
        return Ok(Value::FALSE);
    }
    let range = frame.argument(1).to_relative_index(cx, length, 0)?..length;
    let needle = frame.argument(0);
    if let Some(answer) = object.try_includes(cx, range.clone(), needle)? {
        return Ok(answer.into());
    }
    for index in range {
        let element = object.get_index(cx, index)?;
        if needle.same_value_zero(cx, element)? {
            return Ok(Value::TRUE);
        }
        cx.check_traps()?;
    }
    Ok(Value::FALSE)
}
