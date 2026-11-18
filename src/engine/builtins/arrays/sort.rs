use core::cmp::Ordering;

use bun_engine_bytecode::{Comparator, Known, SortKey};
use bun_engine_number::NumberText;
use bun_engine_text::{AllocError, Text};
use bun_engine_vm::{
    HoleMode, JsArray, NoGc, RepeatedCall, RootVec, ValueVec, find_sort_keys, root_vec,
};

use super::copy::{array_create, check_array_size};
use super::string_sort::{
    Entry, FEW, entries_for, int32_of_key, key_of_int32, sort_few, sort_texts, try_collect,
};
use super::{merge_sort, radix_sort, receiver, this_object};
use crate::prelude::*;

/// Whether what a comparator has returned puts its first argument before the second.
#[inline(always)]
fn means_less(cx: &mut Cx, result: Value) -> JsResult<bool> {
    if let Some(number) = result.as_int32() {
        return Ok(number < 0);
    }
    // For comparators such as `(a, b) => a > b`.
    if result.is_boolean() {
        return Ok(result.is_false());
    }
    Ok(result.to_number(cx)? < 0.0)
}

fn permute(values: &mut [Value], scratch: &mut [Value], order: impl Iterator<Item = u32>) {
    scratch.copy_from_slice(values);
    for (value, index) in values.iter_mut().zip(order) {
        *value = scratch[index as usize];
    }
}

fn indices(entries: &[Entry]) -> impl DoubleEndedIterator<Item = u32> {
    entries.iter().map(|entry| entry.index)
}

#[inline(always)]
fn text_of<'a>(no_gc: &'a NoGc<'_>, string: Value) -> Text<'a> {
    string.cast::<JsString>().try_text(no_gc).expect("a view")
}

fn texts_of<'a>(
    no_gc: &'a NoGc<'_>,
    strings: impl ExactSizeIterator<Item = Value>,
) -> Result<Vec<Text<'a>>, AllocError> {
    try_collect(strings.map(|string| text_of(no_gc, string)))
}

fn sort_int32s_by(
    values: &mut [Value],
    key: impl Fn(i32) -> u64,
    number: impl Fn(u64) -> i32,
) -> Result<(), AllocError> {
    let (mut few, mut many) = ([0; FEW * 2], None);
    let keys = match few.get_mut(..values.len()) {
        Some(few) => few,
        None => many.insert(try_collect(values.iter().map(|_| 0))?),
    };
    for (target, value) in keys.iter_mut().zip(&*values) {
        *target = key(value.to_bits() as i32);
    }
    radix_sort::sort(keys, |key| key);
    for (value, &key) in values.iter_mut().zip(&*keys) {
        *value = Value::int32(number(key));
    }
    Ok(())
}

fn sort_numbers_as_strings(values: &mut [Value], scratch: &mut [Value]) -> Result<(), AllocError> {
    let text = |value: &Value| NumberText::from(value.as_number().unwrap_or_default());
    let numbers = try_collect(values.iter().map(text))?;
    if values.len() <= FEW {
        sort_few(values, |index| numbers[index].text());
    } else {
        let texts = try_collect(numbers.iter().map(NumberText::text))?;
        permute(values, scratch, indices(&sort_texts(&texts)?));
    }
    Ok(())
}

fn sort_as_strings(cx: &mut Cx, values: &mut [Value], scratch: &mut [Value]) -> JsResult<()> {
    if values.iter().all(|it| it.is_int32()) {
        return cx.or_out_of_memory(sort_int32s_by(values, key_of_int32, int32_of_key));
    }
    if values.iter().all(|it| it.is_number()) {
        return cx.or_out_of_memory(sort_numbers_as_strings(values, scratch));
    }
    for (string, value) in scratch.iter_mut().zip(&*values) {
        let converted = value.to_string(cx)?;
        if converted.is_rope() {
            converted.view(cx)?;
        }
        *string = converted.into();
    }
    let no_gc = cx.no_gc();
    if values.len() <= FEW {
        sort_few(values, |index| text_of(&no_gc, scratch[index]));
        return Ok(());
    }
    let order = texts_of(&no_gc, scratch.iter().copied()).and_then(|texts| sort_texts(&texts));
    permute(values, scratch, indices(&cx.or_out_of_memory(order)?));
    Ok(())
}

