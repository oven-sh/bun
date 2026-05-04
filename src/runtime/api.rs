//! "api" in this context means "the Bun APIs", as in "the exposed JS APIs"

/// `globalThis.Bun`
pub use crate::api::bun_object as Bun;

pub use crate::server;
pub use crate::api::native_promise_context as NativePromiseContext;
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
pub use crate::api::bun::secure_context as SecureContext;
pub use crate::api::bun::ssl_context_cache as SSLContextCache;

pub use crate::api::bun::subprocess as Subprocess;
pub use crate::api::cron;
pub use crate::api::bun::terminal as Terminal;
pub use crate::webview::host_process as WebViewHostProcess;
pub use crate::webview::chrome_process as ChromeProcess;
pub use crate::api::hash_object as HashObject;
pub use crate::api::jsonc_object as JSONCObject;
pub use crate::api::markdown_object as MarkdownObject;
pub use crate::api::toml_object as TOMLObject;
pub use crate::api::unsafe_object as UnsafeObject;
pub use crate::api::json5_object as JSON5Object;
pub use crate::api::yaml_object as YAMLObject;
pub use crate::timer as Timer;
pub use crate::ffi::ffi_object as FFIObject;
pub use crate::api::js_bundler::BuildArtifact;
pub use bun_jsc::build_message::BuildMessage;
pub use crate::dns_jsc::dns;
pub use crate::ffi::FFI;
pub use crate::api::html_rewriter as HTMLRewriter;
pub use crate::api::filesystem_router::FileSystemRouter;
pub use crate::api::archive as Archive;
pub use crate::api::glob as Glob;
pub use crate::image as Image;
pub use crate::api::bun::h2_frame_parser::H2FrameParser;
pub use crate::api::js_bundler::JSBundler;
pub use crate::api::js_transpiler as JSTranspiler;
pub use crate::api::filesystem_router::MatchedRoute;
pub use crate::node::zlib::native_brotli as NativeBrotli;
pub use crate::node::zlib::native_zlib as NativeZlib;
pub use bun_sql_jsc::postgres as Postgres;
pub use bun_sql_jsc::mysql as MySQL;
pub use bun_jsc::resolve_message::ResolveMessage;
pub use bun_shell as Shell;
pub use crate::socket::udp_socket::UDPSocket;
pub use crate::valkey_jsc::js_valkey::JSValkeyClient as Valkey;
pub use crate::node::net::block_list as BlockList;
pub use crate::node::zlib::native_zstd as NativeZstd;

pub use bun_napi as napi;
pub use crate::node;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api.zig (72 lines)
//   confidence: high
//   todos:      0
//   notes:      pure re-export hub; whole-file Zig imports mapped to `pub use <mod> as Name` — Phase B may need to swap module aliases for inner struct re-exports where the Zig file-as-struct pattern was used
// ──────────────────────────────────────────────────────────────────────────
