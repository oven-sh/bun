use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::Expect;
use super::Expect::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_be_nan(this: &mut Expect, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // `defer this.postMatch(globalThis)` — must run on every exit path including the `?` below.
    // scopeguard cannot hold `&mut Expect` across the body without a borrowck conflict, so we
    // capture a raw pointer.
    // SAFETY: `this` outlives this function frame; post_match runs before return while `this` is
    // still exclusively borrowed by us.
    let this_ptr: *mut Expect = this;
    let _post_match = scopeguard::guard((), move |_| unsafe {
        (*this_ptr).post_match(global);
    });
    // TODO(port): revisit raw-pointer scopeguard once Expect::post_match signature is settled.

    let this_value = frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBeNaN", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.not;
    let mut pass = false;
    if value.is_number() {
        let number = value.as_number();
        if number != number {
            pass = true;
        }
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let mut formatter = Formatter { global_this: global, quote_strings: true, ..Default::default() };
    let value_fmt = value.to_fmt(&mut formatter);
    if not {
        const SIGNATURE: &str = get_signature("toBeNaN", "", true);
        return this.throw(global, SIGNATURE, format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), value_fmt));
    }

    const SIGNATURE: &str = get_signature("toBeNaN", "", false);
    this.throw(global, SIGNATURE, format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), value_fmt))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeNaN.zig (42 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match via raw-ptr scopeguard (borrowck); Expect::throw assumed to take format_args!; get_signature assumed const fn
// ──────────────────────────────────────────────────────────────────────────
