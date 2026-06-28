use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsError, JsResult};
use bun_parsers::toml::TOML;

pub(crate) fn create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::create_host_function_object(global, &[("parse", __jsc_host_parse, 1)])
}

#[bun_jsc::host_fn]
pub fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    super::with_text_format_source(
        global,
        frame,
        b"input.toml",
        true,
        true,
        |arena, log, source| {
            let root = match TOML::parse(source, log, arena, false) {
                Ok(v) => v,
                Err(e) if e == bun_core::err!("StackOverflow") => {
                    return Err(global.throw_stack_overflow());
                }
                Err(e) if e == bun_core::err!("OutOfMemory") => {
                    return Err(JsError::OutOfMemory);
                }
                Err(_) => {
                    if let Some(first_msg) = log.msgs.first() {
                        return Err(global.throw_value(global.create_syntax_error_instance(
                            format_args!(
                                "TOML Parse error: {}",
                                bstr::BStr::new(&first_msg.data.text),
                            ),
                        )));
                    }
                    return Err(global.throw_value(global.create_syntax_error_instance(
                        format_args!("TOML Parse error: Unable to parse TOML"),
                    )));
                }
            };

            super::expr_to_js(root, global)
        },
    )
}
