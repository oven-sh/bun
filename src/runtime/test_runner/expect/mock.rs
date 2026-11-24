//! What the matchers of mock functions share.

use core::fmt;

use bun_jsc::console_object::Formatter;
use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult};

use super::matcher::{Matcher, Verdict, fail};
use super::{make_formatter, show};

#[cold]
pub(super) fn throw_not_a_mock(global: &JSGlobalObject, with: &str, value: JSValue) -> JsError {
    global.throw(format_args!("Expected value must be a mock function{with}: {}", show(global, value)))
}

/// `mock.mock[property]`, for the arrays that have no native accessor.
pub(super) fn state_array(global: &JSGlobalObject, mock: JSValue, property: &str, with: &str) -> JsResult<JSValue> {
    let array = match mock.get(global, "mock")? {
        Some(state) => state.get(global, property)?,
        None => None,
    };
    array.filter(|array| array.is_array()).ok_or_else(|| throw_not_a_mock(global, with, mock))
}

pub(super) fn nth_argument(m: &Matcher<'_>, nth: JSValue, not_an_integer: &str, not_positive: &str) -> JsResult<u32> {
    if !nth.is_any_int() {
        return Err(m.global.throw_invalid_arguments(format_args!("{}() {not_an_integer}", m.name)));
    }
    match nth.to_int32() {
        nth @ 1.. => Ok(nth.unsigned_abs()),
        _ => Err(m.global.throw_invalid_arguments(format_args!("{}() {not_positive}", m.name))),
    }
}

pub(super) fn no_argument(m: &Matcher<'_>, argument: JSValue) -> JsResult<()> {
    if argument.is_undefined() {
        return Ok(());
    }
    Err(m.global.throw_invalid_arguments(format_args!("{}() must not have an argument", m.name)))
}

pub(super) fn times_argument(m: &Matcher<'_>, times: JSValue) -> JsResult<u32> {
    if times.is_uint32_as_any_int() {
        return Ok(times.to_u32());
    }
    Err(m.global.throw_invalid_arguments(format_args!("{}() requires 1 non-negative integer argument", m.name)))
}

#[cold]
pub(super) fn fail_not_called(m: &Matcher<'_>, expected: JSValue) -> Verdict {
    fail!(m, "Expected: <green>{}<r>\nBut it was not called.", m.show(expected))
}

#[cold]
pub(super) fn fail_called_less(m: &Matcher<'_>, count: u32, nth: u32, end: &str) -> Verdict {
    let s = if count == 1 { "" } else { "s" };
    Err(m.fail(format_args!("The mock function was called {count} time{s}, but call {nth} was requested.{end}")))
}

/// A numbered list. One formatter prints every row, because it carries the length of the line from value to value.
pub(super) struct Rows<'a, 'f> {
    out: &'a mut fmt::Formatter<'f>,
    formatter: Formatter<'a>,
    number_width: usize,
    count: u32,
}

impl<'a, 'f> Rows<'a, 'f> {
    pub(super) fn new(global: &'a JSGlobalObject, out: &'a mut fmt::Formatter<'f>, number_width: usize) -> Self {
        Self { out, formatter: make_formatter(global), number_width, count: 0 }
    }

    #[optimize(size)]
    pub(super) fn add(&mut self, text: &str, value: Option<JSValue>) -> fmt::Result {
        let separator = if self.count == 0 { "" } else { "\n" };
        self.count += 1;
        write!(self.out, "{separator}           {:>2$}: {}", self.count, text, self.number_width)?;
        match value {
            Some(value) => write!(self.out, "{}", value.to_fmt(&mut self.formatter)),
            None => Ok(()),
        }
    }
}
