use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter as ConsoleFormatter;

use crate::expect::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_false(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // Zig: `defer this.postMatch(globalThis);`
        // TODO(port): scopeguard captures `&mut *this` across the fn body; Phase B may need to
        // reshape (e.g. call post_match before each return) if borrowck rejects this.
        let _post = scopeguard::guard((), |_| this.post_match(global));

        let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, b"toBeFalse", b"")?;

        this.increment_expect_call_counter();

        let not = this.flags.not;
        let pass = (value.is_boolean() && !value.to_boolean()) != not;

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // Zig: `var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };`
        // Zig: `defer formatter.deinit();` — dropped; `impl Drop for ConsoleFormatter` handles cleanup.
        let mut formatter = ConsoleFormatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        let received = value.to_fmt(&mut formatter);

        if not {
            const SIGNATURE: &'static str = Expect::get_signature("toBeFalse", "", true);
            return this.throw(
                global,
                SIGNATURE,
                format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
            );
        }

        const SIGNATURE: &'static str = Expect::get_signature("toBeFalse", "", false);
        this.throw(
            global,
            SIGNATURE,
            format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeFalse.zig (35 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match via scopeguard will fight borrowck; ConsoleFormatter init/Default and Expect::get_signature const-fn need Phase B wiring
// ──────────────────────────────────────────────────────────────────────────
