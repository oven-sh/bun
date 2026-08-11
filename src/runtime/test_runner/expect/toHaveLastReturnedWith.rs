use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::mock;
use super::Expect;

pub(crate) fn to_have_last_returned_with(
    this: &Expect,
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let expected = callframe.arguments_as_array::<1>()[0];
    let (this, returns, _value) = this.mock_prologue(
        global_this,
        callframe.this(),
        "toHaveBeenLastReturnedWith",
        "<green>expected<r>",
        mock::MockKind::Returns,
    )?;

    let calls_count = u32::try_from(returns.get_length(global_this)?).unwrap();
    let mut pass = false;
    let mut last_return_value: JSValue = JSValue::UNDEFINED;
    let mut last_call_threw = false;
    let mut last_error_value: JSValue = JSValue::UNDEFINED;

    if calls_count > 0 {
        let last_result = returns.get_direct_index(global_this, calls_count - 1);

        match mock::parse_mock_result(global_this, last_result)? {
            mock::MockResult::Return(value) => {
                last_return_value = value;
                if last_return_value.jest_deep_equals(expected, global_this)? {
                    pass = true;
                }
            }
            mock::MockResult::Throw(result) => {
                last_call_threw = true;
                last_error_value = result.get(global_this, "value")?.unwrap_or(JSValue::UNDEFINED);
            }
            mock::MockResult::Other => {}
        }
    }

    if pass != this.flags.get().not() {
        return Ok(JSValue::UNDEFINED);
    }

    // Handle failure
    let signature = Expect::get_signature("toHaveBeenLastReturnedWith", "<green>expected<r>", false);

    if this.flags.get().not() {
        return mock::throw_not_failure(
            &this, global_this, "toHaveBeenLastReturnedWith", "<green>expected<r>",
            format_args!("Expected mock function not to have last returned"), expected, "\nBut it did.\n",
        );
    }

    if calls_count == 0 {
        return this.throw(global_this, signature, format_args!("\n\nThe mock function was not called."));
    }

    if last_call_threw {
        return mock::throw_call_threw(&this, global_this, signature, format_args!("The last call"), last_error_value);
    }

    // Diff if possible
    if expected.is_string() && last_return_value.is_string() {
        return mock::throw_diff(&this, global_this, signature, format_args!(""), expected, last_return_value);
    }

    mock::throw_expected_received(&this, global_this, signature, format_args!(""), expected, last_return_value)
}
