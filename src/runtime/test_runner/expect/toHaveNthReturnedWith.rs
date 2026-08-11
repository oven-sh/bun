use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::mock;
use super::{Expect, get_signature};

pub(crate) fn to_have_nth_returned_with(
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
        mock::MockKind::Returns,
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
    let nth_call_exists = index < calls_count;

    if nth_call_exists {
        let nth_result = returns.get_direct_index(global, index);
        match mock::parse_mock_result(global, nth_result)? {
            mock::MockResult::Return(value) => {
                nth_return_value = value;
                if nth_return_value.jest_deep_equals(expected, global)? {
                    pass = true;
                }
            }
            mock::MockResult::Throw(result) => {
                nth_call_threw = true;
                nth_error_value = result.get(global, "value")?.unwrap_or(JSValue::UNDEFINED);
            }
            mock::MockResult::Other => {}
        }
    }

    if pass != this.flags.get().not() {
        return Ok(JSValue::UNDEFINED);
    }

    // Handle failure
    let signature = get_signature("toHaveNthReturnedWith", "<green>n<r>, <green>expected<r>", false);

    if this.flags.get().not() {
        return mock::throw_not_failure(
            &this, global, "toHaveNthReturnedWith", "<green>n<r>, <green>expected<r>",
            format_args!("Expected mock function not to have returned on call {}", n), expected, "\nBut it did.\n",
        );
    }

    if !nth_call_exists {
        return mock::throw_nth_call_missing(&this, global, signature, calls_count, index + 1, "\n");
    }

    if nth_call_threw {
        return mock::throw_call_threw(&this, global, signature, format_args!("Call {}", n), nth_error_value);
    }

    // Diff if possible
    if expected.is_string() && nth_return_value.is_string() {
        return mock::throw_diff(&this, global, signature, format_args!("Call {}:\n", n), expected, nth_return_value);
    }

    mock::throw_expected_received(&this, global, signature, format_args!("Call {}:\n", n), expected, nth_return_value)
}
