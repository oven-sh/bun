//! The methods of `String.prototype` that take a regular expression.

use bun_engine_macros::direct_form;

use super::operand::{AnyPattern, GlobalPattern, Limit, Literal, PatternSearchingOnce};
use super::outcome::Found;
use super::regexp::{
    Matches, pattern_from, symbol_match_every, symbol_match_once, symbol_match_plain,
    symbol_search, symbol_split,
};
use crate::{Cx, Gc, JsArray, JsResult, JsString, PlainRegExp, RegExpStringIterator};

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
fn match_once(cx: &Cx, this: Gc<JsString>, pattern: PatternSearchingOnce) -> Matches {
    symbol_match_once(cx, pattern, this)
}

#[direct_form(writes(LAST_MATCH), needs(RegExpPrimordialProperties), gives_new)]
fn match_every(cx: &Cx, this: Gc<JsString>, pattern: GlobalPattern) -> Matches {
    symbol_match_every(cx, pattern, this)
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
fn match_plain(cx: &Cx, this: Gc<JsString>, regexp: PlainRegExp<'_>) -> Matches {
    symbol_match_plain(cx, regexp, this)
}

#[direct_form(
    writes(LAST_MATCH, TRANSITIONS),
    needs(RegExpPrimordialProperties),
    makes(regexp_match_array_shape),
    gives_new
)]
fn match_source(cx: &Cx, this: Gc<JsString>, source: Gc<JsString>) -> Matches {
    let pattern = PatternSearchingOnce(pattern_from(cx, source, None)?);
    symbol_match_once(cx, pattern, this)
}

#[direct_form(
    pure,
    needs(RegExpPrimordialProperties, RegExpSpecies),
    makes(regexp_string_iterator_shape),
    gives_new
)]
fn match_all(cx: &Cx, this: Gc<JsString>, pattern: GlobalPattern) -> Gc<RegExpStringIterator> {
    RegExpStringIterator::for_pattern(cx, pattern.0, 0, this)
}

#[direct_form(writes(LAST_MATCH), needs(RegExpPrimordialProperties))]
fn search(cx: &Cx, this: Gc<JsString>, pattern: AnyPattern) -> JsResult<Found> {
    symbol_search(cx, pattern, this)
}

#[direct_form(writes(LAST_MATCH), needs(RegExpPrimordialProperties))]
fn search_source(cx: &Cx, this: Gc<JsString>, source: Gc<JsString>) -> JsResult<Found> {
    symbol_search(cx, AnyPattern(pattern_from(cx, source, None)?), this)
}

#[direct_form(
    writes(LAST_MATCH),
    needs(RegExpPrimordialProperties, RegExpSpecies),
    gives_new
)]
fn split_by_pattern(
    cx: &Cx,
    this: Gc<JsString>,
    separator: AnyPattern,
    limit: Limit,
) -> JsResult<Gc<JsArray>> {
    symbol_split(cx, separator, this, limit)
}

macro_rules! replacing {
    ($($literally:ident, $by_template:ident = $pattern:ty;)*) => {$(
        #[direct_form(writes(LAST_MATCH), needs(RegExpPrimordialProperties))]
        fn $literally(
            cx: &Cx,
            this: Gc<JsString>,
            pattern: $pattern,
            replacement: Literal,
        ) -> JsResult<Gc<JsString>> {
            pattern.0.replace_literally(cx, this, replacement.0)
        }

        #[direct_form(writes(LAST_MATCH), needs(RegExpPrimordialProperties))]
        fn $by_template(
            cx: &Cx,
            this: Gc<JsString>,
            pattern: $pattern,
            template: Gc<JsString>,
        ) -> JsResult<Gc<JsString>> {
            pattern.0.replace_with_string(cx, this, template)
        }
    )*};
}

replacing! {
    replace_once_literally, replace_once = PatternSearchingOnce;
    replace_every_literally, replace_every = GlobalPattern;
}

#[direct_form(
    reads(PATTERN),
    writes(LAST_INDEX, LAST_MATCH),
    needs(RegExpPrimordialProperties)
)]
fn replace_plain(
    cx: &Cx,
    this: Gc<JsString>,
    regexp: PlainRegExp<'_>,
    template: Gc<JsString>,
) -> JsResult<Gc<JsString>> {
    regexp.unchanged_if_it_throws(|| regexp.replace_with_string(cx, this, template))
}
