use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};

use super::DiffFormatter;
use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_strict_equal(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: `defer this.postMatch(globalThis)` — reshaped for borrowck: scopeguard owns
        // the &mut Expect and runs post_match on drop; body re-borrows through DerefMut.
        let mut this = scopeguard::guard(this, |t| t.post_match(global));
        let this: &mut Expect = &mut this;

        let this_value = frame.this();
        let _arguments = frame.arguments_old::<1>();
        // TODO(port): arguments_old returns a {ptr,len} struct in Zig; Phase B exposes a slice accessor.
        let arguments: &[JSValue] = &_arguments.ptr[0.._arguments.len];

        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(
                format_args!("toStrictEqual() requires 1 argument"),
            ));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        let value: JSValue =
            this.get_value(global, this_value, "toStrictEqual", "<green>expected<r>")?;

        let not = this.flags.not();
        let mut pass = value.jest_strict_deep_equals(expected, global)?;

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
            let signature = Expect::get_signature("toStrictEqual", "<green>expected<r>", true);
            return this.throw(global, signature, format_args!("\n\n{}\n", diff_formatter));
        }

        let signature = Expect::get_signature("toStrictEqual", "<green>expected<r>", false);
        this.throw(global, signature, format_args!("\n\n{}\n", diff_formatter))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toStrictEqual.zig (44 lines)
//   confidence: medium
//   todos:      2
//   notes:      defer post_match needs borrowck reshape; arguments_old slice accessor TBD
// ──────────────────────────────────────────────────────────────────────────
