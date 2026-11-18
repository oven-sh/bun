use bun_engine_regexp::Flags;
use bun_engine_text::PropertyName;
use bun_engine_vm::{RegExpObject, direct};

use super::this_object;
use crate::prelude::*;

/// In the order of the bits of `Flags`.
pub(super) const FLAG_NAMES: [PropertyName<'static>; 8] = [
    names::hasIndices,
    names::global,
    names::ignoreCase,
    names::multiline,
    names::dotAll,
    names::unicode,
    names::unicodeSets,
    names::sticky,
];

/// `None` for the prototype.
#[inline(always)]
fn this_regexp(
    cx: &Cx,
    frame: &CallFrame,
    message: &'static str,
) -> JsResult<Option<Gc<RegExpObject>>> {
    let this = frame.this_value();
    match this.downcast() {
        None if this != cx.regexp_prototype().into() => Err(cx.throw_type_error(message)),
        regexp => Ok(regexp),
    }
}

macro_rules! message {
    ($name:literal) => {
        concat!(
            "The RegExp.prototype.",
            $name,
            " getter can only be called on a RegExp object"
        )
    };
}

macro_rules! flag_getters {
    ($($function:ident, $name:literal, $read:ident;)*) => {$(
        #[native_abi]
        pub(super) fn $function(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
            let this = this_regexp(cx, frame, message!($name))?;
            Ok(this.map_or_default(|it| direct::regexp::$read(it).into()))
        }
    )*};
}

flag_getters! {
    has_indices, "hasIndices", flag_has_indices;
    global, "global", flag_global;
    ignore_case, "ignoreCase", flag_ignore_case;
    multiline, "multiline", flag_multiline;
    dot_all, "dotAll", flag_dot_all;
    unicode, "unicode", flag_unicode;
    unicode_sets, "unicodeSets", flag_unicode_sets;
    sticky, "sticky", flag_sticky;
}

#[native_abi]
pub(super) fn source(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(match this_regexp(cx, frame, message!("source"))? {
        Some(this) => this.regexp().source(cx)?.into(),
        None => JsString::from_literal(cx, "(?:)").into(),
    })
}

#[native_abi]
pub(super) fn flags(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "The RegExp.prototype.flags getter can only be called on an object";
    let this = this_object(cx, frame, message)?;
    let mut flags = Flags::empty();
    match this.downcast::<RegExpObject>() {
        Some(this) if this.inherits_pristine(cx.in_realm_of(&this), &FLAG_NAMES) => {
            flags = this.regexp().flags();
        }
        _ => {
            for (name, flag) in FLAG_NAMES.into_iter().zip(Flags::all()) {
                flags.set(flag, this.get(cx, name)?.to_boolean(cx));
            }
        }
    }
    Ok(direct::regexp::letters_of(cx, flags).into())
}
