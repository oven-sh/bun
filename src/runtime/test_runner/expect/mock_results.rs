use core::fmt;

use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{BuiltinName, JSGlobalObject, JSValue, JsResult, MarkedArgumentBuffer, js_error_to_write_error};

use super::Expect;
use super::matcher::{EXPECTED, Matcher, NO_PARAMS, Params, This, Verdict, fail, params};
use super::mock::{self, Rows};
use crate::test_runner::diff_format::DiffFormatter;

const NTH_EXPECTED: Params = params!("<green>n<r>, <green>expected<r>");

/// `None` if script put something else than a `{ type: string }` in the array.
fn type_of(global: &JSGlobalObject, entry: JSValue) -> JsResult<Option<bun_core::String>> {
    if entry.is_object()
        && let Some(name) = entry.fast_get(global, BuiltinName::Type)?
        && name.is_string()
    {
        return name.to_bun_string(global).map(Some);
    }
    Ok(None)
}

fn value_of(global: &JSGlobalObject, entry: JSValue) -> JsResult<JSValue> {
    Ok(entry.get(global, "value")?.unwrap_or(JSValue::UNDEFINED))
}

/// The `type` of an entry of `mock.results`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ResultType {
    Return,
    Throw,
    Incomplete,
}

impl ResultType {
    fn of(global: &JSGlobalObject, entry: JSValue) -> JsResult<Option<Self>> {
        Ok(match type_of(global, entry)? {
            Some(name) if name.eq_ascii(b"return") => Some(Self::Return),
            Some(name) if name.eq_ascii(b"throw") => Some(Self::Throw),
            Some(name) if name.eq_ascii(b"incomplete") => Some(Self::Incomplete),
            _ => None,
        })
    }

    fn of_valid(global: &JSGlobalObject, entry: JSValue) -> JsResult<Self> {
        Self::of(global, entry)?.ok_or_else(|| mock::throw_not_a_mock(global, " with returns", entry))
    }
}

enum Outcome {
    Value(JSValue),
    Error(JSValue),
    Pending,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// `mock.results`
    Returned,
    /// `mock.settledResults`
    Resolved,
}

#[derive(Clone, Copy)]
struct Results<'a> {
    global: &'a JSGlobalObject,
    kind: Kind,
    entries: JSValue,
    count: u32,
}

impl<'a> Results<'a> {
    #[optimize(size)]
    fn of(m: &Matcher<'a>, mock: JSValue, kind: Kind) -> JsResult<Self> {
        let global = m.global;
        let mut entries = bun_jsc::cpp::JSMockFunction__getReturns(global, mock)?;
        if !entries.is_array() {
            return Err(mock::throw_not_a_mock(global, "", mock));
        }
        if kind == Kind::Resolved {
            entries = mock::state_array(global, mock, "settledResults", " with returns")?;
        }
        Ok(Self { global, kind, entries, count: entries.get_length(global)? as u32 })
    }

    #[optimize(size)]
    fn outcome(&self, index: u32) -> JsResult<Outcome> {
        let global = self.global;
        if self.kind == Kind::Returned {
            let entry = self.entries.get_direct_index(global, index)?;
            return Ok(match ResultType::of(global, entry)? {
                Some(ResultType::Return) => Outcome::Value(value_of(global, entry)?),
                Some(ResultType::Throw) => Outcome::Error(value_of(global, entry)?),
                Some(ResultType::Incomplete) | None => Outcome::Pending,
            });
        }
        let entry = self.entries.get_index(global, index)?;
        let Some(name) = type_of(global, entry)? else { return Ok(Outcome::Pending) };
        let value = value_of(global, entry)?;
        Ok(if name.eq_ascii(b"fulfilled") {
            Outcome::Value(value)
        } else if name.eq_ascii(b"rejected") {
            Outcome::Error(value)
        } else {
            Outcome::Pending
        })
    }

