//! HTTP/3 client over lsquic via packages/bun-usockets/src/quic.c.
//!
//! One `ClientContext` per HTTP-thread loop wraps the lsquic client engine;
//! each `ClientSession` is one QUIC connection to an origin and multiplexes
//! `Stream`s, each bound 1:1 to an `HTTPClient`. The result-delivery surface
//! is the same one H2 uses (`handleResponseMetadata` / `handleResponseBody` /
//! `progressUpdateH3`), so redirect, decompression, and FetchTasklet plumbing
//! are shared with HTTP/1.1.
//!
//! Layout mirrors `h2_client/`:
//!   - `Stream`         — one in-flight request
//!   - `ClientSession`  — one QUIC connection (pooled per origin)
//!   - `ClientContext`  — process-global lsquic engine + session registry
//!   - `encode`         — request header/body framing onto a quic.Stream
//!   - `callbacks`      — lsquic → Rust glue (on_hsk_done / on_stream_* / …)
//!   - `PendingConnect` — DNS-pending connect resolution

use core::sync::atomic::AtomicU32;

#[path = "h3_client/AltSvc.rs"]
pub mod AltSvc;
#[path = "h3_client/callbacks.rs"]
pub mod callbacks;
#[path = "h3_client/ClientContext.rs"]
pub mod client_context;
#[path = "h3_client/ClientSession.rs"]
pub mod client_session;
#[path = "h3_client/encode.rs"]
pub mod encode;
#[path = "h3_client/PendingConnect.rs"]
pub mod pending_connect;
#[path = "h3_client/Stream.rs"]
pub mod stream;

// Single `Output.scoped(.h3_client, .hidden)` for the whole module tree. Zig
// comptime-deduplicates per tag, so the four submodules share one
// `really_disable`/`is_visible_once`/lock; declaring it once here and importing
// in each child preserves that behavior.
bun_core::declare_scope!(h3_client, hidden);

pub use client_context::ClientContext;
pub use client_session::ClientSession;
pub use pending_connect::PendingConnect;
pub use stream::Stream;

/// Live-object counters for the leak test in fetch-http3-client.test.ts.
/// Incremented at allocation, decremented in deinit. Read from the JS thread
/// via TestingAPIs.quicLiveCounts so they must be atomic.
// PORT NOTE: Zig names are `live_sessions`/`live_streams` (snake_case module
// vars). Kept verbatim so cross-crate readers (`bun_http_jsc`) and the gated
// submodules see the same identifier the Zig uses; SCREAMING_SNAKE aliases
// preserved for the existing internal references.
#[allow(non_upper_case_globals)]
pub static live_sessions: AtomicU32 = AtomicU32::new(0);
#[allow(non_upper_case_globals)]
pub static live_streams: AtomicU32 = AtomicU32::new(0);
pub use live_sessions as LIVE_SESSIONS;
pub use live_streams as LIVE_STREAMS;

// Zig: pub const TestingAPIs = @import("../http_jsc/headers_jsc.zig").H3TestingAPIs;
// Deleted per PORTING.md — *_jsc aliases are dropped; H3TestingAPIs lives in
// bun_http_jsc and is accessed via the extension-trait pattern there.

// ported from: src/http/H3Client.zig
