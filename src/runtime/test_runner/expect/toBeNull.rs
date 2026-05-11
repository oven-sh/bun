use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_null(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: reshaped for borrowck — `defer this.postMatch(globalThis)` becomes a
        // scopeguard over `self` so post_match runs on every exit path.
        let this = scopeguard::guard(self, |this| this.post_match(global));

        let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, "toBeNull", "")?;

        this.increment_expect_call_counter();

        let not = this.flags.get().not();
        let mut pass = value.is_null();
        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        let mut formatter = super::make_formatter(global);
        let value_fmt = value.to_fmt(&mut formatter);
        if not {
            let signature: &str = Expect::get_signature("toBeNull", "", true);
            return this.throw(
                global,
                signature,
                format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
            );
        }

        let signature: &str = Expect::get_signature("toBeNull", "", false);
        this.throw(
            global,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
        )
    }
}

// ported from: src/test_runner/expect/toBeNull.zig
