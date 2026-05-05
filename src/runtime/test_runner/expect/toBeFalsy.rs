use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use crate::expect::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_falsy(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: reshaped for borrowck — was `defer this.postMatch(globalThis)`. A scopeguard
        // would hold `&mut self` across the whole body, conflicting with get_value/throw below, so
        // post_match() is called explicitly on every return path instead.

        let this_value = frame.this();

        let value: JSValue = match this.get_value(global, this_value, "toBeFalsy", "") {
            Ok(v) => v,
            Err(e) => {
                this.post_match(global);
                return Err(e);
            }
        };

        this.increment_expect_call_counter();

        let not = this.flags.not;
        let mut pass = false;

        let truthy = value.to_boolean();
        if !truthy {
            pass = true;
        }

        if not {
            pass = !pass;
        }
        if pass {
            this.post_match(global);
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        let mut formatter = Formatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        // `defer formatter.deinit()` → handled by Drop
        let value_fmt = value.to_fmt(&mut formatter);
        if not {
            // received_line = "Received: <red>{f}<r>\n" — inlined into concat!() below since Rust
            // concat! only accepts literals (Zig `++` works on comptime consts).
            let signature = Expect::get_signature("toBeFalsy", "", true);
            let res = this.throw(
                global,
                signature,
                format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), value_fmt),
            );
            this.post_match(global);
            return res;
        }

        let signature = Expect::get_signature("toBeFalsy", "", false);
        let res = this.throw(
            global,
            signature,
            format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), value_fmt),
        );
        this.post_match(global);
        res
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeFalsy.zig (42 lines)
//   confidence: medium
//   todos:      0
//   notes:      defer post_match() inlined on each return path; throw() assumed to take format_args!
// ──────────────────────────────────────────────────────────────────────────
