use core::ffi::c_void;

use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, VM};
use bun_core::strings;

use super::Expect;
use super::get_signature;
use super::throw;

impl Expect {
    pub(crate) fn to_contain(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (this, value, not) =
            self.matcher_prelude(global, this_value.to_js(), "toContain", "<green>expected<r>")?;

        let expected = expected.to_js();
        let mut pass = false;

        struct ExpectedEntry<'a> {
            global: &'a JSGlobalObject,
            expected: JSValue,
            pass: &'a mut bool,
        }

        // Jest's toContain uses `===` (Array.prototype.indexOf), not Object.is:
        // `[-0]` contains `0`, `[NaN]` does not contain `NaN`.
        if value.js_type_loose().is_array_like() {
            let mut itr = value.array_iterator(global)?;
            while let Some(item) = itr.next()? {
                if item.is_strict_equal(expected, global)? {
                    pass = true;
                    break;
                }
            }
        } else if value.is_string_literal() && expected.is_string_literal() {
            let value_string = value.to_utf8(global)?;
            let expected_string = expected.to_utf8(global)?;

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
                global,
                expected,
                pass: &mut pass,
            };

            extern "C" fn strict_equal_iterator(
                _: *mut VM,
                _: &JSGlobalObject,
                entry_: *mut c_void,
                item: JSValue,
            ) {
                // SAFETY: entry_ is &mut ExpectedEntry on the caller's stack, threaded through
                // for_each as opaque userdata.
                let entry = unsafe { bun_ptr::callback_ctx::<ExpectedEntry<'_>>(entry_) };
                let Ok(same) = item.is_strict_equal(entry.expected, entry.global) else {
                    return;
                };
                if same {
                    *entry.pass = true;
                    // TODO(perf): break out of the `forEach` when a match is found
                }
            }

            value.for_each(
                global,
                (&raw mut expected_entry).cast::<c_void>(),
                strict_equal_iterator,
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
        // Each `to_fmt` borrows `&mut Formatter` for the lifetime of the returned wrapper,
        // so a second Formatter (cheap struct init, no shared state) satisfies borrowck.
        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        if not {
            let signature = get_signature("toContain", "<green>expected<r>", true);
            return throw!(
                this,
                global,
                signature,
                concat!(
                    "\n\n",
                    "Expected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n",
                ),
                expected.to_fmt(&mut formatter),
                value.to_fmt(&mut formatter2),
            );
        }

        let signature = get_signature("toContain", "<green>expected<r>", false);
        throw!(
            this,
            global,
            signature,
            concat!(
                "\n\n",
                "Expected to contain: <green>{}<r>\n",
                "Received: <red>{}<r>\n",
            ),
            expected.to_fmt(&mut formatter),
            value.to_fmt(&mut formatter2),
        )
    }
}
