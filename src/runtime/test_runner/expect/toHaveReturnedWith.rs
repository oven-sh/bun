use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
#[allow(unused_imports)] use bun_core::Output;

use super::DiffFormatter;
use super::mock;
use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_have_returned_with(
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

    // Zig: std.array_list.Managed(JSValue) — heap-backed list of JSValue.
    // PORTING.md §JSC types: heap-backed Vec<JSValue> is not stack-scanned by JSC's conservative GC;
    // however every value pushed here is also reachable via the `returns` JSArray (kept live on the
    // stack), so a plain Vec mirrors the Zig spec safely. SuccessfulReturnsFormatter expects &Vec.
    let mut successful_returns: Vec<JSValue> = Vec::new();

    let mut has_errors = false;

    // Check for a pass and collect info for error messages
    for i in 0..calls_count {
        let result = returns.get_direct_index(global, i);

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

    if pass != this.flags.get().not() {
        return Ok(JSValue::UNDEFINED);
    }

    // Handle failure
    let mut formatter = super::make_formatter(global);

    let signature: &str = Expect::get_signature("toHaveReturnedWith", "<green>expected<r>", false);

    if this.flags.get().not() {
        let not_signature: &str = Expect::get_signature("toHaveReturnedWith", "<green>expected<r>", true);
        return this.throw(
            global,
            not_signature,
            format_args!(
                "\n\nExpected mock function not to have returned: <green>{}<r>\n",
                expected.to_fmt(&mut formatter),
            ),
        );
    }

    // No match was found.
    let successful_returns_count = successful_returns.len();

    // Case: Only one successful return, no errors
    if calls_count == 1 && successful_returns_count == 1 {
        let received = successful_returns[0];
        if expected.is_string() && received.is_string() {
            let diff_format = DiffFormatter {
                expected: Some(expected),
                received: Some(received),
                expected_string: None,
                received_string: None,
                global_this: Some(global),
                not: false,
            };
            return this.throw(global, signature, format_args!("\n\n{}\n", diff_format));
        }

        // PORT NOTE: Zig shares one `*Formatter` across both `toFmt` calls; in Rust the
        // `ZigFormatter` adapter holds `&'a mut Formatter`, so two live adapters cannot alias
        // the same backing formatter. Use a second formatter for the received value —
        // `make_formatter` is a trivial struct init with no shared state between values.
        let mut formatter2 = super::make_formatter(global);
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>",
                expected.to_fmt(&mut formatter),
                received.to_fmt(&mut formatter2),
            ),
        );
    }

    // PORT NOTE: list_formatter holds &mut Formatter via RefCell, so a separate formatter is
    // required for the inline `expected.to_fmt` argument used alongside it in the same format_args!.
    let mut list_fmt = super::make_formatter(global);

    if has_errors {
        // Case: Some calls errored
        let list_formatter = mock::AllCallsFormatter {
            global_this: global,
            returns,
            formatter: core::cell::RefCell::new(&mut list_fmt),
        };
        // TODO(port): Output.prettyFmt comptime color dispatch — Zig branches on
        // `Output.enable_ansi_colors_stderr` to substitute/strip `<green>`/`<r>` tags at comptime.
        // `Expect::throw` → `throw_pretty` handles tag substitution at runtime, so collapse both arms.
        // PERF(port): was comptime bool dispatch (`switch inline else`) — profile in Phase B
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nSome calls errored:\n\n    Expected: {}\n    Received:\n{}\n\n    Number of returns: {}\n    Number of calls:   {}\n",
                expected.to_fmt(&mut formatter),
                list_formatter,
                successful_returns_count,
                calls_count,
            ),
        );
    } else {
        // Case: No errors, but no match (and multiple returns)
        let list_formatter = mock::SuccessfulReturnsFormatter {
            global_this: global,
            successful_returns: &successful_returns,
            formatter: core::cell::RefCell::new(&mut list_fmt),
        };
        // TODO(port): Output.prettyFmt comptime color dispatch — Zig branches on
        // `Output.enable_ansi_colors_stderr` to substitute/strip `<green>`/`<red>` tags at comptime.
        // `Expect::throw` → `throw_pretty` handles tag substitution at runtime, so collapse both arms.
        // PERF(port): was comptime bool dispatch (`switch inline else`) — profile in Phase B
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\n    <green>Expected<r>: {}\n    <red>Received<r>:\n{}\n\n    Number of returns: {}\n",
                expected.to_fmt(&mut formatter),
                list_formatter,
                successful_returns_count,
            ),
        );
    }
}

// ported from: src/test_runner/expect/toHaveReturnedWith.zig
