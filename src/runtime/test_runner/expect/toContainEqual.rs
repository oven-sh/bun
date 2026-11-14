use core::ffi::c_void;

use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, VM};
use bun_core::strings;

use super::expect_deferred::{Asked, Pass, Question};
use super::{get_signature, throw, Expect};

struct Items {
    array: JSValue,
    len: u32,
}

extern "C" fn collect_item(_: *mut VM, global: &JSGlobalObject, items: *mut c_void, item: JSValue) {
    // SAFETY: `items` is the `&mut Items` passed through `for_each` below; non-null by contract.
    let items = unsafe { bun_ptr::callback_ctx::<Items>(items) };
    if items.array.put_index(global, items.len, item).is_ok() {
        items.len += 1;
    }
}

impl Expect {
    #[optimize(size)]
    pub(crate) fn to_contain_equal(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let this_value = this_value.to_js();
        let (this, value, not) =
            self.matcher_prelude(global, this_value, "toContainEqual", "<green>expected<r>")?;

        let expected = expected.to_js();
        let mut pass = false;

        let value_type = value.js_type();
        let expected_type = expected.js_type();

        if value_type.is_array_like() {
            let mut itr = value.array_iterator(global)?;
            while let Some(item) = itr.next()? {
                if item.jest_deep_equals(expected, global)? {
                    pass = true;
                    break;
                }
            }
        } else if value_type.is_string_like() && expected_type.is_string_like() {
            if expected_type.is_string_object_like() && value_type.is_string() {
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
            let question = Question { asked: Asked::Items, who: JSValue::UNDEFINED, what: value };
            let items = Pass::once(global, question, &mut || {
                let mut items = Items { array: JSValue::create_empty_array(global, 0)?, len: 0 };
                value.for_each(global, (&raw mut items).cast::<c_void>(), collect_item)?;
                Ok(items.array)
            })?;
            let mut itr = items.array_iterator(global)?;
            while let Some(item) = itr.next()? {
                if item.jest_deep_equals(expected, global)? {
                    pass = true;
                    break;
                }
            }
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
