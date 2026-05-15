use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use super::FormatterTestExt;
use bun_jsc::console_object::Formatter;
use bun_jsc::JsClass;
use bun_core::{strings, ZigString};

use super::Expect;
use super::ExpectAny;
use super::expect_any_js;
use super::get_signature;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_throw(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // `defer this.postMatch(globalThis)` — scopeguard owns the &mut Expect and runs
    // post_match on drop; the body re-borrows `this` through Deref/DerefMut so post_match
    // runs on every exit path (Ok and Err alike).
    let this = scopeguard::guard(this, |t| t.post_match(global));

    let this_value = frame.this();
    let arguments = frame.arguments_as_array::<1>();

    this.increment_expect_call_counter();

    let expected_value: JSValue = 'brk: {
        let value = arguments[0];
        if value.is_undefined() {
            break 'brk JSValue::ZERO;
        }
        if value.is_undefined_or_null() || (!value.is_object() && !value.is_string()) {
            let mut fmt = Formatter::new(global).with_quote_strings(true);
            return Err(global.throw(format_args!(
                "Expected value must be string or Error: {}",
                value.to_fmt(&mut fmt),
            )));
        }
        if value.is_object() {
            if ExpectAny::from_js_direct(value).is_some() {
                if let Some(inner_constructor_value) =
                    expect_any_js::constructor_value_get_cached(value)
                {
                    break 'brk inner_constructor_value;
                }
            }
        } else if value.is_string() {
            // `.toThrow("")` behaves the same as `.toThrow()`
            let s = value.to_js_string(global)?;
            if s.length() == 0 {
                break 'brk JSValue::ZERO;
            }
        }
        break 'brk value;
    };
    expected_value.ensure_still_alive();

    let not = this.flags.get().not();

    let (result_, return_value_from_function) = this.get_value_as_to_throw(
        global,
        this.get_value(global, this_value, "toThrow", "<green>expected<r>")?,
    )?;

    let did_throw = result_.is_some();

    if not {
        // PERF(port): was comptime — get_signature should be const fn returning &'static str
        let signature: &'static str = get_signature("toThrow", "<green>expected<r>", true);

        if !did_throw {
            return Ok(JSValue::UNDEFINED);
        }

        let result: JSValue = result_.unwrap();
        let mut formatter = Formatter::new(global).with_quote_strings(true);

        if expected_value.is_empty() || expected_value.is_undefined() {
            let signature_no_args: &'static str = get_signature("toThrow", "", true);
            if let Some(err) = result.to_error() {
                let name: JSValue = err
                    .get_truthy(global, "name")?
                    .unwrap_or(JSValue::UNDEFINED);
                let message: JSValue = err
                    .get_truthy(global, "message")?
                    .unwrap_or(JSValue::UNDEFINED);
                let mut formatter2 = super::make_formatter(global);
                return Err(global.throw_pretty(format_args!(
                    "{signature_no_args}\n\nError name: <red>{}<r>\nError message: <red>{}<r>\n",
                    name.to_fmt(&mut formatter),
                    message.to_fmt(&mut formatter2),
                )));
            }

            // non error thrown
            return Err(global.throw_pretty(format_args!(
                "{signature_no_args}\n\nThrown value: <red>{}<r>\n",
                result.to_fmt(&mut formatter),
            )));
        }

        if expected_value.is_string() {
            let received_message: JSValue = (if result.is_object() {
                result.fast_get(global, bun_jsc::BuiltinName::Message)?
            } else {
                Some(JSValue::from_cell(result.to_js_string(global)?))
            })
            .unwrap_or(JSValue::UNDEFINED);
            if global.has_exception() {
                return Ok(JSValue::ZERO);
            }

            // TODO: remove this allocation
            // partial match
            {
                let expected_slice = expected_value.to_slice_or_null(global)?;
                let received_slice = received_message.to_slice_or_null(global)?;
                if !strings::contains(received_slice.slice(), expected_slice.slice()) {
                    return Ok(JSValue::UNDEFINED);
                }
            }

            let mut formatter2 = super::make_formatter(global);
            return this.throw(
                global,
                signature,
                format_args!(
                    "\n\nExpected substring: not <green>{}<r>\nReceived message: <red>{}<r>\n",
                    expected_value.to_fmt(&mut formatter),
                    received_message.to_fmt(&mut formatter2),
                ),
            );
        }

        if expected_value.is_reg_exp() {
            let received_message: JSValue = (if result.is_object() {
                result.fast_get(global, bun_jsc::BuiltinName::Message)?
            } else {
                Some(JSValue::from_cell(result.to_js_string(global)?))
            })
            .unwrap_or(JSValue::UNDEFINED);

            if global.has_exception() {
                return Ok(JSValue::ZERO);
            }
            // TODO: REMOVE THIS GETTER! Expose a binding to call .test on the RegExp object directly.
            if let Some(test_fn) = expected_value.get(global, "test")? {
                let matches = test_fn
                    .call(global, expected_value, &[received_message])
                    .unwrap_or_else(|err| global.take_exception(err));
                if !matches.to_boolean() {
                    return Ok(JSValue::UNDEFINED);
                }
            }

            let mut formatter2 = super::make_formatter(global);
            return this.throw(
                global,
                signature,
                format_args!(
                    "\n\nExpected pattern: not <green>{}<r>\nReceived message: <red>{}<r>\n",
                    expected_value.to_fmt(&mut formatter),
                    received_message.to_fmt(&mut formatter2),
                ),
            );
        }

        if let Some(expected_message) = expected_value.fast_get(global, bun_jsc::BuiltinName::Message)? {
            let received_message: JSValue = (if result.is_object() {
                result.fast_get(global, bun_jsc::BuiltinName::Message)?
            } else {
                Some(JSValue::from_cell(result.to_js_string(global)?))
            })
            .unwrap_or(JSValue::UNDEFINED);
            if global.has_exception() {
                return Ok(JSValue::ZERO);
            }

            // no partial match for this case
            if !expected_message.is_same_value(received_message, global)? {
                return Ok(JSValue::UNDEFINED);
            }

            return this.throw(
                global,
                signature,
                format_args!(
                    "\n\nExpected message: not <green>{}<r>\n",
                    expected_message.to_fmt(&mut formatter),
                ),
            );
        }

        if !result.is_instance_of(global, expected_value)? {
            return Ok(JSValue::UNDEFINED);
        }

        let mut expected_class = ZigString::EMPTY;
        expected_value.get_class_name(global, &mut expected_class)?;
        let received_message: JSValue = result
            .fast_get(global, bun_jsc::BuiltinName::Message)?
            .unwrap_or(JSValue::UNDEFINED);
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected constructor: not <green>{}<r>\n\nReceived message: <red>{}<r>\n",
                expected_class,
                received_message.to_fmt(&mut formatter),
            ),
        );
    }

    if did_throw {
        if expected_value.is_empty() || expected_value.is_undefined() {
            return Ok(JSValue::UNDEFINED);
        }

        let result: JSValue = if let Some(r) = result_.unwrap().to_error() {
            r
        } else {
            result_.unwrap()
        };

        let received_message_opt: Option<JSValue> = if result.is_object() {
            result.fast_get(global, bun_jsc::BuiltinName::Message)?
        } else {
            Some(JSValue::from_cell(result.to_js_string(global)?))
        };

        if expected_value.is_string() {
            if let Some(received_message) = received_message_opt {
                // TODO: remove this allocation
                // partial match
                let expected_slice = expected_value.to_slice_or_null(global)?;
                let received_slice = received_message.to_slice(global)?;
                if strings::contains(received_slice.slice(), expected_slice.slice()) {
                    return Ok(JSValue::UNDEFINED);
                }
            }

            // error: message from received error does not match expected string
            let mut formatter = Formatter::new(global).with_quote_strings(true);

            let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);

            let mut formatter2 = super::make_formatter(global);
            if let Some(received_message) = received_message_opt {
                return this.throw(
                    global,
                    signature,
                    format_args!(
                        "\n\nExpected substring: <green>{}<r>\nReceived message: <red>{}<r>\n",
                        expected_value.to_fmt(&mut formatter),
                        received_message.to_fmt(&mut formatter2),
                    ),
                );
            }

            return this.throw(
                global,
                signature,
                format_args!(
                    "\n\nExpected substring: <green>{}<r>\nReceived value: <red>{}<r>",
                    expected_value.to_fmt(&mut formatter),
                    result.to_fmt(&mut formatter2),
                ),
            );
        }

        if expected_value.is_reg_exp() {
            if let Some(received_message) = received_message_opt {
                // TODO: REMOVE THIS GETTER! Expose a binding to call .test on the RegExp object directly.
                if let Some(test_fn) = expected_value.get(global, "test")? {
                    let matches = test_fn
                        .call(global, expected_value, &[received_message])
                        .unwrap_or_else(|err| global.take_exception(err));
                    if matches.to_boolean() {
                        return Ok(JSValue::UNDEFINED);
                    }
                }
            }

            // error: message from received error does not match expected pattern
            let mut formatter = Formatter::new(global).with_quote_strings(true);

            let mut formatter2 = super::make_formatter(global);
            if let Some(received_message) = received_message_opt {
                let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);
                return this.throw(
                    global,
                    signature,
                    format_args!(
                        "\n\nExpected pattern: <green>{}<r>\nReceived message: <red>{}<r>\n",
                        expected_value.to_fmt(&mut formatter),
                        received_message.to_fmt(&mut formatter2),
                    ),
                );
            }

            let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);
            return this.throw(
                global,
                signature,
                format_args!(
                    "\n\nExpected pattern: <green>{}<r>\nReceived value: <red>{}<r>",
                    expected_value.to_fmt(&mut formatter),
                    result.to_fmt(&mut formatter2),
                ),
            );
        }

        if Expect::is_asymmetric_matcher(expected_value) {
            let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);
            let is_equal = result.jest_strict_deep_equals(expected_value, global)?;

            if global.has_exception() {
                return Ok(JSValue::ZERO);
            }

            if is_equal {
                return Ok(JSValue::UNDEFINED);
            }

            let mut formatter = Formatter::new(global).with_quote_strings(true);
            let mut formatter2 = super::make_formatter(global);
            return this.throw(
                global,
                signature,
                format_args!(
                    "\n\nExpected value: <green>{}<r>\nReceived value: <red>{}<r>\n",
                    expected_value.to_fmt(&mut formatter2),
                    result.to_fmt(&mut formatter),
                ),
            );
        }

        // If it's not an object, we are going to crash here.
        debug_assert!(expected_value.is_object());

        if let Some(expected_message) = expected_value.fast_get(global, bun_jsc::BuiltinName::Message)? {
            let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);

            if let Some(received_message) = received_message_opt {
                if received_message.is_same_value(expected_message, global)? {
                    return Ok(JSValue::UNDEFINED);
                }
            }

            // error: message from received error does not match expected error message.
            let mut formatter = Formatter::new(global).with_quote_strings(true);
            let mut formatter2 = super::make_formatter(global);

            if let Some(received_message) = received_message_opt {
                return this.throw(
                    global,
                    signature,
                    format_args!(
                        "\n\nExpected message: <green>{}<r>\nReceived message: <red>{}<r>\n",
                        expected_message.to_fmt(&mut formatter),
                        received_message.to_fmt(&mut formatter2),
                    ),
                );
            }

            return this.throw(
                global,
                signature,
                format_args!(
                    "\n\nExpected message: <green>{}<r>\nReceived value: <red>{}<r>\n",
                    expected_message.to_fmt(&mut formatter),
                    result.to_fmt(&mut formatter2),
                ),
            );
        }

        if result.is_instance_of(global, expected_value)? {
            return Ok(JSValue::UNDEFINED);
        }

        // error: received error not instance of received error constructor
        let mut formatter = Formatter::new(global).with_quote_strings(true);
        let mut expected_class = ZigString::EMPTY;
        let mut received_class = ZigString::EMPTY;
        expected_value.get_class_name(global, &mut expected_class)?;
        result.get_class_name(global, &mut received_class)?;
        let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);

        if let Some(received_message) = received_message_opt {
            return Err(global.throw_pretty(format_args!(
                "{signature}\n\nExpected constructor: <green>{}<r>\nReceived constructor: <red>{}<r>\n\nReceived message: <red>{}<r>\n",
                expected_class,
                received_class,
                received_message.to_fmt(&mut formatter),
            )));
        }

        return Err(global.throw_pretty(format_args!(
            "{signature}\n\nExpected constructor: <green>{}<r>\nReceived constructor: <red>{}<r>\n\nReceived value: <red>{}<r>\n",
            expected_class,
            received_class,
            result.to_fmt(&mut formatter),
        )));
    }

    // did not throw
    let result = return_value_from_function;
    let mut formatter = Formatter::new(global).with_quote_strings(true);
    let mut formatter2 = super::make_formatter(global);
    // PORT NOTE: Zig `received_line` was concatenated via `++` into each fmt string
    // below; Rust `format_args!` only accepts literals so the value is inlined at each site.
    // received_line = "Received function did not throw\nReceived value: <red>{f}<r>\n"

    if expected_value.is_empty() || expected_value.is_undefined() {
        let signature: &'static str = get_signature("toThrow", "", false);
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nReceived function did not throw\nReceived value: <red>{}<r>\n",
                result.to_fmt(&mut formatter),
            ),
        );
    }

    let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);

    if expected_value.is_string() {
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected substring: <green>{}<r>\n\nReceived function did not throw\nReceived value: <red>{}<r>\n",
                expected_value.to_fmt(&mut formatter),
                result.to_fmt(&mut formatter2),
            ),
        );
    }

    if expected_value.is_reg_exp() {
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected pattern: <green>{}<r>\n\nReceived function did not throw\nReceived value: <red>{}<r>\n",
                expected_value.to_fmt(&mut formatter),
                result.to_fmt(&mut formatter2),
            ),
        );
    }

    if let Some(expected_message) = expected_value.fast_get(global, bun_jsc::BuiltinName::Message)? {
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected message: <green>{}<r>\n\nReceived function did not throw\nReceived value: <red>{}<r>\n",
                expected_message.to_fmt(&mut formatter),
                result.to_fmt(&mut formatter2),
            ),
        );
    }

    let mut expected_class = ZigString::EMPTY;
    expected_value.get_class_name(global, &mut expected_class)?;
    this.throw(
        global,
        signature,
        format_args!(
            "\n\nExpected constructor: <green>{}<r>\n\nReceived function did not throw\nReceived value: <red>{}<r>\n",
            expected_class,
            result.to_fmt(&mut formatter),
        ),
    )
}

// ported from: src/test_runner/expect/toThrow.zig
