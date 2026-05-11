use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_finite(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: reshaped for borrowck — `defer this.postMatch(globalThis)` becomes a
        // scopeguard wrapping `this`; method calls go through DerefMut.
        let this = scopeguard::guard(self, |this| this.post_match(global));

        let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, "toBeFinite", "")?;

        this.increment_expect_call_counter();

        let mut pass = value.is_number();
        if pass {
            let num: f64 = value.as_number();
            pass = num.is_finite() && !num.is_nan();
        }

        let not = this.flags.get().not();
        if not {
            pass = !pass;
        }

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        let mut formatter = super::make_formatter(global);
        // `defer formatter.deinit()` → dropped; Formatter: Drop handles cleanup.
        let received = value.to_fmt(&mut formatter);

        if not {
            let signature: &str = Expect::get_signature("toBeFinite", "", true);
            return this.throw(
                global,
                signature,
                format_args!("\n\nReceived: <red>{}<r>\n", received),
            );
        }

        let signature: &str = Expect::get_signature("toBeFinite", "", false);
        this.throw(
            global,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", received),
        )
    }
}

// ported from: src/test_runner/expect/toBeFinite.zig
