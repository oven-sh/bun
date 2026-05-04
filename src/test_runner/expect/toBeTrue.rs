use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use crate::expect::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_true(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // Zig: `defer this.postMatch(globalThis);`
        // PORT NOTE: reshaped for borrowck (was `defer this.postMatch`) — scopeguard would hold
        // &mut self for the whole body, so run the match in an inner closure and call
        // post_match once on the way out (covers both Ok and Err paths).
        let res = (|| -> JsResult<JSValue> {
            let this_value = frame.this();
            let value: JSValue = this.get_value(global, this_value, "toBeTrue", "")?;

            this.increment_expect_call_counter();

            let not = this.flags.not;
            let pass = (value.is_boolean() && value.to_boolean()) != not;

            if pass {
                return Ok(JSValue::UNDEFINED);
            }

            let mut formatter = Formatter {
                global_this: global,
                quote_strings: true,
                ..Default::default()
            };
            // Zig: `defer formatter.deinit();` — handled by Drop.
            let received = value.to_fmt(&mut formatter);

            if not {
                const SIGNATURE: &str = Expect::get_signature("toBeTrue", "", true);
                return this.throw(
                    global,
                    SIGNATURE,
                    concat!("\n\n", "Received: <red>{}<r>\n"),
                    format_args!("{}", received),
                );
            }

            const SIGNATURE: &str = Expect::get_signature("toBeTrue", "", false);
            this.throw(
                global,
                SIGNATURE,
                concat!("\n\n", "Received: <red>{}<r>\n"),
                format_args!("{}", received),
            )
        })();
        this.post_match(global);
        res
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeTrue.zig (35 lines)
//   confidence: medium-high
//   todos:      0
//   notes:      defer post_match() reshaped via inner closure (no raw ptrs); Formatter init/throw() signatures need Phase B confirmation
// ──────────────────────────────────────────────────────────────────────────
