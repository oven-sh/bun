use core::cell::Cell;
use core::ptr::{NonNull, addr_of, addr_of_mut};
use core::sync::atomic::Ordering;

use bun_core::scoped_log;
use bun_core::{Error, err};
use bun_uws as uws;

use crate::http_cert_error::HTTPCertError;
use crate::http_context::HTTPSocket;
use crate::internal_state::{HTTPStage, Stage};
use crate::ssl_config::SSLConfig;
use crate::ssl_wrapper::{Handlers as SSLWrapperHandlers, InitError, SSLWrapper, WriteDataError};
use crate::{AlpnOffer, HTTPClient};

bun_core::declare_scope!(http_proxy_tunnel, visible);

// Intrusive single-thread refcount (bun.ptr.RefCount). `ref_count` field at
// matching offset; deref() hitting 0 calls ProxyTunnel::deinit (mapped to Drop
// + dealloc via IntrusiveRc).
pub type RefPtr = bun_ptr::IntrusiveRc<ProxyTunnel>;

/// Upgrade a `*mut ProxyTunnel` (obtained from [`RefPtr::as_ptr`]) to
/// `&'a mut ProxyTunnel`.
///
/// INVARIANT: callers hold a strong intrusive ref on the tunnel for the
/// duration of the returned borrow, the tunnel is a heap allocation disjoint
/// from the caller's `self`, and no other `&mut ProxyTunnel` to it is live.
/// HTTP-thread-only (single-thread refcount). Centralises the SAFETY argument
/// formerly open-coded at five `&mut *t.as_ptr()` sites in `lib.rs`.
#[inline]
pub(crate) fn raw_as_mut<'a>(ptr: *mut ProxyTunnel) -> &'a mut ProxyTunnel {
    debug_assert!(!ptr.is_null());
    // SAFETY: see INVARIANT above.
    unsafe { &mut *ptr }
}

type ProxyTunnelWrapper = SSLWrapper<*mut HTTPClient<'static>>;

pub use bun_uws::MaybeAnySocket as Socket;

#[derive(bun_ptr::CellRefCounted)]
pub struct ProxyTunnel {
    pub wrapper: Option<ProxyTunnelWrapper>,
    pub shutdown_err: Cell<Error>,
    /// active socket is the socket that is currently being used
    pub socket: Socket,
    pub write_buffer: bun_io::StreamBuffer,
    pub did_have_handshaking_error: bool,
    pub established_with_reject_unauthorized: bool,
    pub ref_count: Cell<u32>,
}

impl Default for ProxyTunnel {
    fn default() -> Self {
        Self {
            wrapper: None,
            shutdown_err: Cell::new(err!(ConnectionClosed)),
            socket: Socket::None,
            write_buffer: bun_io::StreamBuffer::default(),
            did_have_handshaking_error: false,
            established_with_reject_unauthorized: false,
            ref_count: Cell::new(1),
        }
    }
}

impl Drop for ProxyTunnel {
    fn drop(&mut self) {
        // Zig: ProxyTunnel.deinit — wrapper.deinit() / write_buffer.deinit()
        // are handled by their own Drop impls; just clear the socket tag.
        self.socket = Socket::None;
    }
}

// ─── intrusive refcount: derived via #[derive(CellRefCounted)] above ─────────

impl ProxyTunnel {
    /// Read-only access to `socket` (disjoint from `wrapper`).
    #[inline]
    fn socket_of<'a>(this: NonNull<Self>) -> &'a Socket {
        // SAFETY: `this` is a live intrusive-refcounted tunnel; `socket` is
        // disjoint from `wrapper`. HTTP-thread-only.
        unsafe { &*addr_of!((*this.as_ptr()).socket) }
    }

    /// Overwrite `socket` (disjoint from `wrapper`).
    #[inline]
    fn set_socket(this: NonNull<Self>, s: Socket) {
        // SAFETY: see [`Self::socket_of`].
        unsafe { *addr_of_mut!((*this.as_ptr()).socket) = s };
    }

    /// Mutable access to `write_buffer` (disjoint from `wrapper`).
    #[inline]
    fn write_buffer_of<'a>(this: NonNull<Self>) -> &'a mut bun_io::StreamBuffer {
        // SAFETY: see [`Self::socket_of`].
        unsafe { &mut *addr_of_mut!((*this.as_ptr()).write_buffer) }
    }

