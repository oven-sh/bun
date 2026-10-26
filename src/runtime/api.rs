//! "api" in this context means "the Bun APIs", as in "the exposed JS APIs"

// ─── server / socket / ffi ───────────────────────────────────────────────────
pub(crate) use crate::server;
pub(crate) use crate::server::AnyRequestContext;
pub(crate) use crate::server::AnyServer;
pub(crate) use crate::server::DebugHTTPSServer;
pub(crate) use crate::server::DebugHTTPServer;
pub(crate) use crate::server::HTMLBundle;
pub(crate) use crate::server::HTTPSServer;
pub(crate) use crate::server::HTTPServer;
pub(crate) use crate::server::SavedRequest;

pub(crate) use crate::socket;
pub(crate) use crate::socket::Listener;
pub(crate) use crate::socket::NewSocket;
pub(crate) use crate::socket::SocketAddress;

pub(crate) use crate::crypto;

// ─── BuildMessage / ResolveMessage ───────────────────────────────────────────
// Defined in `bun_jsc`.
pub(crate) use bun_jsc::BuildMessage;
pub(crate) use bun_jsc::ResolveMessage;

// ─── compiling submodules (api/ dir) ─────────────────────────────────────────
#[path = "api/Archive.rs"]
pub(crate) mod archive;
#[path = "api/BunObject.rs"]
pub(crate) mod bun_object;
#[path = "api/crash_handler_jsc.rs"]
pub(crate) mod crash_handler_jsc;
#[path = "api/cron.rs"]
pub(crate) mod cron;
#[path = "api/cron_parser.rs"]
pub(crate) mod cron_parser;
#[path = "api/csrf_jsc.rs"]
pub(crate) mod csrf_jsc;
#[path = "api/filesystem_router.rs"]
pub(crate) mod filesystem_router;
#[path = "api/glob.rs"]
pub(crate) mod glob;
#[path = "api/HashObject.rs"]
pub(crate) mod hash_object;
#[path = "api/html_rewriter.rs"]
pub(crate) mod html_rewriter;
#[path = "api/js_bundle_completion_task.rs"]
pub(crate) mod js_bundle_completion_task;
#[path = "api/JSBundler.rs"]
pub(crate) mod js_bundler;
#[path = "api/JSSourceMap.rs"]
pub(crate) mod js_source_map;
#[path = "api/JSTranspiler.rs"]
pub(crate) mod js_transpiler;
#[path = "api/JSON5Object.rs"]
pub(crate) mod json5_object;
#[path = "api/JSONCObject.rs"]
pub(crate) mod jsonc_object;
#[path = "api/MarkdownObject.rs"]
pub(crate) mod markdown_object;
#[path = "api/NativePromiseContext.rs"]
pub(crate) mod native_promise_context;
#[path = "api/output_file_jsc.rs"]
pub(crate) mod output_file_jsc;
#[path = "api/standalone_graph_jsc.rs"]
pub(crate) mod standalone_graph_jsc;
#[path = "api/TOMLObject.rs"]
pub(crate) mod toml_object;
#[path = "api/UnsafeObject.rs"]
pub(crate) mod unsafe_object;
#[path = "api/XMLObject.rs"]
pub(crate) mod xml_object;
#[path = "api/YAMLObject.rs"]
pub(crate) mod yaml_object;

// ─── api/bun/ core (process / spawn / pty / h2) ──────────────────────────────
// `#[path]` is relative to the dir containing this file (`src/runtime/`); the
// inline `mod bun { }` below is a re-export façade only — module bodies are
// declared flat to avoid the non-mod-rs nested-path resolution rules.

// Process struct + posix_spawn/uv_spawn machinery.
#[path = "api/bun/process.rs"]
pub(crate) mod bun_process;

// posix_spawn(2) wrappers + Stdio enum.
#[path = "api/bun/spawn.rs"]
pub(crate) mod bun_spawn;

#[path = "api/bun/subprocess.rs"]
pub(crate) mod bun_subprocess;

// Bun.spawn() / Bun.spawnSync() host fns. Entirely JSC (~75 jsc refs).
#[path = "api/bun/js_bun_spawn_bindings.rs"]
pub(crate) mod js_bun_spawn_bindings;

// Bun.Terminal — PTY/ConPTY. JsRef lifecycle + BufferedReader/StreamingWriter
// generic owner wiring (~120 jsc refs).
#[path = "api/bun/Terminal.rs"]
pub(crate) mod bun_terminal_body;

