use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter as ConsoleFormatter;

use crate::expect::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_be_odd(this: &mut Expect, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalThis);`
    // TODO(port): borrowck — scopeguard captures `this` while body also uses `&mut self`; Phase B may need raw-ptr reshape or move post_match into Drop guard on a sub-borrow.
    let _post_match = scopeguard::guard((), |_| this.post_match(global));

    let this_value = frame.this_value();

    let value: JSValue = this.get_value(global, this_value, "toBeOdd", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.not;
    let mut pass = false;

    if value.is_big_int32() {
        pass = value.to_int32() & 1 == 1;
    } else if value.is_big_int() {
        pass = value.to_int64() & 1 == 1;
    } else if value.is_int32() {
        let v = value.to_int32();
        pass = v.rem_euclid(2) == 1;
    } else if value.is_any_int() {
        let v = value.to_int64();
        pass = v.rem_euclid(2) == 1;
    } else if value.is_number() {
        let v = value.as_number();
        // if the fraction is all zeros and odd
        if v.rem_euclid(1.0) == 0.0 && v.rem_euclid(2.0) == 1.0 {
            pass = true;
        } else {
            pass = false;
        }
    } else {
        pass = false;
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let mut formatter = ConsoleFormatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    // Zig `defer formatter.deinit();` — handled by Drop.
    let value_fmt = value.to_fmt(&mut formatter);
    if not {
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        // PERF(port): was `comptime getSignature(...)` — make get_signature a const fn in Phase B
        let signature = Expect::get_signature("toBeOdd", "", true);
        return this.throw(
            global,
            signature,
            format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), value_fmt),
        );
    }

    const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
    // PERF(port): was `comptime getSignature(...)` — make get_signature a const fn in Phase B
    let signature = Expect::get_signature("toBeOdd", "", false);
    this.throw(
        global,
        signature,
        format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), value_fmt),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeOdd.zig (60 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match needs borrowck reshape; comptime get_signature flagged inline as PERF(port); Zig {f} fmt-spec mapped to {}
// ──────────────────────────────────────────────────────────────────────────