    fn count_values(&self) -> JsResult<u32> {
        let mut values = 0;
        if self.kind == Kind::Returned {
            let mut entries = self.entries.array_iterator(self.global)?;
            while let Some(entry) = entries.next()? {
                values += u32::from(ResultType::of_valid(self.global, entry)? == ResultType::Return);
            }
        } else {
            for index in 0..self.count {
                values += u32::from(matches!(self.outcome(index)?, Outcome::Value(_)));
            }
        }
        Ok(values)
    }
}

#[derive(Clone, Copy)]
enum Times {
    AtLeastOnce,
    Exactly,
}

#[optimize(size)]
fn has_values(m: &Matcher<'_>, mock: JSValue, kind: Kind, times: Times, argument: JsLocal<'_>) -> Verdict {
    let results = Results::of(m, mock, kind)?;
    let expected = match (times, kind) {
        (Times::AtLeastOnce, _) => mock::no_argument(m, argument.to_js()).map(|()| 1)?,
        (Times::Exactly, Kind::Returned) => mock::times_argument(m, argument.to_js())?.min(i32::MAX.unsigned_abs()),
        (Times::Exactly, Kind::Resolved) => mock::times_argument(m, argument.to_js())?,
    };
    let values = results.count_values()?;
    let matched = match times {
        Times::AtLeastOnce => values >= expected,
        Times::Exactly => values == expected,
    };
    if m.passes(matched) {
        return m.pass();
    }
    let (noun, calls) = match kind {
        Kind::Returned => ("succesful returns: ", "calls:             "),
        Kind::Resolved => ("resolved calls: ", "calls:          "),
    };
    let (relation, padding) = match (times, m.not()) {
        (Times::AtLeastOnce, false) => (">= ", "   "),
        (Times::AtLeastOnce, true) => ("< ", "  "),
        (Times::Exactly, false) => ("== ", "   "),
        (Times::Exactly, true) => ("!= ", "   "),
    };
    fail!(
        m,
        "Expected number of {}{}<green>{}<r>\nReceived number of {}{}<red>{}<r>\nReceived number of {}{}<red>{}<r>\n",
        noun,
        relation,
        expected,
        noun,
        padding,
        values,
        calls,
        padding,
        results.count,
    )
}

#[cold]
#[optimize(size)]
fn fail_mismatch(m: &Matcher<'_>, label: fmt::Arguments<'_>, expected: JSValue, received: JSValue) -> Verdict {
    if expected.is_string() && received.is_string() {
        let diff = DiffFormatter::new(m.global, received, expected, false)?;
        return Err(m.fail(format_args!("{label}{diff}\n")));
    }
    fail!(m, "{}Expected: <green>{}<r>\nReceived: <red>{}<r>", label, m.show(expected), m.show(received))
}

#[derive(Clone, Copy)]
enum Call {
    Last,
    Nth(u32),
}

impl Call {
    fn nth(m: &Matcher<'_>, nth: JsLocal<'_>) -> JsResult<Self> {
        mock::nth_argument(m, nth.to_js(), "first argument must be an integer", "n must be greater than 0")
            .map(Call::Nth)
    }
}

impl fmt::Display for Call {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Call::Last => f.write_str("The last call"),
            Call::Nth(nth) => write!(f, "Call {nth}"),
        }
    }
}