// H2FrameParser — ~338 jsc refs (Strong, JsRef, host_fn getters, AbortSignal).
// From-scratch node:http2 engine rewrite (will replace h2_frame_parser.rs).
#[path = "api/bun/h2/mod.rs"]
pub(crate) mod h2;

#[path = "api/bun/h2_frame_parser.rs"]
pub(crate) mod h2_frame_parser_body;

#[path = "api/bun/SSLContextCache.rs"]
pub(crate) mod bun_ssl_context_cache;

#[path = "api/bun/SecureContext.rs"]
pub(crate) mod bun_secure_context;

#[path = "api/bun/x509.rs"]
pub(crate) mod bun_x509;

pub(crate) mod bun {
    pub(crate) use super::bun_process as process;
    pub(crate) use super::bun_ssl_context_cache as ssl_context_cache;
    pub(crate) use super::bun_subprocess as subprocess;
    pub(crate) use process::Rusage;

    pub(crate) mod terminal {
        pub(crate) use crate::api::bun_terminal_body::Terminal;
    }
    pub(crate) use terminal::Terminal;

    pub(crate) mod h2_frame_parser {
        pub(crate) use crate::api::h2_frame_parser_body::H2FrameParser;
    }
}

pub(crate) use crate::api::bun::h2_frame_parser::H2FrameParser;
pub(crate) use crate::api::bun::ssl_context_cache as SSLContextCache;
pub(crate) use crate::api::js_bundler::BuildArtifact;
pub(crate) use crate::api::js_bundler::JSBundler;

// ─── shared scaffold for Bun.{TOML,JSONC,JSON5,YAML,XML}.parse ───────────────
//
// All five repeat: Arena + ASTMemoryAllocator scope + Log + Source::init_path_string. They diverge on the parse-error
// class and the Expr→JS tail, so this helper owns ONLY the scaffold and hands `(&arena, &mut log, &source)` to a
// per-format closure that does the format-specific parse, error match (StackOverflow / OOM / SyntaxError vs
// log.to_js), and tail conversion.
fn with_text_format_source<R>(
    global: &bun_jsc::JSGlobalObject,
    bytes: &[u8],
    path: &'static [u8],
    f: impl FnOnce(&bun_alloc::Arena, &mut bun_ast::Log, &bun_ast::Source) -> bun_jsc::JsResult<R>,
) -> bun_jsc::JsResult<R> {
    // A private mi_heap costs microseconds to create, more than parsing a
    // small document: keep one per thread and recycle it between calls.
    // `#[thread_local]` rather than `thread_local!` so there is no
    // destructor racing mimalloc's own thread teardown (as in
    // `ast_memory_allocator.rs`); a parked heap is reclaimed with the thread.
    #[thread_local]
    static ARENA: core::cell::Cell<Option<bun_alloc::Arena>> = core::cell::Cell::new(None);
    struct Recycle(Option<bun_alloc::Arena>);
    impl Drop for Recycle {
        fn drop(&mut self) {
            if let Some(mut arena) = self.0.take() {
                arena.reset_retain_with_limit(2 * 1024 * 1024);
                ARENA.set(Some(arena));
            }
        }
    }
    let recycle = Recycle(Some(ARENA.take().unwrap_or_default()));
    let arena = recycle.0.as_ref().expect("set above");
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(arena);
    let _ast_scope = ast_memory_allocator.enter();

    // Every parser reached from here records source positions as an `i32`
    // (`ast::Loc` via `usize2loc` for JSONC/TOML, JSON5's token locs, YAML's
    // `Pos`), so an input those offsets cannot represent panics inside the
    // lexer instead of reporting an error. Reject it before parsing.
    if bytes.len() > i32::MAX as usize {
        return Err(global.throw_range_error(
            bytes.len() as i64,
            bun_jsc::RangeErrorOptions {
                field_name: b"input.byteLength",
                max: i64::from(i32::MAX),
                ..Default::default()
            },
        ));
    }

    let mut log = bun_ast::Log::init();
    let source = bun_ast::Source::init_path_string(path, bytes);

    f(arena, &mut log, &source)
}

// ─── shared Expr → JS conversion for the text-format parsers ─────────────────

/// `Expr` → `JSValue` for the text-format parsers (TOML, JSON5), through the
/// same converter the module loader uses for imported data files, so
/// `Bun.TOML.parse` and `import "./x.toml"` cannot drift apart.
fn expr_to_js(
    expr: bun_ast::Expr,
    global: &bun_jsc::JSGlobalObject,
) -> bun_jsc::JsResult<bun_jsc::JSValue> {
    bun_js_parser_jsc::expr_to_js(&expr, global)
        .map_err(|e| bun_js_parser_jsc::to_js_error(e, global))
}
