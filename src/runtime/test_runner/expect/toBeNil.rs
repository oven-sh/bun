use bun_jsc::console_object::Formatter;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_nil(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: reshaped for borrowck — `defer this.postMatch(global)` via scopeguard owning `this`.
        let mut this = scopeguard::guard(this, |t| t.post_match(global));

        let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, "toBeNil", "")?;

        this.increment_expect_call_counter();

        let not = this.flags.not;
        let pass = value.is_undefined_or_null() != not;

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        let mut formatter = Formatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        let received = value.to_fmt(&mut formatter);

        if not {
            let signature = Expect::get_signature("toBeNil", "", true);
            return this.throw(
                global,
                signature,
                format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
            );
        }

        let signature = Expect::get_signature("toBeNil", "", false);
        this.throw(
            global,
            signature,
            format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeNil.zig (35 lines)
//   confidence: high
//   todos:      0
//   notes:      scopeguard owns `this` to model `defer postMatch`; Formatter init assumes Default + pub fields
// ──────────────────────────────────────────────────────────────────────────
