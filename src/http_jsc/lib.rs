#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// ──────────────────────────────────────────────────────────────────────────
// B-2 STATUS
// `bun_jsc` is now linked and its stub surface (`JSGlobalObject`/`JSValue`/
// `CallFrame`/`JsResult`/`EventLoop`/`RareData`) plus `bun_uws`'s
// `NewSocketHandler` API are sufficient for the full method surface:
//   - method_jsc       → un-gated, compiles
//   - fetch_enums_jsc  → un-gated, compiles
//   - headers_jsc      → fully un-gated. `to_fetch_headers` now uses
//                        `bun_jsc::FetchHeaders` (moved out of bun_runtime);
//                        `live_counts`/`quic_live_counts` compile against
//                        `bun_http::{h2,h3}_client` atomics.
//   - websocket_client → `impl WebSocket<SSL>` fully un-gated (~40 methods).
//                        `vm_loop_ctx` un-gated via local `EventLoopCtxVTable`
//                        (only `platform_event_loop` is hot; hoist into
//                        `bun_jsc` once a canonical adapter lands).
//                        `handle_handshake` un-gated via local extern decl for
//                        `SSL_get_servername`. `close` 16-bit reason un-gated
//                        via `ZigString::to_owned_slice`. C-ABI exports
//                        un-gated (declare-site macro replaces `paste`).
//                        Residual body-level gate: `write_blob`
//                        (bun_runtime::webcore::Blob — dep cycle).
//                        Submodules: cpp_websocket + websocket_proxy +
//                        websocket_deflate un-gated (deflate's RareData pool
//                        falls back to per-connection until bun_jsc::rare_data
//                        WebSocketDeflateRareData shim lands). proxy_tunnel /
//                        upgrade_client remain gated behind stubs (blocked on
//                        bun_runtime::socket::ssl_wrapper::SslWrapper +
//                        bun_runtime::api::server_config::SslConfig — dep
//                        cycle; see websocket_client.rs header).
// ──────────────────────────────────────────────────────────────────────────

pub mod method_jsc;
pub mod fetch_enums_jsc;

pub mod headers_jsc;

pub mod websocket_client;
