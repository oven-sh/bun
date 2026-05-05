use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::Expect;
use super::Expect::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_have_length(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: Zig `defer this.postMatch(globalThis)` — scopeguard captures `this`;
    // reshaped for borrowck may be needed in Phase B.
    scopeguard::defer! { this.post_match(global); }

    let this_value = frame.this();
    let arguments_ = frame.arguments_old(1);
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!("toHaveLength() takes 1 argument"));
    }

    this.increment_expect_call_counter();

    let expected: JSValue = arguments[0];
    let value: JSValue = this.get_value(global, this_value, "toHaveLength", "<green>expected<r>")?;

    if !value.is_object() && !value.is_string() {
        let mut fmt = Formatter { global_this: global, quote_strings: true, ..Default::default() };
        return global.throw(format_args!(
            "Received value does not have a length property: {}",
            value.to_fmt(&mut fmt),
        ));
    }

    if !expected.is_number() {
        let mut fmt = Formatter { global_this: global, quote_strings: true, ..Default::default() };
        return global.throw(format_args!(
            "Expected value must be a non-negative integer: {}",
            expected.to_fmt(&mut fmt),
        ));
    }

    let expected_length: f64 = expected.as_number();
    if expected_length.round() != expected_length
        || expected_length.is_infinite()
        || expected_length.is_nan()
        || expected_length < 0.0
    {
        let mut fmt = Formatter { global_this: global, quote_strings: true, ..Default::default() };
        return global.throw(format_args!(
            "Expected value must be a non-negative integer: {}",
            expected.to_fmt(&mut fmt),
        ));
    }

    let not = this.flags.not;
    let mut pass = false;

    let actual_length = value.get_length_if_property_exists_internal(global)?;

    if actual_length == f64::INFINITY {
        let mut fmt = Formatter { global_this: global, quote_strings: true, ..Default::default() };
        return global.throw(format_args!(
            "Received value does not have a length property: {}",
            value.to_fmt(&mut fmt),
        ));
    } else if actual_length.is_nan() {
        return global.throw(format_args!(
            "Received value has non-number length property: {}",
            actual_length,
        ));
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
        const EXPECTED_LINE: &str = "Expected length: not <green>{d}<r>\n";
        // PERF(port): was comptime getSignature — const fn evaluated at compile time
        const SIGNATURE: &str = get_signature("toHaveLength", "<green>expected<r>", true);
        // TODO(port): Expect.throw fmt — Zig {d} placeholders vs Rust format_args; revisit arg-packing once Expect.throw signature is fixed
        return this.throw(
            global,
            SIGNATURE,
            const_format::concatcp!("\n\n", EXPECTED_LINE),
            format_args!("{}", expected_length),
        );
    }

    const EXPECTED_LINE: &str = "Expected length: <green>{d}<r>\n";
    const RECEIVED_LINE: &str = "Received length: <red>{d}<r>\n";
    // PERF(port): was comptime getSignature — const fn evaluated at compile time
    const SIGNATURE: &str = get_signature("toHaveLength", "<green>expected<r>", false);
    // TODO(port): Expect.throw fmt — Zig {d} placeholders vs Rust format_args; revisit arg-packing once Expect.throw signature is fixed
    this.throw(
        global,
        SIGNATURE,
        const_format::concatcp!("\n\n", EXPECTED_LINE, RECEIVED_LINE),
        format_args!("{} {}", expected_length, actual_length),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toHaveLength.zig (77 lines)
//   confidence: medium
//   todos:      2
//   notes:      scopeguard::defer! for post_match may need borrowck reshape; get_signature must be const fn; Expect.throw fmt-string uses Zig {d} placeholders — arg-packing pending Expect.throw Rust signature
// ──────────────────────────────────────────────────────────────────────────
