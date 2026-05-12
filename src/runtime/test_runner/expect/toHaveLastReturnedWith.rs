use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, FormatterTestExt, make_formatter};
use bun_jsc::console_object::Formatter;
// TODO(port): verify path for JSMockFunction__getReturns FFI binding
use super::mock::JSMockFunction__getReturns;

use super::DiffFormatter;
use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_have_last_returned_with(
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
        super::mock::MockKind::Returns,
    )?;

    let calls_count = u32::try_from(returns.get_length(global_this)?).unwrap();
    let mut pass = false;
    let mut last_return_value: JSValue = JSValue::UNDEFINED;
    let mut last_call_threw = false;
    let mut last_error_value: JSValue = JSValue::UNDEFINED;

    if calls_count > 0 {
        let last_result = returns.get_direct_index(global_this, calls_count - 1);

        if last_result.is_object() {
            let result_type = last_result.get(global_this, "type")?.unwrap_or(JSValue::UNDEFINED);
            if result_type.is_string() {
                let type_str = result_type.to_bun_string(global_this)?;

                if type_str.eql_comptime("return") {
                    last_return_value =
                        last_result.get(global_this, "value")?.unwrap_or(JSValue::UNDEFINED);

                    if last_return_value.jest_deep_equals(expected, global_this)? {
                        pass = true;
                    }
                } else if type_str.eql_comptime("throw") {
                    last_call_threw = true;
                    last_error_value =
                        last_result.get(global_this, "value")?.unwrap_or(JSValue::UNDEFINED);
                }
            }
        }
    }

    if pass != this.flags.get().not() {
        return Ok(JSValue::UNDEFINED);
    }

    // Handle failure
    let mut formatter = Formatter::new(global_this).with_quote_strings(true);

    let signature = Expect::get_signature("toHaveBeenLastReturnedWith", "<green>expected<r>", false);

    if this.flags.get().not() {
        return this.throw(
            global_this,
            Expect::get_signature("toHaveBeenLastReturnedWith", "<green>expected<r>", true),
            format_args!(
                concat!(
                    "\n\n",
                    "Expected mock function not to have last returned: <green>{}<r>\n",
                    "But it did.\n",
                ),
                expected.to_fmt(&mut formatter),
            ),
        );
    }

    if calls_count == 0 {
        return this.throw(
            global_this,
            signature,
            format_args!(concat!("\n\n", "The mock function was not called.")),
        );
    }

    if last_call_threw {
        return this.throw(
            global_this,
            signature,
            format_args!(
                concat!("\n\n", "The last call threw an error: <red>{}<r>\n"),
                last_error_value.to_fmt(&mut formatter),
            ),
        );
    }

    // Diff if possible
    if expected.is_string() && last_return_value.is_string() {
        let diff_format = DiffFormatter {
            received_string: None,
            expected_string: None,
            expected: Some(expected),
            received: Some(last_return_value),
            global_this: Some(global_this),
            not: false,
        };
        return this.throw(global_this, signature, format_args!("\n\n{}\n", diff_format));
    }

    // PORT NOTE: Zig shares one `*Formatter` across both `toFmt` calls; in Rust the
    // `ZigFormatter` adapter holds `&'a mut Formatter`, so two live adapters cannot alias
    // the same backing formatter. Use a second formatter for the received value —
    // `make_formatter` is a trivial struct init with no shared state between values.
    let mut formatter2 = super::make_formatter(global_this);
    this.throw(
        global_this,
        signature,
        format_args!(
            "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>",
            expected.to_fmt(&mut formatter),
            last_return_value.to_fmt(&mut formatter2),
        ),
    )
}

// ported from: src/test_runner/expect/toHaveLastReturnedWith.zig
