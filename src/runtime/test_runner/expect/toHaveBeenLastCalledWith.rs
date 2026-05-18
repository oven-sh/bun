use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::DiffFormatter;
use super::{Expect, get_signature};

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_have_been_last_called_with(
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
        super::mock::MockKind::CallsWithSig,
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

        if last_call_value.get_length(global)? != arguments.len() as u64 {
            pass = false;
        } else {
            let mut itr = last_call_value.array_iterator(global)?;
            while let Some(call_arg) = itr.next()? {
                if !call_arg.jest_deep_equals(arguments[itr.i as usize - 1], global)? {
                    pass = false;
                    break;
                }
            }
        }
    }

    if pass != this.flags.get().not() {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let mut formatter = super::make_formatter(global);

    let expected_args_js_array = JSValue::create_array_from_slice(global, arguments)?;
    expected_args_js_array.ensure_still_alive();

    if this.flags.get().not() {
        let signature = get_signature("toHaveBeenLastCalledWith", "<green>...expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected last call not to be with: <green>{}<r>\nBut it was.",
                expected_args_js_array.to_fmt(&mut formatter),
            ),
        );
    }
    let signature = get_signature("toHaveBeenLastCalledWith", "<green>...expected<r>", false);

    if total_calls == 0 {
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected: <green>{}<r>\nBut it was not called.",
                expected_args_js_array.to_fmt(&mut formatter),
            ),
        );
    }

    let diff_format = DiffFormatter {
        expected: Some(expected_args_js_array),
        received: Some(last_call_value),
        expected_string: None,
        received_string: None,
        global_this: Some(global),
        not: false,
    };
    this.throw(global, signature, format_args!("\n\n{}\n", diff_format))
}

// ported from: src/test_runner/expect/toHaveBeenLastCalledWith.zig
