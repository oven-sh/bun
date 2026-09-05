use bun_core::strings;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::{get_signature, throw, Expect};

// Free fn (this module can't open `impl Expect`); bridged into `impl Expect` by the
// `__forward_matcher!` macro in expect.rs, where the JsClass codegen host_fn shim picks it up.
pub(crate) fn to_contain_equal(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let this_value = frame.this();
    let (this, value, not) =
        this.matcher_prelude(global, this_value, "toContainEqual", "<green>expected<r>")?;
    let arguments = frame.arguments();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toContainEqual() takes 1 argument")));
    }

    let expected = arguments[0];
    expected.ensure_still_alive();
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

            // jest does not have a `typeof === "string"` check for `toContainEqual`.
            // it immediately spreads the value into an array.

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
        value.for_each_iter(global, |global, item| {
            let Ok(eq) = item.jest_deep_equals(expected, global) else {
                return;
            };
            if eq {
                pass = true;
                // PERF: break out of the `forEach` when a match is found
            }
        })?;
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

    // handle failure
    // Two live `&mut formatter` borrows cannot coexist, so allocate a second
    // Formatter for the expected value.
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
