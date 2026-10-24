use core::ffi::c_void;

use bun_core::strings;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, VM};

use super::{Expect, get_signature, throw};
use crate::generated_bindgen::expect::StringValue;

struct ExpectedEntry<'a> {
    global_this: &'a JSGlobalObject,
    expected: JSValue,
    pass: &'a mut bool,
}

extern "C" fn deep_equals_iterator(
    _: *mut VM,
    _: &JSGlobalObject,
    entry_: *mut c_void,
    item: JSValue,
) {
    // SAFETY: `entry_` is `&mut ExpectedEntry` passed through `for_each` below; non-null by contract.
    let entry = unsafe { bun_ptr::callback_ctx::<ExpectedEntry<'_>>(entry_) };
    let Ok(eq) = item.jest_deep_equals(entry.expected, entry.global_this) else {
        return;
    };
    if eq {
        *entry.pass = true;
        // PERF: break out of the `forEach` when a match is found
    }
}

impl Expect {
    pub(crate) fn to_contain_equal<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'_>,
        (expected_string, expected): (StringValue<'_>, JsLocal<'_>),
    ) -> JsResult<JsWrapper<'a, Self>> {
        let global = cx.global();
        let (this, value, not) = self.matcher_prelude(
            global,
            this_value.to_js(),
            "toContainEqual",
            "<green>expected<r>",
        )?;

        let mut pass = false;

        let value_type = value.js_type();
        let expected = expected.to_js();

        if value_type.is_array_like() {
            let mut itr = value.array_iterator(global)?;
            while let Some(item) = itr.next()? {
                if item.jest_deep_equals(expected, global)? {
                    pass = true;
                    break;
                }
            }
        } else if value_type.is_string_like() && !matches!(expected_string, StringValue::Other) {
            if matches!(expected_string, StringValue::StringObject(_)) && value_type.is_string() {
                pass = false;
            } else {
                let value_string = value.to_utf8(global)?;
                let expected_string = expected.to_utf8(global)?;

                // jest does not have a `typeof === "string"` check here: it spreads the value into an array.

                let mut expected_codepoint_cursor = strings::Cursor::default();
                let expected_iter = strings::CodepointIterator::init(expected_string.slice());
                let _ = expected_iter.next(&mut expected_codepoint_cursor);

                pass = if expected_iter.next(&mut expected_codepoint_cursor) {
                    false
                } else {
                    strings::index_of(value_string.slice(), expected_string.slice()).is_some()
                };
            }
        } else if value.is_iterable(global)? {
            let mut expected_entry = ExpectedEntry {
                global_this: global,
                expected,
                pass: &mut pass,
            };
            value.for_each(
                global,
                (&raw mut expected_entry).cast::<c_void>(),
                deep_equals_iterator,
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
            return Ok(this_value);
        }

        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        let value_fmt = value.to_fmt(&mut formatter);
        let expected_fmt = expected.to_fmt(&mut formatter2);
        if not {
            let signature: &str = get_signature("toContainEqual", "<green>expected<r>", true);
            return throw!(
                this,
                global,
                signature,
                concat!("\n\n", "Expected to not contain: <green>{}<r>\n"),
                expected_fmt,
            );
        }

        let signature: &str = get_signature("toContainEqual", "<green>expected<r>", false);
        throw!(
            this,
            global,
            signature,
            concat!(
                "\n\n",
                "Expected to contain: <green>{}<r>\n",
                "Received: <red>{}<r>\n"
            ),
            expected_fmt,
            value_fmt,
        )
    }
}
