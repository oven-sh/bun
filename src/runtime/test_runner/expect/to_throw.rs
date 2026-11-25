use bun_core::strings;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{BuiltinName, JSGlobalObject, JSValue, JsResult};

use super::matcher::{EXPECTED, Matcher, NO_PARAMS, This, Verdict, fail};
use super::{Expect, ExpectAny, JSValueTestExt as _, Promise, Received};
use crate::generated_bindgen::expect::js_ExpectAny;

/// What a message is compared with.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Text {
    Substring,
    Pattern,
    Message,
}

impl Text {
    fn noun(self) -> &'static str {
        match self {
            Text::Substring => "substring",
            Text::Pattern => "pattern",
            Text::Message => "message",
        }
    }

    /// `None` for a RegExp without `test`.
    fn matches(self, global: &JSGlobalObject, expected: JSValue, message: JSValue) -> JsResult<Option<bool>> {
        Ok(Some(match self {
            Text::Substring => {
                let (substring, message) = (expected.to_utf8(global)?, message.to_utf8(global)?);
                strings::contains(&message, &substring)
            }
            // TODO: REMOVE THIS GETTER! Expose a binding to call .test on the RegExp object directly.
            Text::Pattern => match expected.get(global, "test")? {
                Some(test) => test.call(global, expected, &[message])?.to_boolean(),
                None => return Ok(None),
            },
            Text::Message => message.is_same_value(expected, global)?,
        }))
    }
}

/// What `toThrow(expected)` compares the thrown value with.
enum Expected {
    Text(Text, JSValue),
    Class(JSValue),
}

impl Expected {
    /// Reads `value.message`, so it waits until the function has run.
    fn of(global: &JSGlobalObject, value: JSValue) -> JsResult<Self> {
        Ok(if value.is_string() {
            Expected::Text(Text::Substring, value)
        } else if value.is_reg_exp() {
            Expected::Text(Text::Pattern, value)
        } else if let Some(message) = value.fast_get(global, BuiltinName::Message)? {
            Expected::Text(Text::Message, message)
        } else {
            Expected::Class(value)
        })
    }
}

/// `None` if anything thrown will do.
fn expected_argument(m: &Matcher<'_>, value: JSValue) -> JsResult<Option<JSValue>> {
    if value.is_object() {
        let class =
            if value.is_direct::<ExpectAny>() { js_ExpectAny::constructor_value_get_cached(value) } else { None };
        Ok(Some(class.unwrap_or(value)))
    } else if value.is_string() {
        Ok((value.to_js_string(m.global)?.length() != 0).then_some(value))
    } else if value.is_undefined() {
        Ok(None)
    } else {
        Err(m.global.throw(format_args!("Expected value must be string or Error: {}", m.show(value))))
    }
}

/// A thrown primitive is its own message.
fn message_of(global: &JSGlobalObject, thrown: JSValue) -> JsResult<Option<JSValue>> {
    if thrown.is_object() {
        thrown.fast_get(global, BuiltinName::Message)
    } else {
        Ok(Some(JSValue::from_cell(thrown.to_js_string(global)?)))
    }
}

impl Expect {
    #[optimize(size)]
    pub(crate) fn to_throw(&self, this: This<'_>, cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> Verdict {
        let m = this.begin(cx, "toThrow", EXPECTED).count();
        let expected = expected_argument(&m, expected.to_js())?;
        let received = m.received()?;
        // Nothing was thrown if the promise resolved to a value that can't be called. Jest, unlike Vitest, counts an error as thrown.
        let resolved_without_throwing = m.promise() == Promise::Resolves
            && !received.js_type().is_function()
            && (!received.is_any_error() || self.is_vitest());
        let outcome =
            if resolved_without_throwing { Received::Value(received) } else { Self::call_to_throw(&m, received)? };
        match (outcome, expected) {
            (Received::Value(_), _) if m.not() => m.pass(),
            (Received::Value(returned), expected) => fail_did_not_throw(&m, expected, returned),
            (Received::Thrown(thrown), None) if m.not() => fail_threw(&m.with_params(NO_PARAMS), thrown),
            (Received::Thrown(_), None) => m.pass(),
            (Received::Thrown(thrown), Some(expected)) => compare_thrown(&m, expected, thrown),
        }
    }
}