#[optimize(size)]
fn call_has_value(m: &Matcher<'_>, results: &Results<'_>, call: Call, expected: JsLocal<'_>) -> Verdict {
    let expected = expected.to_js();
    let outcome = match call {
        Call::Last if results.count > 0 => Some(results.outcome(results.count - 1)?),
        Call::Nth(nth) if nth <= results.count => Some(results.outcome(nth - 1)?),
        _ => None,
    };
    let matched = match outcome {
        Some(Outcome::Value(value)) => value.jest_deep_equals(expected, m.global)?,
        _ => false,
    };
    if m.passes(matched) {
        return m.pass();
    }

    if m.not() {
        return match (results.kind, call) {
            (Kind::Returned, Call::Last) => {
                fail!(
                    m,
                    "Expected mock function not to have last returned: <green>{}<r>\nBut it did.\n",
                    m.show(expected)
                )
            }
            (Kind::Returned, Call::Nth(nth)) => {
                fail!(
                    m,
                    "Expected mock function not to have returned on call {}: <green>{}<r>\nBut it did.\n",
                    nth,
                    m.show(expected)
                )
            }
            (Kind::Resolved, _) => {
                fail!(m, "{} was expected not to resolve with: <green>{}<r>\nBut it did.\n", call, m.show(expected))
            }
        };
    }
    let received = match (outcome, results.kind) {
        (Some(Outcome::Value(value)), _) => value,
        (Some(Outcome::Pending), Kind::Returned) => JSValue::UNDEFINED,
        (Some(Outcome::Pending), Kind::Resolved) => return Err(m.fail(format_args!("{call} has not settled.\n"))),
        (Some(Outcome::Error(error)), Kind::Returned) => {
            return fail!(m, "{} threw an error: <red>{}<r>\n", call, m.show(error));
        }
        (Some(Outcome::Error(error)), Kind::Resolved) => {
            return fail!(m, "{} rejected with: <red>{}<r>\n", call, m.show(error));
        }
        (None, _) => {
            return match call {
                Call::Last => Err(m.fail(format_args!("The mock function was not called."))),
                Call::Nth(nth) => mock::fail_called_less(m, results.count, nth, "\n"),
            };
        }
    };
    match (results.kind, call) {
        (Kind::Returned, Call::Last) => fail_mismatch(m, format_args!(""), expected, received),
        _ => fail_mismatch(m, format_args!("{call}:\n"), expected, received),
    }
}

/// `roots` keeps the returned values alive: `jest_deep_equals` can run script that clears `mock.results`.
#[optimize(size)]
fn returned_with(m: &Matcher<'_>, mock: JSValue, expected: JSValue, roots: &mut MarkedArgumentBuffer) -> Verdict {
    let global = m.global;
    let Results { entries, count, .. } = Results::of(m, mock, Kind::Returned)?;
    let mut matched = false;
    let mut some_threw = false;
    let mut returned: Vec<JSValue> = Vec::new();
    for index in 0..count {
        let entry = entries.get_direct_index(global, index)?;
        match ResultType::of(global, entry)? {
            Some(ResultType::Return) => {
                let value = value_of(global, entry)?;
                roots.append(value);
                returned.push(value);
                matched = matched || value.jest_deep_equals(expected, global)?;
            }
            Some(ResultType::Throw) => some_threw = true,
            Some(ResultType::Incomplete) | None => {}
        }
    }
    if m.passes(matched) {
        return m.pass();
    }

    if m.not() {
        return fail!(m, "Expected mock function not to have returned: <green>{}<r>\n", m.show(expected));
    }
    if let (1, &[only]) = (count, returned.as_slice()) {
        return fail_mismatch(m, format_args!(""), expected, only);
    }
    if !some_threw {
        let list = fmt::from_fn(|f| {
            let mut rows = Rows::new(global, f, 4);
            returned.iter().try_for_each(|&value| rows.add("", Some(value)))
        });
        return fail!(
            m,
            "    <green>Expected<r>: {}\n    <red>Received<r>:\n{}\n\n    Number of returns: {}\n",
            m.show(expected),
            list,
            returned.len(),
        );
    }
    let list = fmt::from_fn(|f| {
        let mut rows = Rows::new(global, f, 2);
        let mut entries = entries.array_iterator(global).map_err(js_error_to_write_error)?;
        while let Some(entry) = entries.next().map_err(js_error_to_write_error)? {
            let value = value_of(global, entry).map_err(js_error_to_write_error)?;
            match ResultType::of_valid(global, entry).map_err(js_error_to_write_error)? {
                ResultType::Return => rows.add("", Some(value))?,
                ResultType::Throw => rows.add("function call threw an error: ", Some(value))?,
                ResultType::Incomplete => rows.add("<incomplete call>", None)?,
            }
        }
        Ok(())
    });
    Err(m.fail(format_args!(
        "Some calls errored:\n\n    Expected: {}\n    Received:\n{list}\n\n    Number of returns: {}\n    Number of calls:   {count}\n",
        m.show(expected),
        returned.len(),
    )))
}

