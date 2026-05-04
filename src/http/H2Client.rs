//! HTTP/2 path for Bun's fetch HTTP client.
//!
//! `ClientSession` owns the TLS socket once ALPN selects "h2" and is the
//! `ActiveSocket` variant the HTTPContext handlers dispatch to. It holds the
//! connection-scoped state — HPACK tables, write/read buffers, server
//! SETTINGS — and a map of active `Stream`s, each bound to one `HTTPClient`.
//! Response frames are parsed into per-stream buffers and then handed to the
//! same `picohttp.Response` / `handleResponseBody` machinery the HTTP/1.1
//! path uses, so redirects, decompression and the result callback are shared.

use core::sync::atomic::AtomicI32;

/// Advertised as SETTINGS_INITIAL_WINDOW_SIZE; replenished via WINDOW_UPDATE
/// once half has been consumed.
// PORT NOTE: Zig type was `u31` (HTTP/2 window sizes are 31-bit); Rust has no
// `u31`, so widen to `u32`. Value `1 << 24` is well within range.
pub const LOCAL_INITIAL_WINDOW_SIZE: u32 = 1 << 24;

/// Advertised as SETTINGS_MAX_HEADER_LIST_SIZE and enforced as a hard cap on
/// both the wire header block (HEADERS + CONTINUATION accumulation) and the
/// decoded header list, so a CONTINUATION flood or HPACK-amplification bomb
/// can't OOM the process. RFC 9113 §6.5.2 makes the setting advisory, so the
/// cap is checked locally regardless of what the server honors.
pub const LOCAL_MAX_HEADER_LIST_SIZE: u32 = 256 * 1024;

/// `write_buffer` high-water mark. `writeDataWindowed` stops queueing once the
/// userland send buffer crosses this even if flow-control window remains, so a
/// large grant doesn't duplicate the whole body in memory before the first
/// `flush()`. `onWritable → drainSendBodies` resumes once the socket drains.
pub const WRITE_BUFFER_HIGH_WATER: usize = 256 * 1024;

/// Abandon the connection (ENHANCE_YOUR_CALM) if queued control-frame replies
/// (PING/SETTINGS ACKs) push `write_buffer` past this while the socket is
/// stalled — caps the PING-reflection growth at a fixed budget instead of OOM.
pub const WRITE_BUFFER_CONTROL_LIMIT: usize = 1024 * 1024;

/// Live-object counters for the leak test in fetch-http2-leak.test.ts.
/// Incremented at allocation, decremented in deinit. Read from the JS thread
/// via TestingAPIs.liveCounts so they must be atomic.
pub static LIVE_SESSIONS: AtomicI32 = AtomicI32::new(0);
pub static LIVE_STREAMS: AtomicI32 = AtomicI32::new(0);

pub use crate::h2_client::Stream;
pub use crate::h2_client::ClientSession;
pub use crate::h2_client::PendingConnect;

// PORT NOTE: Zig had `pub const TestingAPIs = @import("../http_jsc/headers_jsc.zig").H2TestingAPIs;`
// — a `*_jsc` alias. Deleted per PORTING.md: `to_js`/host-fn surfaces live in the
// `*_jsc` crate via extension traits; the base crate has no mention of jsc.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/H2Client.zig (45 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export hub; u31 widened to u32; *_jsc alias dropped
// ──────────────────────────────────────────────────────────────────────────
