use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{BuiltinName, JSGlobalObject, JSType, JSValue, JsResult};
use super::JSValueTestExt;
use super::FormatterTestExt;
use bun_jsc::console_object::Formatter;
use bun_core::strings;

use super::DiffFormatter;
use super::Expect;
use super::Promise;
use super::get_signature;
use super::throw;

/// What `toThrow(expected)` compares the thrown value with.
#[derive(Clone, Copy)]
enum Comparison {
    Substring(JSValue),
    Pattern(JSValue),
    /// An asymmetric matcher, and what it answered about the thrown value.
    Matcher(JSValue, bool),
    Class(JSValue),
    /// The `message` of the expected object. The thrown value's has to be the same value.
    Message(JSValue),
    /// Compared like `toEqual()` does.
    Value(JSValue),
}

struct Thrown {
    value: JSValue,
    /// `None` until it is read.
    message: Option<Option<JSValue>>,
}

impl Thrown {
    /// The `message` of a thrown object. A thrown primitive is its own message.
    fn message(&mut self, global: &JSGlobalObject) -> JsResult<Option<JSValue>> {
        if let Some(message) = self.message {
            return Ok(message);
        }
        let message = if self.value.is_object() {
            self.value.fast_get(global, BuiltinName::Message)?
        } else {
            Some(JSValue::from_cell(self.value.to_js_string(global)?))
        };
        self.message = Some(message);
        Ok(message)
    }

    /// Vitest asks no class and no matcher about a falsy thrown value: `thrown && thrown instanceof expected`.
    #[inline(always)]
    fn is_asked(&self, expect: &Expect) -> bool {
        self.value.is_object() || self.value.to_boolean() || !expect.is_vitest()
    }
}

/// The `message` to compare before deep equality, which calls no `message` getter: a DOMException's, a ResolveMessage's, an error class's.
fn message_checked_first(global: &JSGlobalObject, expected: JSValue) -> JsResult<Option<JSValue>> {
    // Deep equality compares the properties of a plain object.
    if !expected.is_object() || expected.js_type() == JSType::FinalObject {
        return Ok(None);
    }
    expected.fast_get(global, BuiltinName::Message)
}

fn is_dom_exception(value: JSValue) -> bool {
    value.get_class_info_name() == Some(b"DOMException")
}

/// `None` if neither value is a DOMException. The `message` is not compared.
fn dom_exceptions_equal(global: &JSGlobalObject, thrown: JSValue, expected: JSValue) -> JsResult<Option<bool>> {
    let equal = match (is_dom_exception(thrown), is_dom_exception(expected)) {
        (false, false) => return Ok(None),
        (true, true) => {
            let name = thrown.fast_get(global, BuiltinName::name)?.unwrap_or(JSValue::UNDEFINED);
            let expected_name = expected.fast_get(global, BuiltinName::name)?.unwrap_or(JSValue::UNDEFINED);
            name.is_same_value(expected_name, global)?
                && match expected.get(global, "cause")? {
                    Some(expected_cause) => {
                        let cause = thrown.get(global, "cause")?.unwrap_or(JSValue::UNDEFINED);
                        cause.jest_deep_equals(expected_cause, global)?
                    }
                    None => true,
                }
        }
        _ => false,
    };
    Ok(Some(equal))
}

impl Comparison {
    /// A matcher is asked about `thrown` here, because its answer is what tells it from another object.
    #[inline(always)] // `to_throw` is optimized for size: it inlines `of`, `matches` and `is_asked` only by force.
    fn of(expect: &Expect, global: &JSGlobalObject, expected: JSValue, thrown: Option<&Thrown>) -> JsResult<Comparison> {
        debug_assert!(!expected.is_empty());
        // Jest's and Vitest's order: a class, a pattern, then an asymmetric matcher.
        let is_function = expected.is_object() && expected.js_type().is_function();
        let is_pattern = expected.is_reg_exp();
        if expected.is_object() && !is_function && !is_pattern {
            let answer = match thrown {
                Some(thrown) if thrown.is_asked(expect) => expected.jest_asymmetric_match(thrown.value, global)?,
                _ => (Expect::is_asymmetric_matcher(expected) || expected.has_asymmetric_match_method(global))
                    .then_some(false),
            };
            if let Some(matched) = answer {
                return Ok(Comparison::Matcher(expected, matched));
            }
        }
        if expected.is_string() {
            return Ok(Comparison::Substring(expected));
        }
        if is_pattern {
            return Ok(Comparison::Pattern(expected));
        }

        // Vitest compares any other value like toEqual() does.
        if expect.is_vitest() {
            // A callable Proxy is a class to Vitest: `typeof expected === "function"`.
            let is_class = is_function || expected.is_callable();
            return Ok(if is_class { Comparison::Class(expected) } else { Comparison::Value(expected) });
        }
        debug_assert!(expected.is_object());
        // Jest 30 also compares the cause and the class: https://github.com/oven-sh/bun/issues/8479
        Ok(match expected.fast_get(global, BuiltinName::Message)? {
            Some(message) => Comparison::Message(message),
            None => Comparison::Class(expected),
        })
    }

