use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::JSValueTestExt;

use super::Expect;
use super::throw;

pub(crate) fn to_match(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let this = this.post_match_guard(global);
    let this_value = frame.this();
    let arguments: &[JSValue] = frame.arguments();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toMatch() requires 1 argument")));
    }

    this.increment_expect_call_counter();

    let mut formatter = super::make_formatter(global);

    let expected_value = arguments[0];
    if !expected_value.is_string() && !expected_value.is_reg_exp() {
        return Err(global.throw(format_args!(
            "Expected value must be a string or regular expression: {}",
            expected_value.to_fmt(&mut formatter),
        )));
    }
    expected_value.ensure_still_alive();

    let value: JSValue = this.get_value(global, this_value, "toMatch", "<green>expected<r>")?;

    if !value.is_string() {
        return Err(global.throw(format_args!(
            "Received value must be a string: {}",
            value.to_fmt(&mut formatter),
        )));
    }

    let not = this.flags.get().not();
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
    // Each `to_fmt` borrows `&mut Formatter` for the lifetime of the returned wrapper, so
    // we need a second Formatter for the second value (matches toContain.rs / toBe.rs).
    let mut formatter2 = super::make_formatter(global);
    let expected_fmt = expected_value.to_fmt(&mut formatter);
    let value_fmt = value.to_fmt(&mut formatter2);

    if not {
        let signature = Expect::get_signature("toMatch", "<green>expected<r>", true);
        return throw!(
            this,
            global,
            signature,
            concat!(
                "\n\n",
                "Expected substring or pattern: not <green>{}<r>\n",
                "Received: <red>{}<r>\n",
            ),
            expected_fmt,
            value_fmt,
        );
    }

    let signature = Expect::get_signature("toMatch", "<green>expected<r>", false);
    throw!(
        this,
        global,
        signature,
        concat!(
            "\n\n",
            "Expected substring or pattern: <green>{}<r>\n",
            "Received: <red>{}<r>\n",
        ),
        expected_fmt,
        value_fmt,
    )
}
