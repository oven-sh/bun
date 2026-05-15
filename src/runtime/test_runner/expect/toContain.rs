use core::ffi::c_void;
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, VM};
use bun_jsc::console_object::Formatter;
use bun_core::strings;

use super::Expect;
use super::get_signature;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let (this, value, not) =
            self.matcher_prelude(global, frame.this(), "toContain", "<green>expected<r>")?;

        let arguments_ = frame.arguments_old::<1>();
        let arguments = arguments_.slice();

        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!("toContain() takes 1 argument")));
        }

        let expected = arguments[0];
        expected.ensure_still_alive();
        let mut pass = false;

        // FFI/BACKREF: erased to *mut c_void for for_each userdata; raw ptrs match the Zig
        // `*JSGlobalObject` / `*bool` fields and avoid a Phase-A struct lifetime param.
        struct ExpectedEntry {
            global: *const JSGlobalObject,
            expected: JSValue,
            pass: *mut bool,
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

            if expected_string.slice().is_empty() {
                // edge case empty string is always contained
                pass = true;
            } else if strings::contains(value_string.slice(), expected_string.slice()) {
                pass = true;
            } else if value_string.slice().is_empty() && expected_string.slice().is_empty() {
                // edge case two empty strings are true
                pass = true;
            }
        } else if value.is_iterable(global)? {
            let mut expected_entry = ExpectedEntry {
                global: std::ptr::from_ref(global),
                expected,
                pass: &raw mut pass,
            };

            extern "C" fn same_value_iterator(
                _: *mut VM,
                _: &JSGlobalObject,
                entry_: *mut c_void,
                item: JSValue,
            ) {
                // SAFETY: entry_ is &mut ExpectedEntry on the caller's stack, threaded through
                // for_each as opaque userdata; non-null asserted by Zig `entry_.?`. global/pass
                // point at live stack locals for the duration of the for_each call.
                debug_assert!(!entry_.is_null());
                let entry = unsafe { bun_ptr::callback_ctx::<ExpectedEntry>(entry_) };
                let Ok(same) = item.is_same_value(entry.expected, unsafe { &*entry.global }) else {
                    return;
                };
                if same {
                    unsafe { *entry.pass = true };
                    // TODO(perf): break out of the `forEach` when a match is found
                }
            }

            value.for_each(
                global,
                (&raw mut expected_entry).cast::<c_void>(),
                same_value_iterator,
            )?;
        } else {
            return Err(global.throw(format_args!(
                "Received value must be an array type, or both received and expected values must be strings."
            )));
        }

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        // PORT NOTE: Zig shares one Formatter across both `to_fmt` calls; in Rust each
        // `to_fmt` borrows `&mut Formatter` for the lifetime of the returned wrapper, so
        // create a second Formatter (cheap struct init, no shared state) to satisfy borrowck.
        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        if not {
            // PERF(port): was comptime getSignature — profile in Phase B (make get_signature const fn / const_format)
            let signature = get_signature("toContain", "<green>expected<r>", true);
            return this.throw(
                global,
                signature,
                format_args!(
                    concat!(
                        "\n\n",
                        "Expected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n",
                    ),
                    expected.to_fmt(&mut formatter),
                    value.to_fmt(&mut formatter2),
                ),
            );
        }

        // PERF(port): was comptime getSignature — profile in Phase B (make get_signature const fn / const_format)
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
                expected.to_fmt(&mut formatter),
                value.to_fmt(&mut formatter2),
            ),
        )
    }
}

// ported from: src/test_runner/expect/toContain.zig
