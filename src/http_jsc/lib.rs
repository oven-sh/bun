#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
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
//   - websocket_client → fully un-gated. `impl WebSocket<SSL>` (~40 methods)
//                        + all five submodules (cpp_websocket, websocket_proxy,
//                        websocket_deflate, proxy_tunnel, upgrade_client)
//                        compile against `bun_jsc::webcore::Blob` shim and
//                        `bun_jsc::rare_data` deflate pool. C-ABI exports via
//                        declare-site macro. 0 residual gates.
// ──────────────────────────────────────────────────────────────────────────

pub mod fetch_enums_jsc;
pub mod method_jsc;

pub mod headers_jsc;

pub mod websocket_client;
