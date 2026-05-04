use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_be_even(
    this: &mut Expect,
    global_this: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    // TODO(port): `defer this.postMatch(globalThis)` — scopeguard closure borrows `this`/`global_this`;
    // Phase B: reshape (RAII guard on Expect, or call post_match before each return).
    let _post_match = scopeguard::guard((), |_| this.post_match(global_this));

    let this_value = call_frame.this();

    let value: JSValue = this.get_value(global_this, this_value, "toBeEven", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.not;
    let mut pass = false;

    if value.is_any_int() {
        let _value = value.to_int64();
        pass = _value.rem_euclid(2) == 0;
        if _value == 0 {
            // negative zero is even
            pass = true;
        }
    } else if value.is_big_int() || value.is_big_int32() {
        let _value = value.to_int64();
        pass = if _value == 0 {
            // negative zero is even
            true
        } else {
            _value & 1 == 0
        };
    } else if value.is_number() {
        let _value = value.as_number();
        if _value.rem_euclid(1.0) == 0.0 && _value.rem_euclid(2.0) == 0.0 {
            // if the fraction is all zeros and even
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
    let mut formatter = Formatter {
        global_this,
        quote_strings: true,
        ..Default::default()
    };
    // `defer formatter.deinit()` — handled by Drop
    let value_fmt = value.to_fmt(&mut formatter);
    if not {
        let signature = const { Expect::get_signature("toBeEven", "", true) };
        return this.throw(
            global_this,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
        );
    }

    let signature = const { Expect::get_signature("toBeEven", "", false) };
    this.throw(
        global_this,
        signature,
        format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeEven.zig (62 lines)
//   confidence: medium
//   todos:      1
//   notes:      scopeguard for post_match will fight borrowck; Expect::throw arity collapsed fmt+args into format_args!; get_signature wrapped in const { } (requires const fn in Phase B)
// ──────────────────────────────────────────────────────────────────────────
