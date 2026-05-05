#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// ──────────────────────────────────────────────────────────────────────────
// B-2 STATUS
// `bun_jsc` is now linked and its stub surface (`JSGlobalObject`/`JSValue`/
// `CallFrame`/`JsResult`) is sufficient for the small bridges:
//   - method_jsc       → un-gated, compiles
//   - fetch_enums_jsc  → un-gated, compiles
//   - headers_jsc      → un-gated; `live_counts`/`quic_live_counts` signatures
//                        compile, bodies re-gated on `bun_http::{h2,h3}_client`;
//                        `to_fetch_headers` stays whole-fn gated (FetchHeaders
//                        is in bun_jsc's `_gated` block)
//   - websocket_client → module un-gated; struct/enum surface + frame-parsing
//                        helpers compile. `impl WebSocket<SSL>` method body
//                        re-gated on `bun_uws::NewSocketHandler` API (close/
//                        write/is_closed/detach/adopt_group/…). Submodules:
//                        cpp_websocket + websocket_proxy un-gated; deflate/
//                        proxy_tunnel/upgrade_client re-gated behind stubs.
// ──────────────────────────────────────────────────────────────────────────

pub mod method_jsc;
pub mod fetch_enums_jsc;

pub mod headers_jsc;

pub mod websocket_client;
