//! `Bun.JSONC` — `parse()` host function.

use bun_js_parser_jsc::ExprJsc;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsError, JsResult};
use bun_parsers::json;

pub(crate) fn create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::create_host_function_object(global, &[("parse", __jsc_host_parse, 1)])
}

#[bun_jsc::host_fn]
pub(crate) fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    super::with_text_format_source(
        global,
        frame,
        b"input.jsonc",
        false,
        true,
        |_arena, log, source| {
            // parse_jsonc maps empty input to {}; the public API rejects it like JSON.parse.
            if source.contents.is_empty() {
                return Err(
                    global.throw_value(global.create_syntax_error_instance(format_args!(
                        "JSONC Parse error: Unexpected end of input"
                    ))),
                );
            }
            let parsed = match json::ParsedJson::parse_jsonc(source, log) {
                Ok(v) => v,
                Err(bun_parsers::Error::StackOverflow) => {
                    return Err(global.throw_stack_overflow());
                }
                Err(bun_parsers::Error::Alloc(_)) => {
                    return Err(JsError::OutOfMemory);
                }
                Err(_) => {
                    // Skip duplicate-key warnings so the message names the fatal error.
                    let first_msg = log
                        .msgs
                        .iter()
                        .find(|m| m.kind == bun_ast::Kind::Err)
                        .or_else(|| log.msgs.first());
                    if let Some(first_msg) = first_msg {
                        return Err(global.throw_value(global.create_syntax_error_instance(
                            format_args!(
                                "JSONC Parse error: {}",
                                bstr::BStr::new(&first_msg.data.text),
                            ),
                        )));
                    }
                    return Err(global.throw_value(global.create_syntax_error_instance(
                        format_args!("JSONC Parse error: Unable to parse JSONC string"),
                    )));
                }
            };

            parsed
                .root
                .to_js(global)
                .map_err(|e| bun_js_parser_jsc::to_js_error(e, global))
        },
    )
}
