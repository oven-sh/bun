use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::{Expect, get_signature};

#[bun_jsc::host_fn(method)]
pub fn to_be_negative(
    this: &mut Expect,
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalThis);`
    let mut this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = call_frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBeNegative", "")?;

    this.increment_expect_call_counter();

    let mut pass = value.is_number();
    if pass {
        let num: f64 = value.as_number();
        pass = num.round() < 0.0 && !num.is_infinite() && !num.is_nan();
    }

    let not = this.flags.not;
    if not {
        pass = !pass;
    }

    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = Formatter {
        global,
        quote_strings: true,
        ..Default::default()
    };
    // Zig: `defer formatter.deinit();` — handled by Drop
    let received = value.to_fmt(&mut formatter);

    if not {
        const SIGNATURE: &str = get_signature("toBeNegative", "", true);
        return this.throw(
            global,
            SIGNATURE,
            format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
        );
    }

    const SIGNATURE: &str = get_signature("toBeNegative", "", false);
    this.throw(
        global,
        SIGNATURE,
        format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeNegative.zig (42 lines)
//   confidence: medium
//   todos:      0
//   notes:      scopeguard wraps `this` for defer post_match; Formatter init/get_signature signatures may need adjustment in Phase B
// ──────────────────────────────────────────────────────────────────────────
