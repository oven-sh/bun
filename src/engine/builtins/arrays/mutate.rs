//! The methods that change the receiver.

use bun_engine_vm::{HoleMode, JsArray, array_species_create, errors};

use super::copy::copy_properties;
use super::{MAX_LENGTH, receiver, set_length, this_object};
use crate::prelude::*;

#[native_abi]
pub(super) fn push(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, items) = (frame.this_value(), frame.arguments());
    if let Some(array) = this.as_exact_array() {
        if let &[item] = items {
            array.push(cx, item)?;
            return Ok(array.length().into());
        }
        if cx.or_out_of_memory(array.try_set_elements(cx, array.length().into(), items))? {
            return Ok(array.length().into());
        }
    }
    let object = receiver(cx, this)?;
    let length = object.length_of_array_like(cx)?;
    let new_length = length + items.len() as u64;
    if new_length > MAX_LENGTH {
        let message = "push cannot produce an array of length larger than (2 ** 53) - 1";
        return Err(cx.throw_type_error(message));
    }
    for (index, &item) in (length..).zip(items) {
        object.set_index(cx, index, item, true)?;
    }
    set_length(cx, &object, new_length)?;
    Ok(new_length.into())
}

#[native_abi]
pub(super) fn pop(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if let Some(array) = frame.this_value().as_exact_array() {
        return array.pop(cx);
    }
    let object = receiver(cx, frame.this_value())?;
    let Some(last) = object.length_of_array_like(cx)?.checked_sub(1) else {
        set_length(cx, &object, 0)?;
        return Ok(Value::UNDEFINED);
    };
    let element = object.get_index(cx, last)?;
    object.delete_index_or_throw(cx, last)?;
    set_length(cx, &object, last)?;
    Ok(element)
}

fn move_property(cx: &mut Cx, object: &JsObject, from: u64, to: u64) -> JsResult<()> {
    match object.get_index_if_has_property(cx, from)? {
        Some(value) => object.set_index(cx, to, value, true).map(|_| ())?,
        None => object.delete_index_or_throw(cx, to)?,
    }
    cx.check_traps()
}

/// What `splice` does once it has copied what it removes.
fn replace_range(
    cx: &mut Cx,
    object: &JsObject,
    length: u64,
    start: u64,
    removed: u64,
    items: &[Value],
) -> JsResult<()> {
    let added = items.len() as u64;
    let new_length = length - removed + added;
    if let Some(array) = object.as_exact_array() {
        if cx.or_out_of_memory(array.try_splice(cx, length, start, removed, items))? {
            return Ok(());
        }
        if new_length > u64::from(u32::MAX) && added > removed {
            return Err(cx.throw_range_error(errors::LENGTH_EXCEEDS_MAXIMUM));
        }
    }
    let kept = start..length - removed;
    if added < removed {
        for index in kept {
            move_property(cx, object, index + removed, index + added)?;
        }
        for index in (new_length..length).rev() {
            object.delete_index_or_throw(cx, index)?;
            cx.check_traps()?;
        }
    } else if added > removed {
        for index in kept.rev() {
            move_property(cx, object, index + removed, index + added)?;
        }
    }
    for (index, &item) in (start..).zip(items) {
        object.set_index(cx, index, item, true)?;
    }
    set_length(cx, object, new_length)
}

#[native_abi]
pub(super) fn shift(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = frame.this_value();
    if let Some(first) = this.as_exact_array().and_then(|it| it.try_shift(cx)) {
        return Ok(first);
    }
    let object = receiver(cx, this)?;
    let length = object.length_of_array_like(cx)?;
    if length == 0 {
        set_length(cx, &object, 0)?;
        return Ok(Value::UNDEFINED);
    }
    let first = object.get_index(cx, 0)?;
    replace_range(cx, &object, length, 0, 1, &[])?;
    Ok(first)
}

