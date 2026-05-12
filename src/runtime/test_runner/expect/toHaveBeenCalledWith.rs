use bun_jsc::{CallFrame, ConsoleObject, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};

use super::DiffFormatter;
use super::mock;
use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_have_been_called_with(
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

            if call_item.get_length(global)? != arguments.len() as u64 {
                continue;
            }

            let mut call_itr = call_item.array_iterator(global)?;
            let mut matched = true;
            while let Some(call_arg) = call_itr.next()? {
                if !call_arg.jest_deep_equals(arguments[call_itr.i as usize - 1], global)? {
                    matched = false;
                    break;
                }
            }

            if matched {
                pass = true;
                break;
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
        let signature = Expect::get_signature("toHaveBeenCalledWith", "<green>...expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected mock function not to have been called with: <green>{}<r>\nBut it was.",
                expected_args_js_array.to_fmt(&mut formatter),
            ),
        );
    }
    let signature = Expect::get_signature("toHaveBeenCalledWith", "<green>...expected<r>", false);

    if calls_count == 0 {
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected: <green>{}<r>\nBut it was not called.",
                expected_args_js_array.to_fmt(&mut formatter),
            ),
        );
    }

    // If there's only one call, provide a nice diff.
    if calls_count == 1 {
        let received_call_args = calls.get_index(global, 0)?;
        let diff_format = DiffFormatter {
            received_string: None,
            expected_string: None,
            expected: Some(expected_args_js_array),
            received: Some(received_call_args),
            global_this: Some(global),
            not: false,
        };
        return this.throw(global, signature, format_args!("\n\n{}\n", diff_format));
    }

    // If there are multiple calls, list them all to help debugging.
    // PORT NOTE: reshaped for borrowck — Zig shares one `&formatter` between to_fmt and
    // list_formatter; in Rust the AllCallsWithArgsFormatter holds an exclusive borrow, so
    // we allocate a second ConsoleObject formatter for the list.
    let mut list_fmt = super::make_formatter(global);
    let list_formatter = mock::AllCallsWithArgsFormatter {
        global_this: global,
        calls,
        formatter: core::cell::RefCell::new(&mut list_fmt),
    };

    // TODO(port): Output.prettyFmt comptime color dispatch — Zig branches on
    // `Output.enable_ansi_colors_stderr` to substitute/strip `<green>`/`<red>` tags at comptime.
    // Re-expand to `if b { throw::<true>() } else { throw::<false>() }` once `bun_core::pretty_fmt!` exists.
    // PERF(port): was comptime bool dispatch (`switch inline else`) — profile in Phase B
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

// ported from: src/test_runner/expect/toHaveBeenCalledWith.zig
