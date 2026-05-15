//! `Bun.JSONC` — `parse()` host function.

use bun_ast::ToJSError;
use bun_js_parser_jsc::ExprJsc;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsError, JsResult, LogJsc};
use bun_parsers::json;

pub fn create(global: &JSGlobalObject) -> JSValue {
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
        |arena, log, source| {
            let parse_result = match json::parse_ts_config::<true>(source, log, arena) {
                Ok(v) => v,
                Err(e) => {
                    if e == bun_core::err!(StackOverflow) {
                        return Err(global.throw_stack_overflow());
                    }
                    return Err(global.throw_value(log.to_js(global, "Failed to parse JSONC")?));
                }
            };

            // `ExprJsc::to_js` (bun_js_parser_jsc) drops the allocator param — Rust port
            // threads the arena via the AST nodes themselves. `parse_ts_config` returns
            // the cycle-broken `bun_ast::Expr`; lift it into the full
            // `bun_ast::Expr` (From impl in ast/Expr.rs) so `ExprJsc` applies.
            let parse_result: bun_ast::Expr = parse_result.into();
            match parse_result.to_js(global) {
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

// ported from: src/runtime/api/JSONCObject.zig