    /// Shared access to `shutdown_err` (a `Cell<Error>`; disjoint from
    /// `wrapper`). Callers use `.get()`/`.set()` — no `&mut` needed.
    #[inline]
    fn shutdown_err_of<'a>(this: NonNull<Self>) -> &'a Cell<Error> {
        // SAFETY: see [`Self::socket_of`].
        unsafe { &*addr_of!((*this.as_ptr()).shutdown_err) }
    }

    #[inline]
    fn close_from_callback(this: NonNull<Self>, err: Error) {
        Self::close_raw(this, err);
    }

    #[inline]
    fn wrapper_ssl(this: NonNull<Self>) -> Option<NonNull<bun_boringssl_sys::SSL>> {
        // SAFETY: `this` is live; transient shared read of a Copy field. See
        // doc note above re: overlap with the caller's `&mut SSLWrapper`.
        unsafe { (*this.as_ptr()).wrapper.as_ref().and_then(|w| w.ssl) }
    }

    #[inline]
    fn wrapper_mut<'a>(this: *mut Self) -> Option<&'a mut ProxyTunnelWrapper> {
        // SAFETY: see INVARIANT above. Projects only the `wrapper` field; no
        // intermediate `&mut Self` is formed.
        unsafe { (*addr_of_mut!((*this).wrapper)).as_mut() }
    }

    /// Read-only access to `ref_count` (a `Cell<u32>`; disjoint from `wrapper`).
    /// Used to bump the intrusive refcount from within a callback whose caller
    /// holds `&mut SSLWrapper` on `(*this).wrapper`.
    #[inline]
    fn ref_count_of<'a>(this: NonNull<Self>) -> &'a core::cell::Cell<u32> {
        // SAFETY: see [`Self::socket_of`].
        unsafe { &*addr_of!((*this.as_ptr()).ref_count) }
    }

    #[inline]
    fn ref_scope(this: NonNull<Self>) -> bun_ptr::ScopedRef<Self> {
        // SAFETY: see INVARIANT above.
        unsafe { bun_ptr::ScopedRef::new(this.as_ptr()) }
    }
}

#[inline]
fn client_from_ctx<'a, 'c>(ctx: *mut HTTPClient<'c>) -> &'a mut HTTPClient<'c> {
    // SAFETY: see INVARIANT above.
    unsafe { &mut *ctx }
}

fn on_open(ctx: *mut HTTPClient) {
    // HTTPClient owns ProxyTunnel only by `NonNull` pointer, so the borrow
    // here does not overlap the caller's `&mut SSLWrapper`.
    let this = client_from_ctx(ctx);
    scoped_log!(http_proxy_tunnel, "ProxyTunnel onOpen");
    bun_analytics::features::http_client_proxy.fetch_add(1, Ordering::Relaxed);
    this.state.response_stage = HTTPStage::ProxyHandshake;
    this.state.request_stage = HTTPStage::ProxyHandshake;
    let Some(proxy_nn) = this.proxy_tunnel.as_ref().map(|p| p.data) else {
        return;
    };
    // Live intrusive-refcounted tunnel allocated in `start()`. Do NOT form
    // `&mut ProxyTunnel` — see ALIASING NOTE.
    let _guard = ProxyTunnel::ref_scope(proxy_nn);
    if let Some(ssl_ptr) = ProxyTunnel::wrapper_ssl(proxy_nn) {
        let _hostname = this.hostname.unwrap_or(this.url.hostname);

        // PORT NOTE: Zig `configureHTTPClient` is `configureHTTPClientWithALPN(ssl, host, .h1)`;
        // the Rust port already exposes the ALPN form in `crate::configure_http_client_with_alpn`.
        // SAFETY: `ssl_ptr` is the live SSL handle from the tunnel's SSLWrapper.
        let ssl = unsafe { &mut *ssl_ptr.as_ptr() };
        if bun_core::is_ip_address(_hostname) {
            // SNI is null (IP literal — no SNI).
            crate::configure_http_client_with_alpn(ssl, core::ptr::null(), AlpnOffer::H1);
        } else {
            // SAFETY: TEMP_HOSTNAME is only accessed from the single HTTP thread.
            let temp_hostname = crate::temp_hostname();
            if _hostname.len() < temp_hostname.len() {
                temp_hostname[.._hostname.len()].copy_from_slice(_hostname);
                temp_hostname[_hostname.len()] = 0;
                // `temp_hostname` is NUL-terminated and outlives this call.
                crate::configure_http_client_with_alpn(
                    ssl,
                    temp_hostname.as_ptr().cast(),
                    AlpnOffer::H1,
                );
            } else {
                let mut owned = _hostname.to_vec();
                owned.push(0);
                // `owned` is NUL-terminated and outlives this call.
                crate::configure_http_client_with_alpn(ssl, owned.as_ptr().cast(), AlpnOffer::H1);
                // owned drops here (was: defer if hostname_needs_free free(hostname))
            }
        }
    }
}

