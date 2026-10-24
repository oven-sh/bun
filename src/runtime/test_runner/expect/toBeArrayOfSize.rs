use super::Expect;
use super::get_signature;
use super::throw;
use bun_jsc::bindgen::{JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

impl Expect {
    pub(crate) fn to_be_array_of_size(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        size: Option<f64>,
    ) -> JsResult<()> {
        let global = cx.global();
        let this = self.post_match_guard(global);

        let this_value = this_value.to_js();

        let value: JSValue = this.get_value(global, this_value, "toBeArrayOfSize", "")?;

        let Some(size) = size
            .map(JSValue::js_double_number)
            .filter(|size| size.is_any_int())
        else {
            return Err(global.throw(format_args!(
                "toBeArrayOfSize() requires the first argument to be a number"
            )));
        };

        this.increment_expect_call_counter();

        let not = this.flags.get().not();
        let mut pass = value.js_type().is_array()
            && value.get_length(global)? as i64 == size.to_int64();

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(());
        }

        let mut formatter = super::make_formatter(global);
        let received = value.to_fmt(&mut formatter);

        if not {
            let signature = get_signature("toBeArrayOfSize", "", true);
            return throw!(
                this,
                global,
                signature,
                concat!("\n\n", "Received: <red>{}<r>\n"),
                received,
            );
        }

        let signature = get_signature("toBeArrayOfSize", "", false);
        throw!(
            this,
            global,
            signature,
            concat!("\n\n", "Received: <red>{}<r>\n"),
            received,
        )
    }
}

