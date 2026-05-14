use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;
use bun_core::ZigString;

use super::Expect;
use super::get_signature;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_satisfy(this: &Expect, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // toSatisfy bypasses get_value (no .resolves/.rejects handling), so it cannot use
    // the full `matcher_prelude`; only the post_match guard mechanism unifies.
    let _guard = this.post_match_guard(global);

    let this_value = frame.this();
    let arguments_ = frame.arguments_old::<1>();
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toSatisfy() requires 1 argument")));
    }

    this.increment_expect_call_counter();

    let predicate = arguments[0];
    predicate.ensure_still_alive();

    if !predicate.is_callable() {
        return Err(global.throw(format_args!("toSatisfy() argument must be a function")));
    }

    let Some(value) = super::js::captured_value_get_cached(this_value) else {
        return Err(global.throw(format_args!(
            "Internal consistency error: the expect(value) was garbage collected but it should not have been!"
        )));
    };
    value.ensure_still_alive();

    let result = match predicate.call(global, JSValue::UNDEFINED, &[value]) {
        Ok(r) => r,
        Err(e) => {
            let err = global.take_exception(e);
            let fmt = ZigString::init(b"toSatisfy() predicate threw an exception");
            return Err(global.throw_value(global.create_aggregate_error(&[err], &fmt)?));
        }
    };

    let not = this.flags.get().not();
    let pass = (result.is_boolean() && result.to_boolean()) != not;

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // PORT NOTE: `defer formatter.deinit()` dropped — Formatter impls Drop.
    let mut formatter = super::make_formatter(global);

    if not {
        // PERF(port): was `comptime getSignature(...)` — profile in Phase B (const-eval signature)
        let signature = get_signature("toSatisfy", "<green>expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!("\n\nExpected: not <green>{}<r>\n", predicate.to_fmt(&mut formatter)),
        );
    }

    // PERF(port): was `comptime getSignature(...)` — profile in Phase B (const-eval signature)
    let signature = get_signature("toSatisfy", "<green>expected<r>", false);

    // PORT NOTE: reshaped for borrowck — Zig held two `*Formatter` aliases via `toFmt`;
    // Rust `to_fmt(&mut Formatter)` borrows exclusively, so use a second formatter for the
    // received value (matches the toBeGreaterThan.rs pattern).
    let mut formatter2 = super::make_formatter(global);
    this.throw(
        global,
        signature,
        format_args!(
            "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>\n",
            predicate.to_fmt(&mut formatter),
            value.to_fmt(&mut formatter2),
        ),
    )
}

// ported from: src/test_runner/expect/toSatisfy.zig
