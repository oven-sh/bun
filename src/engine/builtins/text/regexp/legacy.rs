//! The properties of the constructor that tell of the last match.

use bun_engine_text::PropertyName;
use bun_engine_vm::{Attributes, CustomGetter, CustomSetter};

use crate::prelude::*;

const ACCESSOR: Attributes = Attributes::CUSTOM_ACCESSOR.union(Attributes::DONT_ENUM);

pub(super) const fn getter(name: PropertyName<'static>, getter: CustomGetter) -> StaticProperty {
    StaticProperty::custom(name, ACCESSOR.union(Attributes::READ_ONLY), getter, None)
}

pub(super) const fn accessor(
    name: PropertyName<'static>,
    getter: CustomGetter,
    setter: CustomSetter,
) -> StaticProperty {
    StaticProperty::custom(name, ACCESSOR, getter, Some(setter))
}

fn check_this(cx: &Cx, this: Value, message: &'static str) -> JsResult<()> {
    if this != cx.regexp_constructor().into() {
        return Err(cx.throw_type_error(message));
    }
    Ok(())
}

macro_rules! getters {
    ($($function:ident, $subject:literal, |$cx:ident, $name:pat_param| $value:expr;)*) => {$(
        #[native_abi]
        pub(super) fn $function($cx: &mut Cx, this: Value, $name: PropertyName<'_>) -> JsResult<Value> {
            check_this($cx, this, concat!("RegExp.", $subject, " RegExp constructor as |this|"))?;
            Ok($value.into())
        }
    )*};
}

getters! {
    input, "input getter requires", |cx, _| cx.regexp_input();
    multiline, "multiline getter require", |cx, _| cx.global().is_regexp_multiline().get();
    last_match, "lastMatch getter require", |cx, _| cx.regexp_last_match()?;
    last_paren, "lastParen getter require", |cx, _| cx.regexp_last_paren()?;
    left_context, "leftContext getter require", |cx, _| cx.regexp_left_context()?;
    right_context, "rightContext getter require", |cx, _| cx.regexp_right_context()?;
    group, "$N getters require",
        |cx, name| cx.regexp_last_group(usize::from(name.text().at(1) - u16::from(b'0')))?;
}

#[native_abi]
pub(super) fn set_input(cx: &mut Cx, this: Value, value: Value, _: PropertyName<'_>) -> bool {
    let message = "RegExp.input setters require RegExp constructor as |this|";
    let input = check_this(cx, this, message).and_then(|()| value.to_string(cx));
    input.map(|it| cx.global().set_regexp_input(it)).is_ok()
}

#[native_abi]
pub(super) fn set_multiline(cx: &mut Cx, this: Value, value: Value, _: PropertyName<'_>) -> bool {
    let message = "RegExp.multiline setters require RegExp constructor as |this|";
    let is_allowed = check_this(cx, this, message).is_ok();
    if is_allowed {
        cx.global().is_regexp_multiline().set(value.to_boolean(cx));
    }
    is_allowed
}