#[native_abi]
pub(super) fn unshift(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = receiver(cx, frame.this_value())?;
    let length = object.length_of_array_like(cx)?;
    let new_length = length + frame.argument_count() as u64;
    if new_length > MAX_LENGTH {
        let message = "unshift cannot produce an array of length larger than (2 ** 53) - 1";
        return Err(cx.throw_type_error(message));
    }
    replace_range(cx, &object, length, 0, 0, frame.arguments())?;
    Ok(new_length.into())
}

/// Where `splice` and `toSpliced` start, and how many elements they leave out.
#[inline(always)]
pub(super) fn splice_range(cx: &mut Cx, frame: &CallFrame, length: u64) -> JsResult<(u64, u64)> {
    let start = frame.argument(0).to_relative_index(cx, length, 0)?;
    let count = match frame.arguments() {
        [] => 0,
        [_] => length - start,
        [_, count, ..] => match count.as_index_int32() {
            Some(count) => u64::from(count),
            None => count.to_integer_or_infinity(cx)? as u64,
        }
        .min(length - start),
    };
    Ok((start, count))
}

#[native_abi]
pub(super) fn splice(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = receiver(cx, frame.this_value())?;
    let length = object.length_of_array_like(cx)?;
    let (start, removed) = splice_range(cx, frame, length)?;
    let items = frame.rest(2);
    if length - removed + items.len() as u64 > MAX_LENGTH {
        let message = "Splice cannot produce an array of length larger than (2 ** 53) - 1";
        return Err(cx.throw_type_error(message));
    }
    let range = start..start + removed;
    let species = array_species_create(cx, &object, removed)?;
    let copy = match species {
        Some(_) => None,
        None => JsArray::try_copy(cx, &object, range.clone(), HoleMode::Keep)?,
    };
    let result = match copy {
        Some(copy) => copy.upcast(),
        None => copy_properties(cx, &object, range, species)?,
    };
    replace_range(cx, &object, length, start, removed, items)?;
    Ok(result.into())
}

#[native_abi]
pub(super) fn reverse(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = receiver(cx, frame.this_value())?;
    let length = object.length_of_array_like(cx)?;
    if cx.or_out_of_memory(object.try_reverse_elements(cx, length))? {
        return Ok(object.into());
    }
    for lower in 0..length / 2 {
        let upper = length - lower - 1;
        let lower_value = object.get_index_if_has_property(cx, lower)?;
        let upper_value = object.get_index_if_has_property(cx, upper)?;
        if lower_value.is_some() || upper_value.is_some() {
            for (index, value) in [(lower, upper_value), (upper, lower_value)] {
                match value {
                    Some(value) => object.set_index(cx, index, value, true).map(|_| ())?,
                    None => object.delete_index_or_throw(cx, index)?,
                }
            }
        }
        cx.check_traps()?;
    }
    Ok(object.into())
}

#[native_abi]
pub(super) fn fill(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = this_object!(cx, frame, "fill")?;
    let length = object.length_of_array_like(cx)?;
    let start = frame.argument(1).to_relative_index(cx, length, 0)?;
    let end = frame.argument(2).to_relative_index(cx, length, length)?;
    let value = frame.argument(0);
    for index in start..end {
        // Sparse elements become dense on the way.
        if cx.or_out_of_memory(object.try_fill_elements(cx, index..end, value))? {
            break;
        }
        object.set_index(cx, index, value, true)?;
        cx.check_traps()?;
    }
    Ok(object.into())
}

#[native_abi]
pub(super) fn copy_within(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = this_object!(cx, frame, "copyWithin")?;
    let length = object.length_of_array_like(cx)?;
    let to = frame.argument(0).to_relative_index(cx, length, 0)?;
    let from = frame.argument(1).to_relative_index(cx, length, 0)?;
    let end = frame.argument(2).to_relative_index(cx, length, length)?;
    let count = end.saturating_sub(from).min(length - to);
    if count == 0 || cx.or_out_of_memory(object.try_copy_elements_within(cx, from, to, count))? {
        return Ok(object.into());
    }
    let is_backward = from < to && to < from + count;
    for step in 0..count {
        let offset = if is_backward { count - 1 - step } else { step };
        move_property(cx, &object, from + offset, to + offset)?;
    }
    Ok(object.into())
}
