use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::mock;
use super::Expect;

pub(crate) fn to_have_been_nth_called_with(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = frame.arguments();
    let (this, calls, _value) = this.mock_prologue(
        global,
        frame.this(),
        "toHaveBeenNthCalledWith",
        "<green>n<r>, <green>...expected<r>",
        mock::MockKind::CallsWithSig,
    )?;

    if arguments.is_empty() || !arguments[0].is_any_int() {
        return Err(global.throw_invalid_arguments(format_args!(
            "toHaveBeenNthCalledWith() requires a positive integer as the first argument"
        )));
    }
    let nth_call_num_i32 = arguments[0].to_int32();

    if nth_call_num_i32 <= 0 {
        return Err(global.throw_invalid_arguments(format_args!(
            "toHaveBeenNthCalledWith() first argument must be a positive integer"
        )));
    }
    let nth_call_num: u32 = u32::try_from(nth_call_num_i32).unwrap();

    let total_calls: u32 = u32::try_from(calls.get_length(global)?).unwrap();
    let mut pass = total_calls >= nth_call_num;
    let mut nth_call_value: JSValue = JSValue::ZERO;

    if pass {
        nth_call_value = calls.get_index(global, nth_call_num - 1)?;

        if !nth_call_value.js_type().is_array() {
            return Err(global.throw(format_args!(
                "Internal error: expected mock call item to be an array of arguments."
            )));
        }

        pass = mock::call_args_equal(global, nth_call_value, &arguments[1..])?;
    }

    if pass != this.flags.get().not() {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let expected_args_js_array = JSValue::create_array_from_slice(global, &arguments[1..])?;
    expected_args_js_array.ensure_still_alive();

    if this.flags.get().not() {
        return mock::throw_not_failure(
            &this, global, "toHaveBeenNthCalledWith", "<green>n<r>, <green>...expected<r>",
            format_args!("Expected call #{} not to be with", nth_call_num), expected_args_js_array, "\nBut it was.",
        );
    }
    let signature = Expect::get_signature("toHaveBeenNthCalledWith", "<green>n<r>, <green>...expected<r>", false);

    // Handle case where function was not called enough times
    if total_calls < nth_call_num {
        return mock::throw_nth_call_missing(&this, global, signature, total_calls, nth_call_num, "");
    }

    // The call existed but didn't match. Show a diff.
    mock::throw_diff(
        &this, global, signature,
        format_args!("Call #{}:\n", nth_call_num), expected_args_js_array, nth_call_value,
    )
}
