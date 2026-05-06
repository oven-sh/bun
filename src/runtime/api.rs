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
pub use crate::socket::Listener;
pub use crate::socket::SocketAddress;
pub use crate::socket::TCPSocket;
pub use crate::socket::TLSSocket;
pub use crate::socket::Handlers as SocketHandlers;
pub use crate::socket::NewSocket;
// PORT NOTE: dropped `comptime { _ = @import("./socket/uws_jsc.zig"); }` force-reference;
// Rust links `us_socket_buffered_js_write` via `pub` export in crate::socket::uws_jsc.
pub use crate::socket::udp_socket::UDPSocket;

pub use crate::ffi::ffi_object as FFIObject;
pub use crate::ffi::FFI;

pub use crate::napi;
pub use crate::node;
pub use crate::crypto;

// ─── BuildMessage / ResolveMessage ───────────────────────────────────────────
// Zig: `pub const BuildMessage = @import("../jsc/BuildMessage.zig").BuildMessage;`
// The full implementations are JSC-codegen-backed and live in `bun_jsc`
// (BuildMessage.rs / ResolveMessage.rs). That crate is broken under concurrent
// B-2 work, and re-exporting from it here would also create a dependency cycle
// (bun_jsc → bun_runtime → bun_jsc). Until the cycle is resolved, define the
// minimal struct shape locally so dependents (`bun_jsc`, `bun_js_parser_jsc`)
// can name the type.
// TODO(b2-blocked): bun_jsc::build_message — reconcile defs once bun_jsc is green.
pub struct BuildMessage {
    pub msg: bun_logger::Msg,
    pub logged: bool,
}
pub struct ResolveMessage {
    pub msg: bun_logger::Msg,
    pub referrer: Option<bun_logger::fs::Path>,
    pub logged: bool,
}

// ─── compiling submodules (api/ dir) ─────────────────────────────────────────
#[path = "api/cron_parser.rs"]
pub mod cron_parser;
#[path = "api/cron.rs"]
pub mod cron;
#[path = "api/JSONCObject.rs"]
pub mod jsonc_object;
#[path = "api/MarkdownObject.rs"]
pub mod markdown_object;
#[path = "api/Archive.rs"]
pub mod archive;
#[path = "api/filesystem_router.rs"]
pub mod filesystem_router;
#[path = "api/html_rewriter.rs"]
pub mod html_rewriter;
#[path = "api/JSTranspiler.rs"]
pub mod js_transpiler;
#[path = "api/JSBundler.rs"]
pub mod js_bundler;
#[path = "api/BunObject.rs"]
pub mod bun_object;
#[path = "api/HashObject.rs"]
pub mod hash_object;
#[path = "api/NativePromiseContext.rs"]
pub mod native_promise_context;
#[path = "api/TOMLObject.rs"]
pub mod toml_object;
#[path = "api/UnsafeObject.rs"]
pub mod unsafe_object;
#[path = "api/JSON5Object.rs"]
pub mod json5_object;
#[path = "api/YAMLObject.rs"]
pub mod yaml_object;
#[path = "api/glob.rs"]
pub mod glob;

// ─── api/bun/ core (process / spawn / pty / h2) ──────────────────────────────
// `#[path]` is relative to the dir containing this file (`src/runtime/`); the
// inline `mod bun { }` below is a re-export façade only — module bodies are
// declared flat to avoid the non-mod-rs nested-path resolution rules.

// process.rs — Process struct + posix_spawn/uv_spawn machinery. §Dispatch
// vtable applied for ProcessExitHandler; structs + non-JSC methods un-gated.
// spawn_process_{posix,windows} bodies + waiter-thread dispatch loop + sync
// mod remain re-gated inside the file (depend on sibling `spawn` posix_spawn
// wrappers and bun_aio FilePoll method surface).
#[path = "api/bun/process.rs"]
pub mod bun_process;

