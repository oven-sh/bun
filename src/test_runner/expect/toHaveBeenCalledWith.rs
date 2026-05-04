use bun_core::Output;
use bun_jsc::{CallFrame, ConsoleObject, JSGlobalObject, JSValue, JsResult};

use crate::diff_format::DiffFormatter;
use super::mock;
use super::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_have_been_called_with(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();

    let this_value = frame.this();
    let arguments = frame.arguments();
    // PORT NOTE: reshaped for borrowck — `defer this.post_match(global)` captured via raw ptr so
    // `this` remains usable below. Guard runs on every return path.
    let this_ptr: *mut Expect = this;
    let global_ptr: *const JSGlobalObject = global;
    let _post_match = scopeguard::guard((), move |_| {
        // SAFETY: `this` and `global` outlive this function scope; guard drops before return.
        unsafe { (*this_ptr).post_match(&*global_ptr) };
    });
    let value: JSValue = this.get_value(global, this_value, "toHaveBeenCalledWith", "<green>...expected<r>")?;

    this.increment_expect_call_counter();

    // TODO(port): move to *_jsc — bun.cpp.JSMockFunction__getCalls is a C++ extern binding
    let calls = bun_jsc::cpp::JSMockFunction__getCalls(global, value)?;
    if !calls.js_type().is_array() {
        let mut formatter = ConsoleObject::Formatter { global_this: global, quote_strings: true, ..Default::default() };
        return this.throw(
            global,
            Expect::get_signature("toHaveBeenCalledWith", "<green>...expected<r>", false),
            format_args!(
                "\n\nMatcher error: <red>received<r> value must be a mock function\nReceived: {}",
                value.to_fmt(&mut formatter),
            ),
        );
    }

    let mut pass = false;

    let calls_count = u32::try_from(calls.get_length(global)?).unwrap();
    if calls_count > 0 {
        let mut itr = calls.array_iterator(global)?;
        while let Some(call_item) = itr.next()? {
            if call_item.is_empty() || !call_item.js_type().is_array() {
                // This indicates a malformed mock object, which is an internal error.
                return global.throw(format_args!(
                    "Internal error: expected mock call item to be an array of arguments."
                ));
            }

            if call_item.get_length(global)? != arguments.len() {
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

    if pass != this.flags.not {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let mut formatter = ConsoleObject::Formatter { global_this: global, quote_strings: true, ..Default::default() };

    let expected_args_js_array = JSValue::create_empty_array(global, arguments.len())?;
    for (i, arg) in arguments.iter().enumerate() {
        expected_args_js_array.put_index(global, u32::try_from(i).unwrap(), *arg)?;
    }
    expected_args_js_array.ensure_still_alive();

    if this.flags.not {
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
            expected: expected_args_js_array,
            received: received_call_args,
            global_this: global,
            not: false,
        };
        return this.throw(global, signature, format_args!("\n\n{}\n", diff_format));
    }

    // If there are multiple calls, list them all to help debugging.
    let list_formatter = mock::AllCallsWithArgsFormatter {
        global_this: global,
        calls,
        formatter: &mut formatter,
    };

    // TODO(port): Output::pretty_fmt is a comptime string transform (color tag → ANSI / strip).
    // Rust format_args! requires a literal first arg, so the const-generic dispatch below passes
    // the concatenated literal directly. Phase B: replace with `bun_core::pretty_fmt!` macro.
    const FMT: &str = concat!(
        "\n\n",
        "    <green>Expected<r>: {}\n",
        "    <red>Received<r>:\n",
        "{}\n",
        "\n",
        "    Number of calls: {}",
        "\n",
    );
    // PERF(port): was comptime bool dispatch (`switch inline else`) — profile in Phase B
    if Output::enable_ansi_colors_stderr() {
        this.throw(
            global,
            signature,
            // TODO(port): Output::pretty_fmt::<true>(FMT) — comptime color substitution
            format_args!(
                "\n\n    <green>Expected<r>: {}\n    <red>Received<r>:\n{}\n\n    Number of calls: {}\n",
                expected_args_js_array.to_fmt(&mut formatter),
                list_formatter,
                calls_count,
            ),
        )
    } else {
        this.throw(
            global,
            signature,
            // TODO(port): Output::pretty_fmt::<false>(FMT) — comptime color stripping
            format_args!(
                "\n\n    <green>Expected<r>: {}\n    <red>Received<r>:\n{}\n\n    Number of calls: {}\n",
                expected_args_js_array.to_fmt(&mut formatter),
                list_formatter,
                calls_count,
            ),
        )
    }
    #[allow(unused)]
    let _ = FMT;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toHaveBeenCalledWith.zig (127 lines)
//   confidence: medium
//   todos:      4
//   notes:      Output.prettyFmt comptime color transform needs a macro; defer post_match uses raw-ptr scopeguard for borrowck; this.throw signature assumed to take fmt::Arguments
// ──────────────────────────────────────────────────────────────────────────
