use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_contain_any_values(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: reshaped for borrowck — Zig had `defer this.postMatch(globalObject)`.
    // We run the body in an inner closure so `post_match` can be called on every exit path
    // (success or error) without overlapping the `&mut self` borrow.
    let result = (|| -> JsResult<JSValue> {
        let this_value = frame.this();
        let arguments_ = frame.arguments_old(1);
        let arguments = arguments_.slice();

        if arguments.len() < 1 {
            return global.throw_invalid_arguments(format_args!(
                "toContainAnyValues() takes 1 argument"
            ));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        if !expected.js_type().is_array() {
            return global.throw_invalid_argument_type("toContainAnyValues", "expected", "array");
        }
        expected.ensure_still_alive();
        let value: JSValue =
            this.get_value(global, this_value, "toContainAnyValues", "<green>expected<r>")?;

        let not = this.flags.not;
        let mut pass = false;

        if !value.is_undefined_or_null() {
            let values = value.values(global)?;
            let mut itr = expected.array_iterator(global)?;
            let count = values.get_length(global)?;

            'outer: while let Some(item) = itr.next()? {
                let mut i: u32 = 0;
                while i < count {
                    let key = values.get_index(global, i)?;
                    if key.jest_deep_equals(item, global)? {
                        pass = true;
                        break 'outer;
                    }
                    i += 1;
                }
            }
        }

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(this_value);
        }

        // handle failure
        let mut formatter = Formatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        // `defer formatter.deinit()` — handled by Drop.
        let value_fmt = value.to_fmt(&mut formatter);
        let expected_fmt = expected.to_fmt(&mut formatter);
        if not {
            let received_fmt = value.to_fmt(&mut formatter);
            return this.throw(
                global,
                Expect::get_signature("toContainAnyValues", "<green>expected<r>", true),
                format_args!(
                    concat!(
                        "\n\n",
                        "Expected to not contain any of the following values: <green>{}<r>\n",
                        "Received: <red>{}<r>\n",
                    ),
                    expected_fmt, received_fmt,
                ),
            );
        }

        this.throw(
            global,
            Expect::get_signature("toContainAnyValues", "<green>expected<r>", false),
            format_args!(
                concat!(
                    "\n\n",
                    "Expected to contain any of the following values: <green>{}<r>\n",
                    "Received: <red>{}<r>\n",
                ),
                expected_fmt, value_fmt,
            ),
        )
    })();
    this.post_match(global);
    result
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toContainAnyValues.zig (73 lines)
//   confidence: medium
//   todos:      0
//   notes:      defer post_match reshaped via inner closure; Expect.throw assumed to take fmt::Arguments
// ──────────────────────────────────────────────────────────────────────────
