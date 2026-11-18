//! `RegExp` and its prototype.

use bun_engine_macros::direct_form;
use bun_engine_regexp::Flags;

use super::operand::{AnyPattern, GlobalPattern, Limit, Original, PatternSearchingOnce, Undefined};
use super::outcome::{Flat, Found, IteratorResult, OrNull};
use crate::{
    Cx, Gc, JsArray, JsResult, JsString, PlainMatchIterator, PlainRegExp, RegExp, RegExpObject, Vm,
};

pub(super) type Matches = JsResult<OrNull<Gc<JsArray>>>;

#[direct_form(
    writes(LAST_MATCH, TRANSITIONS),
    makes(
        regexp_match_array_shape,
        regexp_match_array_with_indices_shape,
        regexp_indices_array_shape
    ),
    gives_new
)]
fn exec_pattern(cx: &Cx, this: PatternSearchingOnce, string: Gc<JsString>) -> Matches {
    this.0.exec_once(cx, string).map(Into::into)
}

#[direct_form(
    reads(PATTERN),
    writes(LAST_INDEX, LAST_MATCH, TRANSITIONS),
    makes(
        regexp_match_array_shape,
        regexp_match_array_with_indices_shape,
        regexp_indices_array_shape
    ),
    gives_new
)]
fn exec_plain(cx: &Cx, this: PlainRegExp<'_>, string: Gc<JsString>) -> Matches {
    this.exec(cx, string).map(Into::into)
}

#[direct_form(writes(LAST_MATCH), needs(RegExpPrimordialProperties))]
fn test_pattern(cx: &Cx, this: PatternSearchingOnce, string: Gc<JsString>) -> JsResult<bool> {
    Ok(this.0.find_and_record(cx, string, 0)?.is_some())
}

#[direct_form(
    reads(PATTERN),
    writes(LAST_INDEX, LAST_MATCH),
    needs(RegExpPrimordialProperties)
)]
fn test_plain(cx: &Cx, this: PlainRegExp<'_>, string: Gc<JsString>) -> JsResult<bool> {
    this.test(cx, string)
}

#[direct_form(
    writes(LAST_MATCH, TRANSITIONS),
    needs(RegExpPrimordialProperties),
    makes(
        regexp_match_array_shape,
        regexp_match_array_with_indices_shape,
        regexp_indices_array_shape
    ),
    gives_new
)]
pub(super) fn symbol_match_once(
    cx: &Cx,
    this: PatternSearchingOnce,
    string: Gc<JsString>,
) -> Matches {
    exec_pattern(cx, this, string)
}

#[direct_form(writes(LAST_MATCH), needs(RegExpPrimordialProperties), gives_new)]
pub(super) fn symbol_match_every(cx: &Cx, this: GlobalPattern, string: Gc<JsString>) -> Matches {
    this.0.match_all(cx, string).map(Into::into)
}

#[direct_form(
    reads(PATTERN),
    writes(LAST_INDEX, LAST_MATCH, TRANSITIONS),
    needs(RegExpPrimordialProperties),
    makes(
        regexp_match_array_shape,
        regexp_match_array_with_indices_shape,
        regexp_indices_array_shape
    ),
    gives_new
)]
pub(super) fn symbol_match_plain(cx: &Cx, this: PlainRegExp<'_>, string: Gc<JsString>) -> Matches {
    this.unchanged_if_it_throws(|| this.matches(cx, string).map(Into::into))
}

#[direct_form(writes(LAST_MATCH), needs(RegExpPrimordialProperties))]
pub(super) fn symbol_search(cx: &Cx, this: AnyPattern, string: Gc<JsString>) -> JsResult<Found> {
    this.0.search(cx, string).map(Found::new)
}

#[direct_form(
    writes(LAST_MATCH),
    needs(RegExpPrimordialProperties, RegExpSpecies),
    gives_new
)]
pub(super) fn symbol_split(
    cx: &Cx,
    this: AnyPattern,
    string: Gc<JsString>,
    limit: Limit,
) -> JsResult<Gc<JsArray>> {
    this.0.split(cx, string, limit.0 as u32)
}

