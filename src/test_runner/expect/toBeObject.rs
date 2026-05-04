use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_object(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // Zig: `defer this.postMatch(globalThis);`
        // PORT NOTE: reshaped for borrowck (was `defer this.postMatch`) — wrap the
        // body in an inner closure and call `post_match` after it returns, so every
        // exit path (incl. `?` early-returns) is covered without a raw `*mut Expect`.
        let result = (|| -> JsResult<JSValue> {
        let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, "toBeObject", "")?;

        this.increment_expect_call_counter();

        let not = this.flags.not;
        let pass = value.is_object() != not;

        if pass {
            return Ok(this_value);
        }

        // Zig: `defer formatter.deinit();` — handled by Drop.
        let mut formatter = Formatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        let received = value.to_fmt(&mut formatter);

        if not {
            let signature = Expect::get_signature("toBeObject", "", true);
            return this.throw(
                global,
                signature,
                format_args!(
                    "\n\nExpected value <b>not<r> to be an object\n\nReceived: <red>{}<r>\n",
                    received
                ),
            );
        }

        let signature = Expect::get_signature("toBeObject", "", false);
        this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected value to be an object\n\nReceived: <red>{}<r>\n",
                received
            ),
        )
        })();
        this.post_match(global);
        result
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeObject.zig (35 lines)
//   confidence: medium
//   todos:      0
//   notes:      defer post_match reshaped as inner-closure + trailing call (no raw ptr); Formatter init/throw signatures may need adjustment in Phase B
// ──────────────────────────────────────────────────────────────────────────
