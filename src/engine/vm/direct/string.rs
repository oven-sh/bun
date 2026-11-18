use bun_engine_macros::direct_form;
use bun_engine_text::StringImpl;
use bun_engine_unicode::MAX_CODE_POINT;

use super::operand::{CodePoint, Count, End, Limit, Literal, Primitive, Start, ToInt32, Undefined};
use super::outcome::{Flat, FlatOrFirst, IteratorResult, OrNan, OrUndefined, Ranged, Same};
use crate::{
    Cx, Gc, JsArray, JsResult, JsString, JsStringIterator, PadSide, ReplaceMode, StringObject,
    TrimSides, Vm,
};

type Unit = OrNan<Ranged<0, 0xffff>>;
type Character = OrUndefined<Ranged<0, { MAX_CODE_POINT as i32 }>>;

#[direct_form(pure)]
fn char_code_at_in_characters(this: &StringImpl, position: Start) -> Unit {
    this.text().get(position.0 as u32 as usize).into()
}

#[direct_form(pure, only_lacks_room)]
pub fn char_code_at(cx: &Cx, this: Gc<JsString>, position: Start) -> JsResult<Unit> {
    this.get_unit(cx, position.0).map(Into::into)
}

#[direct_form(pure)]
fn code_point_at_in_characters(this: &StringImpl, position: Start) -> Character {
    let index = Some(position.0 as u32 as usize).filter(|&index| index < this.len());
    (index.map(|index| Ranged::new(this.text().code_point_at(index) as i32))).into()
}

#[direct_form(pure, only_lacks_room)]
pub fn code_point_at(cx: &Cx, this: Gc<JsString>, position: Start) -> JsResult<Character> {
    Ok(code_point_at_in_characters(&*this.resolve(cx)?, position))
}

#[direct_form(pure, only_lacks_room)]
pub fn char_at(cx: &Cx, this: Gc<JsString>, position: Start) -> JsResult<Flat> {
    Ok(Flat::made_by(match this.get_unit(cx, position.0)? {
        Some(unit) => JsString::from_unit(cx, unit),
        None => cx.small_strings.empty(),
    }))
}

#[direct_form(pure, only_lacks_room)]
fn at(cx: &Cx, this: Gc<JsString>, position: Start) -> JsResult<OrUndefined<Flat>> {
    Ok(this.at(cx, position.0)?.map(Flat::made_by).into())
}

#[direct_form(pure)]
pub fn from_char_code(vm: &Vm, code: ToInt32) -> Flat {
    Flat::made_by(JsString::from_unit(vm, code.0 as u16))
}

#[direct_form(pure)]
fn from_code_point(vm: &Vm, code_point: CodePoint) -> Flat {
    Flat::made_by(JsString::from_code_point(vm, code_point.0 as u32))
}

#[direct_form(pure, only_lacks_room)]
fn slice(cx: &Cx, this: Gc<JsString>, start: Start, end: End) -> JsResult<Gc<JsString>> {
    this.slice(cx, start.0, end.0)
}

#[direct_form(pure, only_lacks_room)]
fn substring(cx: &Cx, this: Gc<JsString>, start: Start, end: End) -> JsResult<Gc<JsString>> {
    this.substring_between(cx, start.0, end.0)
}

#[direct_form(pure, only_lacks_room)]
fn substr(cx: &Cx, this: Gc<JsString>, start: Start, length: End) -> JsResult<Gc<JsString>> {
    this.substr(cx, start.0, length.0)
}

#[direct_form(pure, only_lacks_room)]
fn trim(cx: &Cx, this: Gc<JsString>) -> JsResult<Gc<JsString>> {
    this.trim(cx, TrimSides::Both)
}

#[direct_form(pure, only_lacks_room)]
fn trim_start(cx: &Cx, this: Gc<JsString>) -> JsResult<Gc<JsString>> {
    this.trim(cx, TrimSides::Start)
}

#[direct_form(pure, only_lacks_room)]
fn trim_end(cx: &Cx, this: Gc<JsString>) -> JsResult<Gc<JsString>> {
    this.trim(cx, TrimSides::End)
}

#[direct_form(pure, only_lacks_room)]
fn to_lower_case(cx: &Cx, this: Gc<JsString>) -> JsResult<FlatOrFirst> {
    Ok(FlatOrFirst::new(this.to_lower_case(cx)?, this))
}

#[direct_form(pure, only_lacks_room)]
fn to_upper_case(cx: &Cx, this: Gc<JsString>) -> JsResult<FlatOrFirst> {
    Ok(FlatOrFirst::new(this.to_upper_case(cx)?, this))
}

#[direct_form(pure)]
fn is_well_formed_in_characters(this: &StringImpl) -> bool {
    this.text().is_well_formed()
}

#[direct_form(pure, only_lacks_room)]
fn is_well_formed(cx: &Cx, this: Gc<JsString>) -> JsResult<bool> {
    this.is_well_formed(cx)
}

#[direct_form(pure, only_lacks_room)]
fn to_well_formed(cx: &Cx, this: Gc<JsString>) -> JsResult<FlatOrFirst> {
    Ok(FlatOrFirst::new(this.to_well_formed(cx)?, this))
}