macro_rules! flag_getters {
    ($($name:ident = $flag:ident,)*) => {$(
        #[direct_form(reads(PATTERN))]
        pub fn $name(this: Gc<RegExpObject>) -> bool {
            this.regexp().flags().contains(Flags::$flag)
        }
    )*};
}

flag_getters! {
    flag_has_indices = HAS_INDICES,
    flag_global = GLOBAL,
    flag_ignore_case = IGNORE_CASE,
    flag_multiline = MULTILINE,
    flag_dot_all = DOT_ALL,
    flag_unicode = UNICODE,
    flag_unicode_sets = UNICODE_SETS,
    flag_sticky = STICKY,
}

#[direct_form(reads(PATTERN), only_lacks_room)]
fn regexp_source(cx: &Cx, this: Gc<RegExpObject>) -> JsResult<Flat> {
    this.regexp().source(cx).map(Flat::made_by)
}

#[inline]
pub fn letters_of(vm: &Vm, flags: Flags) -> Flat {
    Flat::made_by(JsString::from_text(vm, flags.to_text().text()))
}

#[direct_form(reads(PATTERN), needs(RegExpPrimordialProperties))]
fn regexp_flags(vm: &Vm, this: Original<RegExpObject>) -> Flat {
    letters_of(vm, this.0.regexp().flags())
}

#[direct_form(
    reads(PATTERN),
    writes(ITERATOR, LAST_INDEX, LAST_MATCH, TRANSITIONS),
    needs(RegExpPrimordialProperties),
    makes(
        iterator_result_shape,
        regexp_match_array_shape,
        regexp_match_array_with_indices_shape,
        regexp_indices_array_shape
    ),
    gives_new
)]
fn regexp_string_iterator_next(cx: &Cx, this: PlainMatchIterator<'_>) -> JsResult<IteratorResult> {
    Ok(IteratorResult::new(cx, this.next_match(cx)?))
}

fn parse_flags(cx: &Cx, flags: Gc<JsString>) -> JsResult<Flags> {
    Flags::parse(flags.view(cx)?.text())
        .ok_or_else(|| cx.throw_syntax_error("Invalid flags supplied to RegExp constructor."))
}

/// What RegExpInitialize gives an object.
#[inline]
pub fn pattern_from(
    cx: &Cx,
    source: Gc<JsString>,
    flags: Option<Gc<JsString>>,
) -> JsResult<Gc<RegExp>> {
    let flags = flags.map_or(Ok(Flags::empty()), |flags| parse_flags(cx, flags))?;
    RegExp::create(cx, &*source.resolve(cx)?, flags)
}

/// The same, for the source of another one.
pub fn pattern_like(cx: &Cx, original: Gc<RegExp>, flags: Gc<JsString>) -> JsResult<Gc<RegExp>> {
    let flags = parse_flags(cx, flags)?;
    RegExp::create(cx, &original.pattern(), flags)
}

#[direct_form(pure, makes(regexp_shape), gives_new)]
fn new_regexp(cx: &Cx, source: Gc<JsString>, _: Undefined) -> JsResult<Gc<RegExpObject>> {
    Ok(RegExpObject::create(cx, pattern_from(cx, source, None)?))
}

#[direct_form(pure, makes(regexp_shape), gives_new)]
fn new_regexp_with_flags(
    cx: &Cx,
    source: Gc<JsString>,
    flags: Gc<JsString>,
) -> JsResult<Gc<RegExpObject>> {
    Ok(RegExpObject::create(
        cx,
        pattern_from(cx, source, Some(flags))?,
    ))
}

#[direct_form(pure, needs(RegExpPrimordialProperties), gives_new)]
fn copy_regexp(cx: &Cx, original: AnyPattern, _: Undefined) -> Gc<RegExpObject> {
    RegExpObject::create(cx, original.0)
}

#[direct_form(pure, needs(RegExpPrimordialProperties), gives_new)]
fn copy_regexp_with_flags(
    cx: &Cx,
    original: AnyPattern,
    flags: Gc<JsString>,
) -> JsResult<Gc<RegExpObject>> {
    Ok(RegExpObject::create(
        cx,
        pattern_like(cx, original.0, flags)?,
    ))
}
