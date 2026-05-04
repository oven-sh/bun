use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter as ConsoleFormatter;
use bun_core::Output;

use crate::diff_format::DiffFormatter;
use crate::expect::mock;
use crate::expect::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_have_returned_with(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // jsc.markBinding(@src()) — debug-only binding marker, dropped in port.

    let this_value = frame.this();
    // defer this.postMatch(globalThis)
    let _post_match = scopeguard::guard((), |_| this.post_match(global));
    // TODO(port): scopeguard borrows `this`/`global`; if borrowck rejects, hoist post_match to each return path.

    let value: JSValue = this.get_value(global, this_value, "toHaveReturnedWith", "<green>expected<r>")?;

    let expected = frame.arguments_as_array::<1>()[0];
    this.increment_expect_call_counter();

    // TODO(port): bun.cpp.JSMockFunction__getReturns — extern C++ shim; confirm crate path.
    let returns = bun_jsc::cpp::JSMockFunction__getReturns(global, value)?;
    if !returns.js_type().is_array() {
        let mut formatter = ConsoleFormatter { global, quote_strings: true, ..Default::default() };
        return global.throw(format_args!(
            "Expected value must be a mock function: {}",
            value.to_fmt(&mut formatter),
        ));
    }

    let calls_count = u32::try_from(returns.get_length(global)?).unwrap();
    let mut pass = false;

    // PORTING.md §JSC types: heap-backed Vec<JSValue> is not stack-scanned by JSC's conservative GC.
    // Use MarkedArgumentBuffer (registered with the VM as a root) so values pushed mid-loop survive
    // the allocations triggered by get()/to_bun_string()/jest_deep_equals() below.
    let mut successful_returns = bun_jsc::MarkedArgumentBuffer::new();

    let mut has_errors = false;

    // Check for a pass and collect info for error messages
    for i in 0..calls_count {
        let result = returns.get_direct_index(global, i as u32);

        if result.is_object() {
            let result_type = result.get(global, "type")?.unwrap_or(JSValue::UNDEFINED);
            if result_type.is_string() {
                let type_str = result_type.to_bun_string(global)?;

                if type_str.eql_comptime("return") {
                    let result_value = result.get(global, "value")?.unwrap_or(JSValue::UNDEFINED);
                    successful_returns.push(result_value);

                    // Check for pass condition only if not already passed
                    if !pass {
                        if result_value.jest_deep_equals(expected, global)? {
                            pass = true;
                        }
                    }
                } else if type_str.eql_comptime("throw") {
                    has_errors = true;
                }
            }
        }
    }

    if pass != this.flags.not {
        return Ok(JSValue::UNDEFINED);
    }

    // Handle failure
    let mut formatter = ConsoleFormatter { global, quote_strings: true, ..Default::default() };

    const SIGNATURE: &str = Expect::get_signature("toHaveReturnedWith", "<green>expected<r>", false);

    if this.flags.not {
        const NOT_SIGNATURE: &str = Expect::get_signature("toHaveReturnedWith", "<green>expected<r>", true);
        return this.throw(
            global,
            NOT_SIGNATURE,
            concat!("\n\n", "Expected mock function not to have returned: <green>{}<r>\n"),
            format_args!("{}", expected.to_fmt(&mut formatter)),
        );
    }

    // No match was found.
    let successful_returns_count = successful_returns.len();

    // Case: Only one successful return, no errors
    if calls_count == 1 && successful_returns_count == 1 {
        let received = successful_returns.at(0);
        if expected.is_string() && received.is_string() {
            let diff_format = DiffFormatter {
                expected,
                received,
                global,
                not: false,
            };
            return this.throw(global, SIGNATURE, "\n\n{}\n", format_args!("{}", diff_format));
        }

        return this.throw(
            global,
            SIGNATURE,
            "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>",
            // TODO(port): Expect::throw fmt-arg plumbing — Zig passes (template, .{arg1, arg2});
            // Rust signature TBD. Placeholder concatenation below does NOT line up with template `{}`s.
            format_args!(
                "{}{}",
                expected.to_fmt(&mut formatter),
                received.to_fmt(&mut formatter),
            ),
        );
    }

    if has_errors {
        // Case: Some calls errored
        let list_formatter = mock::AllCallsFormatter {
            global,
            returns,
            formatter: &mut formatter,
        };
        const FMT: &str = "Some calls errored:\n\
            \n\
            \x20   Expected: {}\n\
            \x20   Received:\n\
            {}\n\
            \n\
            \x20   Number of returns: {}\n\
            \x20   Number of calls:   {}";

        // switch (Output.enable_ansi_colors_stderr) { inline else => |colors| ... }
        if Output::enable_ansi_colors_stderr() {
            return this.throw(
                global,
                SIGNATURE,
                Output::pretty_fmt::<true>(const_format::concatcp!("\n\n", FMT, "\n")),
                // TODO(port): pretty_fmt is comptime ANSI-tag expansion in Zig; Rust needs a macro (`bun_core::pretty_fmt!`).
                // TODO(port): Expect::throw fmt-arg plumbing — args below must map to template `{}`s, not concatenate.
                format_args!(
                    "{}{}{}{}",
                    expected.to_fmt(&mut formatter),
                    list_formatter,
                    successful_returns_count,
                    calls_count,
                ),
            );
        } else {
            return this.throw(
                global,
                SIGNATURE,
                Output::pretty_fmt::<false>(const_format::concatcp!("\n\n", FMT, "\n")),
                // TODO(port): Expect::throw fmt-arg plumbing — args below must map to template `{}`s, not concatenate.
                format_args!(
                    "{}{}{}{}",
                    expected.to_fmt(&mut formatter),
                    list_formatter,
                    successful_returns_count,
                    calls_count,
                ),
            );
        }
    } else {
        // Case: No errors, but no match (and multiple returns)
        let list_formatter = mock::SuccessfulReturnsFormatter {
            global,
            successful_returns: successful_returns.as_slice(),
            formatter: &mut formatter,
        };
        const FMT: &str = "    <green>Expected<r>: {}\n\
            \x20   <red>Received<r>:\n\
            {}\n\
            \n\
            \x20   Number of returns: {}";

        if Output::enable_ansi_colors_stderr() {
            return this.throw(
                global,
                SIGNATURE,
                Output::pretty_fmt::<true>(const_format::concatcp!("\n\n", FMT, "\n")),
                // TODO(port): pretty_fmt is comptime ANSI-tag expansion in Zig; Rust needs a macro (`bun_core::pretty_fmt!`).
                // TODO(port): Expect::throw fmt-arg plumbing — args below must map to template `{}`s, not concatenate.
                format_args!(
                    "{}{}{}",
                    expected.to_fmt(&mut formatter),
                    list_formatter,
                    successful_returns_count,
                ),
            );
        } else {
            return this.throw(
                global,
                SIGNATURE,
                Output::pretty_fmt::<false>(const_format::concatcp!("\n\n", FMT, "\n")),
                // TODO(port): Expect::throw fmt-arg plumbing — args below must map to template `{}`s, not concatenate.
                format_args!(
                    "{}{}{}",
                    expected.to_fmt(&mut formatter),
                    list_formatter,
                    successful_returns_count,
                ),
            );
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toHaveReturnedWith.zig (159 lines)
//   confidence: medium
//   todos:      9
//   notes:      Expect::throw takes (signature, fmt_template, args-tuple) in Zig; Rust signature TBD — current format_args! placeholders do not align with templates. Output.prettyFmt needs a const/macro form. scopeguard on post_match may fight borrowck.
// ──────────────────────────────────────────────────────────────────────────
