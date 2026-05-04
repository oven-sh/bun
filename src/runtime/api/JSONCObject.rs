use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_core::err;
use bun_interchange::json;
use bun_js_parser::ast;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};
use bun_logger as logger;
use bun_str::ZigString;

pub fn create(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 1);
    object.put(
        global,
        ZigString::static_(b"parse"),
        JSFunction::create(
            global,
            b"parse",
            parse,
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
    // Arena threaded into AST/interchange crates (bulk-freed on Drop at scope exit).
    let arena = Arena::new();

    // TODO(port): ASTMemoryAllocator is a typed slab (typed_arena) with an enter/exit scope
    // guard. Model as RAII — `_ast_scope` Drop replaces `defer ast_scope.exit()`.
    let mut ast_memory_allocator = ast::ASTMemoryAllocator::new(&arena);
    let _ast_scope = ast_memory_allocator.enter();

    let mut log = logger::Log::new();
    let input_value = frame.argument(0);
    if input_value.is_empty_or_undefined_or_null() {
        return global.throw_invalid_arguments(format_args!("Expected a string to parse"));
    }

    let input_slice = input_value.to_slice(global)?;
    let source = logger::Source::init_path_string(b"input.jsonc", input_slice.slice());
    let parse_result = match json::parse_tsconfig(&source, &mut log, &arena, true) {
        Ok(v) => v,
        Err(e) => {
            if e == err!(StackOverflow) {
                return global.throw_stack_overflow();
            }
            return global.throw_value(log.to_js(global, b"Failed to parse JSONC")?);
        }
    };

    match parse_result.to_js(&arena, global) {
        Ok(v) => Ok(v),
        Err(e) if e == err!(OutOfMemory) => Err(bun_jsc::JsError::OutOfMemory),
        Err(e) if e == err!(JSError) => Err(bun_jsc::JsError::Thrown),
        Err(e) if e == err!(JSTerminated) => Err(bun_jsc::JsError::Terminated),
        // JSONC parsing does not produce macros or identifiers
        Err(_) => unreachable!(),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/JSONCObject.zig (64 lines)
//   confidence: medium
//   todos:      1
//   notes:      Arena kept (threaded into interchange/ast crates); ASTMemoryAllocator enter/exit modeled as RAII guard; Expr.to_js error-set narrowing matches against bun_core::err! consts.
// ──────────────────────────────────────────────────────────────────────────
