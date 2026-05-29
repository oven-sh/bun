use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_object(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let this = self;
        let result = (|| -> JsResult<JSValue> {
        let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, "toBeObject", "")?;

        this.increment_expect_call_counter();

        let not = this.flags.get().not();
        let pass = value.is_object() != not;

        if pass {
            return Ok(this_value);
        }

        // Zig: `defer formatter.deinit();` — handled by Drop.
        let mut formatter = super::make_formatter(global);
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

// ported from: src/test_runner/expect/toBeObject.zig
