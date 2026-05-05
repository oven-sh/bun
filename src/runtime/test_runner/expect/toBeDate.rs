use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::Expect;
use super::Expect::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_be_date(this: &mut Expect, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // TODO(port): `defer this.postMatch(global)` — scopeguard captures &mut *this for the whole
    // scope and conflicts with later uses; Phase B may need to reshape (call before each return).
    let _post = scopeguard::guard((), |_| this.post_match(global));

    let this_value = frame.this_value();
    let value: JSValue = this.get_value(global, this_value, "toBeDate", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.not;
    let pass = value.is_date() != not;

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = Formatter { global_this: global, quote_strings: true, ..Default::default() };
    // `defer formatter.deinit()` — handled by Drop.
    let received = value.to_fmt(&mut formatter);

    if not {
        let signature = get_signature("toBeDate", "", true);
        return this.throw(
            global,
            signature,
            format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
        );
    }

    let signature = get_signature("toBeDate", "", false);
    this.throw(
        global,
        signature,
        format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeDate.zig (35 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match via scopeguard will fight borrowck; get_signature assumed const-ish; throw() takes format_args!
// ──────────────────────────────────────────────────────────────────────────