    /// A `Value` whose `message` is the difference becomes a `Message`, which is what the failure then names.
    #[inline(always)]
    fn matches(&mut self, expect: &Expect, global: &JSGlobalObject, thrown: &mut Thrown) -> JsResult<bool> {
        match *self {
            Comparison::Substring(substring) => {
                let Some(message) = thrown.message(global)? else { return Ok(false) };
                let substring = substring.to_utf8(global)?;
                let message = message.to_utf8(global)?;
                Ok(strings::contains(message.slice(), substring.slice()))
            }
            Comparison::Pattern(pattern) => {
                let Some(message) = thrown.message(global)? else { return Ok(false) };
                let Some(test_fn) = pattern.get(global, "test")? else { return Ok(false) };
                Ok(test_fn.call(global, pattern, &[message])?.to_boolean())
            }
            Comparison::Matcher(_, matched) => Ok(matched),
            Comparison::Class(class) => Ok(thrown.is_asked(expect) && thrown.value.is_instance_of(global, class)?),
            Comparison::Message(expected_message) => {
                let Some(message) = thrown.message(global)? else { return Ok(false) };
                message.is_same_value(expected_message, global)
            }
            Comparison::Value(expected) => {
                if thrown.value.is_object() && expected.is_object() {
                    // Vitest asks the equality testers before it compares anything. Deep equality asks them again if none decides.
                    if let Some(equal) = Expect::run_equality_testers(global, thrown.value, expected)? {
                        return Ok(equal);
                    }
                    if let Some(expected_message) = message_checked_first(global, expected)? {
                        let message = thrown.message(global)?.unwrap_or(JSValue::UNDEFINED);
                        if !message.is_same_value(expected_message, global)? {
                            *self = Comparison::Message(expected_message);
                            return Ok(false);
                        }
                    }
                    // Deep equality compares where a native DOMException was created, and never its `name`.
                    if let Some(equal) = dom_exceptions_equal(global, thrown.value, expected)? {
                        return Ok(equal);
                    }
                }
                thrown.value.jest_deep_equals(expected, global)
            }
        }
    }

    /// What a failure calls the expected string, RegExp or `message`.
    fn noun(self) -> &'static str {
        match self {
            Comparison::Substring(_) => "substring",
            Comparison::Pattern(_) => "pattern",
            _ => "message",
        }
    }
}

impl Expect {
    #[optimize(size)]
    pub(crate) fn to_throw(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let this = self.post_match_guard(global);

        let this_value = this_value.to_js();

        this.increment_expect_call_counter();

        let expected_value: JSValue = 'brk: {
            let value = expected.to_js();
            if value.is_undefined() {
                break 'brk JSValue::ZERO;
            }
            if !value.is_object() {
                if value.is_string() {
                    // `.toThrow("")` behaves the same as `.toThrow()`
                    let s = value.to_js_string(global)?;
                    if s.length() == 0 {
                        break 'brk JSValue::ZERO;
                    }
                } else if value.is_null() || !this.is_vitest() {
                    // Vitest also takes a number, boolean, bigint or symbol.
                    let mut fmt = Formatter::new(global).with_quote_strings(true);
                    return Err(global.throw(format_args!(
                        "Expected value must be string or Error: {}",
                        value.to_fmt(&mut fmt),
                    )));
                }
            }
            break 'brk value;
        };
        expected_value.ensure_still_alive();

        let not = this.flags.get().not();

        let received = this.get_value(global, this_value, "toThrow", "<green>expected<r>")?;
        // Nothing was thrown if the promise resolved to a value that can't be called. Jest, unlike Vitest, counts an error as thrown.
        let resolved_without_throwing = this.flags.get().promise() == Promise::Resolves
            && !received.js_type().is_function()
            && (!received.is_any_error() || this.is_vitest());
        let (thrown, return_value_from_function) = if resolved_without_throwing {
            (None, received)
        } else {
            this.get_value_as_to_throw(global, received)?
        };

