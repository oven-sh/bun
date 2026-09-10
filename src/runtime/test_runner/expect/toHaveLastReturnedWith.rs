use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::mock;
use super::Expect;
use super::throw;

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
    let mock::ReturnCheck {
        matched: pass,
        return_value: last_return_value,
        threw: last_call_threw,
        error_value: last_error_value,
    } = if calls_count > 0 {
        mock::check_returned_with(
            global_this,
            returns.get_direct_index(global_this, calls_count - 1)?,
            expected,
        )?
    } else {
        mock::ReturnCheck::MISSING
    };

    if pass != this.flags.get().not() {
        return Ok(JSValue::UNDEFINED);
    }

    // Handle failure
    let signature = Expect::get_signature("toHaveBeenLastReturnedWith", "<green>expected<r>", false);

    if this.flags.get().not() {
        return mock::throw_not_failure(
            &this,
            global_this,
            "toHaveBeenLastReturnedWith",
            "<green>expected<r>",
            format_args!("Expected mock function not to have last returned"),
            expected,
            "\nBut it did.\n",
        );
    }

    if calls_count == 0 {
        return throw!(this, global_this, signature, "\n\nThe mock function was not called.");
    }

    if last_call_threw {
        return mock::throw_call_threw(
            &this,
            global_this,
            signature,
            format_args!("The last call"),
            last_error_value,
        );
    }

    // Diff if possible
    if expected.is_string() && last_return_value.is_string() {
        return mock::throw_diff(
            &this,
            global_this,
            signature,
            format_args!(""),
            expected,
            last_return_value,
        );
    }

    mock::throw_expected_received(
        &this,
        global_this,
        signature,
        format_args!(""),
        expected,
        last_return_value,
    )
}