fn on_data(ctx: *mut HTTPClient, decoded_data: &[u8]) {
    if decoded_data.is_empty() {
        return;
    }
    scoped_log!(
        http_proxy_tunnel,
        "ProxyTunnel onData decoded {}",
        decoded_data.len()
    );
    // SAFETY: see on_open. `&mut HTTPClient` is disjoint from the caller's
    // `&mut SSLWrapper` (HTTPClient holds the tunnel only by pointer). NLL
    // ends this borrow before any reentrant call below that re-derives
    // `&mut *ctx` (close → on_close, progress_update).
    let this = client_from_ctx(ctx);
    let Some(proxy_nn) = this.proxy_tunnel.as_ref().map(|p| p.data) else {
        return;
    };
    let _guard = ProxyTunnel::ref_scope(proxy_nn);
    // While parked waiting for the JS `checkServerIdentity` verdict no request
    // has been written through the tunnel, so any decrypted application data
    // arriving here is unexpected.
    if this.state.flags.is_waiting_for_cert_check {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onData while parked");
        this.state.pending_response = None;
        // SAFETY: `this` dead (NLL); reenter via raw ptr.
        ProxyTunnel::close_from_callback(proxy_nn, err!(UnexpectedData));
        return;
    }
    match this.state.response_stage {
        HTTPStage::Body => {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onData body");
            if decoded_data.is_empty() {
                return;
            }
            let report_progress = match this.handle_response_body(decoded_data, false) {
                Ok(v) => v,
                Err(err) => {
                    // `this` is dead (NLL); reenter via raw ptr so on_close's
                    // fresh `&mut *ctx` / `&mut *proxy_ptr` do not alias us.
                    // SAFETY: tunnel pinned by ref_raw above.
                    ProxyTunnel::close_from_callback(proxy_nn, err);
                    return;
                }
            };

            if report_progress {
                // `this` dead (NLL); reborrow via `client_from_ctx` inside.
                progress_update_for_proxy_socket(ctx, proxy_nn);
                return;
            }
        }
        HTTPStage::BodyChunk => {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onData body_chunk");
            if decoded_data.is_empty() {
                return;
            }
            let report_progress = match this.handle_response_body_chunked_encoding(decoded_data) {
                Ok(v) => v,
                Err(err) => {
                    // SAFETY: see Body arm.
                    ProxyTunnel::close_from_callback(proxy_nn, err);
                    return;
                }
            };

            if report_progress {
                // `this` dead (NLL); see Body arm.
                progress_update_for_proxy_socket(ctx, proxy_nn);
                return;
            }
        }
        HTTPStage::ProxyHeaders => {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onData proxy_headers");
            match ProxyTunnel::socket_of(proxy_nn) {
                &Socket::Ssl(socket) => {
                    let hctx = &raw mut crate::http_thread().https_context;
                    this.handle_on_data_headers::<true>(decoded_data, hctx, socket);
                }
                &Socket::Tcp(socket) => {
                    let hctx = &raw mut crate::http_thread().http_context;
                    this.handle_on_data_headers::<false>(decoded_data, hctx, socket);
                }
                Socket::None => {}
            }
        }
        _ => {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onData unexpected data");
            this.state.pending_response = None;
            // SAFETY: `this` dead (NLL); reenter via raw ptr.
            ProxyTunnel::close_from_callback(proxy_nn, err!(UnexpectedData));
        }
    }
}

