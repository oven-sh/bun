use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::DiffFormatter;
use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_equal(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.equals_impl(global, frame, "toEqual", JSValue::jest_deep_equals)
    }

    #[bun_jsc::host_fn(method)]
    pub fn to_strict_equal(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.equals_impl(global, frame, "toStrictEqual", JSValue::jest_strict_deep_equals)
    }

    fn equals_impl(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        name: &'static str,
        deep_equals: fn(JSValue, JSValue, &JSGlobalObject) -> JsResult<bool>,
    ) -> JsResult<JSValue> {
        let (this, value, not) =
            self.matcher_prelude(global, frame.this(), name, "<green>expected<r>")?;

        let _arguments = frame.arguments_old::<1>();
        let arguments: &[JSValue] = _arguments.slice();

        if arguments.len() < 1 {
            return Err(
                global.throw_invalid_arguments(format_args!("{name}() requires 1 argument"))
            );
        }

        let expected = arguments[0];
        let mut pass = deep_equals(value, expected, global)?;

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

        let signature: &str = Expect::get_signature(name, "<green>expected<r>", not);
        this.throw(global, signature, format_args!("\n\n{}\n", diff_formatter))
    }
}
