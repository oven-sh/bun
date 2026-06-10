use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::mock;
use super::{Expect, get_signature};

pub(crate) fn to_have_been_last_called_with(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let arguments = frame.arguments();
    let (this, calls, value) = this.mock_prologue(
        global,
        frame.this(),
        "toHaveBeenLastCalledWith",
        "<green>...expected<r>",
        mock::MockKind::CallsWithSig,
    )?;

    let total_calls: u32 = calls.get_length(global)? as u32;
    let mut last_call_value: JSValue = JSValue::ZERO;

    let mut pass = total_calls > 0;

    if pass {
        last_call_value = calls.get_index(global, total_calls - 1)?;

        if !last_call_value.js_type().is_array() {
            let mut formatter = super::make_formatter(global);
            return Err(global.throw(format_args!(
                "Expected value must be a mock function with calls: {}",
                value.to_fmt(&mut formatter),
            )));
        }

        pass = mock::call_args_equal(global, last_call_value, arguments)?;
    }

    if pass != this.flags.get().not() {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let expected_args_js_array = JSValue::create_array_from_slice(global, arguments)?;
    expected_args_js_array.ensure_still_alive();

    if this.flags.get().not() {
        return mock::throw_not_failure(
            &this, global, "toHaveBeenLastCalledWith", "<green>...expected<r>",
            format_args!("Expected last call not to be with"), expected_args_js_array, "\nBut it was.",
        );
    }
    let signature = get_signature("toHaveBeenLastCalledWith", "<green>...expected<r>", false);

    if total_calls == 0 {
        return mock::throw_not_called(&this, global, signature, expected_args_js_array);
    }

    mock::throw_diff(&this, global, signature, format_args!(""), expected_args_js_array, last_call_value)
}
