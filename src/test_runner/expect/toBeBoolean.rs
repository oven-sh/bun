use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use crate::expect::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_be_boolean(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: Zig `defer this.postMatch(globalThis)` — must run on every exit path
    // (including the `?` below). scopeguard here aliases `&mut self`; Phase B may need
    // to reshape (e.g. split borrow or move post_match into Drop of a guard type on Expect).
    // TODO(port): defer post_match — borrowck reshape
    let _post = scopeguard::guard((), |_| this.post_match(global));

    let this_value = frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBeBoolean", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.not;
    let pass = value.is_boolean() != not;

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = Formatter {
        global,
        quote_strings: true,
        ..Default::default()
    };
    // `defer formatter.deinit()` — handled by Drop
    let received = value.to_fmt(&mut formatter);

    if not {
        let signature = Expect::get_signature("toBeBoolean", "", true);
        return this.throw(
            global,
            signature,
            format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
        );
    }

    let signature = Expect::get_signature("toBeBoolean", "", false);
    this.throw(
        global,
        signature,
        format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeBoolean.zig (35 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match aliases &mut self under scopeguard; get_signature assumed const fn → &'static str
// ──────────────────────────────────────────────────────────────────────────
