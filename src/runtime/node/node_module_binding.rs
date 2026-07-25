//! Native backing for `module.stripTypeScriptTypes` (`node:module`).
//!
//! The JS wrapper (`src/js/internal/shared.ts`) validates the arguments
//! Node-style and handles the `sourceUrl` suffix; this binding runs Bun's
//! parser in strip mode (`ParseOptions::ts_strip_mode`) and returns either
//! the blanked source string or a plain object describing the amaro-style
//! error (`{ errorCode, message, startLine, snippet }`) for the wrapper to
//! turn into `ERR_INVALID_TYPESCRIPT_SYNTAX` / `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.

use bun_alloc::Arena;
use bun_ast::Loader;
use bun_bundler::options;
use bun_bundler::transpiler::{MacroJSCtx, ParseOptions, Transpiler};
use bun_core::{String as BunString, ZigString};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_options_types::schema::api;
use bun_resolver::package_json::MacroMap;

/// 1-based line number of byte offset `lo`, and the source text of that line
/// (for Node's `filename:line\n<snippet>` error-stack decoration).
fn line_and_snippet(source: &[u8], lo: u32, hi: u32) -> (u32, Vec<u8>) {
    let lo = (lo as usize).min(source.len());
    let hi = (hi as usize).min(source.len()).max(lo);
    let line_start = source[..lo]
        .iter()
        .rposition(|&b| b == b'\n')
        .map_or(0, |i| i + 1);
    let line_end = source[lo..]
        .iter()
        .position(|&b| b == b'\n')
        .map_or(source.len(), |i| lo + i);
    let line_no = 1 + source[..lo].iter().filter(|&&b| b == b'\n').count() as u32;

    // `<line>\n<caret marks under the offending span>` like amaro's
    // diagnostic snippet (clamped to the first line of the construct).
    let mut snippet = source[line_start..line_end].to_vec();
    snippet.push(b'\n');
    for i in line_start..line_end {
        snippet.push(if i >= lo && i < hi { b'^' } else { b' ' });
    }
    while snippet.last() == Some(&b' ') {
        snippet.pop();
    }
    (line_no, snippet)
}

fn error_object(
    global: &JSGlobalObject,
    error_code: &str,
    message: &[u8],
    line: u32,
    snippet: &[u8],
) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object_with_null_prototype(global);
    obj.put(
        global,
        ZigString::static_("errorCode"),
        jsc::bun_string_jsc::create_utf8_for_js(global, error_code.as_bytes())?,
    );
    obj.put(
        global,
        ZigString::static_("message"),
        jsc::bun_string_jsc::create_utf8_for_js(global, message)?,
    );
    obj.put(
        global,
        ZigString::static_("startLine"),
        JSValue::js_number_from_int32(line as i32),
    );
    obj.put(
        global,
        ZigString::static_("snippet"),
        jsc::bun_string_jsc::create_utf8_for_js(global, snippet)?,
    );
    Ok(obj)
}

