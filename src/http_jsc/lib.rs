#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// ──────────────────────────────────────────────────────────────────────────
// B-2 STATUS
// `bun_jsc` is now linked and its stub surface (`JSGlobalObject`/`JSValue`/
// `CallFrame`/`JsResult`/`EventLoop`/`RareData`) plus `bun_uws`'s
// `NewSocketHandler` API are sufficient for the full method surface:
//   - method_jsc       → un-gated, compiles
//   - fetch_enums_jsc  → un-gated, compiles
//   - headers_jsc      → un-gated; `live_counts`/`quic_live_counts` bodies
//                        compile against `bun_http::{h2,h3}_client` atomics.
//                        `to_fetch_headers` stays whole-fn gated (FetchHeaders
//                        is in bun_jsc's `_gated` block).
//   - websocket_client → `impl WebSocket<SSL>` fully un-gated and compiles
//                        (~40 methods: handle_data/send_data/close/init/
//                        init_with_tunnel/dispatch_*/…). `Mask::fill*`,
//                        `InitialDataHandler::handle*`, `cpp_websocket::did_*`
//                        un-gated. Residual body-level gates:
//                        `vm_loop_ctx` (bun_jsc VM→EventLoopCtx adapter),
//                        `handle_handshake` server-identity check
//                        (bun_boringssl::SSL_get_servername),
//                        `write_blob` (bun_jsc::webcore::Blob),
//                        `close` 16-bit reason fmt (ZigString: Display),
//                        `export_websocket_client!` (paste workspace dep).
//                        Submodules: cpp_websocket + websocket_proxy un-gated;
//                        deflate/proxy_tunnel/upgrade_client re-gated behind
//                        stubs (see websocket_client.rs header for blockers).
// ──────────────────────────────────────────────────────────────────────────

pub mod method_jsc;
pub mod fetch_enums_jsc;

pub mod headers_jsc;

pub mod websocket_client;
