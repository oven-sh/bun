use core::fmt;

use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::cpp::JSMockFunction__getCalls as calls_of;
use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult, js_error_to_write_error};

use super::Expect;
use super::matcher::{EXPECTED, Matcher, NO_PARAMS, Params, This, Verdict, fail, params};
use super::mock::{self, Rows};
use crate::test_runner::diff_format::DiffFormatter;

const ARGUMENTS: Params = params!("<green>...expected<r>");

fn number_of_calls(m: &Matcher<'_>, mock: JSValue) -> JsResult<u64> {
    let calls = calls_of(m.global, mock)?;
    if calls.is_array() { calls.get_length(m.global) } else { Err(mock::throw_not_a_mock(m.global, "", mock)) }
}

fn calls(m: &Matcher<'_>, mock: JSValue) -> JsResult<(JSValue, u32)> {
    let calls = calls_of(m.global, mock)?;
    if !calls.is_array() {
        return fail!(
            m.signed_not(false),
            "Matcher error: <red>received<r> value must be a mock function\nReceived: {}",
            m.show(mock)
        );
    }
    Ok((calls, calls.get_length(m.global)? as u32))
}

/// `not_a_call`: script put something else than an array in `mock.calls`.
fn has_arguments(
    global: &JSGlobalObject,
    call: Option<JSValue>,
    expected: &[JSValue],
    not_a_call: &dyn Fn() -> JsError,
) -> JsResult<bool> {
    let Some(call) = call else { return Ok(false) };
    if !call.is_array() {
        return Err(not_a_call());
    }
    let mut arguments = call.array_iterator(global)?;
    if arguments.len as usize != expected.len() {
        return Ok(false);
    }
    for &expected in expected {
        if let Some(argument) = arguments.next()?
            && !argument.jest_deep_equals(expected, global)?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cold]
fn throw_not_a_call(global: &JSGlobalObject) -> JsError {
    global.throw(format_args!("Internal error: expected mock call item to be an array of arguments."))
}

fn list_calls(global: &JSGlobalObject, calls: JSValue) -> impl fmt::Display {
    fmt::from_fn(move |f| {
        let count = calls.get_length(global).map_err(js_error_to_write_error)? as u32;
        if count == 0 {
            return f.write_str("(no calls)");
        }
        let mut rows = Rows::new(global, f, 4);
        (0..count)
            .try_for_each(|index| rows.add("", Some(calls.get_index(global, index).map_err(js_error_to_write_error)?)))
    })
}

#[cold]
fn fail_number_of_calls(m: &Matcher<'_>, relation: &str, expected: u32, count: u64) -> Verdict {
    fail!(
        m,
        "Expected number of calls: {}<green>{}<r>\nReceived number of calls: <red>{}<r>\n",
        relation,
        expected,
        count
    )
}

fn called_times(m: &Matcher<'_>, count: u64, times: u32) -> Verdict {
    if m.passes(count == u64::from(times)) { m.pass() } else { fail_number_of_calls(m, m.not_word(), times, count) }
}

impl Expect {
    pub(crate) fn to_have_been_called(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveBeenCalled", NO_PARAMS)?;
        let count = number_of_calls(&m, mock)?;
        mock::no_argument(&m, expected.to_js())?;
        if m.passes(count > 0) {
            return m.pass();
        }
        if m.not() { fail_number_of_calls(&m, "", 0, count) } else { fail_number_of_calls(&m, ">= ", 1, count) }
    }

    pub(crate) fn to_have_been_called_once(&self, this: This<'_>, cx: &mut JsScope<'_>) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveBeenCalledOnce", EXPECTED)?;
        called_times(&m, number_of_calls(&m, mock)?, 1)
    }

    pub(crate) fn to_have_been_called_times(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveBeenCalledTimes", EXPECTED)?;
        let count = number_of_calls(&m, mock)?;
        called_times(&m, count, mock::times_argument(&m, expected.to_js())?)
    }

    pub(crate) fn to_have_been_called_with(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: &[JsLocal<'_>],
    ) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveBeenCalledWith", ARGUMENTS)?;
        let global = m.global;
        let expected = JsLocal::to_js_slice(expected);
        let (calls, count) = calls(&m, mock)?;
        let mut matched = false;
        let mut items = calls.array_iterator(global)?;
        while !matched && let Some(call) = items.next()? {
            matched = has_arguments(global, Some(call), expected, &|| throw_not_a_call(global))?;
        }
        if m.passes(matched) {
            return m.pass();
        }

        let expected = JSValue::create_array_from_slice(global, expected)?;
        match count {
            _ if m.not() => fail!(
                m,
                "Expected mock function not to have been called with: <green>{}<r>\nBut it was.",
                m.show(expected)
            ),
            0 => mock::fail_not_called(&m, expected),
            1 => m.fail_diff(expected, calls.get_index(global, 0)?),
            _ => fail!(
                m,
                "    <green>Expected<r>: {}\n    <red>Received<r>:\n{}\n\n    Number of calls: {}\n",
                m.show(expected),
                list_calls(global, calls),
                count,
            ),
        }
    }

    #[optimize(size)]
    pub(crate) fn to_have_been_called_exactly_once_with(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: &[JsLocal<'_>],
    ) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveBeenCalledExactlyOnceWith", ARGUMENTS)?;
        let global = m.global;
        let expected = JsLocal::to_js_slice(expected);
        let (calls, count) = calls(&m, mock)?;
        let call = if count == 1 { Some(calls.get_index(global, 0)?) } else { None };
        let matched = has_arguments(global, call, expected, &|| throw_not_a_call(global))?;
        if m.passes(matched) {
            return m.pass();
        }

        let expected = JSValue::create_array_from_slice(global, expected)?;
        match call {
            _ if m.not() => fail!(
                m,
                "Expected mock function not to have been called exactly once with: <green>{}<r>\nBut it was.",
                m.show(expected),
            ),
            Some(call) => m.fail_diff(expected, call),
            None if count == 0 => mock::fail_not_called(&m, expected),
            None => fail!(
                m,
                concat!(
                    "    <green>Expected<r>: {}\n    <red>Received<r>:\n{}\n\n",
                    "    Expected number of calls: <green>1<r>\n    Received number of calls: <red>{}<r>\n",
                ),
                m.show(expected),
                list_calls(global, calls),
                count,
            ),
        }
    }

    #[optimize(size)]
    pub(crate) fn to_have_been_last_called_with(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: &[JsLocal<'_>],
    ) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveBeenLastCalledWith", ARGUMENTS)?;
        let global = m.global;
        let expected = JsLocal::to_js_slice(expected);
        let (calls, count) = calls(&m, mock)?;
        let call = if count > 0 { Some(calls.get_index(global, count - 1)?) } else { None };
        let matched = has_arguments(global, call, expected, &|| mock::throw_not_a_mock(global, " with calls", mock))?;
        if m.passes(matched) {
            return m.pass();
        }

        let expected = JSValue::create_array_from_slice(global, expected)?;
        match call {
            _ if m.not() => fail!(m, "Expected last call not to be with: <green>{}<r>\nBut it was.", m.show(expected)),
            Some(call) => m.fail_diff(expected, call),
            None => mock::fail_not_called(&m, expected),
        }
    }

    #[optimize(size)]
    pub(crate) fn to_have_been_nth_called_with(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        nth: JsLocal<'_>,
        expected: &[JsLocal<'_>],
    ) -> Verdict {
        let (m, mock) =
            this.start(cx, "toHaveBeenNthCalledWith", params!("<green>n<r>, <green>...expected<r>"))?;
        let global = m.global;
        let expected = JsLocal::to_js_slice(expected);
        let (calls, count) = calls(&m, mock)?;
        let nth = mock::nth_argument(
            &m,
            nth.to_js(),
            "requires a positive integer as the first argument",
            "first argument must be a positive integer",
        )?;
        let call = if nth <= count { Some(calls.get_index(global, nth - 1)?) } else { None };
        let matched = has_arguments(global, call, expected, &|| throw_not_a_call(global))?;
        if m.passes(matched) {
            return m.pass();
        }

        let expected = JSValue::create_array_from_slice(global, expected)?;
        match call {
            _ if m.not() => {
                fail!(m, "Expected call #{} not to be with: <green>{}<r>\nBut it was.", nth, m.show(expected))
            }
            Some(call) => {
                let diff = DiffFormatter::new(global, call, expected, false)?;
                Err(m.fail(format_args!("Call #{nth}:\n{diff}\n")))
            }
            None => mock::fail_called_less(&m, count, nth, ""),
        }
    }

    pub(crate) fn to_have_been_called_before(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        other: JsLocal<'_>,
        must_be_called: JsLocal<'_>,
    ) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveBeenCalledBefore", EXPECTED)?;
        called_in_order(&m, mock, other.to_js(), must_be_called.to_js(), Order::Before)
    }

    pub(crate) fn to_have_been_called_after(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        other: JsLocal<'_>,
        must_be_called: JsLocal<'_>,
    ) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveBeenCalledAfter", EXPECTED)?;
        called_in_order(&m, mock, other.to_js(), must_be_called.to_js(), Order::After)
    }
}

