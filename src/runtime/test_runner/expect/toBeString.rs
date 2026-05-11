use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, FormatterTestExt, make_formatter};

use super::Expect;
use super::get_signature;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_string(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // Zig: `defer this.postMatch(globalThis);`
        // PORT NOTE: reshaped for borrowck — scopeguard derefs to &mut Self so method
        // calls below go through the guard.
        let this = scopeguard::guard(self, |this| this.post_match(global));

        let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, "toBeString", "")?;

        this.increment_expect_call_counter();

        let not = this.flags.get().not();
        let pass = value.is_string() != not;

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // Zig: `defer formatter.deinit();` — handled by Drop.
        let mut formatter = super::make_formatter(global);
        let received = value.to_fmt(&mut formatter);

        if not {
            // `comptime getSignature(...)` — get_signature is `const fn` in the port.
            let signature = get_signature("toBeString", "", true);
            return this.throw(
                global,
                signature,
                format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
            );
        }

        let signature = get_signature("toBeString", "", false);
        this.throw(
            global,
            signature,
            format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
        )
    }
}

// ported from: src/test_runner/expect/toBeString.zig