/// Compares as the number does, which is not NaN.
#[inline(always)]
fn key_of_number(number: f64) -> u64 {
    let bits = (number + 0.0).to_bits();
    bits ^ (((bits as i64) >> 63) as u64 | 1 << 63)
}

/// Whether a comparator puts its first argument before the second if the key of that is less, equal or greater.
type Verdicts = [bool; 3];

const ASCENDING: Verdicts = [true, false, false];
const DESCENDING: Verdicts = [false, false, true];

fn verdicts_of(comparator: &Comparator) -> Verdicts {
    [Ordering::Less, Ordering::Equal, Ordering::Greater].map(|order| {
        match comparator.result(order) {
            Known::Boolean(result) => !result,
            Known::Number(result) => result < 0.0,
        }
    })
}

/// If all that `comparator` does with two numbers but NaN is to order them: whether the greater comes first.
pub(crate) fn orders_numbers_descending(cx: &mut Cx, comparator: Value) -> JsResult<Option<bool>> {
    let comparator = find_sort_keys(cx, comparator, &[], &mut [])?;
    let verdicts = (comparator.filter(|it| it.key == SortKey::Whole)).map(|it| verdicts_of(&it));
    Ok(match verdicts {
        Some(ASCENDING) => Some(false),
        Some(DESCENDING) => Some(true),
        _ => None,
    })
}

/// Asks the questions that the comparator would have been asked.
fn sort_by_verdicts(
    entries: &mut [Entry],
    verdicts: Verdicts,
    compare: impl Fn(Entry, Entry) -> Ordering,
) -> Result<(), AllocError> {
    let mut scratch = try_collect(entries.iter().copied())?;
    merge_sort::sort(entries, &mut scratch, |a, b| {
        Ok(verdicts[(compare(a, b) as i8 + 1) as usize])
    })
}

fn sort_by_numbers(
    values: &mut [Value],
    keys: &mut [Value],
    verdicts: Verdicts,
) -> Result<(), AllocError> {
    let flip = if verdicts == DESCENDING { u64::MAX } else { 0 };
    let key = |key: &Value| key_of_number(key.as_number().unwrap_or_default()) ^ flip;
    let mut entries = entries_for(keys.iter().map(key))?;
    match verdicts {
        ASCENDING | DESCENDING => radix_sort::sort(&mut entries, |entry| entry.key),
        _ => sort_by_verdicts(&mut entries, verdicts, |a, b| a.key.cmp(&b.key))?,
    }
    permute(values, keys, indices(&entries));
    Ok(())
}

fn sort_by_strings(
    no_gc: &NoGc<'_>,
    values: &mut [Value],
    keys: &mut [Value],
    verdicts: Verdicts,
) -> Result<(), AllocError> {
    if verdicts == DESCENDING {
        let entries = sort_texts(&texts_of(no_gc, keys.iter().copied().rev())?)?;
        let last = values.len() as u32 - 1;
        permute(values, keys, indices(&entries).rev().map(|it| last - it));
        return Ok(());
    }
    let texts = texts_of(no_gc, keys.iter().copied())?;
    let entries = if verdicts == ASCENDING {
        sort_texts(&texts)?
    } else {
        let mut entries = entries_for(texts.iter().map(|_| 0))?;
        let text = |entry: Entry| texts[entry.index as usize];
        sort_by_verdicts(&mut entries, verdicts, |a, b| text(a).cmp(&text(b)))?;
        entries
    };
    permute(values, keys, indices(&entries));
    Ok(())
}

