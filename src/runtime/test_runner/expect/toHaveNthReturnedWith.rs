use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::DiffFormatter;
use super::{Expect, get_signature};

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_have_nth_returned_with(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let [nth_arg, expected] = frame.arguments_as_array::<2>();
    let (this, returns, _value) = this.mock_prologue(
        global,
        frame.this(),
        "toHaveNthReturnedWith",
        "<green>n<r>, <green>expected<r>",
        super::mock::MockKind::Returns,
    )?;

    // Validate n is a number
    if !nth_arg.is_any_int() {
        return Err(global.throw_invalid_arguments(format_args!(
            "toHaveNthReturnedWith() first argument must be an integer"
        )));
    }
    let n = nth_arg.to_int32();
    if n <= 0 {
        return Err(global.throw_invalid_arguments(format_args!(
            "toHaveNthReturnedWith() n must be greater than 0"
        )));
    }

    let calls_count = u32::try_from(returns.get_length(global)?).unwrap();
    let index = u32::try_from(n - 1).unwrap(); // Convert to 0-based index

    let mut pass = false;
    let mut nth_return_value: JSValue = JSValue::UNDEFINED;
    let mut nth_call_threw = false;
    let mut nth_error_value: JSValue = JSValue::UNDEFINED;
    let mut nth_call_exists = false;

    if index < calls_count {
        nth_call_exists = true;
        let nth_result = returns.get_direct_index(global, index);
        if nth_result.is_object() {
            let result_type = nth_result.get(global, "type")?.unwrap_or(JSValue::UNDEFINED);
            if result_type.is_string() {
                let type_str = result_type.to_bun_string(global)?;
                // defer type_str.deref() — handled by Drop on bun_core::String
                if type_str.eql_comptime("return") {
                    nth_return_value = nth_result.get(global, "value")?.unwrap_or(JSValue::UNDEFINED);
                    if nth_return_value.jest_deep_equals(expected, global)? {
                        pass = true;
                    }
                } else if type_str.eql_comptime("throw") {
                    nth_call_threw = true;
                    nth_error_value = nth_result.get(global, "value")?.unwrap_or(JSValue::UNDEFINED);
                }
            }
        }
    }

    if pass != this.flags.get().not() {
        return Ok(JSValue::UNDEFINED);
    }

    // Handle failure
    let mut formatter = super::make_formatter(global);
    let mut formatter2 = super::make_formatter(global);
    // defer formatter.deinit() — handled by Drop

    // TODO(port): get_signature should be a const fn returning &'static str (was `comptime getSignature(...)`)
    let signature = get_signature("toHaveNthReturnedWith", "<green>n<r>, <green>expected<r>", false);

    if this.flags.get().not() {
        return this.throw(
            global,
            get_signature("toHaveNthReturnedWith", "<green>n<r>, <green>expected<r>", true),
            format_args!(
                "\n\nExpected mock function not to have returned on call {}: <green>{}<r>\nBut it did.\n",
                n,
                expected.to_fmt(&mut formatter),
            ),
        );
    }

    if !nth_call_exists {
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nThe mock function was called {} time{}, but call {} was requested.\n",
                calls_count,
                if calls_count == 1 { "" } else { "s" },
                n,
            ),
        );
    }

    if nth_call_threw {
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nCall {} threw an error: <red>{}<r>\n",
                n,
                nth_error_value.to_fmt(&mut formatter),
            ),
        );
    }

    // Diff if possible
    if expected.is_string() && nth_return_value.is_string() {
        let diff_format = DiffFormatter {
            expected: Some(expected),
            received: Some(nth_return_value),
            expected_string: None,
            received_string: None,
            global_this: Some(global),
            not: false,
        };
        return this.throw(
            global,
            signature,
            format_args!("\n\nCall {}:\n{}\n", n, diff_format),
        );
    }

    this.throw(
        global,
        signature,
        format_args!(
            "\n\nCall {}:\nExpected: <green>{}<r>\nReceived: <red>{}<r>",
            n,
            expected.to_fmt(&mut formatter),
            nth_return_value.to_fmt(&mut formatter2),
        ),
    )
}

// ported from: src/test_runner/expect/toHaveNthReturnedWith.zig
