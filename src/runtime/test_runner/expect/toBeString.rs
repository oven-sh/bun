use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use super::Expect;
use super::get_signature;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_string(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // Zig: `defer this.postMatch(globalThis);`
        // PORT NOTE: reshaped for borrowck — scopeguard derefs to &mut Self so method
        // calls below go through the guard.
        let mut this = scopeguard::guard(this, |this| this.post_match(global));

        let this_value = frame.this_value();
        let value: JSValue = this.get_value(global, this_value, "toBeString", "")?;

        this.increment_expect_call_counter();

        let not = this.flags.not;
        let pass = value.is_string() != not;

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // Zig: `defer formatter.deinit();` — handled by Drop.
        // TODO(port): Formatter has other defaulted fields in Zig; constructor shape may differ.
        let mut formatter = Formatter::new(global).quote_strings(true);
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeString.zig (35 lines)
//   confidence: medium
//   todos:      1
//   notes:      scopeguard wraps &mut Self for defer post_match; Formatter ctor + Expect::throw fmt-args signature need Phase B alignment
// ──────────────────────────────────────────────────────────────────────────