/// False, having left the values as they are, if the comparator has to be called.
#[inline(never)]
fn try_sort_without_calls(
    cx: &mut Cx,
    values: &mut [Value],
    keys: &mut [Value],
    comparator: Value,
) -> JsResult<bool> {
    let Some(comparator) = find_sort_keys(cx, comparator, values, keys)? else {
        return Ok(false);
    };
    let verdicts = verdicts_of(&comparator);
    let is_ordered = |key: &Value| key.as_number().is_some_and(|it| !it.is_nan());
    if comparator.key == SortKey::Whole
        && matches!(verdicts, ASCENDING | DESCENDING)
        && values.iter().all(|it| it.is_int32())
    {
        let flip = if verdicts == ASCENDING {
            i32::MIN
        } else {
            i32::MAX
        };
        let key = |number: i32| u64::from((number ^ flip) as u32);
        cx.or_out_of_memory(sort_int32s_by(values, key, |key| key as i32 ^ flip))?;
    } else if keys.iter().all(is_ordered) {
        cx.or_out_of_memory(sort_by_numbers(values, keys, verdicts))?;
    } else if !comparator.subtracts && keys.iter().all(|it| it.is_string()) {
        for key in &*keys {
            key.cast::<JsString>().view(cx)?;
        }
        let sorted = sort_by_strings(&cx.no_gc(), values, keys, verdicts);
        cx.or_out_of_memory(sorted)?;
    } else {
        return Ok(false);
    }
    Ok(true)
}

/// From here on, a look at the code of the comparator can pay.
pub(crate) const MIN_LENGTH_TO_AVOID_CALLS: usize = 8;

fn sort_with_calls(
    cx: &mut Cx,
    values: &mut [Value],
    scratch: &mut [Value],
    comparator: Value,
) -> JsResult<()> {
    let comparator = RepeatedCall::new(cx, comparator);
    merge_sort::sort(values, scratch, |a, b| {
        let result = comparator.call(cx, Value::UNDEFINED, [a, b])?;
        means_less(cx, result)
    })
}

pub(crate) fn sort_by_calling(
    cx: &mut Cx,
    values: &mut [Value],
    comparator: Value,
) -> JsResult<()> {
    let mut scratch = try_room(cx, values.len())?;
    sort_with_calls(cx, values, &mut scratch, comparator)
}

fn sort_values(
    cx: &mut Cx,
    values: &mut [Value],
    scratch: &mut [Value],
    comparator: Value,
) -> JsResult<()> {
    if comparator.is_undefined() {
        return sort_as_strings(cx, values, scratch);
    }
    if values.len() >= MIN_LENGTH_TO_AVOID_CALLS
        && try_sort_without_calls(cx, values, scratch, comparator)?
    {
        return Ok(());
    }
    sort_with_calls(cx, values, scratch, comparator)
}

/// `values` are the elements that are not undefined.
fn sort_and_store(
    cx: &mut Cx,
    object: &JsObject,
    length: u64,
    comparator: Value,
    (values, scratch): (&mut [Value], &mut [Value]),
    undefined_count: u64,
) -> JsResult<()> {
    sort_values(cx, values, scratch, comparator)?;
    if !cx.or_out_of_memory(object.try_set_elements(cx, 0, values))? {
        for (index, &value) in (0..).zip(&*values) {
            object.set_index(cx, index, value, true)?;
        }
    }
    let first_undefined = values.len() as u64;
    let mut index = first_undefined + undefined_count;
    for index in first_undefined..index {
        object.set_index(cx, index, Value::UNDEFINED, true)?;
    }
    while index < length {
        object.delete_index_or_throw(cx, index)?;
        index = object.skip_holes(index + 1..length);
        cx.check_traps()?;
    }
    Ok(())
}

