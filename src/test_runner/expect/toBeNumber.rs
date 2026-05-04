use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use crate::expect::Expect;
use crate::expect::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_be_number(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: reshaped for borrowck — Zig `defer this.postMatch(globalThis)` becomes a
    // scopeguard wrapping `this`; the guard Derefs to `&mut Expect` for the body below.
    let mut this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBeNumber", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.not;
    let pass = value.is_number() != not;

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let formatter = Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    // `defer formatter.deinit()` → dropped implicitly (impl Drop for Formatter).
    let received = value.to_fmt(&formatter);

    if not {
        let signature = get_signature("toBeNumber", "", true);
        return this.throw(
            global,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", received),
        );
    }

    let signature = get_signature("toBeNumber", "", false);
    this.throw(
        global,
        signature,
        format_args!("\n\nReceived: <red>{}<r>\n", received),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeNumber.zig (35 lines)
//   confidence: medium
//   todos:      0
//   notes:      `defer postMatch` modeled via scopeguard wrapping &mut Expect; Expect::throw assumed to take format_args! (Zig fmt+args tuple collapsed)
// ──────────────────────────────────────────────────────────────────────────
