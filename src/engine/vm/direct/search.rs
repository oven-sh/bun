//! The methods of `String.prototype` that look for another string.

use bun_engine_macros::direct_form;
use bun_engine_text::StringImpl;

use super::operand::{End, LastStart, Start, Unit};
use super::outcome::Found;
use crate::{Cx, Gc, JsResult, JsString};

#[direct_form(pure)]
fn index_of_unit_in_characters(this: &StringImpl, search: Unit, start: Start) -> Found {
    (this
        .text()
        .find_unit(search.get(), start.within(this.len())))
    .into()
}

#[direct_form(pure)]
fn index_of_in_characters(this: &StringImpl, search: &StringImpl, start: Start) -> Found {
    (this.text().find(search.text(), start.within(this.len()))).into()
}

#[direct_form(pure, only_lacks_room)]
fn index_of_unit(cx: &Cx, this: Gc<JsString>, search: Unit, start: Start) -> JsResult<Found> {
    let start = this.clamp_position(start.0);
    this.index_of_unit(cx, search.get(), start).map(Into::into)
}

#[direct_form(pure, only_lacks_room)]
pub fn index_of(
    cx: &Cx,
    this: Gc<JsString>,
    search: Gc<JsString>,
    start: Start,
) -> JsResult<Found> {
    let start = this.clamp_position(start.0);
    this.index_of(cx, &search, start).map(Into::into)
}

#[direct_form(pure)]
fn includes_unit_in_characters(this: &StringImpl, search: Unit, start: Start) -> bool {
    index_of_unit_in_characters(this, search, start).is_some()
}

#[direct_form(pure)]
fn includes_in_characters(this: &StringImpl, search: &StringImpl, start: Start) -> bool {
    index_of_in_characters(this, search, start).is_some()
}

#[direct_form(pure, only_lacks_room)]
fn includes_unit(cx: &Cx, this: Gc<JsString>, search: Unit, start: Start) -> JsResult<bool> {
    index_of_unit(cx, this, search, start).map(Found::is_some)
}

#[direct_form(pure, only_lacks_room)]
pub fn includes(cx: &Cx, this: Gc<JsString>, search: Gc<JsString>, start: Start) -> JsResult<bool> {
    index_of(cx, this, search, start).map(Found::is_some)
}

#[direct_form(pure)]
fn last_index_of_unit_in_characters(this: &StringImpl, search: Unit, start: LastStart) -> Found {
    (this
        .text()
        .rfind_unit(search.get(), start.get() as usize + 1))
    .into()
}

#[direct_form(pure)]
fn last_index_of_in_characters(this: &StringImpl, search: &StringImpl, start: LastStart) -> Found {
    this.text()
        .rfind(search.text(), start.get() as usize)
        .into()
}

#[direct_form(pure, only_lacks_room)]
fn last_index_of_unit(
    cx: &Cx,
    this: Gc<JsString>,
    search: Unit,
    start: LastStart,
) -> JsResult<Found> {
    (this.last_index_of_unit(cx, search.get(), start.get())).map(Into::into)
}

#[direct_form(pure, only_lacks_room)]
pub fn last_index_of(
    cx: &Cx,
    this: Gc<JsString>,
    search: Gc<JsString>,
    start: LastStart,
) -> JsResult<Found> {
    this.last_index_of(cx, &search, start.get()).map(Into::into)
}

#[direct_form(pure)]
fn starts_with_in_characters(this: &StringImpl, search: &StringImpl, start: Start) -> bool {
    (this.text().slice_from(start.within(this.len()))).starts_with(search.text())
}

#[direct_form(pure, only_lacks_room)]
pub fn starts_with(
    cx: &Cx,
    this: Gc<JsString>,
    search: Gc<JsString>,
    start: Start,
) -> JsResult<bool> {
    this.starts_with(cx, &search, this.clamp_position(start.0))
}

#[direct_form(pure)]
fn ends_with_in_characters(this: &StringImpl, search: &StringImpl, end: End) -> bool {
    (this.text().slice(0..end.within(this.len()))).ends_with(search.text())
}

#[direct_form(pure, only_lacks_room)]
pub fn ends_with(cx: &Cx, this: Gc<JsString>, search: Gc<JsString>, end: End) -> JsResult<bool> {
    this.ends_with(cx, &search, this.clamp_position(end.0))
}
