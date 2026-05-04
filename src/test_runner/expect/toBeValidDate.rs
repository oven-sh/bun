use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::Expect;
use super::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_be_valid_date(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // TODO(port): `defer this.postMatch(global)` — scopeguard borrowing `this` conflicts with
    // uses below. Phase B: either raw-ptr capture or an RAII `PostMatchGuard` on Expect.
    let _guard = scopeguard::guard((), |_| this.post_match(global));
    // PORT NOTE: reshaped for borrowck

    let this_value = frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBeValidDate", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.not;
    let mut pass = value.is_date() && !value.get_unix_timestamp().is_nan();
    if not {
        pass = !pass;
    }

    if pass {
        return Ok(this_value);
    }

    let mut formatter = Formatter {
        global_this: global,
        quote_strings: true,
        ..Formatter::default()
    };
    // `defer formatter.deinit()` → handled by Drop
    let received = value.to_fmt(&mut formatter);

    if not {
        let signature = const { get_signature("toBeValidDate", "", true) };
        return this.throw(
            global,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", received),
        );
    }

    let signature = const { get_signature("toBeValidDate", "", false) };
    this.throw(
        global,
        signature,
        format_args!("\n\nReceived: <red>{}<r>\n", received),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeValidDate.zig (37 lines)
//   confidence: medium
//   todos:      1
//   notes:      `defer post_match` needs RAII guard pattern shared across all matchers; get_signature assumed const fn
// ──────────────────────────────────────────────────────────────────────────
