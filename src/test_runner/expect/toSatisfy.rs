use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_str::ZigString;

use super::Expect;
use super::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_satisfy(this: &mut Expect, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // TODO(port): `defer this.postMatch(globalThis)` — scopeguard capturing `&mut *this`
    // conflicts with later `this` uses under borrowck; Phase B reshape (e.g. RAII guard
    // on Expect or raw-ptr scopeguard).
    let _post_match = scopeguard::guard((this as *mut Expect, global), |(t, g)| {
        // SAFETY: `this` outlives this guard (fn scope); no other &mut alias live at drop.
        unsafe { (*t).post_match(g) };
    });

    let this_value = frame.this_value();
    let arguments_ = frame.arguments_old(1);
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!("toSatisfy() requires 1 argument"));
    }

    this.increment_expect_call_counter();

    let predicate = arguments[0];
    predicate.ensure_still_alive();

    if !predicate.is_callable() {
        return global.throw(format_args!("toSatisfy() argument must be a function"));
    }

    let Some(value) = Expect::js::captured_value_get_cached(this_value) else {
        return global.throw(format_args!(
            "Internal consistency error: the expect(value) was garbage collected but it should not have been!"
        ));
    };
    value.ensure_still_alive();

    let result = match predicate.call(global, JSValue::UNDEFINED, &[value]) {
        Ok(r) => r,
        Err(e) => {
            let err = global.take_exception(e);
            let fmt = ZigString::init(b"toSatisfy() predicate threw an exception");
            return global.throw_value(global.create_aggregate_error(&[err], &fmt)?);
        }
    };

    let not = this.flags.not;
    let pass = (result.is_boolean() && result.to_boolean()) != not;

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // PORT NOTE: `defer formatter.deinit()` dropped — Formatter impls Drop.
    let mut formatter = Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };

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

    this.throw(
        global,
        signature,
        format_args!(
            "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>\n",
            predicate.to_fmt(&mut formatter),
            value.to_fmt(&mut formatter),
        ),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toSatisfy.zig (62 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match() vs &mut this borrowck needs Phase B reshape; get_signature was comptime
// ──────────────────────────────────────────────────────────────────────────
