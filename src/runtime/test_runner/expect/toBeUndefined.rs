use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_undefined(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO(port): `defer this.postMatch(globalThis)` — scopeguard would hold &mut self across
        // the body; verify borrowck reshaping in Phase B (call post_match on all exit paths).
        let _post = scopeguard::guard((), |_| this.post_match(global));

        let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, "toBeUndefined", "")?;

        this.increment_expect_call_counter();

        let not = this.flags.not;
        let mut pass = false;
        if value.is_undefined() {
            pass = true;
        }

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
        // PORT NOTE: `defer formatter.deinit()` dropped — Formatter impls Drop.
        let value_fmt = value.to_fmt(&mut formatter);
        if not {
            const SIGNATURE: &str = Expect::get_signature("toBeUndefined", "", true);
            return this.throw(
                global,
                SIGNATURE,
                concat!("\n\n", "Received: <red>{}<r>\n"),
                format_args!("{}", value_fmt),
            );
        }

        const SIGNATURE: &str = Expect::get_signature("toBeUndefined", "", false);
        this.throw(
            global,
            SIGNATURE,
            concat!("\n\n", "Received: <red>{}<r>\n"),
            format_args!("{}", value_fmt),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeUndefined.zig (38 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match() needs borrowck-safe scopeguard; get_signature assumed const fn
// ──────────────────────────────────────────────────────────────────────────