        if not && thrown.is_none() {
            return Ok(JSValue::UNDEFINED);
        }
        let mut thrown = thrown.map(|value| Thrown { value, message: None });
        // `toThrow()`, `toThrow(undefined)` and `toThrow("")` compare nothing: anything thrown will do.
        let mut comparison = if expected_value.is_empty() {
            None
        } else {
            Some(Comparison::of(&this, global, expected_value, thrown.as_ref())?)
        };
        let Some(thrown) = thrown.as_mut() else {
            return this.throw_did_not_throw(global, comparison, return_value_from_function);
        };
        let Some(comparison) = comparison.as_mut() else {
            if !not {
                return Ok(JSValue::UNDEFINED);
            }
            return this.throw_threw(global, thrown.value);
        };
        if comparison.matches(&this, global, thrown)? != not {
            return Ok(JSValue::UNDEFINED);
        }
        if not {
            this.throw_thrown_matches(global, thrown, *comparison)
        } else {
            this.throw_thrown_differs(global, thrown, *comparison)
        }
    }

    /// `toThrow(...)` on a function that threw nothing.
    #[cold]
    #[optimize(size)]
    fn throw_did_not_throw(
        &self,
        global: &JSGlobalObject,
        comparison: Option<Comparison>,
        returned: JSValue,
    ) -> JsResult<JSValue> {
        let mut formatter = Formatter::new(global).with_quote_strings(true);
        let mut formatter2 = super::make_formatter(global);

        let Some(comparison) = comparison else {
            let signature: &'static str = get_signature("toThrow", "", false);
            return throw!(
                self,
                global,
                signature,
                "\n\nReceived function did not throw\nReceived value: <red>{}<r>\n",
                returned.to_fmt(&mut formatter),
            );
        };
        // An expected error is named by its `message`.
        let comparison = match comparison {
            Comparison::Value(expected) => {
                message_checked_first(global, expected)?.map_or(comparison, Comparison::Message)
            }
            _ => comparison,
        };

        let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);
        match comparison {
            Comparison::Substring(expected) | Comparison::Pattern(expected) | Comparison::Message(expected) => throw!(
                self,
                global,
                signature,
                "\n\nExpected {}: <green>{}<r>\n\nReceived function did not throw\nReceived value: <red>{}<r>\n",
                comparison.noun(),
                expected.to_fmt(&mut formatter),
                returned.to_fmt(&mut formatter2),
            ),
            Comparison::Matcher(expected, _) | Comparison::Value(expected) => throw!(
                self,
                global,
                signature,
                "\n\nExpected value: <green>{}<r>\n\nReceived function did not throw\nReceived value: <red>{}<r>\n",
                expected.to_fmt(&mut formatter2),
                returned.to_fmt(&mut formatter),
            ),
            Comparison::Class(class) => {
                let expected_class = class.get_class_name(global)?;
                throw!(
                    self,
                    global,
                    signature,
                    "\n\nExpected constructor: <green>{}<r>\n\nReceived function did not throw\nReceived value: <red>{}<r>\n",
                    expected_class,
                    returned.to_fmt(&mut formatter),
                )
            }
        }
    }

    /// `.not.toThrow()` on a function that threw.
    #[cold]
    #[optimize(size)]
    fn throw_threw(&self, global: &JSGlobalObject, thrown: JSValue) -> JsResult<JSValue> {
        let signature: &'static str = get_signature("toThrow", "", true);
        let mut formatter = Formatter::new(global).with_quote_strings(true);
        if let Some(err) = thrown.to_error() {
            let name: JSValue = err.get_truthy(global, "name")?.unwrap_or(JSValue::UNDEFINED);
            let message: JSValue = err.get_truthy(global, "message")?.unwrap_or(JSValue::UNDEFINED);
            let mut formatter2 = super::make_formatter(global);
            return throw!(
                self,
                global,
                signature,
                "\n\nError name: <red>{}<r>\nError message: <red>{}<r>\n",
                name.to_fmt(&mut formatter),
                message.to_fmt(&mut formatter2),
            );
        }

        // non error thrown
        throw!(
            self,
            global,
            signature,
            "\n\nThrown value: <red>{}<r>\n",
            thrown.to_fmt(&mut formatter),
        )
    }

    /// `toThrow(expected)` on a function that threw something else.
    #[cold]
    #[optimize(size)]
    fn throw_thrown_differs(
        &self,
        global: &JSGlobalObject,
        thrown: &mut Thrown,
        comparison: Comparison,
    ) -> JsResult<JSValue> {
        let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);
        let mut formatter = Formatter::new(global).with_quote_strings(true);
        let mut formatter2 = super::make_formatter(global);
        match comparison {
            Comparison::Substring(expected) | Comparison::Pattern(expected) => {
                if let Some(message) = thrown.message(global)? {
                    return throw!(
                        self,
                        global,
                        signature,
                        "\n\nExpected {}: <green>{}<r>\nReceived message: <red>{}<r>\n",
                        comparison.noun(),
                        expected.to_fmt(&mut formatter),
                        message.to_fmt(&mut formatter2),
                    );
                }
                throw!(
                    self,
                    global,
                    signature,
                    "\n\nExpected {}: <green>{}<r>\nReceived value: <red>{}<r>",
                    comparison.noun(),
                    expected.to_fmt(&mut formatter),
                    thrown.value.to_fmt(&mut formatter2),
                )
            }
            Comparison::Matcher(matcher, _) => throw!(
                self,
                global,
                signature,
                "\n\nExpected value: <green>{}<r>\nReceived value: <red>{}<r>\n",
                matcher.to_fmt(&mut formatter2),
                thrown.value.to_fmt(&mut formatter),
            ),
            Comparison::Message(expected_message) => {
                if let Some(message) = thrown.message(global)? {
                    return throw!(
                        self,
                        global,
                        signature,
                        "\n\nExpected message: <green>{}<r>\nReceived message: <red>{}<r>\n",
                        expected_message.to_fmt(&mut formatter),
                        message.to_fmt(&mut formatter2),
                    );
                }
                throw!(
                    self,
                    global,
                    signature,
                    "\n\nExpected message: <green>{}<r>\nReceived value: <red>{}<r>\n",
                    expected_message.to_fmt(&mut formatter),
                    thrown.value.to_fmt(&mut formatter2),
                )
            }
            Comparison::Class(class) => {
                let expected_class = class.get_class_name(global)?;
                let received_class = thrown.value.get_class_name(global)?;
                // A symbol has no string to show as its message.
                let message = if thrown.value.is_symbol() { None } else { thrown.message(global)? };
                if let Some(message) = message {
                    return throw!(
                        self,
                        global,
                        signature,
                        "\n\nExpected constructor: <green>{}<r>\nReceived constructor: <red>{}<r>\n\nReceived message: <red>{}<r>\n",
                        expected_class,
                        received_class,
                        message.to_fmt(&mut formatter),
                    );
                }
                throw!(
                    self,
                    global,
                    signature,
                    "\n\nExpected constructor: <green>{}<r>\nReceived constructor: <red>{}<r>\n\nReceived value: <red>{}<r>\n",
                    expected_class,
                    received_class,
                    thrown.value.to_fmt(&mut formatter),
                )
            }
            Comparison::Value(expected) => {
                let diff_formatter = DiffFormatter::new(global, thrown.value, expected, false)?;
                throw!(self, global, signature, "\n\n{}\n", diff_formatter)
            }
        }
    }

    /// `.not.toThrow(expected)` on a function that threw what `expected` describes.
    #[cold]
    #[optimize(size)]
    fn throw_thrown_matches(
        &self,
        global: &JSGlobalObject,
        thrown: &mut Thrown,
        comparison: Comparison,
    ) -> JsResult<JSValue> {
        let signature: &'static str = get_signature("toThrow", "<green>expected<r>", true);
        let mut formatter = Formatter::new(global).with_quote_strings(true);
        let mut formatter2 = super::make_formatter(global);
        match comparison {
            Comparison::Substring(expected) | Comparison::Pattern(expected) => {
                let message = thrown.message(global)?.unwrap_or(JSValue::UNDEFINED);
                throw!(
                    self,
                    global,
                    signature,
                    "\n\nExpected {}: not <green>{}<r>\nReceived message: <red>{}<r>\n",
                    comparison.noun(),
                    expected.to_fmt(&mut formatter),
                    message.to_fmt(&mut formatter2),
                )
            }
            Comparison::Matcher(matcher, _) => throw!(
                self,
                global,
                signature,
                "\n\nExpected value: not <green>{}<r>\nReceived value: <red>{}<r>\n",
                matcher.to_fmt(&mut formatter2),
                thrown.value.to_fmt(&mut formatter),
            ),
            Comparison::Message(expected_message) => throw!(
                self,
                global,
                signature,
                "\n\nExpected message: not <green>{}<r>\n",
                expected_message.to_fmt(&mut formatter),
            ),
            Comparison::Class(class) => {
                let expected_class = class.get_class_name(global)?;
                // `Symbol.hasInstance` can accept a thrown value that isn't an object.
                let message = if thrown.value.is_object() { thrown.message(global)? } else { None };
                if let Some(message) = message {
                    return throw!(
                        self,
                        global,
                        signature,
                        "\n\nExpected constructor: not <green>{}<r>\n\nReceived message: <red>{}<r>\n",
                        expected_class,
                        message.to_fmt(&mut formatter),
                    );
                }
                throw!(
                    self,
                    global,
                    signature,
                    "\n\nExpected constructor: not <green>{}<r>\n\nReceived value: <red>{}<r>\n",
                    expected_class,
                    thrown.value.to_fmt(&mut formatter),
                )
            }
            Comparison::Value(expected) => {
                let diff_formatter = DiffFormatter::new(global, thrown.value, expected, true)?;
                throw!(self, global, signature, "\n\n{}\n", diff_formatter)
            }
        }
    }
}
