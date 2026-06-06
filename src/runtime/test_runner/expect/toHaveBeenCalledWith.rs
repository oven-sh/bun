use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::mock;
use super::Expect;

pub(crate) fn to_have_been_called_with(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let arguments = frame.arguments();
    let (this, calls, _value) = this.mock_prologue(
        global,
        frame.this(),
        "toHaveBeenCalledWith",
        "<green>...expected<r>",
        mock::MockKind::CallsWithSig,
    )?;

    let mut pass = false;

    let calls_count = u32::try_from(calls.get_length(global)?).unwrap();
    if calls_count > 0 {
        let mut itr = calls.array_iterator(global)?;
        while let Some(call_item) = itr.next()? {
            if call_item.is_empty() || !call_item.js_type().is_array() {
                // This indicates a malformed mock object, which is an internal error.
                return Err(global.throw(format_args!(
                    "Internal error: expected mock call item to be an array of arguments."
                )));
            }

            if mock::call_args_equal(global, call_item, arguments)? {
                pass = true;
                break;
            }
        }
    }

    if pass != this.flags.get().not() {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let expected_args_js_array = JSValue::create_array_from_slice(global, arguments)?;
    expected_args_js_array.ensure_still_alive();

    if this.flags.get().not() {
        return mock::throw_not_failure(
            &this, global, "toHaveBeenCalledWith", "<green>...expected<r>",
            format_args!("Expected mock function not to have been called with"), expected_args_js_array, "\nBut it was.",
        );
    }
    let signature = Expect::get_signature("toHaveBeenCalledWith", "<green>...expected<r>", false);

    if calls_count == 0 {
        return mock::throw_not_called(&this, global, signature, expected_args_js_array);
    }

    // If there's only one call, provide a nice diff.
    if calls_count == 1 {
        let received_call_args = calls.get_index(global, 0)?;
        return mock::throw_diff(&this, global, signature, format_args!(""), expected_args_js_array, received_call_args);
    }

    // If there are multiple calls, list them all to help debugging.
    // The AllCallsWithArgsFormatter holds an exclusive borrow of the formatter, so
    // we allocate a second ConsoleObject formatter for the list.
    let mut formatter = super::make_formatter(global);
    let mut list_fmt = super::make_formatter(global);
    let list_formatter = mock::AllCallsWithArgsFormatter {
        global_this: global,
        calls,
        formatter: core::cell::RefCell::new(&mut list_fmt),
    };

    this.throw(
        global,
        signature,
        format_args!(
            "\n\n    <green>Expected<r>: {}\n    <red>Received<r>:\n{}\n\n    Number of calls: {}\n",
            expected_args_js_array.to_fmt(&mut formatter),
            list_formatter,
            calls_count,
        ),
    )
}
