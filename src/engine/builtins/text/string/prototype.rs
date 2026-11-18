use bun_engine_text::{PropertyName, StringRef, private_names};
use bun_engine_vm::direct::{self, End, LastStart, Start};
use bun_engine_vm::errors::TYPE_ERROR;
use bun_engine_vm::{
    JsFunction, NativeFunction, PadSide, RealmSlot, RopeBuilder, StringObject, TrimSides, TypeFlags,
};

use super::{html, locale, pattern, this_string};
use crate::prelude::*;
use crate::text::regexp::string_methods::{string_match, string_match_all, string_search};

const fn intrinsic(
    name: PropertyName<'static>,
    function: NativeFunction,
    length: u32,
    intrinsic: Intrinsic,
) -> StaticProperty {
    StaticProperty::function(name, function, length).with_intrinsic(intrinsic)
}

static_table!(static PROPERTIES = [
    StaticProperty::function(names::anchor, html::anchor, 1),
    StaticProperty::function(names::big, html::big, 0),
    StaticProperty::function(names::bold, html::bold, 0),
    StaticProperty::function(names::blink, html::blink, 0),
    StaticProperty::function(names::fixed, html::fixed, 0),
    StaticProperty::function(names::fontcolor, html::fontcolor, 1),
    StaticProperty::function(names::fontsize, html::fontsize, 1),
    StaticProperty::function(names::italics, html::italics, 0),
    StaticProperty::function(names::link, html::link, 1),
    StaticProperty::function(names::small, html::small, 0),
    StaticProperty::function(names::strike, html::strike, 0),
    StaticProperty::function(names::sub, html::sub, 0),
    StaticProperty::function(names::sup, html::sup, 0),
    intrinsic(names::toString, value_of, 0, Intrinsic::StringPrototypeValueOf),
    intrinsic(names::valueOf, value_of, 0, Intrinsic::StringPrototypeValueOf),
    intrinsic(names::charAt, char_at, 1, Intrinsic::CharAt),
    intrinsic(names::charCodeAt, char_code_at, 1, Intrinsic::CharCodeAt),
    intrinsic(names::codePointAt, code_point_at, 1, Intrinsic::StringPrototypeCodePointAt),
    intrinsic(names::concat, concat, 1, Intrinsic::StringPrototypeConcat),
    intrinsic(names::indexOf, index_of, 1, Intrinsic::StringPrototypeIndexOf),
    intrinsic(names::lastIndexOf, last_index_of, 1, Intrinsic::StringPrototypeLastIndexOf),
    intrinsic(names::replace, pattern::replace, 2, Intrinsic::StringPrototypeReplace),
    intrinsic(names::replaceAll, pattern::replace_all, 2, Intrinsic::StringPrototypeReplaceAll),
    intrinsic(names::repeat, repeat, 1, Intrinsic::StringPrototypeRepeat),
    intrinsic(names::padStart, pad_start, 1, Intrinsic::StringPrototypePadStart),
    intrinsic(names::padEnd, pad_end, 1, Intrinsic::StringPrototypePadEnd),
    intrinsic(names::slice, slice, 2, Intrinsic::StringPrototypeSlice),
    intrinsic(names::substr, substr, 2, Intrinsic::StringPrototypeSubstr),
    intrinsic(names::at, at, 1, Intrinsic::StringPrototypeAt),
    intrinsic(names::substring, substring, 2, Intrinsic::StringPrototypeSubstring),
    intrinsic(names::toLowerCase, to_lower_case, 0, Intrinsic::StringPrototypeToLowerCase),
    intrinsic(names::toUpperCase, to_upper_case, 0, Intrinsic::StringPrototypeToUpperCase),
    intrinsic(
        names::localeCompare, locale::locale_compare, 1, Intrinsic::StringPrototypeLocaleCompare
    ),
    StaticProperty::function(names::toLocaleLowerCase, locale::to_locale_lower_case, 0),
    StaticProperty::function(names::toLocaleUpperCase, locale::to_locale_upper_case, 0),
    intrinsic(names::trim, trim, 0, Intrinsic::StringPrototypeTrim),
    intrinsic(names::startsWith, starts_with, 1, Intrinsic::StringPrototypeStartsWith),
    intrinsic(names::endsWith, ends_with, 1, Intrinsic::StringPrototypeEndsWith),
    intrinsic(names::includes, includes, 1, Intrinsic::StringPrototypeIncludes),
    intrinsic(names::r#match, string_match, 1, Intrinsic::StringPrototypeMatch),
    intrinsic(names::search, string_search, 1, Intrinsic::StringPrototypeSearch),
    intrinsic(names::matchAll, string_match_all, 1, Intrinsic::StringPrototypeMatchAll),
    intrinsic(names::split, pattern::split, 2, Intrinsic::StringPrototypeSplit),
    StaticProperty::function(names::normalize, locale::normalize, 0),
    StaticProperty::realm_slot(names::trimStart, RealmSlot::string_prototype_trim_start),
    StaticProperty::realm_slot(names::trimLeft, RealmSlot::string_prototype_trim_start),
    StaticProperty::realm_slot(names::trimEnd, RealmSlot::string_prototype_trim_end),
    StaticProperty::realm_slot(names::trimRight, RealmSlot::string_prototype_trim_end),
    intrinsic(names::isWellFormed, is_well_formed, 0, Intrinsic::StringPrototypeIsWellFormed),
    intrinsic(names::toWellFormed, to_well_formed, 0, Intrinsic::StringPrototypeToWellFormed),
    StaticProperty::realm_slot(names::constructor, RealmSlot::string_constructor),
    StaticProperty::realm_slot(symbols::iterator, RealmSlot::string_prototype_iterator),
    intrinsic(private_names::charCodeAt, char_code_at, 1, Intrinsic::CharCodeAt),
    intrinsic(private_names::substr, substr, 2, Intrinsic::StringPrototypeSubstr),
    intrinsic(private_names::endsWith, ends_with, 2, Intrinsic::StringPrototypeEndsWith),
]);

/// Its string is empty, so it has no elements of that kind.
#[cell(name = "String", shared_type = DerivedStringObject, static_table = PROPERTIES,
    cleared_flags = TypeFlags::INTERCEPTS_INDEXED_ACCESS)]
