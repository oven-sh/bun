use core::cmp::Ordering;

use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{ComparisonResult, JSValue};

use super::Expect;
use super::matcher::{EXPECTED, This, Verdict, fail, params};

fn compare_big_int(big_int: JSValue, other: JSValue) -> Option<Ordering> {
    match big_int.as_big_int_compare(other) {
        ComparisonResult::LessThan => Some(Ordering::Less),
        ComparisonResult::Equal => Some(Ordering::Equal),
        ComparisonResult::GreaterThan => Some(Ordering::Greater),
        ComparisonResult::Undefined | ComparisonResult::InvalidComparison => None,
    }
}

impl Expect {
    pub(crate) fn to_be_greater_than(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        Self::to_be_ordered(this, cx, expected, "toBeGreaterThan", ">", Ordering::is_gt)
    }

    pub(crate) fn to_be_greater_than_or_equal(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> Verdict {
        Self::to_be_ordered(this, cx, expected, "toBeGreaterThanOrEqual", ">=", Ordering::is_ge)
    }

    pub(crate) fn to_be_less_than(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        Self::to_be_ordered(this, cx, expected, "toBeLessThan", "<", Ordering::is_lt)
    }

    pub(crate) fn to_be_less_than_or_equal(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> Verdict {
        Self::to_be_ordered(this, cx, expected, "toBeLessThanOrEqual", "<=", Ordering::is_le)
    }

    fn to_be_ordered(
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
        name: &'static str,
        operator: &'static str,
        holds: fn(Ordering) -> bool,
    ) -> Verdict {
        let m = this.begin(cx, name, EXPECTED).count();
        let received = m.received()?;
        let expected = expected.to_js();
        let order = match (received.is_number(), expected.is_number()) {
            (true, true) => received.as_number().partial_cmp(&expected.as_number()),
            (true, false) if expected.is_big_int() => compare_big_int(expected, received).map(Ordering::reverse),
            (false, is_number) if received.is_big_int() && (is_number || expected.is_big_int()) => {
                compare_big_int(received, expected)
            }
            _ => return Err(m.global.throw(format_args!("Expected and actual values must be numbers or bigints"))),
        };
        if m.passes(order.is_some_and(holds)) {
            return m.pass();
        }
        fail!(
            m,
            "Expected: {}{} <green>{}<r>\nReceived: <red>{}<r>\n",
            m.not_word(),
            operator,
            m.show(expected),
            m.show(received)
        )
    }

    pub(crate) fn to_be_close_to(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
        precision: JsLocal<'_>,
    ) -> Verdict {
        let m = this.begin(cx, "toBeCloseTo", params!("<green>expected<r>, precision")).count();
        let (expected, precision) = (expected.to_js(), precision.to_js());
        if !expected.is_number() {
            return Err(m.global.throw_invalid_argument_type("toBeCloseTo", "expected", "number"));
        }
        if !precision.is_undefined() && !precision.is_number() {
            return Err(m.global.throw_invalid_argument_type("toBeCloseTo", "precision", "number"));
        }
        let precision = if precision.is_undefined() { 2.0 } else { precision.as_number() };
        let received = m.received()?;
        if !received.is_number() {
            return Err(m.global.throw_invalid_argument_type("expect", "received", "number"));
        }

        let same_infinity = received.as_number().is_infinite() && received.as_number() == expected.as_number();
        let expected_difference = 10.0_f64.powf(-precision) / 2.0;
        let difference = if same_infinity { 0.0 } else { (received.as_number() - expected.as_number()).abs() };
        if m.passes(same_infinity || difference < expected_difference) {
            return m.pass();
        }
        fail!(
            m,
            concat!(
                "Expected: <green>{}<r>\nReceived: <red>{}<r>\n\n",
                "Expected precision: {}\nExpected difference: \\< <green>{}<r>\nReceived difference: <red>{}<r>\n",
            ),
            m.show(expected),
            m.show(received),
            precision,
            expected_difference,
            difference,
        )
    }

    #[optimize(size)]
    pub(crate) fn to_be_within(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        start: JsLocal<'_>,
        end: JsLocal<'_>,
    ) -> Verdict {
        let (m, received) = this.start(cx, "toBeWithin", params!("<green>start<r><d>, <r><green>end<r>"))?;
        let (start, end) = (start.to_js(), end.to_js());
        if !start.is_number() {
            return Err(m.global.throw(format_args!("toBeWithin() requires the first argument to be a number")));
        }
        if !end.is_number() {
            return Err(m.global.throw(format_args!("toBeWithin() requires the second argument to be a number")));
        }
        if m.passes(received.is_number() && (start.as_number()..end.as_number()).contains(&received.as_number())) {
            return m.pass();
        }
        fail!(
            m,
            "Expected: {}between <green>{}<r> <d>(inclusive)<r> and <green>{}<r> <d>(exclusive)<r>\nReceived: <red>{}<r>\n",
            m.not_word(),
            m.show(start),
            m.show(end),
            m.show(received),
        )
    }
}
