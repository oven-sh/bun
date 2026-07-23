use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::throw;
use super::DiffFormatter;
use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_equal(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let this = self.post_match_guard(global);
        let this_value = frame.this();
        let _arguments = frame.arguments_old::<1>();
        let arguments: &[JSValue] = _arguments.slice();

        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!("toEqual() requires 1 argument")));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        let value: JSValue = this.get_value(global, this_value, "toEqual", "<green>expected<r>")?;

        let not = this.flags.get().not();
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
            return throw!(this, global, signature, "\n\n{}\n", diff_formatter);
        }

        let signature: &str = Expect::get_signature("toEqual", "<green>expected<r>", false);
        throw!(this, global, signature, "\n\n{}\n", diff_formatter)
    }
}