#[direct_form(pure)]
fn repeat(cx: &Cx, this: Gc<JsString>, count: Count) -> JsResult<Gc<JsString>> {
    this.repeat(cx, count.0 as u64)
}

macro_rules! padding {
    ($($with_spaces:ident, $with_filler:ident = $side:ident;)*) => {$(
        #[direct_form(pure)]
        fn $with_spaces(
            cx: &Cx,
            this: Gc<JsString>,
            length: i32,
            _: Undefined,
        ) -> JsResult<Gc<JsString>> {
            $with_filler(cx, this, length, cx.small_strings.single_character(b' '))
        }

        #[direct_form(pure)]
        fn $with_filler(
            cx: &Cx,
            this: Gc<JsString>,
            length: i32,
            filler: Gc<JsString>,
        ) -> JsResult<Gc<JsString>> {
            this.pad(cx, PadSide::$side, length.max(0) as u64, &filler)
        }
    )*};
}

padding! {
    pad_start_with_spaces, pad_start = Start;
    pad_end_with_spaces, pad_end = End;
}

#[direct_form(reads(LOCALE), makes(intl_state))]
fn locale_compare(
    cx: &Cx,
    this: Gc<JsString>,
    that: Gc<JsString>,
    _: Undefined,
    _: Undefined,
) -> JsResult<Ranged<-1, 1>> {
    (cx.hooks().compare_in_locale)(cx, this, that, None).map(Into::into)
}

#[direct_form(reads(LOCALE), makes(intl_state))]
fn locale_compare_in(
    cx: &Cx,
    this: Gc<JsString>,
    that: Gc<JsString>,
    locale: Gc<JsString>,
    _: Undefined,
) -> JsResult<Ranged<-1, 1>> {
    (cx.hooks().compare_in_locale)(cx, this, that, Some(locale)).map(Into::into)
}

#[direct_form(pure, only_lacks_room)]
fn replace_string_literally(
    cx: &Cx,
    this: Gc<JsString>,
    search: Gc<JsString>,
    replacement: Literal,
) -> JsResult<Gc<JsString>> {
    this.replace_first_literally(cx, &search, replacement.0)
}

#[direct_form(pure, only_lacks_room)]
fn replace_all_strings_literally(
    cx: &Cx,
    this: Gc<JsString>,
    search: Gc<JsString>,
    replacement: Literal,
) -> JsResult<FlatOrFirst> {
    let result = this.replace_all_literally(cx, &search, &replacement.0)?;
    Ok(FlatOrFirst::new(result, this))
}

#[direct_form(pure, only_lacks_room)]
fn replace_string_by_template(
    cx: &Cx,
    this: Gc<JsString>,
    search: Gc<JsString>,
    template: Gc<JsString>,
) -> JsResult<Gc<JsString>> {
    this.replace_by_template(cx, ReplaceMode::First, &search, template)
}

#[direct_form(pure, only_lacks_room)]
fn replace_all_strings_by_template(
    cx: &Cx,
    this: Gc<JsString>,
    search: Gc<JsString>,
    template: Gc<JsString>,
) -> JsResult<Gc<JsString>> {
    this.replace_by_template(cx, ReplaceMode::All, &search, template)
}

#[direct_form]
fn this_string(_this: Gc<JsString>) -> Same<0>;

#[direct_form(pure)]
fn this_string_object(this: Gc<StringObject>) -> Gc<JsString> {
    this.string()
}

#[direct_form(pure, only_lacks_room)]
fn concat(cx: &Cx, this: Gc<JsString>, other: Gc<JsString>) -> JsResult<Gc<JsString>> {
    JsString::concat(cx, this, other)
}

#[direct_form(pure, only_lacks_room)]
fn concat_primitive(cx: &Cx, this: Gc<JsString>, other: Primitive) -> JsResult<Gc<JsString>> {
    JsString::add(cx, this.into(), other.0)
}

#[direct_form(pure, only_lacks_room)]
fn concat_two(
    cx: &Cx,
    this: Gc<JsString>,
    second: Gc<JsString>,
    third: Gc<JsString>,
) -> JsResult<Gc<JsString>> {
    JsString::concat3(cx, this, second, third)
}

#[direct_form(pure, only_lacks_room, gives_new)]
fn split(
    cx: &Cx,
    this: Gc<JsString>,
    separator: Gc<JsString>,
    limit: Limit,
) -> JsResult<Gc<JsArray>> {
    this.split(cx, &separator, limit.0 as u32)
}

#[direct_form(pure, makes(string_iterator_shape), gives_new)]
fn string_iterator(cx: &Cx, this: Gc<JsString>) -> Gc<JsStringIterator> {
    JsStringIterator::create(cx, this)
}

#[direct_form(
    writes(ITERATOR),
    only_lacks_room,
    makes(iterator_result_shape),
    gives_new
)]
pub fn string_iterator_next(cx: &Cx, this: Gc<JsStringIterator>) -> JsResult<IteratorResult> {
    Ok(IteratorResult::new(cx, this.next(cx)?))
}
