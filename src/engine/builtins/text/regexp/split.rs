use bun_engine_text::Text;
use bun_engine_vm::{JsArray, RegExpObject, advance_string_index, regexp_exec};

use super::{FlagsProperty, species, this_object};
use crate::prelude::*;

#[native_abi]
pub(super) fn symbol_split(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "RegExp.prototype.@@split requires that |this| be an Object";
    let this = this_object(cx, frame, message)?;
    let string = frame.argument(0).to_string(cx)?;
    split_by(cx, this, string, frame.argument(1))
}

#[inline]
fn to_limit(cx: &mut Cx, limit: Value) -> JsResult<u32> {
    if limit.is_undefined() {
        return Ok(u32::MAX);
    }
    limit.to_uint32(cx)
}

#[inline]
pub(super) fn split_by(
    cx: &mut Cx,
    regexp: Gc<JsObject>,
    string: Gc<JsString>,
    limit: Value,
) -> JsResult<Value> {
    if let Some(regexp) = regexp.downcast::<RegExpObject>()
        && regexp.as_pristine_with_species(cx).is_some()
        && (limit.is_undefined() || limit.is_number())
    {
        let limit = to_limit(cx, limit)?;
        return regexp.regexp().split(cx, string, limit).map(Into::into);
    }
    split_observably(cx, regexp, string, limit).map(Into::into)
}

#[inline(never)]
fn split_observably(
    cx: &mut Cx,
    regexp: Gc<JsObject>,
    string: Gc<JsString>,
    limit: Value,
) -> JsResult<Gc<JsArray>> {
    let constructor = species(cx, &regexp)?;
    let flags = FlagsProperty::of(cx, &regexp)?;
    let sticky_flags = match flags.has(b'y') {
        true => flags.string,
        false => cx.new_string_from_parts(&[flags.text(), Text::from_ascii("y")])?,
    };
    let arguments = [regexp.into(), sticky_flags.into()];
    let splitter = cx.construct(constructor, &arguments, constructor)?;
    let limit = to_limit(cx, limit)?;
    if constructor == cx.regexp_constructor().into()
        && let Some(unseen) = splitter.downcast::<RegExpObject>()
        && unseen.has_pristine_exec(cx)
    {
        return unseen.regexp().split(cx, string, limit);
    }
    let result = cx.new_array();
    let append = |cx: &Cx, value: Value| {
        cx.or_out_of_memory(result.append_values(cx, &[value]))?;
        Ok(result.length() == limit)
    };
    if limit == 0 {
        return Ok(result);
    }
    if string.is_empty() {
        if regexp_exec(cx, splitter, string)?.is_none() {
            append(cx, string.into())?;
        }
        return Ok(result);
    }
    let subject = string.view(cx)?;
    let size = u64::from(string.len());
    let advance = |index| advance_string_index(subject.text(), index, flags.is_unicode_aware());
    let (mut start, mut index) = (0, 0);
    while index < size {
        cx.check_traps()?;
        splitter.set(cx, names::lastIndex, index.into(), true)?;
        let Some(separator) = regexp_exec(cx, splitter, string)? else {
            index = advance(index);
            continue;
        };
        let end = splitter.get(cx, names::lastIndex)?.to_length(cx)?.min(size);
        if end == start {
            index = advance(index);
            continue;
        }
        let piece = subject.substring(cx, start as usize..index as usize);
        if append(cx, piece.into())? {
            return Ok(result);
        }
        start = end;
        for number in 1..separator.length_of_array_like(cx)? {
            let capture = separator.get_index(cx, number)?;
            if append(cx, capture)? {
                return Ok(result);
            }
            cx.check_traps()?;
        }
        index = start;
    }
    append(
        cx,
        subject.substring(cx, start as usize..size as usize).into(),
    )?;
    Ok(result)
}
