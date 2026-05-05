use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_str::{strings, ZigString};

use super::Expect;
use super::expect_any::ExpectAny;
use super::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_throw(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // TODO(port): `defer this.postMatch(globalThis)` — needs an RAII guard (e.g.
    // `let _post = this.post_match_guard(global);`) because a scopeguard capturing
    // `&mut self` here would conflict with later borrows. Phase B: add such a guard
    // on Expect or call post_match() before every return.

    let this_value = frame.this();
    let arguments = frame.arguments_as_array::<1>();

    this.increment_expect_call_counter();

    let expected_value: JSValue = 'brk: {
        let value = arguments[0];
        if value.is_undefined() {
            break 'brk JSValue::ZERO;
        }
        if value.is_undefined_or_null() || (!value.is_object() && !value.is_string()) {
            let mut fmt = Formatter::new(global).quote_strings(true);
            return global.throw(format_args!(
                "Expected value must be string or Error: {}",
                value.to_fmt(&mut fmt),
            ));
        }
        if value.is_object() {
            if ExpectAny::from_js_direct(value).is_some() {
                if let Some(inner_constructor_value) =
                    ExpectAny::js::constructor_value_get_cached(value)
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

    let not = this.flags.not;

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
        let mut formatter = Formatter::new(global).quote_strings(true);

        if expected_value.is_empty() || expected_value.is_undefined() {
            let signature_no_args: &'static str = get_signature("toThrow", "", true);
            if let Some(err) = result.to_error() {
                let name: JSValue = err
                    .get_truthy_comptime(global, "name")?
                    .unwrap_or(JSValue::UNDEFINED);
                let message: JSValue = err
                    .get_truthy_comptime(global, "message")?
                    .unwrap_or(JSValue::UNDEFINED);
                // TODO(port): comptime string concat — get_signature must be const fn for concatcp!
                let fmt = const_format::concatcp!(
                    get_signature("toThrow", "", true),
                    "\n\nError name: <red>{}<r>\nError message: <red>{}<r>\n"
                );
                return global.throw_pretty(
                    fmt,
                    format_args!(
                        "{}{}",
                        name.to_fmt(&mut formatter),
                        message.to_fmt(&mut formatter),
                    ),
                );
            }

            // non error thrown
            let fmt = const_format::concatcp!(
                get_signature("toThrow", "", true),
                "\n\nThrown value: <red>{}<r>\n"
            );
            return global.throw_pretty(fmt, format_args!("{}", result.to_fmt(&mut formatter)));
            // TODO(port): throw_pretty arg-threading — Zig passes a tuple matched to {f}
            // placeholders; Rust side likely wants format_args! directly. Revisit API shape.
            #[allow(unreachable_code)]
            let _ = signature_no_args;
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

            return this.throw(
                global,
                signature,
                "\n\nExpected substring: not <green>{}<r>\nReceived message: <red>{}<r>\n",
                format_args!(
                    "{}{}",
                    expected_value.to_fmt(&mut formatter),
                    received_message.to_fmt(&mut formatter),
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

            return this.throw(
                global,
                signature,
                "\n\nExpected pattern: not <green>{}<r>\nReceived message: <red>{}<r>\n",
                format_args!(
                    "{}{}",
                    expected_value.to_fmt(&mut formatter),
                    received_message.to_fmt(&mut formatter),
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
                "\n\nExpected message: not <green>{}<r>\n",
                format_args!("{}", expected_message.to_fmt(&mut formatter)),
            );
        }

        if !result.is_instance_of(global, expected_value) {
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
            "\n\nExpected constructor: not <green>{}<r>\n\nReceived message: <red>{}<r>\n",
            format_args!("{}{}", expected_class, received_message.to_fmt(&mut formatter)),
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
            let mut formatter = Formatter::new(global).quote_strings(true);

            let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);

            if let Some(received_message) = received_message_opt {
                let expected_value_fmt = expected_value.to_fmt(&mut formatter);
                let received_message_fmt = received_message.to_fmt(&mut formatter);
                return this.throw(
                    global,
                    signature,
                    concat!("\n\n", "Expected substring: <green>{}<r>\nReceived message: <red>{}<r>\n"),
                    format_args!("{}{}", expected_value_fmt, received_message_fmt),
                );
            }

            let expected_fmt = expected_value.to_fmt(&mut formatter);
            let received_fmt = result.to_fmt(&mut formatter);
            return this.throw(
                global,
                signature,
                concat!("\n\n", "Expected substring: <green>{}<r>\nReceived value: <red>{}<r>"),
                format_args!("{}{}", expected_fmt, received_fmt),
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
            let mut formatter = Formatter::new(global).quote_strings(true);

            if let Some(received_message) = received_message_opt {
                let expected_value_fmt = expected_value.to_fmt(&mut formatter);
                let received_message_fmt = received_message.to_fmt(&mut formatter);
                let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);

                return this.throw(
                    global,
                    signature,
                    concat!("\n\n", "Expected pattern: <green>{}<r>\nReceived message: <red>{}<r>\n"),
                    format_args!("{}{}", expected_value_fmt, received_message_fmt),
                );
            }

            let expected_fmt = expected_value.to_fmt(&mut formatter);
            let received_fmt = result.to_fmt(&mut formatter);
            let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);
            return this.throw(
                global,
                signature,
                concat!("\n\n", "Expected pattern: <green>{}<r>\nReceived value: <red>{}<r>"),
                format_args!("{}{}", expected_fmt, received_fmt),
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

            let mut formatter = Formatter::new(global).quote_strings(true);
            let received_fmt = result.to_fmt(&mut formatter);
            let expected_fmt = expected_value.to_fmt(&mut formatter);
            return this.throw(
                global,
                signature,
                "\n\nExpected value: <green>{}<r>\nReceived value: <red>{}<r>\n",
                format_args!("{}{}", expected_fmt, received_fmt),
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
            let mut formatter = Formatter::new(global).quote_strings(true);

            if let Some(received_message) = received_message_opt {
                let expected_fmt = expected_message.to_fmt(&mut formatter);
                let received_fmt = received_message.to_fmt(&mut formatter);
                return this.throw(
                    global,
                    signature,
                    "\n\nExpected message: <green>{}<r>\nReceived message: <red>{}<r>\n",
                    format_args!("{}{}", expected_fmt, received_fmt),
                );
            }

            let expected_fmt = expected_message.to_fmt(&mut formatter);
            let received_fmt = result.to_fmt(&mut formatter);
            return this.throw(
                global,
                signature,
                "\n\nExpected message: <green>{}<r>\nReceived value: <red>{}<r>\n",
                format_args!("{}{}", expected_fmt, received_fmt),
            );
        }

        if result.is_instance_of(global, expected_value) {
            return Ok(JSValue::UNDEFINED);
        }

        // error: received error not instance of received error constructor
        let mut formatter = Formatter::new(global).quote_strings(true);
        let mut expected_class = ZigString::EMPTY;
        let mut received_class = ZigString::EMPTY;
        expected_value.get_class_name(global, &mut expected_class)?;
        result.get_class_name(global, &mut received_class)?;
        let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);
        // TODO(port): comptime string concat — requires get_signature to be const fn
        let fmt = const_format::concatcp!(
            get_signature("toThrow", "<green>expected<r>", false),
            "\n\nExpected constructor: <green>{}<r>\nReceived constructor: <red>{}<r>\n\n"
        );

        if let Some(received_message) = received_message_opt {
            let message_fmt = const_format::concatcp!(fmt, "Received message: <red>{}<r>\n");
            let received_message_fmt = received_message.to_fmt(&mut formatter);

            return global.throw_pretty(
                message_fmt,
                format_args!("{}{}{}", expected_class, received_class, received_message_fmt),
            );
        }

        let received_fmt = result.to_fmt(&mut formatter);
        let value_fmt = const_format::concatcp!(fmt, "Received value: <red>{}<r>\n");

        return global.throw_pretty(
            value_fmt,
            format_args!("{}{}{}", expected_class, received_class, received_fmt),
        );
        #[allow(unreachable_code)]
        let _ = signature;
    }

    // did not throw
    let result = return_value_from_function;
    let mut formatter = Formatter::new(global).quote_strings(true);
    // PORT NOTE: Zig `received_line` was concatenated via `++` into each fmt string
    // below; Rust `concat!` only accepts literals so the value is inlined at each site.
    // received_line = "Received function did not throw\nReceived value: <red>{any}<r>\n"

    if expected_value.is_empty() || expected_value.is_undefined() {
        let signature: &'static str = get_signature("toThrow", "", false);
        return this.throw(
            global,
            signature,
            concat!("\n\n", "Received function did not throw\nReceived value: <red>{}<r>\n"),
            format_args!("{}", result.to_fmt(&mut formatter)),
        );
    }

    let signature: &'static str = get_signature("toThrow", "<green>expected<r>", false);

    if expected_value.is_string() {
        let expected_fmt = concat!(
            "\n\nExpected substring: <green>{}<r>\n\n",
            "Received function did not throw\nReceived value: <red>{}<r>\n"
        );
        return this.throw(
            global,
            signature,
            expected_fmt,
            format_args!(
                "{}{}",
                expected_value.to_fmt(&mut formatter),
                result.to_fmt(&mut formatter),
            ),
        );
    }

    if expected_value.is_reg_exp() {
        let expected_fmt = concat!(
            "\n\nExpected pattern: <green>{}<r>\n\n",
            "Received function did not throw\nReceived value: <red>{}<r>\n"
        );
        return this.throw(
            global,
            signature,
            expected_fmt,
            format_args!(
                "{}{}",
                expected_value.to_fmt(&mut formatter),
                result.to_fmt(&mut formatter),
            ),
        );
    }

    if let Some(expected_message) = expected_value.fast_get(global, bun_jsc::BuiltinName::Message)? {
        let expected_fmt = concat!(
            "\n\nExpected message: <green>{}<r>\n\n",
            "Received function did not throw\nReceived value: <red>{}<r>\n"
        );
        return this.throw(
            global,
            signature,
            expected_fmt,
            format_args!(
                "{}{}",
                expected_message.to_fmt(&mut formatter),
                result.to_fmt(&mut formatter),
            ),
        );
    }

    let expected_fmt = concat!(
        "\n\nExpected constructor: <green>{}<r>\n\n",
        "Received function did not throw\nReceived value: <red>{}<r>\n"
    );
    let mut expected_class = ZigString::EMPTY;
    expected_value.get_class_name(global, &mut expected_class)?;
    return this.throw(
        global,
        signature,
        expected_fmt,
        format_args!("{}{}", expected_class, result.to_fmt(&mut formatter)),
    );
}

// TODO(port): confirm `bun_jsc::BuiltinName::Message` is the correct variant
// path for `fastGet(global, .message)` once `bun_jsc` exposes the builtin-name enum.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toThrow.zig (319 lines)
//   confidence: medium
//   todos:      5
//   notes:      throw_pretty/this.throw fmt-arg threading is approximated via format_args!; get_signature must be const fn for concatcp!; defer post_match needs RAII guard; BuiltinName::Message path unconfirmed
// ──────────────────────────────────────────────────────────────────────────
