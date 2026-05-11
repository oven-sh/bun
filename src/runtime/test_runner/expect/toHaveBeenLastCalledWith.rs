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

    let this_value = frame.this();
    let arguments = frame.arguments();

    // Zig: `defer this.postMatch(globalThis);`
    // PORT NOTE: reshaped for borrowck — wrap `this` in a scopeguard and re-borrow through
    // the guard's DerefMut so post_match runs at every exit without a raw-pointer alias.
    let this = scopeguard::guard(this, |t| t.post_match(global));
    let this: &Expect = *this;

    let value: JSValue =
        this.get_value(global, this_value, "toHaveBeenLastCalledWith", "<green>...expected<r>")?;

    this.increment_expect_call_counter();

    let calls = super::mock::JSMockFunction__getCalls(global, value)?;
    if !calls.js_type().is_array() {
        let mut formatter = super::make_formatter(global);
        return this.throw(
            global,
            get_signature("toHaveBeenLastCalledWith", "<green>...expected<r>", false),
            format_args!(
                "\n\nMatcher error: <red>received<r> value must be a mock function\nReceived: {}",
                value.to_fmt(&mut formatter),
            ),
        );
    }

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

    let expected_args_js_array = JSValue::create_empty_array(global, arguments.len())?;
    for (i, arg) in arguments.iter().enumerate() {
        expected_args_js_array.put_index(global, u32::try_from(i).unwrap(), *arg)?;
    }
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
