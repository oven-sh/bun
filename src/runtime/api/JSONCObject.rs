//! `Bun.JSONC` — `parse()` host function.

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_interchange::json;
use bun_js_parser::{ast, ToJSError};
use bun_js_parser_jsc::ExprJsc;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsError, JsResult, LogJsc};
use bun_logger as logger;

pub fn create(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 1);
    object.put(
        global,
        b"parse",
        JSFunction::create(
            global,
            b"parse",
            // `#[bun_jsc::host_fn]` emits the raw C-ABI shim under this name.
            __jsc_host_parse,
            1,
            Default::default(),
        ),
    );

    object
}

#[bun_jsc::host_fn]
pub fn parse(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PERF(port): was ArenaAllocator bulk-free feeding the JSON parser + AST stores
    // — profile in Phase B.
    let arena = Arena::new();

    // ASTMemoryAllocator is a typed slab with an enter/exit scope guard. Model
    // as RAII — `_ast_scope` Drop replaces `defer ast_scope.exit()`.
    let mut ast_memory_allocator = ast::ASTMemoryAllocator::new(&arena);
    let _ast_scope = ast_memory_allocator.enter();

    let mut log = logger::Log::new();
    let input_value = frame.argument(0);
    if input_value.is_empty_or_undefined_or_null() {
        return Err(global.throw_invalid_arguments(format_args!("Expected a string to parse")));
    }

    let input_slice = input_value.to_slice(global)?;
    let source = logger::Source::init_path_string(b"input.jsonc", input_slice.slice());
    let parse_result = match json::parse_ts_config::<true>(&source, &mut log, &arena) {
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
    // the cycle-broken `bun_logger::js_ast::Expr`; lift it into the full
    // `bun_js_parser::Expr` (From impl in ast/Expr.rs) so `ExprJsc` applies.
    let _ = &arena;
    let parse_result: bun_js_parser::Expr = parse_result.into();
    match parse_result.to_js(global) {
        Ok(v) => Ok(v),
        Err(ToJSError::OutOfMemory) => Err(JsError::OutOfMemory),
        Err(ToJSError::JSError) => Err(JsError::Thrown),
        Err(ToJSError::JSTerminated) => Err(JsError::Terminated),
        // JSONC parsing does not produce macros or identifiers
        Err(_) => unreachable!(),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/JSONCObject.zig (64 lines)
//   confidence: high
//   todos:      0
//   notes:      Arena threaded into interchange/ast crates; ASTMemoryAllocator enter/exit modeled as RAII guard; Expr.to_js error-set narrowing matches against ToJSError variants.
// ──────────────────────────────────────────────────────────────────────────