struct StringPrototype {
    base: StringObject,
}

pub(crate) fn initialize_prototype(cx: &Cx) {
    let (global, parent) = (cx.global(), cx.object_prototype().into());
    let spec = ShapeSpec::of::<StringPrototype>();
    let shape = Shape::create(cx, Some(global), parent, spec);
    let base = StringObject::init(cx, shape, cx.small_strings.empty());
    let prototype = cx.allocate::<StringPrototype>(StringPrototypeInit { base });
    global.init_string_prototype(prototype.upcast());
}

pub(super) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    let make = |name, function, intrinsic| {
        JsFunction::native_with_intrinsic(
            cx,
            0,
            &StringRef::from_literal(name),
            function,
            intrinsic,
        )
    };
    let global = cx.global();
    match slot {
        RealmSlot::string_prototype_trim_start => {
            let intrinsic = Intrinsic::StringPrototypeTrimStart;
            global.init_string_prototype_trim_start(make("trimStart", trim_start, intrinsic));
        }
        RealmSlot::string_prototype_trim_end => {
            let intrinsic = Intrinsic::StringPrototypeTrimEnd;
            global.init_string_prototype_trim_end(make("trimEnd", trim_end, intrinsic));
        }
        _ => return false,
    }
    true
}

#[native_abi]
fn value_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = frame.this_value();
    if this.is_string() {
        return Ok(this);
    }
    match this.downcast::<StringObject>() {
        Some(object) => Ok(object.internal_value()),
        None => Err(cx.throw_type_error(TYPE_ERROR)),
    }
}

#[native_abi]
fn char_at(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    let position = Start::convert(cx, frame.argument(0))?;
    direct::string::char_at(cx, string, position).map(Into::into)
}

#[native_abi]
fn char_code_at(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    let position = Start::convert(cx, frame.argument(0))?;
    direct::string::char_code_at(cx, string, position).map(Into::into)
}

#[native_abi]
fn code_point_at(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    let position = Start::convert(cx, frame.argument(0))?;
    direct::string::code_point_at(cx, string, position).map(Into::into)
}

#[native_abi]
fn at(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    let position = Start::convert(cx, frame.argument(0))?;
    Ok(string.at(cx, position.0)?.map_or_default(Into::into))
}

#[native_abi]
fn concat(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "String.prototype.concat requires that |this| not be null or undefined";
    let string = this_string(cx, frame, message)?;
    let mut builder = RopeBuilder::default();
    builder.push(cx, string)?;
    for argument in frame.arguments() {
        let argument = argument.to_string(cx)?;
        builder.push(cx, argument)?;
    }
    Ok(builder.finish(cx).into())
}

