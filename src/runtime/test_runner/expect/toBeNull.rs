use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_null(
        &mut self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: reshaped for borrowck — `defer this.postMatch(globalThis)` becomes a
        // scopeguard over `self` so post_match runs on every exit path.
        let mut this = scopeguard::guard(self, |this| this.post_match(global));

        let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, "toBeNull", "")?;

        this.increment_expect_call_counter();

        let not = this.flags.not;
        let mut pass = value.is_null();
        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        let mut formatter = Formatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        let value_fmt = value.to_fmt(&mut formatter);
        if not {
            const SIGNATURE: &str = Expect::get_signature("toBeNull", "", true);
            return this.throw(
                global,
                SIGNATURE,
                format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
            );
        }

        const SIGNATURE: &str = Expect::get_signature("toBeNull", "", false);
        this.throw(
            global,
            SIGNATURE,
            format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeNull.zig (37 lines)
//   confidence: medium
//   todos:      0
//   notes:      get_signature must be const fn; throw() takes fmt::Arguments; scopeguard wraps &mut self for post_match defer
// ──────────────────────────────────────────────────────────────────────────
