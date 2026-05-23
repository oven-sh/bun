use bun_ast::ToJSError;
use bun_js_parser_jsc::ExprJsc;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsError, JsResult, LogJsc};
use bun_parsers::toml::TOML;

pub fn create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::create_host_function_object(global, &[("parse", __jsc_host_parse, 1)])
}

#[bun_jsc::host_fn]
pub fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    super::with_text_format_source(
        global,
        frame,
        b"input.toml",
        false,
        true,
        |arena, log, source| {
            let parse_result = match TOML::parse(source, log, arena, false) {
                Ok(v) => v,
                Err(e) if e == bun_core::err!("StackOverflow") => {
                    return Err(global.throw_stack_overflow());
                }
                Err(_) => {
                    return Err(global.throw_value(log.to_js(global, "Failed to parse toml")?));
                }
            };

            // PORT NOTE(#31252): `Lexer::expect` logs errors but recovers (calls `next()`),
            // so the parser can return `Ok` with a partial AST. Surface any logged errors
            // before handing the AST to JS.
            if log.has_errors() {
                return Err(global.throw_value(log.to_js(global, "Failed to parse toml")?));
            }

            // PORT NOTE: Zig TOMLObject.parse did a `print_json` → `JSONParse` round-trip
            // to get the parsed Expr into JS. That pipeline can't round-trip `Infinity` /
            // `NaN` (strict JSON forbids them), and it's wasteful — JSONC already switched
            // to `ExprJsc::to_js`, which is a direct AST → JSValue walk. Mirror that here.
            match parse_result.to_js(global) {
                Ok(v) => Ok(v),
                Err(ToJSError::OutOfMemory) => Err(JsError::OutOfMemory),
                Err(ToJSError::JSError) => Err(JsError::Thrown),
                Err(ToJSError::JSTerminated) => Err(JsError::Terminated),
                // TOML parsing produces only literals (objects, arrays, strings,
                // numbers, booleans) — never identifiers or macros.
                Err(_) => unreachable!(),
            }
        },
    )
}

// ported from: src/runtime/api/TOMLObject.zig