fn on_handshake(
    ctx: *mut HTTPClient,
    handshake_success: bool,
    ssl_error: uws::us_bun_verify_error_t,
) {
    // NLL ends `this` before any reentrant call below.
    let this = client_from_ctx(ctx);
    let Some(proxy_nn) = this.proxy_tunnel.as_ref().map(|p| p.data) else {
        return;
    };
    scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake");
    // Do NOT form `&mut ProxyTunnel` (see ALIASING NOTE).
    let _guard = ProxyTunnel::ref_scope(proxy_nn);
    this.state.response_stage = HTTPStage::ProxyHeaders;
    this.state.request_stage = HTTPStage::ProxyHeaders;
    this.state.request_sent_len = 0;
    let handshake_error = HTTPCertError::from_verify_error(ssl_error);
    if handshake_success {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake success");
        // handshake completed but we may have ssl errors
        this.flags.did_have_handshaking_error = handshake_error.error_no != 0;
        if this.flags.reject_unauthorized {
            // only reject the connection if reject_unauthorized == true
            if this.flags.did_have_handshaking_error {
                let err = crate::get_cert_error_from_no(handshake_error.error_no);
                // SAFETY: `this` dead (NLL); reenter via raw ptr so on_close's
                // fresh `&mut *ctx` does not alias us.
                ProxyTunnel::close_from_callback(proxy_nn, err);
                return;
            }

            // if checkServerIdentity returns false, we dont call open this means that the connection was rejected
            // Zig: `const ssl_ptr = proxy.wrapper.?.ssl orelse return;` —
            // `.?` asserts wrapper-is-Some; `orelse return` silently bails if
            // ssl is None. Mirror that split: assert the wrapper, then return
            // (no debug_assert) on the ssl-None sub-case.
            // SAFETY: `proxy_nn` is live (ref-guarded above). Transient shared
            // read of the `wrapper` discriminant only — same caveat as
            // [`wrapper_ssl`]: the caller's `&mut SSLWrapper` overlaps this
            // field, so we MUST NOT form `&mut Option<_>` here (rules out
            // `wrapper_mut`); a debug-only `is_some()` autoref read mirrors the
            // pre-refactor inline `proxy.wrapper.?` and is never retained.
            debug_assert!(unsafe { (*proxy_nn.as_ptr()).wrapper.is_some() });
            let Some(ssl_ptr) = ProxyTunnel::wrapper_ssl(proxy_nn) else {
                return;
            };

            // SAFETY: `ssl_ptr` is the live SSL handle from the tunnel's
            // SSLWrapper for the open inner TLS connection (NonNull invariant).
            let ssl = unsafe { &mut *ssl_ptr.as_ptr() };
            match ProxyTunnel::socket_of(proxy_nn) {
                &Socket::Ssl(socket) => {
                    if !this.check_server_identity::<true>(socket, handshake_error, ssl, false) {
                        scoped_log!(
                            http_proxy_tunnel,
                            "ProxyTunnel onHandshake checkServerIdentity failed"
                        );
                        return;
                    }
                }
                &Socket::Tcp(socket) => {
                    if !this.check_server_identity::<false>(socket, handshake_error, ssl, false) {
                        scoped_log!(
                            http_proxy_tunnel,
                            "ProxyTunnel onHandshake checkServerIdentity failed"
                        );
                        // see Ssl arm — `this` may be freed here.
                        return;
                    }
                }
                Socket::None => {}
            }
        }

        match ProxyTunnel::socket_of(proxy_nn) {
            &Socket::Ssl(socket) => {
                client_from_ctx(ctx).on_writable::<true, true>(socket);
            }
            &Socket::Tcp(socket) => {
                client_from_ctx(ctx).on_writable::<true, false>(socket);
            }
            Socket::None => {}
        }
    } else {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake failed");
        // if we are here is because server rejected us, and the error_no is the cause of this
        // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
        if this.flags.did_have_handshaking_error && handshake_error.error_no != 0 {
            let err = crate::get_cert_error_from_no(handshake_error.error_no);
            // SAFETY: `this` dead (NLL); reenter via raw ptr.
            ProxyTunnel::close_from_callback(proxy_nn, err);
            return;
        }
        // if handshake_success it self is false, this means that the connection was rejected
        // SAFETY: `this` dead (NLL); reenter via raw ptr.
        ProxyTunnel::close_from_callback(proxy_nn, err!(ConnectionRefused));
        return;
    }
}

