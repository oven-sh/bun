use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::DiffFormatter;
use super::mock;
use super::throw;
use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn to_have_been_called_exactly_once_with(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = frame.arguments();
        let (this, calls, _value) = self.mock_prologue(
            global,
            frame.this(),
            "toHaveBeenCalledExactlyOnceWith",
            "<green>...expected<r>",
            mock::MockKind::CallsWithSig,
        )?;

        let calls_count = calls.get_length(global)?;
        let mut pass = calls_count == 1;
        let mut only_call = JSValue::UNDEFINED;

        if pass {
            only_call = calls.get_index(global, 0)?;
            if !only_call.js_type().is_array() {
                return Err(global.throw(format_args!(
                    "Internal error: expected mock call item to be an array of arguments."
                )));
            }

            if only_call.get_length(global)? != arguments.len() as u64 {
                pass = false;
            } else {
                let mut itr = only_call.array_iterator(global)?;
                while let Some(call_arg) = itr.next()? {
                    if !call_arg.jest_deep_equals(arguments[itr.i as usize - 1], global)? {
                        pass = false;
                        break;
                    }
                }
            }
        }

        let not = this.flags.get().not();
        if pass != not {
            return Ok(JSValue::UNDEFINED);
        }

        let mut formatter = super::make_formatter(global);
        let expected_args_js_array = JSValue::create_array_from_slice(global, arguments)?;
        expected_args_js_array.ensure_still_alive();
        let signature = Expect::get_signature("toHaveBeenCalledExactlyOnceWith", "<green>...expected<r>", not);

        if not {
            return throw!(
                this,
                global,
                signature,
                "\n\nExpected mock function not to have been called exactly once with: <green>{}<r>\nBut it was.",
                expected_args_js_array.to_fmt(&mut formatter),
            );
        }

        if calls_count == 0 {
            return throw!(
                this,
                global,
                signature,
                "\n\nExpected: <green>{}<r>\nBut it was not called.",
                expected_args_js_array.to_fmt(&mut formatter),
            );
        }

        if calls_count == 1 {
            let diff_format = DiffFormatter::new(global, only_call, expected_args_js_array, false)?;
            return throw!(this, global, signature, "\n\n{}\n", diff_format);
        }

        let mut list_fmt = super::make_formatter(global);
        let list_formatter = mock::AllCallsWithArgsFormatter {
            global_this: global,
            calls,
            formatter: core::cell::RefCell::new(&mut list_fmt),
        };

        throw!(
            this,
            global,
            signature,
            concat!(
                "\n\n",
                "    <green>Expected<r>: {}\n",
                "    <red>Received<r>:\n{}\n\n",
                "    Expected number of calls: <green>1<r>\n",
                "    Received number of calls: <red>{}<r>\n",
            ),
            expected_args_js_array.to_fmt(&mut formatter),
            list_formatter,
            calls_count,
        )
    }
}
