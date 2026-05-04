use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_be_array(this: &mut Expect, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // PORT NOTE: reshaped for borrowck — Zig's `defer this.postMatch(global)` is hoisted to a
    // tail call after an immediately-invoked closure so `this` isn't held by a scopeguard for
    // the whole body.
    let result = (|| -> JsResult<JSValue> {
            let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, "toBeArray", "")?;

        this.increment_expect_call_counter();

        let not = this.flags.not;
        let pass = value.js_type().is_array() != not;

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        let mut formatter = Formatter { global, quote_strings: true, ..Default::default() };
        // `defer formatter.deinit()` — handled by Drop
        let received = value.to_fmt(&mut formatter);

        if not {
            let signature = Expect::get_signature("toBeArray", "", true);
            return this.throw(
                global,
                signature,
                format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
            );
        }

        let signature = Expect::get_signature("toBeArray", "", false);
        this.throw(
            global,
            signature,
            format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
        )
    })();
    this.post_match(global);
    result
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeArray.zig (35 lines)
//   confidence: high
//   todos:      0
//   notes:      defer post_match reshaped to IIFE + tail call; throw() assumed to take fmt::Arguments
// ──────────────────────────────────────────────────────────────────────────