pub fn write_encrypted(ctx: *mut HTTPClient, encoded_data: &[u8]) {
    let Some(proxy_nn) = client_from_ctx(ctx).proxy_tunnel.as_ref().map(|p| p.data) else {
        return;
    };
    let write_buffer = ProxyTunnel::write_buffer_of(proxy_nn);
    // Preserve TLS record ordering: if any encrypted bytes are buffered,
    // enqueue new bytes and flush them in FIFO via onWritable.
    if write_buffer.is_not_empty() {
        if write_buffer.write(encoded_data).is_err() {
            bun_core::out_of_memory();
        }
        return;
    }
    let written = match ProxyTunnel::socket_of(proxy_nn) {
        &Socket::Ssl(socket) => socket.write(encoded_data),
        &Socket::Tcp(socket) => socket.write(encoded_data),
        Socket::None => 0,
    };
    let pending = &encoded_data[usize::try_from(written).expect("int cast")..];
    if !pending.is_empty() {
        // lets flush when we are truly writable
        if write_buffer.write(pending).is_err() {
            bun_core::out_of_memory();
        }
    }
}

fn on_close(ctx: *mut HTTPClient) {
    let this = client_from_ctx(ctx);
    scoped_log!(
        http_proxy_tunnel,
        "ProxyTunnel onClose {}",
        if this.proxy_tunnel.is_none() {
            "tunnel is detached"
        } else {
            "tunnel exists"
        }
    );
    let Some(proxy_nn) = this.proxy_tunnel.as_ref().map(|p| p.data) else {
        return;
    };
    let proxy_ptr = proxy_nn.as_ptr();
    {
        let rc = ProxyTunnel::ref_count_of(proxy_nn);
        rc.set(rc.get() + 1);
    }

    // If a response is in progress, mirror HTTPClient.onClose semantics:
    // treat connection close as end-of-body for identity transfer when no content-length.
    let in_progress = this.state.stage != Stage::Done
        && this.state.stage != Stage::Fail
        && !this.state.flags.is_redirect_pending;
    if in_progress {
        if this.state.is_chunked_encoding() {
            // 4 = CHUNKED_IN_TRAILERS_LINE_HEAD, 5 = CHUNKED_IN_TRAILERS_LINE_MIDDLE
            // (`phr_chunked_decoder._state` is a raw `c_char`.)
            match this.state.chunked_decoder._state {
                4 | 5 => {
                    this.state.flags.received_last_chunk = true;
                    // `this` dead (NLL); reborrow via `client_from_ctx` inside.
                    progress_update_for_proxy_socket(ctx, proxy_nn);
                    // Drop our temporary ref asynchronously to avoid freeing within callback
                    crate::http_thread().schedule_proxy_deref(proxy_ptr);
                    return;
                }
                _ => {}
            }
        } else if this.state.content_length.is_none()
            && this.state.response_stage == HTTPStage::Body
        {
            this.state.flags.received_last_chunk = true;
            // `this` dead (NLL); reborrow via `client_from_ctx` inside.
            progress_update_for_proxy_socket(ctx, proxy_nn);
            // Balance the ref we took asynchronously
            crate::http_thread().schedule_proxy_deref(proxy_ptr);
            return;
        }
    }

    // Otherwise, treat as failure.
    let err = ProxyTunnel::shutdown_err_of(proxy_nn).get();
    match ProxyTunnel::socket_of(proxy_nn) {
        &Socket::Ssl(socket) => {
            this.close_and_fail::<true>(err, socket);
        }
        &Socket::Tcp(socket) => {
            this.close_and_fail::<false>(err, socket);
        }
        Socket::None => {}
    }
    ProxyTunnel::set_socket(proxy_nn, Socket::None);
    // Deref after returning to the event loop to avoid lifetime hazards.
    crate::http_thread().schedule_proxy_deref(proxy_ptr);
}

/// `ctx` and `proxy` must be live. Caller must not hold `&mut HTTPClient` or
/// `&mut ProxyTunnel` across this call (they are reborrowed inside via the
/// module's `client_from_ctx` invariant — see ALIASING NOTE above).
fn progress_update_for_proxy_socket(ctx: *mut HTTPClient, proxy: NonNull<ProxyTunnel>) {
    match ProxyTunnel::socket_of(proxy) {
        &Socket::Ssl(socket) => {
            let hctx = &raw mut crate::http_thread().https_context;
            client_from_ctx(ctx).progress_update::<true>(hctx, socket);
        }
        &Socket::Tcp(socket) => {
            let hctx = &raw mut crate::http_thread().http_context;
            client_from_ctx(ctx).progress_update::<false>(hctx, socket);
        }
        Socket::None => {}
    }
}

