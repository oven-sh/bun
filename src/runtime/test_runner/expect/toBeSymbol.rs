use bun_jsc::console_object::Formatter;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use crate::expect::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_symbol(
        &mut self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO(port): `defer this.postMatch(globalThis)` — the scopeguard below captures
        // `self`/`global` which are reused throughout the body; Phase B must reshape
        // (e.g. immediately-invoked closure returning the result, then `self.post_match`).
        let _post = scopeguard::guard((), |_| self.post_match(global));

        let this_value = frame.this();
        let value: JSValue = self.get_value(global, this_value, "toBeSymbol", "")?;

        self.increment_expect_call_counter();

        let not = self.flags.not;
        let pass = value.is_symbol() != not;

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        let mut formatter = Formatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        // `defer formatter.deinit()` — handled by Drop
        let received = value.to_fmt(&mut formatter);

        if not {
            let signature = Expect::get_signature("toBeSymbol", "", true);
            return self.throw(
                global,
                signature,
                format_args!("\n\nReceived: <red>{}<r>\n", received),
            );
        }

        let signature = Expect::get_signature("toBeSymbol", "", false);
        self.throw(
            global,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", received),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeSymbol.zig (35 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match needs borrowck reshape; get_signature assumed const fn
// ──────────────────────────────────────────────────────────────────────────
