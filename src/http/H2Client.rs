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
// PORT NOTE: Zig names are `live_sessions`/`live_streams` (snake_case module
// vars). Kept verbatim so cross-crate readers (`bun_http_jsc`) and the gated
// submodules see the same identifier the Zig uses; SCREAMING_SNAKE aliases
// preserved for the existing internal references.
#[allow(non_upper_case_globals)]
pub static live_sessions: AtomicI32 = AtomicI32::new(0);
#[allow(non_upper_case_globals)]
pub static live_streams: AtomicI32 = AtomicI32::new(0);
pub use live_sessions as LIVE_SESSIONS;
pub use live_streams as LIVE_STREAMS;

// reconciler-3: Stream/ClientSession/dispatch/encode reference `bun_str`/
// `bun_output`/`crate::state`/`crate::Signal`/`http_thread::InitOpts` that are
// still gated; re-gate until those crate roots land. PendingConnect is real.
// Type-only stubs keep `HTTPContext`'s `h2::ClientSession`/`h2::Stream`
// pointer fields resolving.
#[cfg(any())] #[path = "h2_client/Stream.rs"]         pub mod stream;
#[cfg(not(any()))] pub mod stream { pub struct Stream; }
#[cfg(any())] #[path = "h2_client/ClientSession.rs"]  pub mod client_session;
#[cfg(not(any()))] pub mod client_session { pub struct ClientSession; }
#[path = "h2_client/PendingConnect.rs"]               pub mod pending_connect;
#[cfg(any())] #[path = "h2_client/dispatch.rs"]       pub mod dispatch;
#[cfg(any())] #[path = "h2_client/encode.rs"]         pub mod encode;

pub use stream::Stream;
pub use client_session::ClientSession;
pub use pending_connect::PendingConnect;

// PORT NOTE: Zig had `pub const TestingAPIs = @import("../http_jsc/headers_jsc.zig").H2TestingAPIs;`
// — a `*_jsc` alias. Deleted per PORTING.md: `to_js`/host-fn surfaces live in the
// `*_jsc` crate via extension traits; the base crate has no mention of jsc.

// ═══════════════════════════════════════════════════════════════════════
// B-2 bridge stubs: methods on HTTPClient / HTTPContext that the h2_client
// modules call but which are still gated behind lib.rs `_phase_a_draft` /
// HTTPContext.rs `_phase_a_draft`. `todo!()` bodies so the call sites
// type-check; replaced by the real impls once those blocks un-gate.
// TODO(b2-bridge): delete this section once `_phase_a_draft` lands.
// ═══════════════════════════════════════════════════════════════════════
pub(crate) mod bridge {
    use crate::http_context::HTTPSocket;
    use crate::{HTTPClient, NewHTTPContext, ShouldContinue};
    use bun_picohttp as picohttp;

    /// Socket helper missing from `bun_uws::NewSocketHandler`.
    #[inline]
    pub fn socket_is_closed_or_has_error(socket: &HTTPSocket<true>) -> bool {
        socket.is_closed() || socket.is_shutdown() || socket.get_error() != 0
    }

    impl HTTPClient {
        pub fn h2_register_abort_tracker(&mut self, _socket: HTTPSocket<true>) {
            todo!("HTTPClient::register_abort_tracker — gated in lib.rs _phase_a_draft")
        }
        pub fn h2_retry_after_coalesce(&mut self) {
            todo!("HTTPClient::retry_after_h2_coalesce — gated in lib.rs _phase_a_draft")
        }
        pub fn h2_retry(&mut self) {
            todo!("HTTPClient::retry_from_h2 — gated in lib.rs _phase_a_draft")
        }
        pub fn h2_fail(&mut self, _err: bun_core::Error) {
            todo!("HTTPClient::fail_from_h2 — gated in lib.rs _phase_a_draft")
        }
        pub fn h2_progress_update(
            &mut self,
            _ctx: *mut NewHTTPContext<true>,
            _socket: HTTPSocket<true>,
        ) {
            todo!("HTTPClient::progress_update — gated in lib.rs _phase_a_draft")
        }
        pub fn h2_do_redirect(
            &mut self,
            _ctx: *mut NewHTTPContext<true>,
            _socket: HTTPSocket<true>,
        ) {
            todo!("HTTPClient::do_redirect — gated in lib.rs _phase_a_draft")
        }
        pub fn h2_clone_metadata(&mut self) {
            todo!("HTTPClient::clone_metadata — gated in lib.rs _phase_a_draft")
        }
        pub fn h2_handle_response_metadata(
            &mut self,
            _response: &mut picohttp::Response<'_>,
        ) -> Result<ShouldContinue, bun_core::Error> {
            todo!("HTTPClient::handle_response_metadata — gated in lib.rs _phase_a_draft")
        }
        pub fn h2_handle_response_body(
            &mut self,
            _buf: &[u8],
            _is_only_buffer: bool,
        ) -> Result<bool, bun_core::Error> {
            todo!("HTTPClient::handle_response_body — gated in lib.rs _phase_a_draft")
        }
        pub fn h2_drain_response_body(&mut self, _socket: HTTPSocket<true>) {
            todo!("HTTPClient::drain_response_body — gated in lib.rs _phase_a_draft")
        }
        pub fn h2_build_request(&mut self, _body_len: usize) -> picohttp::Request<'static> {
            todo!("HTTPClient::build_request — gated in lib.rs _phase_a_draft")
        }
    }

    impl NewHTTPContext<true> {
        pub fn h2_register(&mut self, _session: *mut super::ClientSession) {
            todo!("HTTPContext::register_h2 — gated in HTTPContext.rs _phase_a_draft")
        }
        pub fn h2_unregister(&mut self, _session: &super::ClientSession) {
            todo!("HTTPContext::unregister_h2 — gated in HTTPContext.rs _phase_a_draft")
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/H2Client.zig (45 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export hub; u31 widened to u32; *_jsc alias dropped;
//               bridge stubs for gated HTTPClient/HTTPContext state-machine
//               methods (delete once _phase_a_draft un-gates)
// ──────────────────────────────────────────────────────────────────────────
