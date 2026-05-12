use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;
use bun_core::strings;

use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_include(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: `defer this.postMatch(globalThis)` — reshaped for borrowck: scopeguard owns the
    // `&mut Expect` and runs post_match on drop; the body re-borrows `this` through DerefMut.
    let this = scopeguard::guard(this, |t| t.post_match(global));

    let this_value = frame.this();
    let arguments_ = frame.arguments_old::<1>();
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toInclude() requires 1 argument")));
    }

    let expected = arguments[0];
    expected.ensure_still_alive();

    if !expected.is_string() {
        return Err(global.throw(format_args!(
            "toInclude() requires the first argument to be a string"
        )));
    }

    let value: JSValue = this.get_value(global, this_value, "toInclude", "")?;

    this.increment_expect_call_counter();

    let mut pass = value.is_string();
    if pass {
        let value_string = value.to_slice_or_null(global)?;
        let expected_string = expected.to_slice_or_null(global)?;
        pass = strings::contains(value_string.slice(), expected_string.slice())
            || expected_string.slice().is_empty();
    }

    let not = this.flags.get().not();
    if not {
        pass = !pass;
    }

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // PORT NOTE: two live `to_fmt(&mut Formatter)` wrappers alias the same formatter under
    // borrowck — use a second Formatter for the second value (matches toBe.rs / toBeOneOf.rs).
    let mut formatter = super::make_formatter(global);
    let mut formatter2 = super::make_formatter(global);
    let value_fmt = value.to_fmt(&mut formatter);
    let expected_fmt = expected.to_fmt(&mut formatter2);

    if not {
        const EXPECTED_LINE: &str = "Expected to not include: <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        let signature: &str = Expect::get_signature("toInclude", "<green>expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected to not include: <green>{}<r>\n",
                    "Received: <red>{}<r>\n"
                ),
                expected_fmt,
                value_fmt
            ),
        );
    }

    const EXPECTED_LINE: &str = "Expected to include: <green>{}<r>\n";
    const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
    let signature: &str = Expect::get_signature("toInclude", "<green>expected<r>", false);
    this.throw(
        global,
        signature,
        format_args!(
            concat!(
                "\n\n",
                "Expected to include: <green>{}<r>\n",
                "Received: <red>{}<r>\n"
            ),
            expected_fmt,
            value_fmt
        ),
    )
}

// ported from: src/test_runner/expect/toInclude.zig
