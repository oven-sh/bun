//! Matchers that ask one question about the received value.

use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{JSValue, JsResult};

use super::Expect;
use super::matcher::{EXPECTED, Matcher, NO_PARAMS, This, Verdict, fail};

macro_rules! predicates {
    ($($method:ident, $name:literal, |$received:ident| $matched:expr;)*) => {
        impl Expect {$(
            pub(crate) fn $method(&self, this: This<'_>, cx: &mut JsScope<'_>) -> Verdict {
                let (m, $received) = this.start(cx, $name, NO_PARAMS)?;
                if m.passes($matched) { m.pass() } else { m.fail_received($received) }
            }
        )*}
    };
}

predicates! {
    to_be_array, "toBeArray", |v| v.is_array();
    to_be_boolean, "toBeBoolean", |v| v.is_boolean();
    to_be_date, "toBeDate", |v| v.is_date();
    to_be_defined, "toBeDefined", |v| !v.is_undefined();
    to_be_even, "toBeEven", |v| is_odd(v) == Some(false);
    to_be_false, "toBeFalse", |v| v == JSValue::FALSE;
    to_be_falsy, "toBeFalsy", |v| !v.to_boolean();
    to_be_finite, "toBeFinite", |v| v.is_number() && v.as_number().is_finite();
    to_be_function, "toBeFunction", |v| v.is_callable();
    to_be_integer, "toBeInteger", |v| v.is_any_int();
    to_be_nan, "toBeNaN", |v| v.is_number() && v.as_number().is_nan();
    to_be_negative, "toBeNegative", |v| v.is_number() && v.as_number().is_finite() && v.as_number().round() < 0.0;
    to_be_nil, "toBeNil", |v| v.is_undefined_or_null();
    to_be_null, "toBeNull", |v| v.is_null();
    to_be_number, "toBeNumber", |v| v.is_number();
    to_be_odd, "toBeOdd", |v| is_odd(v) == Some(true);
    to_be_positive, "toBePositive", |v| v.is_number() && v.as_number().is_finite() && v.as_number().round() > 0.0;
    to_be_string, "toBeString", |v| v.is_string();
    to_be_symbol, "toBeSymbol", |v| v.is_symbol();
    to_be_true, "toBeTrue", |v| v == JSValue::TRUE;
    to_be_truthy, "toBeTruthy", |v| v.to_boolean();
    to_be_undefined, "toBeUndefined", |v| v.is_undefined();
}

/// `None` for anything but an integer.
fn is_odd(value: JSValue) -> Option<bool> {
    if value.is_int32() || value.is_big_int() {
        return Some(value.to_int64() & 1 == 1);
    }
    let remainder = (value.get_number()? % 2.0).abs();
    (remainder == 0.0 || remainder == 1.0).then_some(remainder == 1.0)
}

const TYPES: [&str; 8] = ["function", "object", "bigint", "boolean", "number", "string", "symbol", "undefined"];

fn type_of(value: JSValue) -> Option<&'static str> {
    Some(if value.is_callable() {
        "function"
    } else if value.is_object() || value.is_null() {
        "object"
    } else if value.is_big_int() {
        "bigint"
    } else if value.is_boolean() {
        "boolean"
    } else if value.is_number() {
        "number"
    } else if value.is_string_literal() {
        "string"
    } else if value.is_symbol() {
        "symbol"
    } else if value.is_undefined() {
        "undefined"
    } else {
        return None;
    })
}

impl Expect {
    #[optimize(size)]
    pub(crate) fn to_be_object(&self, this: This<'_>, cx: &mut JsScope<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toBeObject", NO_PARAMS)?;
        if m.passes(received.is_object()) {
            return m.pass_this();
        }
        if m.not() {
            return fail!(m, "Expected value <b>not<r> to be an object\n\nReceived: <red>{}<r>\n", m.show(received));
        }
        fail!(m, "Expected value to be an object\n\nReceived: <red>{}<r>\n", m.show(received))
    }

    #[optimize(size)]
    pub(crate) fn to_be_empty_object(&self, this: This<'_>, cx: &mut JsScope<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toBeEmptyObject", NO_PARAMS)?;
        if m.passes(received.is_object_empty(m.global)?) { m.pass_this() } else { m.fail_received(received) }
    }

