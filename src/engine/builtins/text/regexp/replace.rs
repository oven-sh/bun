use bun_engine_regexp::{Part, Template};
use bun_engine_text::{Atom, StringBuilder, Text};
use bun_engine_vm::{
    MatchOnRecord, RegExpObject, Storage, ValueVec, advance_last_index, regexp_exec,
};

use super::{FlagsProperty, this_object};
use crate::prelude::*;

#[native_abi]
pub(super) fn symbol_replace(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "RegExp.prototype.@@replace requires that |this| be an Object";
    let this = this_object(cx, frame, message)?;
    let string = frame.argument(0).to_string(cx)?;
    replace_in(cx, this, string, frame.argument(1), MatchOnRecord::Last)
}

#[inline]
pub(super) fn replace_in(
    cx: &mut Cx,
    regexp: Gc<JsObject>,
    string: Gc<JsString>,
    replacement: Value,
    on_record: MatchOnRecord,
) -> JsResult<Value> {
    let template = match replacement.is_callable() {
        true => None,
        false => Some(replacement.to_string(cx)?),
    };
    let object = regexp.downcast::<RegExpObject>();
    let result = match (object.and_then(|it| it.as_pristine(cx)), template) {
        (Some(regexp), Some(template)) => regexp.replace_with_string(cx, string, template),
        (Some(regexp), None) => {
            Gc::from(&*regexp).replace_with_function(cx, string, replacement, on_record)
        }
        (None, _) => replace_observably(cx, regexp, string, template.ok_or(replacement)),
    };
    result.map(Into::into)
}

fn collect_results(cx: &mut Cx, regexp: Gc<JsObject>, string: Gc<JsString>) -> JsResult<ValueVec> {
    let flags = FlagsProperty::of(cx, &regexp)?;
    let is_global = flags.has(b'g');
    if is_global {
        regexp.set(cx, names::lastIndex, Value::ZERO, true)?;
    }
    let mut results = ValueVec::new();
    while let Some(result) = regexp_exec(cx, regexp, string)? {
        cx.or_out_of_memory(results.try_push(result.into()))?;
        if !is_global {
            break;
        }
        if result.get_index(cx, 0)?.to_string(cx)?.is_empty() {
            advance_last_index(cx, regexp, string, flags.is_unicode_aware())?;
        }
        cx.check_traps()?;
    }
    Ok(results)
}

/// `replacement` is a template or a function.
#[inline(never)]
fn replace_observably(
    cx: &mut Cx,
    regexp: Gc<JsObject>,
    string: Gc<JsString>,
    replacement: Result<Gc<JsString>, Value>,
) -> JsResult<Gc<JsString>> {
    let results = collect_results(cx, regexp, string)?;
    let subject = string.view(cx)?;
    let subject = subject.text();
    let (mut out, mut next_position) = (StringBuilder::new(), 0);
    let mut captures = ValueVec::new();
    for result in results.iter().map(|it| it.cast::<JsObject>()) {
        let length = result.length_of_array_like(cx)?;
        let matched = result.get_index(cx, 0)?.to_string(cx)?;
        let position = result.get(cx, names::index)?.to_integer_or_infinity(cx)?;
        let position = position.clamp(0.0, subject.len() as f64) as usize;
        if length > u64::from(Storage::MAX_VECTOR_LENGTH) {
            return Err(cx.throw_out_of_memory());
        }
        captures.clear();
        captures.push(matched.into());
        for index in 1..length {
            let mut capture = result.get_index(cx, index)?;
            if !capture.is_undefined() {
                capture = capture.to_string(cx)?.into();
            }
            cx.or_out_of_memory(captures.try_push(capture))?;
            cx.check_traps()?;
        }
        let groups = result.get(cx, names::groups)?;
        let mut ignored = StringBuilder::new();
        let out = if position >= next_position {
            out.push_text(subject.slice(next_position..position));
            next_position = position + matched.len() as usize;
            &mut out
        } else {
            &mut ignored
        };
        match replacement {
            Ok(template) => {
                let groups = match groups.is_undefined() {
                    true => None,
                    false => Some(groups.to_object(cx)?),
                };
                let template = template.view(cx)?;
                let template = template.text();
                substitute(cx, out, template, subject, position, &captures, groups)?;
            }
            Err(function) => {
                let rest = [position.into(), string.into(), groups];
                let rest = &rest[..2 + usize::from(!groups.is_undefined())];
                cx.or_out_of_memory(captures.try_extend_from_slice(rest))?;
                let replacement = cx.call(function, Value::UNDEFINED, &captures)?;
                out.push_text(replacement.to_string_view(cx)?.text());
            }
        }
    }
    out.push_text(subject.slice_from(next_position.min(subject.len())));
    cx.finish_string(out)
}

/// GetSubstitution. `captures` start with the match.
fn substitute(
    cx: &mut Cx,
    out: &mut StringBuilder,
    template: Text<'_>,
    subject: Text<'_>,
    position: usize,
    captures: &[Value],
    groups: Option<Gc<JsObject>>,
) -> JsResult<()> {
    for part in Template::parts(template, captures.len() - 1, groups.is_some()) {
        let capture = match part {
            Part::Literal(range) => {
                out.push_text(template.slice(range));
                continue;
            }
            Part::Before => {
                out.push_text(subject.slice(0..position));
                continue;
            }
            Part::After => {
                let end = position + captures[0].cast::<JsString>().len() as usize;
                out.push_text(subject.slice_from(end.min(subject.len())));
                continue;
            }
            Part::Match => captures[0],
            Part::Group(number) => captures[number],
            Part::Name(range) => match groups {
                Some(groups) => {
                    let name = cx.or_out_of_memory(Atom::try_new(template.slice(range)))?;
                    groups.get(cx, name.name())?
                }
                None => Value::UNDEFINED,
            },
        };
        if !capture.is_undefined() {
            out.push_text(capture.to_string_view(cx)?.text());
        }
    }
    Ok(())
}
