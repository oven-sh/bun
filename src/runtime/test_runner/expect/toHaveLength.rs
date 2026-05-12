use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;
use super::get_signature;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_have_length(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let (this, value, not) =
        this.matcher_prelude(global, frame.this(), "toHaveLength", "<green>expected<r>")?;

    let arguments_ = frame.arguments_old::<1>();
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toHaveLength() takes 1 argument")));
    }

    let expected: JSValue = arguments[0];

    if !value.is_object() && !value.is_string() {
        let mut fmt = super::make_formatter(global);
        return Err(global.throw(format_args!(
            "Received value does not have a length property: {}",
            value.to_fmt(&mut fmt),
        )));
    }

    if !expected.is_number() {
        let mut fmt = super::make_formatter(global);
        return Err(global.throw(format_args!(
            "Expected value must be a non-negative integer: {}",
            expected.to_fmt(&mut fmt),
        )));
    }

    let expected_length: f64 = expected.as_number();
    if expected_length.round() != expected_length
        || expected_length.is_infinite()
        || expected_length.is_nan()
        || expected_length < 0.0
    {
        let mut fmt = super::make_formatter(global);
        return Err(global.throw(format_args!(
            "Expected value must be a non-negative integer: {}",
            expected.to_fmt(&mut fmt),
        )));
    }

    let mut pass = false;

    let actual_length = value.get_length_if_property_exists_internal(global)?;

    if actual_length == f64::INFINITY {
        let mut fmt = super::make_formatter(global);
        return Err(global.throw(format_args!(
            "Received value does not have a length property: {}",
            value.to_fmt(&mut fmt),
        )));
    } else if actual_length.is_nan() {
        return Err(global.throw(format_args!(
            "Received value has non-number length property: {}",
            actual_length,
        )));
    }

    if actual_length == expected_length {
        pass = true;
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    if not {
        // PERF(port): was comptime getSignature — const fn evaluated at compile time
        let signature: &str = get_signature("toHaveLength", "<green>expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!("\n\nExpected length: not <green>{}<r>\n", expected_length),
        );
    }

    // PERF(port): was comptime getSignature — const fn evaluated at compile time
    let signature: &str = get_signature("toHaveLength", "<green>expected<r>", false);
    this.throw(
        global,
        signature,
        format_args!(
            "\n\nExpected length: <green>{}<r>\nReceived length: <red>{}<r>\n",
            expected_length, actual_length,
        ),
    )
}

// ported from: src/test_runner/expect/toHaveLength.zig