/// `stripTypeScriptTypesNative(code)` — parse `code` as TypeScript and blank
/// every type-only span in place (amaro's strip-only mode).
#[bun_jsc::host_fn]
pub fn strip_type_script_types_native(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let code = frame.argument(0);
    let code_str = code.to_js_string(global)?.to_slice(global);
    let code_utf8 = code_str.slice();

    let mut log = bun_ast::Log::init();
    let arena = Arena::new();
    // SAFETY: `arena` outlives every use through `transpiler` in this fn
    // body; `Transpiler<'static>` forces the borrow to 'static, so launder
    // through a raw ptr (same pattern as JSTranspiler / TransformTask).
    let arena_ref: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(&arena) };

    // SAFETY: VirtualMachine::get() returns the live singleton on the JS thread.
    let vm = VirtualMachine::get().as_mut();

    let transform = api::TransformOptions {
        // Keep `using` / `await using` verbatim; nothing is lowered in strip
        // mode anyway (only the parse pass runs — output comes from
        // `Ast::ts_strip`, not the printer).
        target: Some(api::Target::Bun),
        ..Default::default()
    };
    let mut transpiler =
        match Transpiler::init(arena_ref, &raw mut log, transform, Some(vm.transpiler.env)) {
            Ok(t) => t,
            Err(err) => return Err(global.throw_error(err, "Failed to create transpiler")),
        };
    // `parse()` lazily allocates `macro_context`, whose `data` pointer is
    // only freed by an explicit `deinit()`; this one-shot transpiler must
    // reclaim it on every return path (mirrors `TransformTask::run`).
    let _macro_ctx_guard =
        scopeguard::guard(core::ptr::addr_of_mut!(transpiler.macro_context), |slot| {
            // SAFETY: `slot` points at the stack-owned `transpiler`, which is
            // still alive when this guard drops (declared after it), and the
            // parser's `&mut MacroContext` borrow ended with `parse()`.
            if let Some(ctx) = unsafe { (*slot).take() } {
                ctx.deinit();
            }
        });
    transpiler.options.env.behavior = options::EnvBehavior::disable;
    if let Err(err) = transpiler.configure_defines() {
        return Err(global.throw_error(err, "Failed to configure transpiler"));
    }
    transpiler.options.no_macros = true;
    transpiler.options.dead_code_elimination = false;
    transpiler.options.tree_shaking = false;
    transpiler.options.trim_unused_imports = Some(false);
    transpiler.options.inlining = false;
    transpiler.options.minify_whitespace = false;
    transpiler.options.minify_syntax = false;
    transpiler.options.minify_identifiers = false;
    transpiler.options.auto_import_jsx = false;

    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();

    // Borrowed view; stays alive for the whole parse because `code_str`
    // outlives `parse_result`.
    let source: &bun_ast::Source = arena_ref.alloc(bun_ast::Source::init_path_string(
        Loader::Ts.stdin_name(),
        code_utf8,
    ));

    let parse_options = ParseOptions {
        arena: arena_ref,
        macro_remappings: MacroMap::default(),
        dirname_fd: bun_sys::Fd::INVALID,
        file_descriptor: None,
        loader: Loader::Ts,
        jsx: transpiler.options.jsx.clone(),
        path: source.path,
        virtual_source: Some(source),
        replace_exports: Default::default(),
        experimental_decorators: false,
        emit_decorator_metadata: false,
        macro_js_ctx: MacroJSCtx::ZERO,
        file_fd_ptr: None,
        inject_jest_globals: false,
        set_breakpoint_on_first_line: false,
        remove_cjs_module_wrapper: false,
        ts_strip_mode: true,
        dont_bundle_twice: false,
        allow_commonjs: false,
        module_type: Default::default(),
        runtime_transpiler_cache: None,
        keep_json_and_toml_as_one_statement: false,
        allow_bytecode_cache: false,
    };

    let parse_result = transpiler.parse(parse_options, None);

    if log.errors > 0 {
        // amaro maps parser errors to `InvalidSyntax`; the message text comes
        // from Bun's parser.
        let msg = log
            .msgs
            .iter()
            .find(|m| matches!(m.kind, bun_ast::Kind::Err));
        let text: &[u8] = msg.map(|m| m.data.text.as_ref()).unwrap_or(b"Syntax error");
        let lo = msg
            .and_then(|m| m.data.location.as_ref())
            .map(|l| l.offset as u32)
            .unwrap_or(0);
        let (line, snippet) = line_and_snippet(code_utf8, lo, lo + 1);
        return error_object(global, "InvalidSyntax", text, line, &snippet);
    }
    let Some(parse_result) = parse_result else {
        let (line, snippet) = line_and_snippet(code_utf8, 0, 1);
        return error_object(global, "InvalidSyntax", b"Syntax error", line, &snippet);
    };

    match parse_result.ast.ts_strip.as_deref() {
        Some(bun_ast::TsStripOutput::Code(out)) => {
            let mut result = BunString::clone_utf8(out);
            result.transfer_to_js(global)
        }
        Some(&bun_ast::TsStripOutput::Unsupported { message, lo, hi }) => {
            let (line, snippet) = line_and_snippet(code_utf8, lo, hi);
            error_object(global, "UnsupportedSyntax", message.as_bytes(), line, &snippet)
        }
        None => {
            // Empty input parses through a fast path that skips `to_ast`;
            // nothing to strip.
            let mut result = BunString::clone_utf8(code_utf8);
            result.transfer_to_js(global)
        }
    }
}
