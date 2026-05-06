use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_undefined(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: `defer this.postMatch(globalThis)` — wrap `this` in a scopeguard that owns
        // the &mut Expect and calls post_match on drop, so the body can still use `this` mutably.
        let mut this = scopeguard::guard(this, |t| t.post_match(global));

        let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, "toBeUndefined", "")?;

        this.increment_expect_call_counter();

        let not = this.flags.not();
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
        let mut formatter = super::make_formatter(global);
        // PORT NOTE: `defer formatter.deinit()` dropped — Formatter impls Drop.
        let value_fmt = value.to_fmt(&mut formatter);
        if not {
            let signature: &str = Expect::get_signature("toBeUndefined", "", true);
            return this.throw_fmt(
                global,
                signature,
                concat!("\n\n", "Received: <red>{}<r>\n"),
                format_args!("{}", value_fmt),
            );
        }

        let signature: &str = Expect::get_signature("toBeUndefined", "", false);
        this.throw_fmt(
            global,
            signature,
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
