use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};

use super::DiffFormatter;
use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_equal(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: reshaped for borrowck — Zig `defer this.postMatch(globalThis)` becomes a
        // scopeguard owning the `&mut Expect` borrow so post_match runs on every exit path;
        // method calls below go through DerefMut.
        let mut this = scopeguard::guard(this, |this| this.post_match(global));

        let this_value = frame.this();
        let _arguments = frame.arguments_old::<1>();
        let arguments: &[JSValue] = _arguments.slice();

        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!("toEqual() requires 1 argument")));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        let value: JSValue = this.get_value(global, this_value, "toEqual", "<green>expected<r>")?;

        let not = this.flags.not();
        let mut pass = value.jest_deep_equals(expected, global)?;

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        let diff_formatter = DiffFormatter {
            received: Some(value),
            expected: Some(expected),
            received_string: None,
            expected_string: None,
            global_this: Some(global),
            not,
        };

        if not {
            let signature: &str = Expect::get_signature("toEqual", "<green>expected<r>", true);
            return this.throw(global, signature, format_args!("\n\n{}\n", diff_formatter));
        }

        let signature: &str = Expect::get_signature("toEqual", "<green>expected<r>", false);
        this.throw(global, signature, format_args!("\n\n{}\n", diff_formatter))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toEqual.zig (49 lines)
//   confidence: medium
//   todos:      0
//   notes:      defer post_match reshaped via scopeguard owning &mut Self; get_signature assumed const fn -> &'static str
// ──────────────────────────────────────────────────────────────────────────
