//! "api" in this context means "the Bun APIs", as in "the exposed JS APIs"

// ─── server / socket / ffi ───────────────────────────────────────────────────
pub use crate::server;
pub use crate::server::AnyRequestContext;
pub use crate::server::AnyServer;
pub use crate::server::DebugHTTPSServer;
pub use crate::server::DebugHTTPServer;
pub use crate::server::HTMLBundle;
pub use crate::server::HTTPSServer;
pub use crate::server::HTTPServer;
pub use crate::server::NodeHTTPResponse;
pub use crate::server::SavedRequest;
pub use crate::server::ServerConfig;
pub use crate::server::ServerWebSocket;

pub use crate::socket;
pub use crate::socket::Handlers as SocketHandlers;
pub use crate::socket::Listener;
pub use crate::socket::NewSocket;
pub use crate::socket::SocketAddress;
pub use crate::socket::TCPSocket;
pub use crate::socket::TLSSocket;
pub use crate::socket::udp_socket::UDPSocket;

pub use crate::ffi::FFI;
pub use crate::ffi::ffi_object as FFIObject;

pub use crate::crypto;
pub use crate::napi;
pub use crate::node;

// ─── BuildMessage / ResolveMessage ───────────────────────────────────────────
// Canonical defs live in `bun_jsc` (with `#[bun_jsc::JsClass]` derives wiring
// the C++ `${T}__create`/`__fromJS`/`__finalize` symbols). `bun_runtime` already
// depends on `bun_jsc`, so this is a plain downstream re-export — no cycle.
// Exactly one Rust type backs each C++ `m_ctx` pointer.
pub use bun_jsc::BuildMessage;
pub use bun_jsc::ResolveMessage;

// ─── compiling submodules (api/ dir) ─────────────────────────────────────────
#[path = "api/Archive.rs"]
pub mod archive;
#[path = "api/BunObject.rs"]
pub mod bun_object;
#[path = "api/crash_handler_jsc.rs"]
pub mod crash_handler_jsc;
#[path = "api/cron.rs"]
pub mod cron;
#[path = "api/cron_parser.rs"]
pub mod cron_parser;
#[path = "api/csrf_jsc.rs"]
pub mod csrf_jsc;
#[path = "api/filesystem_router.rs"]
pub mod filesystem_router;
#[path = "api/glob.rs"]
pub mod glob;
#[path = "api/HashObject.rs"]
pub mod hash_object;
#[path = "api/html_rewriter.rs"]
pub mod html_rewriter;
#[path = "api/js_bundle_completion_task.rs"]
pub mod js_bundle_completion_task;
#[path = "api/JSBundler.rs"]
pub mod js_bundler;
#[path = "api/JSTranspiler.rs"]
pub mod js_transpiler;
#[path = "api/JSON5Object.rs"]
pub mod json5_object;
#[path = "api/JSONCObject.rs"]
pub mod jsonc_object;
#[path = "api/MarkdownObject.rs"]
pub mod markdown_object;
#[path = "api/NativePromiseContext.rs"]
pub mod native_promise_context;
#[path = "api/output_file_jsc.rs"]
pub mod output_file_jsc;
#[path = "api/standalone_graph_jsc.rs"]
pub mod standalone_graph_jsc;
#[path = "api/TOMLObject.rs"]
pub mod toml_object;
#[path = "api/UnsafeObject.rs"]
pub mod unsafe_object;
#[path = "api/YAMLObject.rs"]
pub mod yaml_object;

// ─── api/bun/ core (process / spawn / pty / h2) ──────────────────────────────
// `#[path]` is relative to the dir containing this file (`src/runtime/`); the
// inline `mod bun { }` below is a re-export façade only — module bodies are
// declared flat to avoid the non-mod-rs nested-path resolution rules.

// Process struct + posix_spawn/uv_spawn machinery.
#[path = "api/bun/process.rs"]
pub mod bun_process;

// posix_spawn(2) wrappers + Stdio enum.
#[path = "api/bun/spawn.rs"]
pub mod bun_spawn;

// JS-facing `Bun.Subprocess` payload (.classes.ts m_ctx).
#[path = "api/bun/subprocess.rs"]
pub mod bun_subprocess;

// Bun.spawn() / Bun.spawnSync() host fns. Entirely JSC (~75 jsc refs).
#[path = "api/bun/js_bun_spawn_bindings.rs"]
pub mod js_bun_spawn_bindings;

// Bun.Terminal — PTY/ConPTY. JsRef lifecycle + BufferedReader/StreamingWriter
// generic owner wiring (~120 jsc refs).
#[path = "api/bun/Terminal.rs"]
pub mod bun_terminal_body;

// H2FrameParser — ~338 jsc refs (Strong, JsRef, host_fn getters, AbortSignal).
// From-scratch node:http2 engine rewrite (will replace h2_frame_parser.rs).
#[path = "api/bun/h2/mod.rs"]
pub mod h2;

