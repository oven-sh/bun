use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::mock;
use super::Expect;

pub(crate) fn to_have_returned_with(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let expected = frame.arguments_as_array::<1>()[0];
    let (this, returns, _value) = this.mock_prologue(
        global,
        frame.this(),
        "toHaveReturnedWith",
        "<green>expected<r>",
        mock::MockKind::Returns,
    )?;

    let calls_count = u32::try_from(returns.get_length(global)?).unwrap();
    let mut pass = false;

    // A heap-backed Vec<JSValue> is not stack-scanned by JSC's conservative GC;
    // however every value pushed here is also reachable via the `returns` JSArray (kept live on the
    // stack), so a plain Vec is safe. SuccessfulReturnsFormatter expects &Vec.
    let mut successful_returns: Vec<JSValue> = Vec::new();

    let mut has_errors = false;

    // Check for a pass and collect info for error messages
    for i in 0..calls_count {
        let result = returns.get_direct_index(global, i);

        match mock::parse_mock_result(global, result)? {
            mock::MockResult::Return(result_value) => {
                successful_returns.push(result_value);

                // Check for pass condition only if not already passed
                if !pass && result_value.jest_deep_equals(expected, global)? {
                    pass = true;
                }
            }
            mock::MockResult::Throw(_) => has_errors = true,
            mock::MockResult::Other => {}
        }
    }

    if pass != this.flags.get().not() {
        return Ok(JSValue::UNDEFINED);
    }

    // Handle failure
    let signature: &str = Expect::get_signature("toHaveReturnedWith", "<green>expected<r>", false);

    if this.flags.get().not() {
        return mock::throw_not_failure(
            &this, global, "toHaveReturnedWith", "<green>expected<r>",
            format_args!("Expected mock function not to have returned"), expected, "\n",
        );
    }

    // No match was found.
    let successful_returns_count = successful_returns.len();

    // Case: Only one successful return, no errors
    if calls_count == 1 && successful_returns_count == 1 {
        let received = successful_returns[0];
        if expected.is_string() && received.is_string() {
            return mock::throw_diff(&this, global, signature, format_args!(""), expected, received);
        }

        return mock::throw_expected_received(&this, global, signature, format_args!(""), expected, received);
    }

    // list_formatter holds &mut Formatter via RefCell, so a separate formatter is
    // required for the inline `expected.to_fmt` argument used alongside it in the same format_args!.
    let mut formatter = super::make_formatter(global);
    let mut list_fmt = super::make_formatter(global);

    if has_errors {
        // Case: Some calls errored
        let list_formatter = mock::AllCallsFormatter {
            global_this: global,
            returns,
            formatter: core::cell::RefCell::new(&mut list_fmt),
        };
        this.throw(
            global,
            signature,
            format_args!(
                "\n\nSome calls errored:\n\n    Expected: {}\n    Received:\n{}\n\n    Number of returns: {}\n    Number of calls:   {}\n",
                expected.to_fmt(&mut formatter),
                list_formatter,
                successful_returns_count,
                calls_count,
            ),
        )
    } else {
        // Case: No errors, but no match (and multiple returns)
        let list_formatter = mock::SuccessfulReturnsFormatter {
            global_this: global,
            successful_returns: &successful_returns,
            formatter: core::cell::RefCell::new(&mut list_fmt),
        };
        this.throw(
            global,
            signature,
            format_args!(
                "\n\n    <green>Expected<r>: {}\n    <red>Received<r>:\n{}\n\n    Number of returns: {}\n",
                expected.to_fmt(&mut formatter),
                list_formatter,
                successful_returns_count,
            ),
        )
    }
}
