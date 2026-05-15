//! "api" in this context means "the Bun APIs", as in "the exposed JS APIs"

// ─── server / socket / ffi (un-gated, opaque surface) ────────────────────────
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
// PORT NOTE: dropped `comptime { _ = @import("./socket/uws_jsc.zig"); }` force-reference;
// Rust links `us_socket_buffered_js_write` via `pub` export in crate::socket::uws_jsc.
pub use crate::socket::udp_socket::UDPSocket;

pub use crate::ffi::FFI;
pub use crate::ffi::ffi_object as FFIObject;

pub use crate::crypto;
pub use crate::napi;
pub use crate::node;

// ─── BuildMessage / ResolveMessage ───────────────────────────────────────────
// Zig: `pub const {Build,Resolve}Message = @import("../jsc/{Build,Resolve}Message.zig").…;`
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
#[path = "api/lolhtml_jsc.rs"]
pub mod lolhtml_jsc;
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

// process.rs — Process struct + posix_spawn/uv_spawn machinery. §Dispatch
// vtable applied for ProcessExitHandler; structs + non-JSC methods un-gated.
// spawn_process_{posix,windows} bodies + waiter-thread dispatch loop + sync
// mod remain re-gated inside the file (depend on sibling `spawn` posix_spawn
// wrappers and bun_io FilePoll method surface).
#[path = "api/bun/process.rs"]
pub mod bun_process;

// posix_spawn(2) wrappers + Stdio enum. `bun_sys::posix` surface is now wide
// enough for the `bun_spawn` half; libc-backed `PosixSpawn*` wrappers are
// cfg-gated to macOS inside the file. `stdio` submod stays re-gated within.
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
#[path = "api/bun/h2_frame_parser.rs"]
pub mod h2_frame_parser_body;

// SSL siblings — gated (boringssl_sys bindgen surface).
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
        /// Re-export the full struct now that `bun_terminal_body` is un-gated;
        /// downstream callers (`Subprocess.terminal`, spawn bindings) hold the
        /// concrete type directly — no opaque-ZST cast layer.
        pub use crate::api::bun_terminal_body::Terminal;
        // `Terminal.PtyResult`, `Winsize`, `OpenPtyFn`, `CreatePtyError` —
        // pure FFI handles with no JSC. Canonical defs live in
        // `api/bun/Terminal.rs`; re-exported here so callers can name them via
        // `api::Terminal::*` exactly as in the Zig (`Terminal.PtyResult` etc.).
        pub use crate::api::bun_terminal_body::{
            CreatePtyError, OpenPtyFn, OpenPtyTermios, PtyResult, Winsize,
        };
    }
    pub use terminal::Terminal;

    pub mod h2_frame_parser {
        pub use crate::api::h2_frame_parser_body::ErrorCode;
        /// Re-export the full struct now that `h2_frame_parser_body` is
        /// un-gated; `socket::NativeCallbacks::H2(IntrusiveRc<H2FrameParser>)`
        /// and the `set_native_socket` attach path now share one concrete
        /// type — no opaque-ZST cast layer. The body provides the real
        /// `RefCounted` impl + `on_native_{read,writable,close}` bodies.
        pub use crate::api::h2_frame_parser_body::H2FrameParser;
        // js2native thunks (`$zig(h2_frame_parser.zig, …)` in generated_js2native.rs).
        pub use crate::api::h2_frame_parser_body::h2_frame_parser_constructor;
        pub use crate::api::h2_frame_parser_body::js_assert_settings;
        pub use crate::api::h2_frame_parser_body::js_get_packed_settings;
        pub use crate::api::h2_frame_parser_body::js_get_unpacked_settings;
    }
    pub use h2_frame_parser::H2FrameParser;
}
pub use bun::process::Process as SpawnProcess;

// ─── un-gated re-exports (targets compile) ───────────────────────────────────
pub use crate::image as Image;
pub use crate::shell as Shell;
pub use crate::timer as Timer;

// ─── un-gated re-exports (opaque structs / pure helpers compiling) ───────────
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
// the full Phase-A `dns.rs` draft is mounted privately as `dns_body` inside it.
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
//
// Zig has no shared helper (four open-coded copies); this is net-new cleanup of
// a faithfully-ported duplication.
pub(crate) fn with_text_format_source<R>(
    global: &bun_jsc::JSGlobalObject,
    frame: &bun_jsc::CallFrame,
    path: &'static [u8],
    accept_blob_or_buffer: bool,
    reject_nullish: bool,
    f: impl FnOnce(&bun_alloc::Arena, &mut bun_ast::Log, &bun_ast::Source) -> bun_jsc::JsResult<R>,
) -> bun_jsc::JsResult<R> {
    use crate::node::{BlobOrStringOrBuffer, StringOrBuffer};

    // PERF(port): was ArenaAllocator bulk-free feeding the parser + AST stores.
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::new(&arena);
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

    let mut log = bun_ast::Log::init();
    let source = bun_ast::Source::init_path_string(path, bytes);

    f(&arena, &mut log, &source)
}

// ported from: src/runtime/api.zig
