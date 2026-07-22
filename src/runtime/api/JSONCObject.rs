//! `Bun.JSONC` — `parse()` host function.

use bun_ast::ToJSError;
use bun_js_parser_jsc::ExprJsc;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsError, JsResult};
use bun_parsers::json;

pub(crate) fn create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::create_host_function_object(global, &[("parse", __jsc_host_parse, 1)])
}

#[bun_jsc::host_fn]
pub fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    super::with_text_format_source(
        global,
        frame,
        b"input.jsonc",
        false,
        true,
        |_arena, log, source| {
            // `parse_jsonc` treats an empty document as `{}` for lenient config-file
            // callers (tsconfig, package.json); the public `Bun.JSONC.parse` matches
            // `JSON.parse` / `Bun.JSON5.parse` and rejects it instead.
            if source.contents.is_empty() {
                return Err(global.throw_value(global.create_syntax_error_instance(
                    format_args!("JSONC Parse error: Unexpected end of input"),
                )));
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
                    if let Some(first_msg) = log.msgs.first() {
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

            match parsed.root.to_js(global) {
                Ok(v) => Ok(v),
                Err(ToJSError::OutOfMemory) => Err(JsError::OutOfMemory),
                Err(ToJSError::JSError) => Err(JsError::Thrown),
                Err(ToJSError::JSTerminated) => Err(JsError::Terminated),
                // JSONC parsing does not produce macros or identifiers
                Err(_) => unreachable!(),
            }
        },
    )
}
