use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter as ConsoleFormatter;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_less_than_or_equal(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // `defer this.postMatch(globalThis)` — side effect on every exit path.
        // PORT NOTE: move `this` into the scopeguard so the body uses it via DerefMut and
        // `post_match` runs on drop without an overlapping borrow.
        let mut this = scopeguard::guard(this, |this| this.post_match(global));

        let this_value = frame.this();
        let _arguments = frame.arguments_old::<1>();
        let arguments: &[JSValue] = &_arguments.ptr[0.._arguments.len];

        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!(
                "toBeLessThanOrEqual() requires 1 argument"
            )));
        }

        this.increment_expect_call_counter();

        let other_value = arguments[0];
        other_value.ensure_still_alive();

        let value: JSValue =
            this.get_value(global, this_value, "toBeLessThanOrEqual", "<green>expected<r>")?;

        if (!value.is_number() && !value.is_big_int())
            || (!other_value.is_number() && !other_value.is_big_int())
        {
            return Err(global.throw(format_args!(
                "Expected and actual values must be numbers or bigints"
            )));
        }

        let not = this.flags.not();
        let mut pass = false;

        if !value.is_big_int() && !other_value.is_big_int() {
            pass = value.as_number() <= other_value.as_number();
        } else if value.is_big_int() {
            // UFCS: the inherent `JSValue::as_big_int_compare(global, other)` shadows the
            // `JSValueTestExt` trait method which keeps the Phase-A `(other, global)` ordering
            // and returns `BigIntCompare`. Call the trait method explicitly.
            pass = match JSValueTestExt::as_big_int_compare(value, other_value, global) {
                BigIntCompare::LessThan | BigIntCompare::Equal => true,
                _ => pass,
            };
        } else {
            pass = match JSValueTestExt::as_big_int_compare(other_value, value, global) {
                BigIntCompare::GreaterThan | BigIntCompare::Equal => true,
                _ => pass,
            };
        }

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        // PORT NOTE: Zig aliased one `*Formatter` for both fmt adapters; Rust `to_fmt` takes
        // `&mut Formatter` so two live adapters need two formatters (matches toBeLessThan.rs).
        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        let value_fmt = value.to_fmt(&mut formatter);
        let expected_fmt = other_value.to_fmt(&mut formatter2);
        if not {
            const EXPECTED_LINE: &str = "Expected: not \\<= <green>{}<r>\n";
            const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
            let signature = Expect::get_signature("toBeLessThanOrEqual", "<green>expected<r>", true);
            return this.throw_fmt(
                global,
                signature,
                concat!("\n\n", "Expected: not \\<= <green>{}<r>\n", "Received: <red>{}<r>\n"),
                format_args!(
                    "\n\nExpected: not \\<= <green>{}<r>\nReceived: <red>{}<r>\n",
                    expected_fmt, value_fmt
                ),
            );
            // TODO(port): Zig passes (signature, fmt, args) — Rust `throw` likely takes (signature, format_args!); the `concat!` literal above mirrors the Zig `++` for diff parity. Phase B: collapse to a single format_args! arg.
        }

        const EXPECTED_LINE: &str = "Expected: \\<= <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        let signature = Expect::get_signature("toBeLessThanOrEqual", "<green>expected<r>", false);
        this.throw_fmt(
            global,
            signature,
            concat!("\n\n", "Expected: \\<= <green>{}<r>\n", "Received: <red>{}<r>\n"),
            format_args!(
                "\n\nExpected: \\<= <green>{}<r>\nReceived: <red>{}<r>\n",
                expected_fmt, value_fmt
            ),
        )
        // TODO(port): same as above — reconcile `throw` arity in Phase B.
    }
}

// ported from: src/test_runner/expect/toBeLessThanOrEqual.zig
