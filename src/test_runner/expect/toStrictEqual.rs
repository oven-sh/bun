use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use crate::diff_format::DiffFormatter;
use crate::expect::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_strict_equal(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO(port): `defer this.postMatch(globalThis)` — scopeguard would borrow `this` for the
        // whole scope, conflicting with the &mut uses below. Phase B: either thread post_match
        // through every return, or split-borrow the field post_match needs.
        let _post = scopeguard::guard((), |_| this.post_match(global));

        let this_value = frame.this();
        let _arguments = frame.arguments_old(1);
        // TODO(port): arguments_old returns a {ptr,len} struct in Zig; Phase B exposes a slice accessor.
        let arguments: &[JSValue] = &_arguments.ptr[0.._arguments.len];

        if arguments.len() < 1 {
            return global.throw_invalid_arguments(
                format_args!("toStrictEqual() requires 1 argument"),
            );
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        let value: JSValue =
            this.get_value(global, this_value, "toStrictEqual", "<green>expected<r>")?;

        let not = this.flags.not;
        let mut pass = value.jest_strict_deep_equals(expected, global)?;

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
            let signature = const { Expect::get_signature("toStrictEqual", "<green>expected<r>", true) };
            return this.throw(global, signature, format_args!("\n\n{}\n", diff_formatter));
        }

        let signature = const { Expect::get_signature("toStrictEqual", "<green>expected<r>", false) };
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
