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
pub use crate::server::SavedRequest;

pub use crate::socket;
pub use crate::socket::Listener;
pub use crate::socket::NewSocket;
pub use crate::socket::SocketAddress;
pub use crate::socket::TCPSocket;
pub use crate::socket::TLSSocket;

pub use crate::crypto;

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
#[path = "api/QRObject.rs"]
pub mod qr_object;
#[path = "api/standalone_graph_jsc.rs"]
pub mod standalone_graph_jsc;
#[path = "api/TOMLObject.rs"]
pub mod toml_object;
#[path = "api/UnsafeObject.rs"]
pub mod unsafe_object;
#[path = "api/XMLObject.rs"]
pub mod xml_object;
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
    pub use super::bun_ssl_context_cache as ssl_context_cache;
    pub use super::bun_subprocess as subprocess;
    pub use process::Rusage;

    pub mod terminal {
        pub use crate::api::bun_terminal_body::Terminal;
    }
    pub use terminal::Terminal;

    pub mod h2_frame_parser {
        pub use crate::api::h2_frame_parser_body::H2FrameParser;
        // js2native thunk (`$rust(h2_frame_parser.rs, …)` in generated_js2native.rs).
        pub(crate) use crate::api::h2_frame_parser_body::h2_frame_parser_constructor;
    }
}

pub use crate::api::bun::h2_frame_parser::H2FrameParser;
pub use crate::api::bun::ssl_context_cache as SSLContextCache;
pub use crate::api::filesystem_router::FileSystemRouter;
pub use crate::api::filesystem_router::MatchedRoute;
pub use crate::api::hash_object as HashObject;
pub use crate::api::js_bundler::BuildArtifact;
pub use crate::api::js_bundler::JSBundler;
pub use crate::api::json5_object as JSON5Object;
pub use crate::api::toml_object as TOMLObject;
pub use crate::api::unsafe_object as UnsafeObject;
pub use crate::api::xml_object as XMLObject;
pub use crate::api::yaml_object as YAMLObject;

// ─── shared scaffold for Bun.{TOML,JSONC,JSON5,YAML}.parse ───────────────────
//
// All four host fns repeat: Arena + ASTMemoryAllocator scope + Log +
// frame.argument(0) → bytes → Source::init_path_string. They diverge on
// (a) whether nullish input throws, (b) whether Blob/Buffer is accepted, and
// (c) parse-error class + Expr→JS tail — so this helper owns ONLY the scaffold
// and hands `(&arena, &mut log, &source)` to a per-format closure that does the
// format-specific parse, error match (StackOverflow / OOM / SyntaxError vs
// log.to_js), and tail conversion.
fn with_text_format_source<R>(
    global: &bun_jsc::JSGlobalObject,
    frame: &bun_jsc::CallFrame,
    path: &'static [u8],
    blob_or_buffer_input: BlobOrBufferInput,
    nullish_input: NullishInput,
    f: impl FnOnce(&bun_alloc::Arena, &mut bun_ast::Log, &bun_ast::Source) -> bun_jsc::JsResult<R>,
) -> bun_jsc::JsResult<R> {
    with_text_format_source_encoded(
        global,
        frame,
        path,
        blob_or_buffer_input,
        nullish_input,
        StringInput::Utf8,
        |arena, log, source, _| f(arena, log, source),
    )
}

/// What `parse` does with a `Blob`, `ArrayBuffer`, typed array or `DataView`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum BlobOrBufferInput {
    /// Parses its bytes.
    Bytes,
    /// Stringifies it like any other argument, as `JSON.parse` would.
    ToString,
}

/// What `parse` does with an `undefined` or `null` argument.
#[derive(Clone, Copy, PartialEq, Eq)]
enum NullishInput {
    Throw,
    /// Parses the text `"undefined"` / `"null"`.
    ToString,
}

/// What `parse` hands the closure for a string argument.
#[derive(Clone, Copy, PartialEq, Eq)]
enum StringInput {
    /// The string re-encoded as UTF-8 ([`SourceEncoding::Utf8Text`]).
    Utf8,
    /// The string's own storage, Latin-1 or UTF-16, as is.
    AsIs,
}

/// How the bytes handed to the closure of
/// [`with_text_format_source_encoded`] are encoded.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SourceEncoding {
    /// A `Buffer` / typed array / `Blob`: bytes as given (UTF-8 expected).
    Bytes,
    /// A JS string, re-encoded as UTF-8.
    Utf8Text,
    /// A Latin-1 JS string, borrowed as is (only under [`StringInput::AsIs`]).
    Latin1Text,
    /// A UTF-16 JS string, borrowed as is: the bytes are its code units
    /// (only under [`StringInput::AsIs`]).
    Utf16Text,
}

fn with_text_format_source_encoded<R>(
    global: &bun_jsc::JSGlobalObject,
    frame: &bun_jsc::CallFrame,
    path: &'static [u8],
    blob_or_buffer_input: BlobOrBufferInput,
    nullish_input: NullishInput,
    string_input: StringInput,
    f: impl FnOnce(
        &bun_alloc::Arena,
        &mut bun_ast::Log,
        &bun_ast::Source,
        SourceEncoding,
    ) -> bun_jsc::JsResult<R>,
) -> bun_jsc::JsResult<R> {
    use crate::node::{BlobOrStringOrBuffer, StringOrBuffer};

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

    let input_value = frame.argument(0);
    if nullish_input == NullishInput::Throw && input_value.is_empty_or_undefined_or_null() {
        return Err(global.throw_invalid_arguments(format_args!("Expected a string to parse")));
    }

    // Hold whichever input storage applies; all expose the bytes.
    // Conditional-init + drop-flag — only the taken branch's holder is live.
    let _blob_hold: BlobOrStringOrBuffer;
    let _str_hold: StringOrBuffer;
    let _latin1_hold: bun_core::String;
    let mut encoding = SourceEncoding::Utf8Text;
    let bytes: &[u8] = 'bytes: {
        if blob_or_buffer_input == BlobOrBufferInput::Bytes && !input_value.is_string() {
            if let Some(v) = BlobOrStringOrBuffer::from_js(global, input_value)? {
                _blob_hold = v;
                encoding = SourceEncoding::Bytes;
                break 'bytes _blob_hold.slice();
            }
        }
        let s = input_value.to_bun_string(global)?;
        if string_input == StringInput::AsIs {
            _latin1_hold = s;
            if _latin1_hold.is_8bit() {
                encoding = SourceEncoding::Latin1Text;
                break 'bytes _latin1_hold.latin1();
            }
            encoding = SourceEncoding::Utf16Text;
            break 'bytes bytemuck::cast_slice(_latin1_hold.utf16());
        }
        _str_hold = StringOrBuffer::String(s.into_utf8_with_string());
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

    f(arena, &mut log, &source, encoding)
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
