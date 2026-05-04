use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use crate::diff_format::DiffFormatter;
use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_equal(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO(port): `defer this.postMatch(globalThis)` — scopeguard borrows `this` for the
        // whole scope which conflicts with the body's `&mut self` uses; reshape in Phase B
        // (e.g. capture a raw `*mut Self` or call `post_match` on every return path).
        let _post_match = scopeguard::guard((), |_| this.post_match(global));

        let this_value = frame.this();
        let _arguments = frame.arguments_old(1);
        let arguments: &[JSValue] = _arguments.as_slice();

        if arguments.len() < 1 {
            return global.throw_invalid_arguments(format_args!("toEqual() requires 1 argument"));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        let value: JSValue = this.get_value(global, this_value, "toEqual", "<green>expected<r>")?;

        let not = this.flags.not;
        let mut pass = value.jest_deep_equals(expected, global)?;

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        let diff_formatter = DiffFormatter {
            received: value,
            expected,
            global_this: global,
            not,
        };

        if not {
            const SIGNATURE: &str = Expect::get_signature("toEqual", "<green>expected<r>", true);
            return this.throw(global, SIGNATURE, format_args!("\n\n{}\n", diff_formatter));
        }

        const SIGNATURE: &str = Expect::get_signature("toEqual", "<green>expected<r>", false);
        this.throw(global, SIGNATURE, format_args!("\n\n{}\n", diff_formatter))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toEqual.zig (49 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match needs borrowck reshape; get_signature assumed const fn -> &'static str
// ──────────────────────────────────────────────────────────────────────────
