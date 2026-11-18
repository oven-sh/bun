use bun_engine_vm::{RegExpObject, RegExpStringIterator, advance_last_index, regexp_exec};

use super::{FlagsProperty, species, this_object};
use crate::prelude::*;

#[native_abi]
pub(super) fn symbol_match(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "RegExp.prototype.@@match requires that |this| be an Object";
    let this = this_object(cx, frame, message)?;
    let string = frame.argument(0).to_string(cx)?;
    match_in(cx, this, string)
}

#[inline]
pub(super) fn match_in(cx: &mut Cx, regexp: Gc<JsObject>, string: Gc<JsString>) -> JsResult<Value> {
    match (regexp.downcast::<RegExpObject>()).and_then(|it| it.as_pristine(cx)) {
        Some(regexp) => Ok(regexp.matches(cx, string)?.map_or(Value::NULL, Into::into)),
        None => match_observably(cx, regexp, string),
    }
}

#[inline(never)]
fn match_observably(cx: &mut Cx, regexp: Gc<JsObject>, string: Gc<JsString>) -> JsResult<Value> {
    let flags = FlagsProperty::of(cx, &regexp)?;
    if !flags.has(b'g') {
        return Ok(regexp_exec(cx, regexp, string)?.map_or(Value::NULL, Into::into));
    }
    regexp.set(cx, names::lastIndex, Value::ZERO, true)?;
    let matches = cx.new_array();
    while let Some(result) = regexp_exec(cx, regexp, string)? {
        let matched = result.get_index(cx, 0)?.to_string(cx)?;
        cx.or_out_of_memory(matches.append_values(cx, &[matched.into()]))?;
        if matched.is_empty() {
            advance_last_index(cx, regexp, string, flags.is_unicode_aware())?;
        }
        cx.check_traps()?;
    }
    Ok(match matches.length() {
        0 => Value::NULL,
        _ => matches.into(),
    })
}

#[native_abi]
pub(super) fn symbol_match_all(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "RegExp.prototype.@@matchAll requires that |this| be an Object";
    let this = this_object(cx, frame, message)?;
    let string = frame.argument(0).to_string(cx)?;
    match_all_in(cx, this, string)
}

pub(super) fn match_all_in(
    cx: &mut Cx,
    regexp: Gc<JsObject>,
    string: Gc<JsString>,
) -> JsResult<Value> {
    if let Some(regexp) = regexp.downcast::<RegExpObject>()
        && let Some(regexp) = regexp.as_pristine_with_species(cx)
    {
        return Ok(RegExpStringIterator::for_pristine(cx, regexp, string).into());
    }
    let constructor = species(cx, &regexp)?;
    let flags = FlagsProperty::of(cx, &regexp)?;
    let arguments = [regexp.into(), flags.string.into()];
    let matcher = cx.construct(constructor, &arguments, constructor)?;
    let last_index = regexp.get(cx, names::lastIndex)?.to_length(cx)?;
    matcher.set(cx, names::lastIndex, last_index.into(), true)?;
    let (is_global, is_unicode_aware) = (flags.has(b'g'), flags.is_unicode_aware());
    Ok(RegExpStringIterator::create(cx, matcher, string, is_global, is_unicode_aware).into())
}

#[native_abi]
pub(super) fn symbol_search(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "RegExp.prototype.@@search requires that |this| be an Object";
    let this = this_object(cx, frame, message)?;
    let string = frame.argument(0).to_string(cx)?;
    search_in(cx, this, string)
}

#[inline]
pub(super) fn search_in(
    cx: &mut Cx,
    regexp: Gc<JsObject>,
    string: Gc<JsString>,
) -> JsResult<Value> {
    match regexp.downcast::<RegExpObject>() {
        Some(regexp) if regexp.can_search_directly(cx) => {
            regexp.regexp().search(cx, string).map(Value::int32)
        }
        _ => search_observably(cx, regexp, string),
    }
}

#[inline(never)]
fn search_observably(cx: &mut Cx, regexp: Gc<JsObject>, string: Gc<JsString>) -> JsResult<Value> {
    let previous = regexp.get(cx, names::lastIndex)?;
    if !previous.same_value(cx, Value::ZERO)? {
        regexp.set(cx, names::lastIndex, Value::ZERO, true)?;
    }
    let result = regexp_exec(cx, regexp, string)?;
    let current = regexp.get(cx, names::lastIndex)?;
    if !current.same_value(cx, previous)? {
        regexp.set(cx, names::lastIndex, previous, true)?;
    }
    match result {
        Some(result) => result.get(cx, names::index),
        None => Ok(Value::int32(-1)),
    }
}
