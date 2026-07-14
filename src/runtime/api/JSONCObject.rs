//! `Bun.JSONC` — `parse()` host function.

use bun_ast::ToJSError;
use bun_js_parser_jsc::ExprJsc;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsError, JsResult, LogJsc};
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
            let parsed = match json::ParsedJson::parse_jsonc(source, log) {
                Ok(v) => v,
                Err(e) => {
                    if e == bun_parsers::Error::StackOverflow {
                        return Err(global.throw_stack_overflow());
                    }
                    return Err(global.throw_value(log.to_js(global, "Failed to parse JSONC")?));
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