#[path = "api/bun/h2_frame_parser.rs"]
pub mod h2_frame_parser_body;

#[path = "api/bun/SSLContextCache.rs"]
pub mod bun_ssl_context_cache;

#[path = "api/bun/SecureContext.rs"]
pub mod bun_secure_context;

#[path = "api/bun/x509.rs"]
pub mod bun_x509;

pub mod bun {
    pub use super::bun_process as process;
    pub use super::bun_secure_context as secure_context;
    pub use super::bun_spawn as spawn;
    pub use super::bun_ssl_context_cache as ssl_context_cache;
    pub use super::bun_subprocess as subprocess;
    pub use super::bun_x509 as x509;
    pub use process::StdioKind as SubprocessStdioKind;
    pub use process::{
        Dup2, Exited, ExtraPipe, PidFdType, PidT, Poller, PosixSpawnOptions, PosixSpawnResult,
        PosixStdio, Process, ProcessExit, ProcessExitHandler, ProcessExitKind, Rusage,
        SpawnOptions, SpawnProcessResult, Status, StdioKind, WaiterThread,
    };
    pub use spawn::posix_spawn;

    pub mod terminal {
        pub use crate::api::bun_terminal_body::Terminal;
        // `Terminal.PtyResult`, `Winsize`, `OpenPtyFn`, `CreatePtyError` —
        // pure FFI handles with no JSC. Canonical defs live in
        // `api/bun/Terminal.rs`; re-exported here so callers can name them via
        // `api::Terminal::*` (`Terminal.PtyResult` etc.).
        pub use crate::api::bun_terminal_body::{
            CreatePtyError, OpenPtyFn, OpenPtyTermios, PtyResult, Winsize,
        };
    }
    pub use terminal::Terminal;

    pub mod h2_frame_parser {
        pub use crate::api::h2_frame_parser_body::ErrorCode;
        pub use crate::api::h2_frame_parser_body::H2FrameParser;
        // js2native thunks (`$rust(h2_frame_parser.rs, …)` in generated_js2native.rs).
        pub use crate::api::h2_frame_parser_body::h2_frame_parser_constructor;
        pub use crate::api::h2_frame_parser_body::js_assert_settings;
    }
    pub use h2_frame_parser::H2FrameParser;
}
pub use bun::process::Process as SpawnProcess;

pub use crate::image as Image;
pub use crate::shell as Shell;
pub use crate::timer as Timer;

pub use crate::api::archive as Archive;
pub use crate::api::bun::h2_frame_parser::H2FrameParser;
pub use crate::api::bun::secure_context as SecureContext;
pub use crate::api::bun::ssl_context_cache as SSLContextCache;
pub use crate::api::bun::subprocess as Subprocess;
pub use crate::api::bun::terminal as Terminal;
/// `globalThis.Bun`
pub use crate::api::bun_object as Bun;
pub use crate::api::filesystem_router::FileSystemRouter;
pub use crate::api::filesystem_router::MatchedRoute;
pub use crate::api::glob as Glob;
pub use crate::api::hash_object as HashObject;
pub use crate::api::html_rewriter as HTMLRewriter;
pub use crate::api::js_bundler::BuildArtifact;
pub use crate::api::js_bundler::JSBundler;
pub use crate::api::js_bundler::OutputKind;
pub use crate::api::js_transpiler as JSTranspiler;
pub use crate::api::json5_object as JSON5Object;
pub use crate::api::jsonc_object as JSONCObject;
pub use crate::api::markdown_object as MarkdownObject;
pub use crate::api::native_promise_context as NativePromiseContext;
pub use crate::api::toml_object as TOMLObject;
pub use crate::api::unsafe_object as UnsafeObject;
pub use crate::api::yaml_object as YAMLObject;
// `dns_jsc/mod.rs` IS the public surface (Resolver, Order, RecordType, internal::*);
// the full `dns.rs` body is mounted privately as `dns_body` inside it.
pub use crate::dns_jsc as dns;
pub use crate::node::net::block_list as BlockList;
pub use crate::node::zlib::native_brotli as NativeBrotli;
pub use crate::node::zlib::native_zlib as NativeZlib;
pub use crate::node::zlib::native_zstd as NativeZstd;
pub use crate::valkey_jsc::js_valkey::JSValkeyClient as Valkey;
pub use bun_sql_jsc::mysql as MySQL;
pub use bun_sql_jsc::postgres as Postgres;

pub use crate::webview::chrome_process as ChromeProcess;
pub use crate::webview::host_process as WebViewHostProcess;

