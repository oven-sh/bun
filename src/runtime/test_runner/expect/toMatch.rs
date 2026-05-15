use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::ConsoleObject;

use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_match(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let (this, value, not) =
        this.matcher_prelude(global, frame.this(), "toMatch", "<green>expected<r>")?;

    let arguments: &[JSValue] = frame.arguments();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toMatch() requires 1 argument")));
    }

    let mut formatter = super::make_formatter(global);

    let expected_value = arguments[0];
    if !expected_value.is_string() && !expected_value.is_reg_exp() {
        return Err(global.throw(format_args!(
            "Expected value must be a string or regular expression: {}",
            expected_value.to_fmt(&mut formatter),
        )));
    }
    expected_value.ensure_still_alive();

    if !value.is_string() {
        return Err(global.throw(format_args!(
            "Received value must be a string: {}",
            value.to_fmt(&mut formatter),
        )));
    }

    let mut pass: bool = 'brk: {
        if expected_value.is_string() {
            break 'brk value.string_includes(global, expected_value)?;
        } else if expected_value.is_reg_exp() {
            break 'brk expected_value.to_match(global, value)?;
        }
        unreachable!();
    };

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    // PORT NOTE: Zig shares one Formatter across both `to_fmt` calls; in Rust each
    // `to_fmt` borrows `&mut Formatter` for the lifetime of the returned wrapper, so
    // we need a second Formatter for the second value (matches toContain.rs / toBe.rs).
    let mut formatter2 = super::make_formatter(global);
    let expected_fmt = expected_value.to_fmt(&mut formatter);
    let value_fmt = value.to_fmt(&mut formatter2);

    if not {
        const EXPECTED_LINE: &str = "Expected substring or pattern: not <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        // TODO(port): `comptime getSignature(...)` — ensure `get_signature` is `const fn` (or macro) returning &'static str.
        let signature = Expect::get_signature("toMatch", "<green>expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected substring or pattern: not <green>{}<r>\n",
                    "Received: <red>{}<r>\n",
                ),
                expected_fmt,
                value_fmt,
            ),
        );
    }

    const EXPECTED_LINE: &str = "Expected substring or pattern: <green>{}<r>\n";
    const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
    let signature = Expect::get_signature("toMatch", "<green>expected<r>", false);
    this.throw(
        global,
        signature,
        format_args!(
            concat!(
                "\n\n",
                "Expected substring or pattern: <green>{}<r>\n",
                "Received: <red>{}<r>\n",
            ),
            expected_fmt,
            value_fmt,
        ),
    )
}

// ported from: src/test_runner/expect/toMatch.zig
