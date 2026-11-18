use bun_engine_vm::direct::regexp::{pattern_from, pattern_like};
use bun_engine_vm::{Attributes, GlobalObject, RegExp, RegExpObject};

use super::legacy;
use crate::define::species_getter;
use crate::prelude::*;

static_table!(static PROPERTIES = [
    legacy::accessor(names::input, legacy::input, legacy::set_input),
    legacy::accessor(names::dollarUnderscore, legacy::input, legacy::set_input),
    legacy::accessor(names::multiline, legacy::multiline, legacy::set_multiline),
    legacy::accessor(names::dollarStar, legacy::multiline, legacy::set_multiline),
    legacy::getter(names::lastMatch, legacy::last_match),
    legacy::getter(names::dollarAmpersand, legacy::last_match),
    legacy::getter(names::lastParen, legacy::last_paren),
    legacy::getter(names::dollarPlus, legacy::last_paren),
    legacy::getter(names::leftContext, legacy::left_context),
    legacy::getter(names::dollarBacktick, legacy::left_context),
    legacy::getter(names::rightContext, legacy::right_context),
    legacy::getter(names::dollarApostrophe, legacy::right_context),
    legacy::getter(names::dollar1, legacy::group),
    legacy::getter(names::dollar2, legacy::group),
    legacy::getter(names::dollar3, legacy::group),
    legacy::getter(names::dollar4, legacy::group),
    legacy::getter(names::dollar5, legacy::group),
    legacy::getter(names::dollar6, legacy::group),
    legacy::getter(names::dollar7, legacy::group),
    legacy::getter(names::dollar8, legacy::group),
    legacy::getter(names::dollar9, legacy::group),
    StaticProperty::getter(symbols::species, species_getter)
        .with_intrinsic(Intrinsic::SpeciesGetter),
]);

define_constructor!(RegExpConstructor, PROPERTIES, call, construct);

pub(super) fn initialize(cx: &Cx) {
    let (parent, prototype) = (cx.function_prototype(), cx.regexp_prototype());
    let constructor = RegExpConstructor::create(cx, parent, 2, names::RegExp, &prototype);
    let (intrinsic, attributes) = (Intrinsic::None, Attributes::DONT_ENUM);
    constructor.put_direct_native_function(cx, names::escape, 1, escape, intrinsic, attributes);
    cx.global().init_regexp_constructor(constructor);
}

pub(super) fn to_pattern(cx: &mut Cx, pattern: Value) -> JsResult<Gc<JsString>> {
    if pattern.is_undefined() {
        return Ok(cx.small_strings.empty());
    }
    pattern.to_string(cx)
}

/// What RegExpInitialize gives an object.
pub(super) fn to_regexp(cx: &mut Cx, pattern: Value, flags: Value) -> JsResult<Gc<RegExp>> {
    let pattern = to_pattern(cx, pattern)?;
    let flags = match flags {
        Value::UNDEFINED => None,
        flags => Some(flags.to_string(cx)?),
    };
    pattern_from(cx, pattern, flags)
}

fn create(
    cx: &mut Cx,
    frame: &CallFrame,
    is_regexp: bool,
    new_target: Value,
) -> JsResult<Gc<RegExpObject>> {
    let (mut pattern, mut flags) = (frame.argument(0), frame.argument(1));
    let original = pattern.downcast::<RegExpObject>().map(|it| it.regexp());
    if original.is_none() && is_regexp {
        let source = pattern.get(cx, names::source)?;
        if flags.is_undefined() {
            flags = pattern.get(cx, names::flags)?;
        }
        pattern = source;
    }
    let callee = frame.callee();
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::regexp_shape)?;
    let regexp = match original {
        Some(original) if flags.is_undefined() => original,
        Some(original) => {
            let flags = flags.to_string(cx)?;
            pattern_like(cx, original, flags)?
        }
        None => to_regexp(cx, pattern, flags)?,
    };
    Ok(match new_target == callee.into() {
        true => RegExpObject::create(cx, regexp),
        false => RegExpObject::create_derived(cx, shape, regexp),
    })
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (pattern, callee) = (frame.argument(0), frame.callee().into());
    let is_regexp = pattern.is_regexp(cx)?;
    if is_regexp
        && frame.argument(1).is_undefined()
        && pattern.get(cx, names::constructor)? == callee
    {
        return Ok(pattern);
    }
    create(cx, frame, is_regexp, callee).map(Into::into)
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let is_regexp = frame.argument(0).is_regexp(cx)?;
    create(cx, frame, is_regexp, frame.new_target()).map(Into::into)
}

#[native_abi]
fn escape(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(string) = frame.argument(0).as_string() else {
        return Err(cx.throw_type_error("RegExp.escape requires a string"));
    };
    let escaped = bun_engine_regexp::escape(string.view(cx)?.text());
    Ok(JsString::new(cx, cx.or_out_of_memory(escaped)?).into())
}
