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

// Un-gated: Stream/ClientSession/dispatch/encode now compile against the
// real crate surface (bridge stubs below cover gated HTTPClient methods).
// They no longer reference bun_str/bun_output/crate::state/crate::Signal.
#[path = "h2_client/ClientSession.rs"]
pub mod client_session;
#[path = "h2_client/dispatch.rs"]
pub mod dispatch;
#[path = "h2_client/encode.rs"]
pub mod encode;
#[path = "h2_client/PendingConnect.rs"]
pub mod pending_connect;
#[path = "h2_client/Stream.rs"]
pub mod stream;

pub use client_session::ClientSession;
pub use pending_connect::PendingConnect;
pub use stream::Stream;

// PORT NOTE: Zig had `pub const TestingAPIs = @import("../http_jsc/headers_jsc.zig").H2TestingAPIs;`
// — a `*_jsc` alias. Deleted per PORTING.md: `to_js`/host-fn surfaces live in the
// `*_jsc` crate via extension traits; the base crate has no mention of jsc.

// ═══════════════════════════════════════════════════════════════════════
// B-2 bridge: thin `h2_*` forwarders on HTTPClient / HTTPContext that the
// h2_client modules call. The real bodies have since un-gated in lib.rs
// (`register_abort_tracker` … `progress_update`) and HTTPContext.rs
// (`register_h2` / `unregister_h2`); these now monomorphize the const-generic
// `<IS_SSL>` callees to `<true>` (HTTP/2 is TLS-only) and erase the
// `picohttp::Request<'_>` borrow back to `'static` so ClientSession can keep
// using `client` after building the request. Kept as inherent methods so the
// many call sites in `h2_client/*.rs` need no churn.
// ═══════════════════════════════════════════════════════════════════════
pub(crate) mod bridge {
    use crate::http_context::HTTPSocket;
    use crate::{HTTPClient, NewHTTPContext};
    use bun_picohttp as picohttp;

    impl HTTPClient<'_> {
        #[inline]
        pub fn h2_register_abort_tracker(&mut self, socket: HTTPSocket<true>) {
            self.register_abort_tracker::<true>(socket);
        }
        #[inline]
        pub fn h2_retry_after_coalesce(&mut self) {
            self.retry_after_h2_coalesce();
        }
        #[inline]
        pub fn h2_retry(&mut self) {
            self.retry_from_h2();
        }
        #[inline]
        pub fn h2_fail(&mut self, err: bun_core::Error) {
            self.fail_from_h2(err);
        }
        #[inline]
        pub fn h2_progress_update(
            &mut self,
            ctx: *mut NewHTTPContext<true>,
            socket: HTTPSocket<true>,
        ) {
            self.progress_update::<true>(ctx, socket);
        }
        #[inline]
        pub fn h2_do_redirect(&mut self, ctx: *mut NewHTTPContext<true>, socket: HTTPSocket<true>) {
            self.do_redirect::<true>(ctx, socket);
        }
        #[inline]
        pub fn h2_clone_metadata(&mut self) {
            self.clone_metadata();
        }
        #[inline]
        pub fn h2_handle_response_body(
            &mut self,
            buf: &[u8],
            is_only_buffer: bool,
        ) -> Result<bool, bun_core::Error> {
            self.handle_response_body(buf, is_only_buffer)
        }
        #[inline]
        pub fn h2_drain_response_body(&mut self, socket: HTTPSocket<true>) {
            self.drain_response_body::<true>(socket);
        }
        #[inline]
        pub fn h2_build_request(&mut self, body_len: usize) -> picohttp::Request<'static> {
            // SAFETY: `build_request` returns a `Request<'_>` whose borrowed
            // slices point only at (a) the thread-local
            // `SHARED_REQUEST_HEADERS_BUF` static and (b) `self.header_buf`,
            // which is itself `&'static [u8]` — neither is tied to the `&mut
            // self` borrow. Erasing to `'static` matches the Zig
            // `buildRequest` (returns slices into module-static storage) and
            // lets `ClientSession::attach` re-borrow `client` while the
            // `Request` is still live. Same pattern as lib.rs `on_writable`.
            unsafe { self.build_request(body_len).detach_lifetime() }
        }
    }

    impl NewHTTPContext<true> {
        #[inline]
        pub fn h2_register(&mut self, session: *mut super::ClientSession) {
            self.register_h2(session);
        }
        #[inline]
        pub fn h2_unregister(&mut self, session: *const super::ClientSession) {
            // Forward the raw heap pointer so `deref()` can reclaim the Box
            // with its original write-capable provenance intact.
            self.unregister_h2(session);
        }
    }
}

// ported from: src/http/H2Client.zig
