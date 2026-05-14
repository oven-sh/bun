use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};

use super::DiffFormatter;
use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_equal(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let (this, value, not) =
            self.matcher_prelude(global, frame.this(), "toEqual", "<green>expected<r>")?;

        let _arguments = frame.arguments_old::<1>();
        let arguments: &[JSValue] = _arguments.slice();

        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!("toEqual() requires 1 argument")));
        }

        let expected = arguments[0];
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

// ported from: src/test_runner/expect/toEqual.zig
