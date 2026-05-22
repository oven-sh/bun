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
//!   - `callbacks`      — lsquic → Zig glue (on_hsk_done / on_stream_* / …)
//!   - `PendingConnect` — DNS-pending connect resolution

pub const Stream = @import("./h3_client/Stream.zig");
pub const ClientSession = @import("./h3_client/ClientSession.zig");
pub const ClientContext = @import("./h3_client/ClientContext.zig");
pub const PendingConnect = @import("./h3_client/PendingConnect.zig");
pub const AltSvc = @import("./h3_client/AltSvc.zig");

/// Live-object counters for the leak test in fetch-http3-client.test.ts.
/// Incremented at allocation, decremented in deinit. Read from the JS thread
/// via TestingAPIs.quicLiveCounts so they must be atomic.
pub var live_sessions = std.atomic.Value(u32).init(0);
pub var live_streams = std.atomic.Value(u32).init(0);

pub const TestingAPIs = @import("../http_jsc/headers_jsc.zig").H3TestingAPIs;

const bun = @import("bun");
const std = @import("std");
