use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
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
        let arguments_ = frame.arguments_old::<1>();
        let arguments = arguments_.slice();

        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!(
                "toContainAnyValues() takes 1 argument"
            )));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        if !expected.js_type().is_array() {
            return Err(global.throw_invalid_argument_type("toContainAnyValues", "expected", "array"));
        }
        expected.ensure_still_alive();
        let value: JSValue =
            this.get_value(global, this_value, "toContainAnyValues", "<green>expected<r>")?;

        let not = this.flags.not();
        let mut pass = false;

        if !value.is_undefined_or_null() {
            let values = value.values(global)?;
            let mut itr = expected.array_iterator(global)?;
            let count = values.get_length(global)?;

            'outer: while let Some(item) = itr.next()? {
                let mut i: u32 = 0;
                while (i as u64) < count {
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
        // PORT NOTE: Zig shared one `*Formatter` across both `toFmt` calls; in Rust each
        // `to_fmt` borrows `&mut Formatter` for the lifetime of the returned adapter, so
        // allocate a second formatter for the received value.
        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        // `defer formatter.deinit()` — handled by Drop.
        let expected_fmt = expected.to_fmt(&mut formatter);
        let value_fmt = value.to_fmt(&mut formatter2);
        if not {
            return this.throw(
                global,
                Expect::get_signature("toContainAnyValues", "<green>expected<r>", true),
                format_args!(
                    concat!(
                        "\n\n",
                        "Expected to not contain any of the following values: <green>{}<r>\n",
                        "Received: <red>{}<r>\n",
                    ),
                    expected_fmt, value_fmt,
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