#[derive(Clone, Copy)]
enum Order {
    Before,
    After,
}

fn first_invocation(global: &JSGlobalObject, mock: JSValue) -> JsResult<Option<f64>> {
    let order = mock::state_array(global, mock, "invocationCallOrder", " with calls")?;
    if order.get_length(global)? == 0 {
        return Ok(None);
    }
    order.get_index(global, 0)?.to_number(global).map(Some)
}

#[optimize(size)]
fn called_in_order(m: &Matcher<'_>, mock: JSValue, other: JSValue, must_be_called: JSValue, order: Order) -> Verdict {
    calls(m, mock)?;
    if !calls_of(m.global, other)?.is_array() {
        return fail!(
            m,
            "Matcher error: <green>expected<r> value must be a mock function\nExpected: {}",
            m.show(other)
        );
    }
    let (received, expected) = (first_invocation(m.global, mock)?, first_invocation(m.global, other)?);
    let (word, first, second) = match order {
        Order::Before => ("before", received, expected),
        Order::After => ("after", expected, received),
    };
    let matched = match (first, second) {
        (None, _) => !must_be_called.is_undefined() && !must_be_called.to_boolean(),
        (Some(_), None) => false,
        (Some(first), Some(second)) => first < second,
    };
    if m.passes(matched) {
        return m.pass();
    }
    let show = |invocation: Option<f64>| {
        fmt::from_fn(move |f| match invocation {
            Some(id) => write!(f, "invocation {id}"),
            None => f.write_str("(no calls)"),
        })
    };
    fail!(
        m,
        concat!(
            "Expected the first call of <red>received<r> {}to be {} the first call of <green>expected<r>\n\n",
            "First call of received: <red>{}<r>\nFirst call of expected: <green>{}<r>\n",
        ),
        m.not_word(),
        word,
        show(received),
        show(expected),
    )
}
