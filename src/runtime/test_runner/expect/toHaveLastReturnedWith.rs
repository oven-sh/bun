use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
// TODO(port): verify path for JSMockFunction__getReturns FFI binding
use bun_jsc::cpp::JSMockFunction__getReturns;

use crate::diff_format::DiffFormatter;
use crate::expect::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_have_last_returned_with(
    this: &mut Expect,
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();

    let this_value = callframe.this_value();
    // TODO(port): `defer this.postMatch(globalThis)` — scopeguard borrows `this` for the whole
    // body; may need borrowck reshaping in Phase B (e.g. inner fn + post_match in caller).
    let _post_match = scopeguard::guard((), |_| this.post_match(global_this));

    let value: JSValue =
        this.get_value(global_this, this_value, "toHaveBeenLastReturnedWith", "<green>expected<r>")?;

    let expected = callframe.arguments_as_array::<1>()[0];
    this.increment_expect_call_counter();

    let returns = JSMockFunction__getReturns(global_this, value)?;
    if !returns.js_type().is_array() {
        let mut formatter = Formatter::new(global_this).quote_strings(true);
        return global_this.throw(format_args!(
            "Expected value must be a mock function: {}",
            value.to_fmt(&mut formatter),
        ));
    }

    let calls_count = u32::try_from(returns.get_length(global_this)?).unwrap();
    let mut pass = false;
    let mut last_return_value: JSValue = JSValue::UNDEFINED;
    let mut last_call_threw = false;
    let mut last_error_value: JSValue = JSValue::UNDEFINED;

    if calls_count > 0 {
        let last_result = returns.get_direct_index(global_this, calls_count - 1);

        if last_result.is_object() {
            let result_type = last_result.get(global_this, "type")?.unwrap_or(JSValue::UNDEFINED);
            if result_type.is_string() {
                let type_str = result_type.to_bun_string(global_this)?;

                if type_str.eql_comptime("return") {
                    last_return_value =
                        last_result.get(global_this, "value")?.unwrap_or(JSValue::UNDEFINED);

                    if last_return_value.jest_deep_equals(expected, global_this)? {
                        pass = true;
                    }
                } else if type_str.eql_comptime("throw") {
                    last_call_threw = true;
                    last_error_value =
                        last_result.get(global_this, "value")?.unwrap_or(JSValue::UNDEFINED);
                }
            }
        }
    }

    if pass != this.flags.not {
        return Ok(JSValue::UNDEFINED);
    }

    // Handle failure
    let mut formatter = Formatter::new(global_this).quote_strings(true);

    let signature = Expect::get_signature("toHaveBeenLastReturnedWith", "<green>expected<r>", false);

    if this.flags.not {
        return this.throw(
            global_this,
            Expect::get_signature("toHaveBeenLastReturnedWith", "<green>expected<r>", true),
            format_args!(
                concat!(
                    "\n\n",
                    "Expected mock function not to have last returned: <green>{}<r>\n",
                    "But it did.\n",
                ),
                expected.to_fmt(&mut formatter),
            ),
        );
    }

    if calls_count == 0 {
        return this.throw(
            global_this,
            signature,
            format_args!(concat!("\n\n", "The mock function was not called.")),
        );
    }

    if last_call_threw {
        return this.throw(
            global_this,
            signature,
            format_args!(
                concat!("\n\n", "The last call threw an error: <red>{}<r>\n"),
                last_error_value.to_fmt(&mut formatter),
            ),
        );
    }

    // Diff if possible
    if expected.is_string() && last_return_value.is_string() {
        let diff_format = DiffFormatter {
            expected,
            received: last_return_value,
            global_this,
            not: false,
        };
        return this.throw(global_this, signature, format_args!("\n\n{}\n", diff_format));
    }

    this.throw(
        global_this,
        signature,
        format_args!(
            "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>",
            expected.to_fmt(&mut formatter),
            last_return_value.to_fmt(&mut formatter),
        ),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toHaveLastReturnedWith.zig (89 lines)
//   confidence: medium
//   todos:      2
//   notes:      scopeguard for post_match will fight borrowck; Formatter ctor + Expect::throw/get_signature signatures assumed
// ──────────────────────────────────────────────────────────────────────────
