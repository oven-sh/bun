use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::Expect;
use super::get_signature;
use super::throw;

impl Expect {
    pub(crate) fn to_have_been_called_times(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (this, calls, _) = self.mock_prologue(
            global,
            this_value.to_js(),
            "toHaveBeenCalledTimes",
            "<green>expected<r>",
            super::mock::MockKind::Calls,
        )?;

        let times = expected.to_js();
        if !times.is_uint32_as_any_int() {
            return Err(global.throw_invalid_arguments(format_args!(
                "toHaveBeenCalledTimes() requires 1 non-negative integer argument"
            )));
        }

        let times = times.to_int64();

        let mut pass = calls.get_length(global)? as i64 == times;

        let not = this.flags.get().not();
        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        if not {
            let signature = get_signature("toHaveBeenCalledTimes", "<green>expected<r>", true);
            return throw!(
                this,
                global,
                signature,
                concat!(
                    "\n\n",
                    "Expected number of calls: not <green>{}<r>\n",
                    "Received number of calls: <red>{}<r>\n"
                ),
                times,
                calls.get_length(global)?,
            );
        }

        let signature = get_signature("toHaveBeenCalledTimes", "<green>expected<r>", false);
        throw!(
            this,
            global,
            signature,
            concat!(
                "\n\n",
                "Expected number of calls: <green>{}<r>\n",
                "Received number of calls: <red>{}<r>\n"
            ),
            times,
            calls.get_length(global)?,
        )
    }
}