#[native_abi]
fn index_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    let search = frame.argument(0).to_string(cx)?;
    let start = Start::convert(cx, frame.argument(1))?;
    direct::search::index_of(cx, string, search, start).map(Into::into)
}

#[native_abi]
fn last_index_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    let search = frame.argument(0).to_string(cx)?;
    let start = LastStart::convert(cx, frame.argument(1))?;
    direct::search::last_index_of(cx, string, search, start).map(Into::into)
}

#[inline(always)]
fn search_argument(
    cx: &mut Cx,
    frame: &CallFrame,
    message: &'static str,
) -> JsResult<Gc<JsString>> {
    let search = frame.argument(0);
    if let Some(string) = search.as_string() {
        return Ok(string);
    }
    if search.is_regexp(cx)? {
        return Err(cx.throw_type_error(message));
    }
    search.to_string(cx)
}

#[native_abi]
fn includes(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    let message = "Argument to String.prototype.includes cannot be a RegExp";
    let search = search_argument(cx, frame, message)?;
    let start = Start::convert(cx, frame.argument(1))?;
    direct::search::includes(cx, string, search, start).map(Into::into)
}

#[native_abi]
fn starts_with(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    let message = "Argument to String.prototype.startsWith cannot be a RegExp";
    let search = search_argument(cx, frame, message)?;
    let start = Start::convert(cx, frame.argument(1))?;
    direct::search::starts_with(cx, string, search, start).map(Into::into)
}

#[native_abi]
fn ends_with(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    let message = "Argument to String.prototype.endsWith cannot be a RegExp";
    let search = search_argument(cx, frame, message)?;
    let end = End::convert(cx, frame.argument(1))?;
    direct::search::ends_with(cx, string, search, end).map(Into::into)
}

#[native_abi]
fn slice(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    let start = Start::convert(cx, frame.argument(0))?;
    let end = End::convert(cx, frame.argument(1))?;
    string.slice(cx, start.0, end.0).map(Into::into)
}

#[native_abi]
fn substring(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    let start = Start::convert(cx, frame.argument(0))?;
    let end = End::convert(cx, frame.argument(1))?;
    string.substring_between(cx, start.0, end.0).map(Into::into)
}

#[native_abi]
fn substr(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    let start = Start::convert(cx, frame.argument(0))?;
    let length = End::convert(cx, frame.argument(1))?;
    string.substr(cx, start.0, length.0).map(Into::into)
}

#[native_abi]
fn repeat(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "String.prototype.repeat requires that |this| not be null or undefined";
    let string = this_string(cx, frame, message)?;
    if let Some(count) = frame.argument(0).as_index_int32() {
        return string.repeat(cx, count.into()).map(Into::into);
    }
    let count = frame.argument(0).to_integer_or_infinity(cx)?;
    if count < 0.0 || count.is_infinite() {
        return Err(cx.throw_range_error(
            "String.prototype.repeat argument must be greater than or equal to 0 and not be Infinity",
        ));
    }
    string.repeat(cx, count as u64).map(Into::into)
}

#[inline(always)]
fn pad(cx: &mut Cx, frame: &CallFrame, side: PadSide, message: &'static str) -> JsResult<Value> {
    let string = this_string(cx, frame, message)?;
    let length = frame.argument(0).to_length(cx)?;
    if length <= string.len().into() {
        return Ok(string.into());
    }
    let filler = match frame.argument(1) {
        Value::UNDEFINED => cx.small_strings.single_character(b' '),
        filler => filler.to_string(cx)?,
    };
    string.pad(cx, side, length, &filler).map(Into::into)
}

#[native_abi]
fn pad_start(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "String.prototype.padStart requires that |this| not be null or undefined";
    pad(cx, frame, PadSide::Start, message)
}

#[native_abi]
fn pad_end(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "String.prototype.padEnd requires that |this| not be null or undefined";
    pad(cx, frame, PadSide::End, message)
}

macro_rules! methods_without_arguments {
    ($($name:ident => $method:ident($($argument:expr)?);)*) => {$(
        #[native_abi]
        fn $name(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
            let string = this_string(cx, frame, TYPE_ERROR)?;
            string.$method(cx, $($argument)?).map(Into::into)
        }
    )*};
}

methods_without_arguments! {
    to_lower_case => to_lower_case();
    to_upper_case => to_upper_case();
    trim => trim(TrimSides::Both);
    trim_start => trim(TrimSides::Start);
    trim_end => trim(TrimSides::End);
    is_well_formed => is_well_formed();
    to_well_formed => to_well_formed();
}