// ── JSC-heavy siblings: Phase-A drafts preserved on disk, body-gated. ──
// TODO(b2-blocked): bun_jsc method surface — un-gate bodies once bun_jsc dep is green.

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
    pub use super::bun_spawn as spawn;
    pub use spawn::posix_spawn;
    pub use process::{
        Dup2, Exited, ExtraPipe, PidFdType, PidT, Poller, PosixSpawnOptions, PosixSpawnResult,
        PosixStdio, Process, ProcessExitHandler, ProcessExitVTable, Rusage, SpawnOptions,
        SpawnProcessResult, Status, StdioKind, WaiterThread,
    };
    pub use process::StdioKind as SubprocessStdioKind;

    pub mod terminal {
        use core::ffi::{c_int, c_void};
        /// Opaque surface — full struct gated in `terminal_body` (JsRef + IOReader/IOWriter fields).
        // TODO(b2-blocked): bun_jsc::JsRef — replace with terminal_body::Terminal once un-gated.
        pub struct Terminal(());
        /// `Terminal.PtyResult` — pure FFI handles, no JSC.
        pub struct PtyResult {
            pub master_fd: bun_sys::Fd,
            pub slave_fd: bun_sys::Fd,
            pub read_fd: bun_sys::Fd,
            pub write_fd: bun_sys::Fd,
            #[cfg(windows)]
            pub hpcon: *mut c_void,
        }
        /// Mirrors libc `winsize` / Win32 `COORD`-ish layout used by ioctl(TIOCSWINSZ).
        #[repr(C)]
        #[derive(Clone, Copy, Default)]
        pub struct Winsize {
            pub ws_row: u16,
            pub ws_col: u16,
            pub ws_xpixel: u16,
            pub ws_ypixel: u16,
        }
        #[cfg(unix)]
        pub type OpenPtyFn = unsafe extern "C" fn(
            *mut c_int,
            *mut c_int,
            *mut core::ffi::c_char,
            *const c_void,
            *const Winsize,
        ) -> c_int;
        #[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
        pub enum CreatePtyError {
            #[error("openpty failed")]
            OpenPty(bun_sys::Error),
            #[error("dup failed")]
            Dup(bun_sys::Error),
            #[cfg(windows)]
            #[error("CreatePseudoConsole failed")]
            CreatePseudoConsole(bun_sys::Error),
        }
    }
    pub use terminal::Terminal;

    pub mod h2_frame_parser {
        // TODO(b2-blocked): bun_jsc::{Strong,JsRef,AbortSignal,host_fn} — full body in h2_frame_parser_body.
        pub struct H2FrameParser(());
        /// RFC 7540 §6.5.2 setting identifiers.
        #[repr(transparent)]
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub struct SettingsType(pub u16);
        /// RFC 7540 §7 error codes.
        #[repr(transparent)]
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub struct ErrorCode(pub u32);
    }
    pub use h2_frame_parser::H2FrameParser;
}
pub use bun::process::Process as SpawnProcess;


// ─── un-gated re-exports (targets compile) ───────────────────────────────────
pub use crate::image as Image;
pub use crate::shell as Shell;
pub use crate::timer as Timer;

// ─── un-gated re-exports (opaque structs / pure helpers compiling) ───────────
/// `globalThis.Bun`
pub use crate::api::bun_object as Bun;
pub use crate::api::jsonc_object as JSONCObject;
pub use crate::api::markdown_object as MarkdownObject;
pub use crate::api::js_bundler::BuildArtifact;
pub use crate::api::js_bundler::JSBundler;
pub use crate::api::js_bundler::OutputKind;
pub use crate::api::html_rewriter as HTMLRewriter;
pub use crate::api::filesystem_router::FileSystemRouter;
pub use crate::api::filesystem_router::MatchedRoute;
pub use crate::api::archive as Archive;
pub use crate::api::js_transpiler as JSTranspiler;
pub use crate::api::hash_object as HashObject;
pub use crate::api::bun::h2_frame_parser::H2FrameParser;

// ─── gated re-exports (target modules not yet declared / lower-tier missing) ─

mod _gated_reexports {
    pub use crate::api::native_promise_context as NativePromiseContext;
    pub use crate::api::bun::secure_context as SecureContext;
    pub use crate::api::bun::ssl_context_cache as SSLContextCache;
    pub use crate::api::bun::subprocess as Subprocess;
    pub use crate::api::bun::terminal as Terminal;
    // TODO(b2-blocked): crate::webview (module not declared)
    pub use crate::webview::host_process as WebViewHostProcess;
    pub use crate::webview::chrome_process as ChromeProcess;
    pub use crate::api::toml_object as TOMLObject;
    pub use crate::api::unsafe_object as UnsafeObject;
    pub use crate::api::json5_object as JSON5Object;
    pub use crate::api::yaml_object as YAMLObject;
    // TODO(b2-blocked): crate::dns_jsc (module not declared)
    pub use crate::dns_jsc::dns;
    pub use crate::api::glob as Glob;
    pub use crate::node::zlib::native_brotli as NativeBrotli;
    pub use crate::node::zlib::native_zlib as NativeZlib;
    // TODO(b2-blocked): bun_sql_jsc (not in deps)
    pub use bun_sql_jsc::postgres as Postgres;
    pub use bun_sql_jsc::mysql as MySQL;
    // TODO(b2-blocked): crate::valkey_jsc (module not declared)
    pub use crate::valkey_jsc::js_valkey::JSValkeyClient as Valkey;
    pub use crate::node::net::block_list as BlockList;
    pub use crate::node::zlib::native_zstd as NativeZstd;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api.zig (72 lines)
//   confidence: high
//   todos:      0
//   notes:      pure re-export hub; whole-file Zig imports mapped to `pub use <mod> as Name` — Phase B may need to swap module aliases for inner struct re-exports where the Zig file-as-struct pattern was used
// ──────────────────────────────────────────────────────────────────────────
