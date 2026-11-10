use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::Expect;
use super::throw;

impl Expect {
    pub(crate) fn to_have_been_called(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        bun_jsc::mark_binding!();
        let (this, calls, _) =
            self.mock_prologue(global, this_value.to_js(), "toHaveBeenCalled", "", super::mock::MockKind::Calls)?;
        // arg-check after prologue: counter bump + post_match still fire on bad-arity.
        if !expected.to_js().is_undefined() {
            return Err(global.throw_invalid_arguments(format_args!(
                "toHaveBeenCalled() must not have an argument"
            )));
        }

        let calls_length = calls.get_length(global)?;
        let mut pass = calls_length > 0;

        let not = this.flags.get().not();
        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        if not {
            let signature = Expect::get_signature("toHaveBeenCalled", "", true);
            return throw!(
                this,
                global,
                signature,
                concat!(
                    "\n\n",
                    "Expected number of calls: <green>0<r>\n",
                    "Received number of calls: <red>{}<r>\n",
                ),
                calls_length
            );
        }

        let signature = Expect::get_signature("toHaveBeenCalled", "", false);
        throw!(
            this,
            global,
            signature,
            concat!(
                "\n\n",
                "Expected number of calls: \\>= <green>1<r>\n",
                "Received number of calls: <red>{}<r>\n",
            ),
            calls_length
        )
    }
}
