use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;
use super::get_signature;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_have_length(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: Zig `defer this.postMatch(globalThis)` — scopeguard owns the `&mut Expect`
    // borrow and DerefMut's back to it, so post_match runs on every exit path without an
    // overlapping borrow.
    let mut this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = frame.this();
    let arguments_ = frame.arguments_old::<1>();
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toHaveLength() takes 1 argument")));
    }

    this.increment_expect_call_counter();

    let expected: JSValue = arguments[0];
    let value: JSValue = this.get_value(global, this_value, "toHaveLength", "<green>expected<r>")?;

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

    let not = this.flags.not();
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toHaveLength.zig (77 lines)
//   confidence: medium
//   todos:      2
//   notes:      scopeguard::defer! for post_match may need borrowck reshape; get_signature must be const fn; Expect.throw fmt-string uses Zig {d} placeholders — arg-packing pending Expect.throw Rust signature
// ──────────────────────────────────────────────────────────────────────────
