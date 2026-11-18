use bun_engine_regexp::Flags;
use bun_engine_text::{PropertyName, StringBuilder};
use bun_engine_vm::{MatchOnRecord, RegExp, RegExpObject, errors};

use super::FlagsProperty;
use super::constructor::{to_pattern, to_regexp};
use super::matching::{match_all_in, match_in, search_in};
use super::replace::replace_in;
use super::split::split_by;
use crate::prelude::*;

type Method = fn(&mut Cx, Gc<JsObject>, Gc<JsString>) -> JsResult<Value>;

#[inline(always)]
fn pristine(cx: &Cx, object: Gc<JsObject>) -> Option<Gc<RegExpObject>> {
    let regexp = object.downcast::<RegExpObject>();
    regexp.filter(|it| it.is_pristine(cx))
}

fn call_method(cx: &mut Cx, method: Value, this: Gc<JsObject>, argument: Value) -> JsResult<Value> {
    if !method.is_callable() {
        let mut message = StringBuilder::new();
        errors::describe_value(cx, method, &mut message);
        message.push_ascii(" is not a function");
        return Err(cx.throw_type_error(message));
    }
    cx.call(method, this.into(), &[argument])
}

/// `original` is what a pristine object has under that name, and `create` makes a pattern of anything else.
#[inline(always)]
fn defer(
    cx: &mut Cx,
    this: Value,
    argument: Value,
    name: PropertyName<'_>,
    original: Method,
    create: fn(&mut Cx, Value) -> JsResult<Gc<RegExp>>,
) -> JsResult<Value> {
    if let Some(object) = argument.as_object() {
        if pristine(cx, object).is_some() {
            let string = this.to_string(cx)?;
            return original(cx, object, string);
        }
        let method = object.get(cx, name)?;
        if !method.is_undefined_or_null() {
            return call_method(cx, method, object, this);
        }
    }
    let string = this.to_string(cx)?;
    let regexp = create(cx, argument)?;
    let regexp = RegExpObject::create(cx, regexp);
    if regexp.is_pristine(cx) {
        return original(cx, regexp.upcast(), string);
    }
    let method = regexp.get(cx, name)?;
    call_method(cx, method, regexp.upcast(), string.into())
}

fn without_flags(cx: &mut Cx, pattern: Value) -> JsResult<Gc<RegExp>> {
    to_regexp(cx, pattern, Value::UNDEFINED)
}

fn global(cx: &mut Cx, pattern: Value) -> JsResult<Gc<RegExp>> {
    let pattern = to_pattern(cx, pattern)?;
    RegExp::create(cx, &*pattern.resolve(cx)?, Flags::GLOBAL)
}

#[inline(always)]
fn require_global(cx: &mut Cx, object: Gc<JsObject>, message: &'static str) -> JsResult<()> {
    let is_acceptable = match pristine(cx, object) {
        Some(regexp) => regexp.regexp().is_global(),
        None => !object.as_value().is_regexp(cx)? || FlagsProperty::of(cx, &object)?.has(b'g'),
    };
    if !is_acceptable {
        return Err(cx.throw_type_error(message));
    }
    Ok(())
}

#[native_abi]
pub(crate) fn string_match(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "String.prototype.match requires that |this| not be null or undefined";
    let this = frame.this_value().require_object_coercible(cx, message)?;
    let argument = frame.argument(0);
    defer(
        cx,
        this,
        argument,
        symbols::r#match,
        match_in,
        without_flags,
    )
}

#[native_abi]
pub(crate) fn string_match_all(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "String.prototype.matchAll requires |this| not to be null nor undefined";
    let this = frame.this_value().require_object_coercible(cx, message)?;
    let argument = frame.argument(0);
    if let Some(object) = argument.as_object() {
        let message =
            "String.prototype.matchAll argument must not be a non-global regular expression";
        require_global(cx, object, message)?;
    }
    defer(cx, this, argument, symbols::matchAll, match_all_in, global)
}

#[native_abi]
pub(crate) fn string_search(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "String.prototype.search requires that |this| not be null or undefined";
    let this = frame.this_value().require_object_coercible(cx, message)?;
    let argument = frame.argument(0);
    defer(
        cx,
        this,
        argument,
        symbols::search,
        search_in,
        without_flags,
    )
}

fn call_if_present(
    cx: &mut Cx,
    object: Gc<JsObject>,
    name: PropertyName<'_>,
    message: &'static str,
    arguments: [Value; 2],
) -> JsResult<Option<Value>> {
    match object.as_value().get_method(cx, name, message)? {
        Some(method) => cx.call(method, object.into(), &arguments).map(Some),
        None => Ok(None),
    }
}

/// `None` if `search` has no method for it.
#[inline]
pub(crate) fn delegate_replace(
    cx: &mut Cx,
    this: Value,
    search: Gc<JsObject>,
    replacement: Value,
) -> JsResult<Option<Value>> {
    if pristine(cx, search).is_some() {
        let string = this.to_string(cx)?;
        return replace_in(cx, search, string, replacement, MatchOnRecord::Current).map(Some);
    }
    let message = "@@replace method is not callable";
    call_if_present(cx, search, symbols::replace, message, [this, replacement])
}

#[inline]
pub(crate) fn delegate_replace_all(
    cx: &mut Cx,
    this: Value,
    search: Gc<JsObject>,
    replacement: Value,
) -> JsResult<Option<Value>> {
    let message =
        "String.prototype.replaceAll argument must not be a non-global regular expression";
    require_global(cx, search, message)?;
    delegate_replace(cx, this, search, replacement)
}

#[inline]
pub(crate) fn delegate_split(
    cx: &mut Cx,
    this: Value,
    separator: Gc<JsObject>,
    limit: Value,
) -> JsResult<Option<Value>> {
    if pristine(cx, separator).is_some() {
        let string = this.to_string(cx)?;
        return split_by(cx, separator, string, limit).map(Some);
    }
    let message = "@@split method is not callable";
    call_if_present(cx, separator, symbols::split, message, [this, limit])
}
