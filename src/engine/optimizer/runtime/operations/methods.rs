//! Methods of arrays. They return zero, and no script can tell that they have been called, if there is more to it.

use bun_engine_macros::native_abi;
use bun_engine_vm::{Cx, Direction, Gc, HoleMode, JsArray, JsObject, JsResult, Value};

use super::elements::species_is_array;
use super::{Address, Operation, Returned};

/// What is added to an index, or to −1.
pub(crate) const BIAS: u32 = 2;

fn quietly<T>(cx: &Cx, result: JsResult<Option<T>>) -> Option<T> {
    result
        .map_err(|it| cx.discard_unless_termination(it))
        .ok()?
}

fn relative(index: i32, length: u32) -> u32 {
    match u32::try_from(index) {
        Ok(index) => index.min(length),
        Err(_) => length.saturating_sub(index.unsigned_abs()),
    }
}

/// Unless there are more elements than `i32::MAX` can stand for.
fn short(length: u32) -> Option<u32> {
    (length < i32::MAX as u32).then_some(length)
}

operations! {
    PUSH: fn push(cx: &Cx, array: Gc<JsArray>, value: Value) -> u32 {
        let index = short(array.length()).filter(|&it| array.try_store_plain_element(cx, it, value));
        index.map_or(0, |index| index + 1)
    }
    UNSHIFT: fn unshift(cx: &Cx, array: Gc<JsArray>, value: Value) -> u32 {
        if array.try_replace_range(cx, 0, 0, &[value]) { array.length() } else { 0 }
    }
    POP: fn pop(cx: &Cx, array: Gc<JsArray>) -> Option<Value> {
        array.try_pop(cx)
    }
    SHIFT: fn shift(cx: &Cx, array: Gc<JsArray>) -> Option<Value> {
        array.try_ensure_writable_elements(cx).ok()?;
        array.try_shift(cx)
    }
    SET_LENGTH: fn set_length(cx: &Cx, array: Gc<JsArray>, length: u32) -> u32 {
        array.try_set_dense_length(cx, length).into()
    }
    SLICE: fn slice(cx: &mut Cx, object: Gc<JsObject>, start: i32, end: i32) -> Option<Gc<JsArray>> {
        let length = short(object.try_length_of_array_like()?).filter(|_| species_is_array(cx, &object) != 0)?;
        let (start, end) = (relative(start, length), relative(end, length));
        let copy = JsArray::try_copy(cx, &object, start.into()..end.max(start).into(), HoleMode::Keep);
        quietly(cx, copy)
    }
    SPLICE: fn splice(
        cx: &mut Cx, array: Gc<JsArray>, start: i32, count: i32, items: *const Value, added: usize
    ) -> Option<Gc<JsArray>> {
        // SAFETY: the code has put that many there.
        let items = unsafe { core::slice::from_raw_parts(items, added) };
        let length = short(array.length()).filter(|_| species_is_array(cx, &array) != 0)?;
        let start = relative(start, length);
        let count = (count.max(0) as u32).min(length - start);
        let range = start.into()..(start + count).into();
        let removed = JsArray::try_copy(cx, &array, range, HoleMode::Keep);
        quietly(cx, removed).filter(|_| array.try_replace_range(cx, start, count, items))
    }
    INDEX_OF: fn index_of(cx: &mut Cx, array: Gc<JsArray>, needle: Value, from: i32) -> u32 {
        let range = relative(from, array.length()).into()..array.length().into();
        let found = array.try_index_of::<{ Direction::Forward }>(cx, range, needle);
        quietly(cx, found).map_or(0, |it| it.map_or(BIAS - 1, |index| index as u32 + BIAS))
    }
    INCLUDES: fn includes(cx: &mut Cx, array: Gc<JsArray>, needle: Value, from: i32) -> u32 {
        let range = relative(from, array.length()).into()..array.length().into();
        let found = array.try_includes(cx, range, needle);
        quietly(cx, found).map_or(0, |is_found| BIAS - 1 + u32::from(is_found))
    }
}

leaves! {
    FIND_WORD: fn find_word(elements: *const u64, start: u32, end: u32, word: u64) -> i32 {
        // SAFETY: inside the vector.
        let words = unsafe { core::slice::from_raw_parts(elements, end as usize) };
        let found = bun_highway::elements::index_of_u64(&words[start as usize..], word);
        found.map_or(-1, |offset| (start as usize + offset) as i32)
    }
}
