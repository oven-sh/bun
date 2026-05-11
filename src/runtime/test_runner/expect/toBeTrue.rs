use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_true(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let this = self;
        // Zig: `defer this.postMatch(globalThis);`
        // PORT NOTE: reshaped for borrowck (was `defer this.postMatch`) — scopeguard would hold
        // &mut self for the whole body, so run the match in an inner closure and call
        // post_match once on the way out (covers both Ok and Err paths).
        let res = (|| -> JsResult<JSValue> {
            let this_value = frame.this();
            let value: JSValue = this.get_value(global, this_value, "toBeTrue", "")?;

            this.increment_expect_call_counter();

            let not = this.flags.get().not();
            let pass = (value.is_boolean() && value.to_boolean()) != not;

            if pass {
                return Ok(JSValue::UNDEFINED);
            }

            let mut formatter = super::make_formatter(global);
            // Zig: `defer formatter.deinit();` — handled by Drop.
            let received = value.to_fmt(&mut formatter);

            if not {
                let signature: &str = Expect::get_signature("toBeTrue", "", true);
                return this.throw_fmt(
                    global,
                    signature,
                    concat!("\n\n", "Received: <red>{}<r>\n"),
                    format_args!("{}", received),
                );
            }

            let signature: &str = Expect::get_signature("toBeTrue", "", false);
            this.throw_fmt(
                global,
                signature,
                concat!("\n\n", "Received: <red>{}<r>\n"),
                format_args!("{}", received),
            )
        })();
        this.post_match(global);
        res
    }
}

// ported from: src/test_runner/expect/toBeTrue.zig
