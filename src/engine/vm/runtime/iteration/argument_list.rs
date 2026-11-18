//! The arguments of a call whose number is known only when it is made.

use core::mem::MaybeUninit;

use super::new_array::as_spread;
use crate::call::MAX_ARGUMENTS;
use crate::{
    Cx, ElementWriter, Elements, HoleMode, ImmutableArray, JsObject, JsResult, JsTypedArray,
    MappedArguments, NoGc, PlainRange, Value, ValueVec, errors,
};

/// How many arguments an object stands for if `to_argument_list` returns it as it is. Only a script changes that.
#[inline(always)]
fn length_as_list(object: &JsObject) -> usize {
    if object.indexing_mode().is_array() {
        object.public_length() as usize
    } else if let Some(arguments) = object.downcast::<MappedArguments>() {
        arguments.plain_length() as usize
    } else if let Some(array) = object.downcast::<JsTypedArray>() {
        if array.is_resizable_or_growable() {
            0
        } else {
            array.known_length()
        }
    } else {
        object.public_length() as usize
    }
}

/// `length` is `length_as_list`.
#[inline(always)]
fn is_plain(no_gc: &NoGc<'_>, object: &JsObject, length: u64) -> bool {
    object.plain_elements(no_gc, 0..length).is_some()
        || object.is::<MappedArguments>()
        || (object.downcast::<JsTypedArray>()).is_some_and(|it| !it.element_type().is_bigint())
}

/// `to_argument_list`, of a value that is not empty.
#[inline]
pub fn to_argument_list(cx: &mut Cx, value: Value) -> JsResult<Value> {
    let Some(object) = value.as_object() else {
        if value.is_undefined_or_null() {
            return Ok(value);
        }
        return Err(errors::throw_invalid_apply_parameter(cx));
    };
    let length = object.length_of_array_like(cx)?;
    if length > MAX_ARGUMENTS as u64 {
        return Err(cx.throw_stack_overflow());
    }
    if length == length_as_list(&object) as u64 && is_plain(&cx.no_gc(), &object, length) {
        return Ok(value);
    }
    let values = get_elements(cx, &object, length)?;
    cx.or_out_of_memory(ImmutableArray::try_from_values(cx, &values))
        .map(Into::into)
}

#[inline(always)]
fn get_elements(cx: &mut Cx, object: &JsObject, length: u64) -> JsResult<ValueVec> {
    let mut values = ValueVec::new();
    cx.or_out_of_memory(values.try_reserve(length as usize))?;
    for index in 0..length {
        values.push(object.get_index(cx, index)?);
    }
    Ok(values)
}

/// CreateListFromArrayLike, for a call.
#[inline(always)]
pub fn arguments_from_array_like(cx: &mut Cx, object: &JsObject) -> JsResult<ValueVec> {
    let length = object.length_of_array_like(cx)?;
    if length > MAX_ARGUMENTS as u64 {
        return Err(cx.throw_stack_overflow());
    }
    get_elements(cx, object, length)
}

/// Of what `call_varargs` and its kin get, unless that is empty. The first `skip` do not count.
#[inline]
pub fn argument_list_length(list: Value, skip: u32) -> usize {
    let length = match list.downcast::<ImmutableArray>() {
        Some(list) => list.len() as usize,
        None => list.as_object().map_or(0, |object| length_as_list(&object)),
    };
    length.saturating_sub(skip as usize)
}

#[inline(always)]
fn load_elements(elements: Elements<'_>, target: &mut [MaybeUninit<Value>]) {
    match elements {
        Elements::Int32(values) | Elements::Contiguous(values) => {
            for (target, value) in target.iter_mut().zip(values) {
                target.write(value.unwrap_or_default());
            }
        }
        Elements::Double(_) => {
            for (target, value) in target.iter_mut().zip(elements.iter()) {
                target.write(value.unwrap_or_default());
            }
        }
    }
}

/// Fills `target`, whose length is `argument_list_length`.
#[inline]
pub fn load_argument_list(
    no_gc: &NoGc<'_>,
    list: Value,
    skip: u32,
    target: &mut [MaybeUninit<Value>],
) {
    if target.is_empty() {
        return;
    }
    let range = skip as usize..skip as usize + target.len();
    if let Some(list) = list.downcast::<ImmutableArray>() {
        return load_elements(list.elements().slice(range), target);
    }
    let object = list.cast::<JsObject>();
    if object.indexing_mode().is_array() {
        return load_elements(object.dense_elements(no_gc).slice(range), target);
    }
    let range = range.start as u64..range.end as u64;
    let plain = PlainRange::of(no_gc, &object, range, HoleMode::FillWithUndefined);
    // SAFETY: just made.
    unsafe { (plain.expect("a list")).write_to(&mut ElementWriter::for_values(target)) };
}

#[inline(always)]
fn count_in(register: Option<Value>, forwarded: &[Value]) -> usize {
    match (register, as_spread(register)) {
        (None, _) => forwarded.len(),
        (_, list) => list.map_or(1, |list| list.len() as usize),
    }
}

/// For `call_with_spread`. `forwarded` is what an empty register stands for.
#[inline]
pub fn spread_argument_count(registers: &[Option<Value>], forwarded: &[Value]) -> usize {
    registers.iter().map(|&it| count_in(it, forwarded)).sum()
}

/// Fills `target`. Panics unless its length is `spread_argument_count`.
#[inline]
pub fn load_spread_arguments(
    registers: &[Option<Value>],
    forwarded: &[Value],
    target: &mut [MaybeUninit<Value>],
) {
    let mut rest = target;
    for &register in registers.iter().rev() {
        let (taken, after) = rest.split_at_mut(count_in(register, forwarded));
        match (register, as_spread(register)) {
            (None, _) => _ = taken.write_copy_of_slice(forwarded),
            (_, Some(list)) => load_elements(list.elements(), taken),
            (Some(value), None) => _ = taken[0].write(value),
        }
        rest = after;
    }
    assert!(rest.is_empty());
}