// ─── ProxyTunnel methods ─────────────────────────────────────────────────────

impl ProxyTunnel {
    pub fn start<const IS_SSL: bool>(
        this: &mut HTTPClient,
        socket: HTTPSocket<IS_SSL>,
        ssl_options: &SSLConfig,
        start_payload: &[u8],
    ) {
        let proxy_tunnel = bun_core::heap::into_raw(Box::new(ProxyTunnel::default()));
        let proxy_nn = NonNull::new(proxy_tunnel).expect("heap::into_raw is non-null");
        // Just allocated, sole owner — route through the module accessor.
        let proxy_tunnel_ref = raw_as_mut(proxy_tunnel);

        // We always request the cert so we can verify it and also we manually abort the connection if the hostname doesn't match
        let custom_options = ssl_options.as_usockets_for_client_verification();
        match ProxyTunnelWrapper::init_from_options(
            &custom_options,
            true,
            SSLWrapperHandlers {
                on_open,
                on_data,
                on_handshake,
                on_close,
                write: write_encrypted,
                ctx: this.as_erased_ptr().as_ptr(),
            },
        ) {
            Ok(w) => proxy_tunnel_ref.wrapper = Some(w),
            Err(e) => {
                if e == InitError::OutOfMemory {
                    bun_core::out_of_memory();
                }

                // invalid TLS Options
                proxy_tunnel_ref.detach_and_deref();
                this.close_and_fail::<IS_SSL>(err!(ConnectionRefused), socket);
                return;
            }
        }
        // Move the sole strong ref (refcount == 1 from `ProxyTunnel::default`)
        // into the client field; no bump (matches the bare `this.proxy_tunnel =
        // tunnel` in http.zig — Zig's `RefPtr.create` returns the owned ref).
        // SAFETY: `proxy_nn` is the fresh `heap::into_raw` allocation above with
        // `ref_count == 1`; `adopt_ref` takes ownership of that sole +1.
        this.proxy_tunnel = Some(unsafe { RefPtr::adopt_ref(proxy_nn.as_ptr()) });
        proxy_tunnel_ref.socket = Socket::from_generic::<IS_SSL>(socket);
        let wrapper = ProxyTunnel::wrapper_mut(proxy_tunnel).unwrap();
        if !start_payload.is_empty() {
            scoped_log!(http_proxy_tunnel, "proxy tunnel start with payload");
            wrapper.start_with_payload(start_payload);
        } else {
            scoped_log!(http_proxy_tunnel, "proxy tunnel start");
            wrapper.start();
        }
    }

    pub fn close(&mut self, err: Error) {
        // `&mut self` was derived from the heap::alloc pointer; the receiver is
        // never used again after this line so the raw call's disjoint field
        // projections do not alias it.
        Self::close_raw(NonNull::from(&mut *self), err);
    }

    pub fn close_raw(this: NonNull<Self>, err: Error) {
        // `shutdown_err` is a `Cell<Error>` disjoint from `wrapper`; safe set.
        Self::shutdown_err_of(this).set(err);
        if let Some(wrapper) = ProxyTunnel::wrapper_mut(this.as_ptr()) {
            // fast shutdown the connection
            let _ = wrapper.shutdown(true);
        }
    }

    pub fn shutdown(&mut self) {
        if let Some(wrapper) = &mut self.wrapper {
            // fast shutdown the connection
            let _ = wrapper.shutdown(true);
        }
    }

    pub fn on_writable<const IS_SSL: bool>(&mut self, socket: HTTPSocket<IS_SSL>) {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onWritable");
        let self_nn = NonNull::from(&mut *self);
        let self_ptr = self_nn.as_ptr();
        let _guard = Self::ref_scope(self_nn);
        {
            let write_buffer = ProxyTunnel::write_buffer_of(self_nn);
            let encoded_data = write_buffer.slice();
            if !encoded_data.is_empty() {
                let written = socket.write(encoded_data);
                let written = usize::try_from(written).expect("int cast");
                if written == encoded_data.len() {
                    write_buffer.reset();
                } else {
                    write_buffer.cursor += written;
                }
            }
        } // drop &mut write_buffer before flush() reborrows it inside write_encrypted
        // Refcount > 0 until _guard drops. The reentrant write_encrypted
        // touches only `write_buffer`/`socket` via accessors, disjoint from
        // the `&mut wrapper` returned by `wrapper_mut`.
        if let Some(wrapper) = ProxyTunnel::wrapper_mut(self_ptr) {
            // Cycle to through the SSL state machine
            let _ = wrapper.flush();
        }
        // _guard derefs here (Zig LIFO `defer deref()`).
    }