/// The elements are plain, and `room` has twice as many.
fn sort_plain_elements(
    cx: &mut Cx,
    object: &JsObject,
    comparator: Value,
    room: &mut [Value],
) -> JsResult<()> {
    let (values, scratch) = room.split_at_mut(room.len() / 2);
    let (length, mut count, mut present) = (values.len(), 0, 0);
    let no_gc = cx.no_gc();
    for value in object
        .dense_elements(&no_gc)
        .slice(0..length)
        .iter()
        .flatten()
    {
        values[count] = value;
        count += usize::from(!value.is_undefined());
        present += 1;
    }
    let lists = (&mut values[..count], &mut scratch[..count]);
    sort_and_store(
        cx,
        object,
        length as u64,
        comparator,
        lists,
        present - count as u64,
    )
}

fn try_room(cx: &Cx, length: usize) -> JsResult<RootVec<Value>> {
    let mut room = root_vec();
    if room.try_reserve_exact(length).is_err() {
        return Err(cx.throw_out_of_memory());
    }
    room.resize(length, Value::UNDEFINED);
    Ok(room)
}

#[inline(never)]
fn sort_properties(cx: &mut Cx, object: &JsObject, length: u64, comparator: Value) -> JsResult<()> {
    let (mut values, mut undefined_count, mut index) = (ValueVec::new(), 0, 0);
    while index < length {
        let value = object.get_index_if_has_property(cx, index)?;
        index += 1;
        match value {
            Some(Value::UNDEFINED) => undefined_count += 1,
            Some(_) if values.len() == u32::MAX as usize => return Err(cx.throw_out_of_memory()),
            Some(value) => cx.or_out_of_memory(values.try_push(value))?,
            None => index = object.skip_holes(index..length),
        }
        cx.check_traps()?;
    }
    let mut scratch = try_room(cx, values.len())?;
    let lists = (&mut *values, &mut *scratch);
    sort_and_store(cx, object, length, comparator, lists, undefined_count)
}

fn sort_object(cx: &mut Cx, object: &JsObject, length: u64, comparator: Value) -> JsResult<()> {
    if length < 2 {
        return Ok(());
    }
    if object.plain_elements(&cx.no_gc(), 0..length).is_none() {
        return sort_properties(cx, object, length, comparator);
    }
    let size = length as usize * 2;
    match size {
        ..=16 => sort_plain_elements(cx, object, comparator, &mut [Value::UNDEFINED; 16][..size]),
        17..=128 => {
            sort_plain_elements(cx, object, comparator, &mut [Value::UNDEFINED; 128][..size])
        }
        _ => sort_plain_elements(cx, object, comparator, &mut try_room(cx, size)?),
    }
}

#[native_abi]
pub(super) fn sort(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let comparator = frame.argument(0);
    if !comparator.is_undefined() && !comparator.is_callable() {
        return Err(cx.throw_type_error(
            "Array.prototype.sort requires the comparator argument to be a function or undefined",
        ));
    }
    let object = receiver(cx, frame.this_value())?;
    let length = object.length_of_array_like(cx)?;
    sort_object(cx, &object, length, comparator)?;
    Ok(object.into())
}

#[native_abi]
pub(super) fn to_sorted(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let comparator = frame.argument(0);
    if !comparator.is_undefined() && !comparator.is_callable() {
        return Err(cx.throw_type_error(
            "Array.prototype.toSorted requires the comparator argument to be a function or undefined",
        ));
    }
    let object = this_object!(cx, frame, "toSorted")?;
    let length = object.length_of_array_like(cx)?;
    let size = check_array_size(cx, length)?;
    let holes = HoleMode::FillWithUndefined;
    let result = match JsArray::try_copy(cx, &object, 0..length, holes)? {
        Some(copy) => copy,
        None => array_create(cx, size, |cx, index| object.get_index(cx, index))?,
    };
    sort_object(cx, &result, length, comparator)?;
    Ok(result.into())
}