    #[optimize(size)]
    pub(crate) fn to_be_valid_date(&self, this: This<'_>, cx: &mut JsScope<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toBeValidDate", NO_PARAMS)?;
        if m.passes(received.is_date() && !received.get_unix_timestamp().is_nan()) {
            m.pass_this()
        } else {
            m.fail_received(received)
        }
    }

    #[optimize(size)]
    pub(crate) fn to_be_type_of(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let (m, received) = this.start(cx, "toBeTypeOf", NO_PARAMS)?;
        let expected = expected.to_js();
        if !expected.is_string() {
            return Err(m.global.throw_invalid_arguments(format_args!("toBeTypeOf() requires a string argument")));
        }
        let expected_type = expected.to_bun_string(m.global)?;
        if !TYPES.iter().any(|name| expected_type.eq_ascii(name.as_bytes())) {
            return Err(m.global.throw_invalid_arguments(format_args!(
                "toBeTypeOf() requires a valid type string argument ('function', 'object', 'bigint', 'boolean', 'number', 'string', 'symbol', 'undefined')"
            )));
        }
        let Some(received_type) = type_of(received) else {
            return Err(m.global.throw(format_args!("Internal consistency error: unknown JSValue type")));
        };
        if m.passes(expected_type.eq_ascii(received_type.as_bytes())) {
            return m.pass();
        }
        fail!(
            m,
            "Expected type: {}<green>{}<r>\nReceived type: <red>\"{}\"<r>\nReceived value: <red>{}<r>\n",
            m.not_word(),
            m.show(expected),
            received_type,
            m.show(received),
        )
    }

    pub(crate) fn to_be_instance_of(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let m = this.begin(cx, "toBeInstanceOf", EXPECTED).count();
        let expected = expected.to_js();
        if !expected.is_constructor() {
            return Err(m.global.throw(format_args!("Expected value must be a function: {}", m.show(expected))));
        }
        let received = m.received()?;
        if m.passes(received.is_instance_of(m.global, expected)?) {
            return m.pass();
        }
        fail!(
            m,
            "Expected constructor: {}<green>{}<r>\nReceived value: <red>{}<r>\n",
            m.not_word(),
            m.show(expected),
            m.show(received)
        )
    }

    #[optimize(size)]
    pub(crate) fn to_satisfy(&self, this: This<'_>, cx: &mut JsScope<'_>, predicate: JsLocal<'_>) -> Verdict {
        let m = this.begin(cx, "toSatisfy", EXPECTED).count();
        let predicate = predicate.to_js();
        if !predicate.is_callable() {
            return Err(m.global.throw(format_args!("toSatisfy() argument must be a function")));
        }
        let received = m.received()?;
        let matched = predicate.call(m.global, JSValue::UNDEFINED, &[received])? == JSValue::TRUE;
        if m.passes(matched) {
            return m.pass();
        }
        if m.not() {
            return fail!(m, "Expected: not <green>{}<r>\n", m.show(predicate));
        }
        m.fail_expected(predicate, received)
    }

    #[optimize(size)]
    pub(crate) fn pass(&self, this: This<'_>, cx: &mut JsScope<'_>, message: JsLocal<'_>) -> Verdict {
        let (m, message) = start_with_message(this, cx, "pass", message, "passes by .pass() assertion")?;
        if m.passes(true) { m.pass() } else { Err(m.fail(format_args!("{message}\n"))) }
    }

    #[optimize(size)]
    pub(crate) fn fail(&self, this: This<'_>, cx: &mut JsScope<'_>, message: JsLocal<'_>) -> Verdict {
        let (m, message) = start_with_message(this, cx, "fail", message, "fails by .fail() assertion")?;
        if m.passes(false) { m.pass() } else { Err(m.signed_not(true).fail(format_args!("{message}\n"))) }
    }
}

#[optimize(size)]
fn start_with_message<'a>(
    this: This<'a>,
    cx: &'a mut JsScope<'_>,
    name: &'static str,
    message: JsLocal<'_>,
    default: &'static str,
) -> JsResult<(Matcher<'a>, bun_core::String)> {
    let call = this.begin(cx, name, NO_PARAMS);
    let message = message.to_js();
    let message = if message.is_undefined() {
        bun_core::String::static_(default)
    } else if message.is_string() {
        message.to_bun_string(call.global())?
    } else {
        return Err(call.global().throw_invalid_argument_type(name, "message", "string"));
    };
    Ok((call.count(), message))
}
