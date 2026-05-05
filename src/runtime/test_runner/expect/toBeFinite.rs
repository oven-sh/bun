use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_finite(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: reshaped for borrowck — `defer this.postMatch(globalThis)` becomes a
        // scopeguard wrapping `this`; method calls go through DerefMut.
        let mut this = scopeguard::guard(this, |this| this.post_match(global));

        let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, "toBeFinite", "")?;

        this.increment_expect_call_counter();

        let mut pass = value.is_number();
        if pass {
            let num: f64 = value.as_number();
            pass = num.is_finite() && !num.is_nan();
        }

        let not = this.flags.not;
        if not {
            pass = !pass;
        }

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        let mut formatter = Formatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        // `defer formatter.deinit()` → dropped; Formatter: Drop handles cleanup.
        let received = value.to_fmt(&mut formatter);

        if not {
            const SIGNATURE: &str = Expect::get_signature("toBeFinite", "", true);
            return this.throw(
                global,
                SIGNATURE,
                format_args!("\n\nReceived: <red>{}<r>\n", received),
            );
        }

        const SIGNATURE: &str = Expect::get_signature("toBeFinite", "", false);
        this.throw(
            global,
            SIGNATURE,
            format_args!("\n\nReceived: <red>{}<r>\n", received),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeFinite.zig (42 lines)
//   confidence: medium
//   todos:      0
//   notes:      scopeguard wraps `this` for post_match defer; get_signature assumed const fn → &'static str; Formatter struct-init path may need a ::new() in Phase B
// ──────────────────────────────────────────────────────────────────────────
