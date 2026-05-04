use core::ffi::c_void;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, VM};
use bun_jsc::console_object::Formatter;
use bun_str::strings;

use super::Expect;
use super::get_signature;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO(port): `defer this.postMatch(globalThis)` — scopeguard captures &mut self and
        // conflicts with later uses; Phase B may need to reshape (call before each return or
        // use a raw-pointer guard).
        scopeguard::defer! { this.post_match(global); }

        let this_value = frame.this();
        let arguments_ = frame.arguments_old(1);
        let arguments = arguments_.slice();

        if arguments.len() < 1 {
            return global.throw_invalid_arguments(format_args!("toContain() takes 1 argument"));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        expected.ensure_still_alive();
        let value: JSValue = this.get_value(global, this_value, "toContain", "<green>expected<r>")?;

        let not = this.flags.not;
        let mut pass = false;

        struct ExpectedEntry<'a> {
            global: &'a JSGlobalObject,
            expected: JSValue,
            pass: &'a mut bool,
        }

        if value.js_type_loose().is_array_like() {
            let mut itr = value.array_iterator(global)?;
            while let Some(item) = itr.next()? {
                if item.is_same_value(expected, global)? {
                    pass = true;
                    break;
                }
            }
        } else if value.is_string_literal() && expected.is_string_literal() {
            let value_string = value.to_slice(global)?;
            let expected_string = expected.to_slice(global)?;

            if expected_string.len() == 0 {
                // edge case empty string is always contained
                pass = true;
            } else if strings::contains(value_string.slice(), expected_string.slice()) {
                pass = true;
            } else if value_string.len() == 0 && expected_string.len() == 0 {
                // edge case two empty strings are true
                pass = true;
            }
        } else if value.is_iterable(global)? {
            let mut expected_entry = ExpectedEntry {
                global,
                expected,
                pass: &mut pass,
            };

            extern "C" fn same_value_iterator(
                _: *mut VM,
                _: *mut JSGlobalObject,
                entry_: *mut c_void,
                item: JSValue,
            ) {
                // SAFETY: entry_ is &mut ExpectedEntry on the caller's stack, threaded through
                // for_each as opaque userdata; non-null asserted by Zig `entry_.?`.
                debug_assert!(!entry_.is_null());
                let entry = unsafe { &mut *(entry_ as *mut ExpectedEntry<'_>) };
                let Ok(same) = item.is_same_value(entry.expected, entry.global) else {
                    return;
                };
                if same {
                    *entry.pass = true;
                    // TODO(perf): break out of the `forEach` when a match is found
                }
            }

            value.for_each(
                global,
                &mut expected_entry as *mut _ as *mut c_void,
                same_value_iterator,
            )?;
        } else {
            return global.throw(format_args!(
                "Received value must be an array type, or both received and expected values must be strings."
            ));
        }

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        let mut formatter = Formatter {
            global,
            quote_strings: true,
            ..Default::default()
        };
        let value_fmt = value.to_fmt(&mut formatter);
        let expected_fmt = expected.to_fmt(&mut formatter);
        if not {
            let received_fmt = value.to_fmt(&mut formatter);
            let signature = get_signature("toContain", "<green>expected<r>", true);
            return this.throw(
                global,
                signature,
                format_args!(
                    concat!(
                        "\n\n",
                        "Expected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n",
                    ),
                    expected_fmt, received_fmt,
                ),
            );
        }

        let signature = get_signature("toContain", "<green>expected<r>", false);
        this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected to contain: <green>{}<r>\n",
                    "Received: <red>{}<r>\n",
                ),
                expected_fmt, value_fmt,
            ),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toContain.zig (106 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match() borrows &mut self across whole fn — needs borrowck reshape; Formatter construction/to_fmt signatures guessed.
// ──────────────────────────────────────────────────────────────────────────