impl Expect {
    pub(crate) fn to_have_returned(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveReturned", EXPECTED)?;
        has_values(&m, mock, Kind::Returned, Times::AtLeastOnce, expected)
    }

    pub(crate) fn to_have_returned_times(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveReturnedTimes", EXPECTED)?;
        has_values(&m, mock, Kind::Returned, Times::Exactly, expected)
    }

    pub(crate) fn to_have_resolved(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveResolved", NO_PARAMS)?;
        has_values(&m, mock, Kind::Resolved, Times::AtLeastOnce, expected)
    }

    pub(crate) fn to_have_resolved_times(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveResolvedTimes", EXPECTED)?;
        has_values(&m, mock, Kind::Resolved, Times::Exactly, expected)
    }

    pub(crate) fn to_have_last_returned_with(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveBeenLastReturnedWith", EXPECTED)?;
        call_has_value(&m, &Results::of(&m, mock, Kind::Returned)?, Call::Last, expected)
    }

    pub(crate) fn to_have_last_resolved_with(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveLastResolvedWith", EXPECTED)?;
        call_has_value(&m, &Results::of(&m, mock, Kind::Resolved)?, Call::Last, expected)
    }

    pub(crate) fn to_have_nth_returned_with(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        nth: JsLocal<'_>,
        expected: JsLocal<'_>,
    ) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveNthReturnedWith", NTH_EXPECTED)?;
        let results = Results::of(&m, mock, Kind::Returned)?;
        call_has_value(&m, &results, Call::nth(&m, nth)?, expected)
    }

    pub(crate) fn to_have_nth_resolved_with(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        nth: JsLocal<'_>,
        expected: JsLocal<'_>,
    ) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveNthResolvedWith", NTH_EXPECTED)?;
        let results = Results::of(&m, mock, Kind::Resolved)?;
        call_has_value(&m, &results, Call::nth(&m, nth)?, expected)
    }

    pub(crate) fn to_have_returned_with(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveReturnedWith", EXPECTED)?;
        MarkedArgumentBuffer::new(|roots| returned_with(&m, mock, expected.to_js(), roots))
    }

    #[optimize(size)]
    pub(crate) fn to_have_resolved_with(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, mock) = this.start(cx, "toHaveResolvedWith", EXPECTED)?;
        let expected = expected.to_js();
        let results = Results::of(&m, mock, Kind::Resolved)?;
        let mut matched = false;
        let mut resolved: u32 = 0;
        let mut last = JSValue::UNDEFINED;
        for index in 0..results.count {
            if let Outcome::Value(value) = results.outcome(index)? {
                resolved += 1;
                last = value;
                matched = matched || value.jest_deep_equals(expected, m.global)?;
            }
        }
        if m.passes(matched) {
            return m.pass();
        }

        let list = fmt::from_fn(|f| {
            let mut rows = Rows::new(m.global, f, 4);
            (0..results.count).try_for_each(|index| match results.outcome(index).map_err(js_error_to_write_error)? {
                Outcome::Value(value) => rows.add("", Some(value)),
                Outcome::Error(reason) => rows.add("function call rejected with: ", Some(reason)),
                Outcome::Pending => rows.add("<pending call>", None),
            })
        });
        match (results.count, resolved) {
            _ if m.not() => {
                fail!(m, "Expected mock function not to have resolved with: <green>{}<r>\n", m.show(expected))
            }
            (0, _) => mock::fail_not_called(&m, expected),
            (1, 1) => fail_mismatch(&m, format_args!(""), expected, last),
            (count, _) => fail!(
                m,
                concat!(
                    "    <green>Expected<r>: {}\n    <red>Received<r>:\n{}\n\n",
                    "    Number of resolved calls: {}\n    Number of calls:          {}\n",
                ),
                m.show(expected),
                list,
                resolved,
                count,
            ),
        }
    }
}
