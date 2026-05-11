use bun_jsc::{CallFrame, ConsoleObject, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain_value(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: reshaped for borrowck — Zig `defer this.postMatch(globalObject)` becomes a
        // scopeguard owning `&mut self` so post_match runs on every exit path.
        let this = scopeguard::guard(self, |t| t.post_match(global));

        let this_value = frame.this();
        let arguments_ = frame.arguments_old::<1>();
        let arguments = arguments_.slice();

        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!("toContainValue() takes 1 argument")));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        expected.ensure_still_alive();
        let value: JSValue =
            this.get_value(global, this_value, "toContainValue", "<green>expected<r>")?;

        let not = this.flags.get().not();
        let mut pass = false;

        if !value.is_undefined_or_null() {
            let values = value.values(global)?;
            let mut itr = values.array_iterator(global)?;
            while let Some(item) = itr.next()? {
                if item.jest_deep_equals(expected, global)? {
                    pass = true;
                    break;
                }
            }
        }

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(this_value);
        }

        // handle failure
        // PORT NOTE: to_fmt() mutably borrows the formatter for the lifetime of the returned
        // ZigFormatter, so two concurrent to_fmt() values need two formatter instances.
        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        if not {
            return this.throw(
                global,
                Expect::get_signature("toContainValue", "<green>expected<r>", true),
                format_args!(
                    "\n\nExpected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n",
                    expected.to_fmt(&mut formatter),
                    value.to_fmt(&mut formatter2),
                ),
            );
        }

        this.throw(
            global,
            Expect::get_signature("toContainValue", "<green>expected<r>", false),
            format_args!(
                "\n\nExpected to contain: <green>{}<r>\nReceived: <red>{}<r>\n",
                expected.to_fmt(&mut formatter),
                value.to_fmt(&mut formatter2),
            ),
        )
    }
}

// ported from: src/test_runner/expect/toContainValue.zig
