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
// HTTP/2 window sizes are 31-bit on the wire; `1 << 24` is well within range.
pub(crate) const LOCAL_INITIAL_WINDOW_SIZE: u32 = 1 << 24;

/// Advertised as SETTINGS_MAX_HEADER_LIST_SIZE and enforced as a hard cap on
/// both the wire header block (HEADERS + CONTINUATION accumulation) and the
/// decoded header list, so a CONTINUATION flood or HPACK-amplification bomb
/// can't OOM the process. RFC 9113 §6.5.2 makes the setting advisory, so the
/// cap is checked locally regardless of what the server honors.
pub(crate) const LOCAL_MAX_HEADER_LIST_SIZE: u32 = 256 * 1024;

/// CONTINUATION frames allowed per header block. Matches nghttp2's
/// `NGHTTP2_DEFAULT_MAX_CONTINUATIONS` (CVE-2024-28182).
pub(crate) const LOCAL_MAX_CONTINUATIONS: u32 = 8;

/// `write_buffer` high-water mark. `writeDataWindowed` stops queueing once the
/// userland send buffer crosses this even if flow-control window remains, so a
/// large grant doesn't duplicate the whole body in memory before the first
/// `flush()`. `onWritable → drainSendBodies` resumes once the socket drains.
pub(crate) const WRITE_BUFFER_HIGH_WATER: usize = 256 * 1024;

/// Abandon the connection (ENHANCE_YOUR_CALM) if queued control-frame replies
/// (PING/SETTINGS ACKs) push `write_buffer` past this while the socket is
/// stalled — caps the PING-reflection growth at a fixed budget instead of OOM.
pub(crate) const WRITE_BUFFER_CONTROL_LIMIT: usize = 1024 * 1024;

/// Live-object counters for the leak test in fetch-http2-leak.test.ts.
/// Incremented at allocation, decremented in deinit. Read from the JS thread
/// via TestingAPIs.liveCounts so they must be atomic.
// Lower-case names kept so cross-crate readers (`bun_http_jsc`) and the gated
// submodules share one identifier; SCREAMING_SNAKE alias preserved for the
// existing internal reference.
#[allow(non_upper_case_globals)]
pub static live_sessions: AtomicI32 = AtomicI32::new(0);
#[allow(non_upper_case_globals)]
pub static live_streams: AtomicI32 = AtomicI32::new(0);
pub use live_streams as LIVE_STREAMS;

#[path = "h2_client/ClientSession.rs"]
pub mod client_session;
#[path = "h2_client/dispatch.rs"]
pub(crate) mod dispatch;
#[path = "h2_client/encode.rs"]
pub mod encode;
#[path = "h2_client/PendingConnect.rs"]
pub mod pending_connect;
#[path = "h2_client/Stream.rs"]
pub mod stream;

pub use client_session::ClientSession;
pub(crate) use client_session::SessionPtr;
pub use pending_connect::PendingConnect;
pub use stream::Stream;
