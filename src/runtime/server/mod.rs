//! Port of src/runtime/server/server.zig
//!
//! B-2: the full draft (4304 lines, preserved in `server_body.rs`) depends on
//! `bun_jsc` method surface (`JSGlobalObject::*`, `JSValue::*`, `Strong`,
//! `WebCore::*`, `Debugger::*`, `API::*`), `bun_uws` request/response methods,
//! `bun_fs`, `bun_uuid`, `bun_output` macros — all of which are currently
//! stub-only or missing in lower tiers. The pure-data submodules that compile
//! standalone are wired below; the rest remain gated with their Phase-A drafts
//! preserved on disk.

// ─── compiling submodules ────────────────────────────────────────────────────
#[path = "HTTPStatusText.rs"]
pub mod http_status_text;
pub use http_status_text as HTTPStatusText;

#[path = "RangeRequest.rs"]
pub mod range_request;
pub use range_request as RangeRequest;

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────
#[cfg(any())]
#[path = "server_body.rs"]
mod server_body; // full Phase-A draft of server.zig
#[cfg(any())]
#[path = "WebSocketServerContext.rs"]
pub mod web_socket_server_context;
#[cfg(any())]
#[path = "HTMLBundle.rs"]
pub mod html_bundle;
#[cfg(any())]
#[path = "StaticRoute.rs"]
pub mod static_route;
#[cfg(any())]
#[path = "FileRoute.rs"]
pub mod file_route;
#[cfg(any())]
#[path = "FileResponseStream.rs"]
pub mod file_response_stream;
#[cfg(any())]
#[path = "ServerConfig.rs"]
pub mod server_config;
#[cfg(any())]
#[path = "ServerWebSocket.rs"]
pub mod server_web_socket;
#[cfg(any())]
#[path = "NodeHTTPResponse.rs"]
pub mod node_http_response;
#[cfg(any())]
#[path = "AnyRequestContext.rs"]
pub mod any_request_context;
#[cfg(any())]
#[path = "RequestContext.rs"]
pub mod request_context;
#[cfg(any())]
#[path = "InspectorBunFrontendDevServerAgent.rs"]
pub mod inspector_bun_frontend_dev_server_agent;

// ─── opaque type surface (replaces lib.rs server_stub) ───────────────────────
// TODO(b2-blocked): bun_jsc::JSGlobalObject (method surface)
// TODO(b2-blocked): bun_jsc::WebCore
// TODO(b2-blocked): bun_jsc::Debugger::AsyncTaskTracker
// TODO(b2-blocked): bun_uws::AnyResponse
// TODO(b2-blocked): bun_fs::FileSystem
pub struct AnyRequestContext(());
pub struct AnyServer(());
pub struct DebugHTTPSServer(());
pub struct DebugHTTPServer(());
pub struct HTMLBundle(());
pub struct HTTPSServer(());
pub struct HTTPServer(());
pub struct NodeHTTPResponse(());
pub struct SavedRequest(());
pub struct ServerConfig(());
pub struct ServerWebSocket(());

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/server.zig
//   confidence: low (B-2 thin un-gate)
//   notes:      only HTTPStatusText compiles; everything else blocked on bun_jsc/bun_uws/bun_fs.
// ──────────────────────────────────────────────────────────────────────────