#[optimize(size)]
fn compare_thrown(m: &Matcher<'_>, expected: JSValue, thrown: JSValue) -> Verdict {
    let global = m.global;
    let thrown = thrown.to_error().unwrap_or(thrown);
    // Without `.not`, the message is read before anything else, whatever it is compared with.
    let read_first = if !m.not() { Some(message_of(global, thrown)?) } else { None };
    let message = || read_first.map_or_else(|| message_of(global, thrown), Ok);

    // With `.not`, a matcher is not asked.
    if !m.not() && expected.is_object() && Expect::is_asymmetric_matcher(expected) {
        if thrown.jest_strict_deep_equals(expected, global)? {
            return m.pass();
        }
        return fail!(
            m,
            "Expected value: <green>{}<r>\nReceived value: <red>{}<r>\n",
            m.show(expected),
            m.show(thrown)
        );
    }
    match Expected::of(global, expected)? {
        Expected::Text(text, expected) => {
            // With `.not`, a missing message is compared as `undefined`.
            let Some(message) = message()?.or_else(|| m.not().then_some(JSValue::UNDEFINED)) else {
                let end = if text == Text::Message { "\n" } else { "" };
                return fail!(
                    m,
                    "Expected {}: <green>{}<r>\nReceived value: <red>{}<r>{}",
                    text.noun(),
                    m.show(expected),
                    m.show(thrown),
                    end
                );
            };
            if text.matches(global, expected, message)?.is_some_and(|matched| m.passes(matched)) {
                return m.pass();
            }
            if m.not() && text == Text::Message {
                return fail!(m, "Expected message: not <green>{}<r>\n", m.show(expected));
            }
            fail!(
                m,
                "Expected {}: {}<green>{}<r>\nReceived message: <red>{}<r>\n",
                text.noun(),
                m.not_word(),
                m.show(expected),
                m.show(message),
            )
        }
        Expected::Class(class) => {
            if m.passes(thrown.is_instance_of(global, class)?) {
                return m.pass();
            }
            let name = class.get_class_name(global)?;
            let received = |message: Option<JSValue>| message.map_or(("value", thrown), |message| ("message", message));
            if m.not() {
                // `Symbol.hasInstance` can accept a thrown value that isn't an object.
                let (noun, received) = received(if thrown.is_object() { message()? } else { None });
                return fail!(
                    m,
                    "Expected constructor: not <green>{}<r>\n\nReceived {}: <red>{}<r>\n",
                    name,
                    noun,
                    m.show(received)
                );
            }
            let thrown_name = thrown.get_class_name(global)?;
            let (noun, received) = received(message()?);
            fail!(
                m,
                "Expected constructor: <green>{}<r>\nReceived constructor: <red>{}<r>\n\nReceived {}: <red>{}<r>\n",
                name,
                thrown_name,
                noun,
                m.show(received),
            )
        }
    }
}

#[cold]
#[optimize(size)]
fn fail_threw(m: &Matcher<'_>, thrown: JSValue) -> Verdict {
    let Some(error) = thrown.to_error() else {
        return fail!(m, "Thrown value: <red>{}<r>\n", m.show(thrown));
    };
    let name = error.get_truthy(m.global, "name")?.unwrap_or(JSValue::UNDEFINED);
    let message = error.get_truthy(m.global, "message")?.unwrap_or(JSValue::UNDEFINED);
    fail!(m, "Error name: <red>{}<r>\nError message: <red>{}<r>\n", m.show(name), m.show(message))
}

#[cold]
#[optimize(size)]
fn fail_did_not_throw(m: &Matcher<'_>, expected: Option<JSValue>, returned: JSValue) -> Verdict {
    let Some(expected) = expected else {
        return fail!(
            m.with_params(NO_PARAMS),
            "Received function did not throw\nReceived value: <red>{}<r>\n",
            m.show(returned)
        );
    };
    let fail = |noun: &str, expected: &dyn core::fmt::Display| {
        fail!(
            m,
            "Expected {}: <green>{}<r>\n\nReceived function did not throw\nReceived value: <red>{}<r>\n",
            noun,
            expected,
            m.show(returned)
        )
    };
    match Expected::of(m.global, expected)? {
        Expected::Text(text, expected) => fail(text.noun(), &m.show(expected)),
        Expected::Class(class) => fail("constructor", &class.get_class_name(m.global)?),
    }
}