// ─── shared scaffold for Bun.{TOML,JSONC,JSON5,YAML}.parse ───────────────────
//
// All four host fns repeat: Arena + ASTMemoryAllocator scope + Log +
// frame.argument(0) → bytes → Source::init_path_string. They diverge on
// (a) whether nullish input throws, (b) whether Blob/Buffer is accepted, and
// (c) parse-error class + Expr→JS tail — so this helper owns ONLY the scaffold
// and hands `(&arena, &mut log, &source)` to a per-format closure that does the
// format-specific parse, error match (StackOverflow / OOM / SyntaxError vs
// log.to_js), and tail conversion.
pub(crate) fn with_text_format_source<R>(
    global: &bun_jsc::JSGlobalObject,
    frame: &bun_jsc::CallFrame,
    path: &'static [u8],
    accept_blob_or_buffer: bool,
    reject_nullish: bool,
    f: impl FnOnce(&bun_alloc::Arena, &mut bun_ast::Log, &bun_ast::Source) -> bun_jsc::JsResult<R>,
) -> bun_jsc::JsResult<R> {
    use crate::node::{BlobOrStringOrBuffer, StringOrBuffer};

    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();

    let input_value = frame.argument(0);
    if reject_nullish && input_value.is_empty_or_undefined_or_null() {
        return Err(global.throw_invalid_arguments(format_args!("Expected a string to parse")));
    }

    // Hold whichever input storage applies; both expose `.slice() -> &[u8]`.
    // Conditional-init + drop-flag — only the taken branch's holder is live.
    let _blob_hold: BlobOrStringOrBuffer;
    let _str_hold;
    let bytes: &[u8] = if accept_blob_or_buffer {
        _blob_hold = match BlobOrStringOrBuffer::from_js(global, input_value)? {
            Some(v) => v,
            None => {
                // `to_slice` moves the +1 ref into the returned slice's
                // `.underlying`, so the temporary `BunString` drop is a no-op.
                let mut s = input_value.to_bun_string(global)?;
                BlobOrStringOrBuffer::StringOrBuffer(StringOrBuffer::String(s.to_slice()))
            }
        };
        _blob_hold.slice()
    } else {
        _str_hold = input_value.to_slice(global)?;
        _str_hold.slice()
    };

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

    f(&arena, &mut log, &source)
}

// ─── shared Expr → JS conversion for the text-format parsers ─────────────────

fn estring_to_js(
    str: &bun_ast::E::EString,
    global: &bun_jsc::JSGlobalObject,
) -> bun_jsc::JsResult<bun_jsc::JSValue> {
    use bun_jsc::StringJsc as _;
    // NOTE: the text-format parsers never build ropes, so the simple
    // slice → JS path is sufficient.
    if str.is_utf16 {
        let zig = bun_core::ZigString::init_utf16(str.slice16());
        let bun_s = bun_core::String::init(zig);
        bun_s.to_js(global)
    } else {
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, str.slice8())
    }
}

pub(crate) fn expr_to_js(
    expr: bun_ast::Expr,
    global: &bun_jsc::JSGlobalObject,
) -> bun_jsc::JsResult<bun_jsc::JSValue> {
    expr_to_js_with_check(expr, global, bun_core::StackCheck::init())
}

fn expr_to_js_with_check(
    expr: bun_ast::Expr,
    global: &bun_jsc::JSGlobalObject,
    stack_check: bun_core::StackCheck,
) -> bun_jsc::JsResult<bun_jsc::JSValue> {
    use bun_ast::expr::Data as ExprData;
    use bun_collections::VecExt as _;
    use bun_jsc::JSValue;

    if !stack_check.is_safe_to_recurse() {
        return Err(global.throw_stack_overflow());
    }
    match expr.data {
        ExprData::ENull(_) => Ok(JSValue::NULL),
        ExprData::EBoolean(boolean) => Ok(JSValue::from(boolean.value)),
        ExprData::ENumber(number) => Ok(JSValue::js_number(number.value())),
        ExprData::EString(str) => estring_to_js(str.get(), global),
        ExprData::EArray(arr) => {
            JSValue::create_array_from_iter(global, arr.slice().iter(), |item| {
                expr_to_js_with_check(*item, global, stack_check)
            })
        }
        ExprData::EObject(obj) => {
            let js_obj = JSValue::create_empty_object(global, obj.properties.len_u32() as usize);
            for prop in obj.properties.slice() {
                let key_expr = prop.key.expect("infallible: prop has key");
                let value = expr_to_js_with_check(
                    prop.value.expect("infallible: prop has value"),
                    global,
                    stack_check,
                )?;
                let key_js = expr_to_js_with_check(key_expr, global, stack_check)?;
                let key_str = bun_core::OwnedString::new(key_js.to_bun_string(global)?);
                js_obj.put_may_be_index(global, &key_str, value)?;
            }
            Ok(js_obj)
        }
        _ => Ok(JSValue::UNDEFINED),
    }
}
