use bun_jsc::console_object::Formatter;
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_symbol(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // Zig: `defer this.postMatch(globalThis);`
        // PORT NOTE: reshaped for borrowck — scopeguard would hold `&mut self` for the whole
        // body, so run the match in an immediately-invoked closure and call `post_match` once
        // on the way out (covers both Ok and Err paths).
        let res = (|| -> JsResult<JSValue> {
            let this_value = frame.this();
            let value: JSValue = self.get_value(global, this_value, "toBeSymbol", "")?;

            self.increment_expect_call_counter();

            let not = self.flags.get().not();
            let pass = value.is_symbol() != not;

            if pass {
                return Ok(JSValue::UNDEFINED);
            }

            let mut formatter = super::make_formatter(global);
            // `defer formatter.deinit()` — handled by Drop
            let received = value.to_fmt(&mut formatter);

            if not {
                let signature = Expect::get_signature("toBeSymbol", "", true);
                return self.throw(
                    global,
                    signature,
                    format_args!("\n\nReceived: <red>{}<r>\n", received),
                );
            }

            let signature = Expect::get_signature("toBeSymbol", "", false);
            self.throw(
                global,
                signature,
                format_args!("\n\nReceived: <red>{}<r>\n", received),
            )
        })();
        self.post_match(global);
        res
    }
}

// ported from: src/test_runner/expect/toBeSymbol.zig
