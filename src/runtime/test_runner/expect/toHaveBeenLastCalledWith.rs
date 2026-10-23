use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

use super::DiffFormatter;
use super::throw;
use super::{Expect, get_signature};

impl Expect {
    pub(crate) fn to_have_been_last_called_with(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        let global = cx.global();
        bun_jsc::mark_binding!();
        let expected = JsLocal::to_js_slice(expected);
        let (this, calls, value) = self.mock_prologue(
            global,
            this_value.to_js(),
            "toHaveBeenLastCalledWith",
            "<green>...expected<r>",
            super::mock::MockKind::CallsWithSig,
        )?;

        let total_calls: u32 = calls.get_length(global)? as u32;
        let mut last_call_value: JSValue = JSValue::ZERO;

        let mut pass = total_calls > 0;

        if pass {
            last_call_value = calls.get_index(global, total_calls - 1)?;

            if !last_call_value.js_type().is_array() {
                let mut formatter = super::make_formatter(global);
                return Err(global.throw(format_args!(
                    "Expected value must be a mock function with calls: {}",
                    value.to_fmt(&mut formatter),
                )));
            }

            if last_call_value.get_length(global)? != expected.len() as u64 {
                pass = false;
            } else {
                let mut itr = last_call_value.array_iterator(global)?;
                while let Some(call_arg) = itr.next()? {
                    if !call_arg.jest_deep_equals(expected[itr.i as usize - 1], global)? {
                        pass = false;
                        break;
                    }
                }
            }
        }

        if pass != this.flags.get().not() {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        let mut formatter = super::make_formatter(global);

        let expected_args_js_array = JSValue::create_array_from_slice(global, expected)?;
        expected_args_js_array.ensure_still_alive();

        if this.flags.get().not() {
            let signature = get_signature("toHaveBeenLastCalledWith", "<green>...expected<r>", true);
            return throw!(
                this,
                global,
                signature,
                "\n\nExpected last call not to be with: <green>{}<r>\nBut it was.",
                expected_args_js_array.to_fmt(&mut formatter),
            );
        }
        let signature = get_signature("toHaveBeenLastCalledWith", "<green>...expected<r>", false);

        if total_calls == 0 {
            return throw!(
                this,
                global,
                signature,
                "\n\nExpected: <green>{}<r>\nBut it was not called.",
                expected_args_js_array.to_fmt(&mut formatter),
            );
        }

        let diff_format = DiffFormatter::new(global, last_call_value, expected_args_js_array, false)?;
        throw!(this, global, signature, "\n\n{}\n", diff_format)
    }
}