    pub fn receive(&mut self, buf: &[u8]) {
        // Capture raw pointer first; never touch `self` again (see on_writable).
        let self_nn = NonNull::from(&mut *self);
        let _guard = Self::ref_scope(self_nn);
        if let Some(wrapper) = ProxyTunnel::wrapper_mut(self_nn.as_ptr()) {
            wrapper.receive_data(buf);
        }
        // _guard derefs here (Zig LIFO `defer deref()`); `self_ptr` provenance
        // intact because `self` was never reborrowed after capture.
    }

    pub fn write(&mut self, buf: &[u8]) -> Result<usize, Error> {
        if let Some(wrapper) = &mut self.wrapper {
            return wrapper.write_data(buf).map_err(|e| match e {
                WriteDataError::ConnectionClosed => err!(ConnectionClosed),
                WriteDataError::WantRead => err!(WantRead),
                WriteDataError::WantWrite => err!(WantWrite),
            });
        }
        Err(err!(ConnectionClosed))
    }

    #[inline]
    pub fn detach_socket(&mut self) {
        self.socket = Socket::None;
    }

    pub fn detach_and_deref(&mut self) {
        // Zig: detachSocket() BEFORE deref() — if refcount > 1 the tunnel
        // outlives this call and must not retain a dangling socket handle.
        self.detach_socket();
        // SAFETY: `&mut self` was derived (transitively) from the `heap::alloc`
        // pointer in `start`/`adopt`; coercing it back to `*mut` preserves write
        // provenance for the dealloc path.
        unsafe { ProxyTunnel::deref(self) };
    }

    pub fn detach_owner(&mut self, client: &HTTPClient) {
        self.socket = Socket::None;
        // Capture the handshaking-error flag from the client — this is a property
        // of the inner TLS session, not the client. adopt() restores it to the
        // next client so re-pooling doesn't erase it.
        self.did_have_handshaking_error = client.flags.did_have_handshaking_error;
        self.established_with_reject_unauthorized =
            self.established_with_reject_unauthorized || client.flags.reject_unauthorized;
        // We intentionally leave wrapper.handlers.ctx stale here. The tunnel is
        // idle in the pool and no callbacks will fire until adopt() reattaches
        // a new owner and socket.
    }

    pub fn adopt<const IS_SSL: bool>(
        &mut self,
        client: &mut HTTPClient,
        socket: HTTPSocket<IS_SSL>,
    ) {
        scoped_log!(
            http_proxy_tunnel,
            "ProxyTunnel adopt (reusing pooled tunnel)"
        );
        self.write_buffer.reset();
        if let Some(wrapper) = &mut self.wrapper {
            wrapper.handlers.ctx = client.as_erased_ptr().as_ptr();
        }
        self.socket = Socket::from_generic::<IS_SSL>(socket);
        // SAFETY: `self` was created by `start` (heap::alloc) and is live; we
        // transfer the pool's strong ref to the client WITHOUT bumping it
        // (`from_raw` == `take_ref`), matching `existingSocket` in
        // HTTPContext.zig which moves the parked ref into the new client.
        client.proxy_tunnel = Some(unsafe { RefPtr::from_raw(core::ptr::from_mut(&mut *self)) });
        client.flags.proxy_tunneling = false;
        // Restore the cert-error flag captured in detachOwner() — no handshake
        // runs here, so the client's own flag would otherwise stay false and
        // re-pooling would erase the record.
        client.flags.did_have_handshaking_error = self.did_have_handshaking_error;
        client.state.request_stage = HTTPStage::ProxyHeaders;
        client.state.response_stage = HTTPStage::ProxyHeaders;
        client.state.request_sent_len = 0;
    }
}

// ported from: src/http/ProxyTunnel.zig
