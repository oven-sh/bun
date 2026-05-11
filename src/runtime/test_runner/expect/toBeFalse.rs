use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_false(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let this = self;
        // Zig: `defer this.postMatch(globalThis);`
        // PORT NOTE: reshaped for borrowck (was `defer this.postMatch`) — scopeguard would hold
        // a borrow of `this` for the whole body, so run the match in an inner closure and call
        // post_match once on the way out (covers both Ok and Err paths).
        let res = (|| -> JsResult<JSValue> {
            let this_value = frame.this();
            let value: JSValue = this.get_value(global, this_value, "toBeFalse", "")?;

            this.increment_expect_call_counter();

            let not = this.flags.get().not();
            let pass = (value.is_boolean() && !value.to_boolean()) != not;

            if pass {
                return Ok(JSValue::UNDEFINED);
            }

            // Zig: `var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };`
            // Zig: `defer formatter.deinit();` — dropped; `impl Drop for ConsoleFormatter` handles cleanup.
            let mut formatter = super::make_formatter(global);
            let received = value.to_fmt(&mut formatter);

            if not {
                let signature: &str = Expect::get_signature("toBeFalse", "", true);
                return this.throw(
                    global,
                    signature,
                    format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
                );
            }

            let signature: &str = Expect::get_signature("toBeFalse", "", false);
            this.throw(
                global,
                signature,
                format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
            )
        })();
        this.post_match(global);
        res
    }
}

// ported from: src/test_runner/expect/toBeFalse.zig
