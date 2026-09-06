use core::cell::Cell;
use core::ptr::{NonNull, addr_of, addr_of_mut};
use core::sync::atomic::Ordering;

use crate::Error;
use bun_core::scoped_log;
use bun_ptr::RefPtr;
use bun_uws as uws;

use crate::http_cert_error::HTTPCertError;
use crate::http_context::{HTTPSocket, PeerVerification};
use crate::internal_state::{HTTPStage, Stage};
use crate::ssl_config::SSLConfig;
use crate::ssl_wrapper::{Handlers as SSLWrapperHandlers, InitError, SSLWrapper, WriteDataError};
use crate::{AlpnOffer, HTTPClient};

bun_core::declare_scope!(http_proxy_tunnel, visible);

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

/// active socket is the socket that is currently being used
// `HTTPSocket<B>` = `uws::SocketHandler<B>` = `NewSocketHandler<B>`, so the
// canonical 3-arm enum lives in `bun_uws` next to its payload type.
pub use bun_uws::MaybeAnySocket as Socket;

#[derive(bun_ptr::CellRefCounted)]
pub struct ProxyTunnel {
    pub(crate) wrapper: Option<ProxyTunnelWrapper>,
    pub(crate) shutdown_err: Cell<Error>,
    /// active socket is the socket that is currently being used
    pub(crate) socket: Socket,
    pub(crate) write_buffer: bun_io::StreamBuffer,
    /// Property of the inner TLS session, not the owning client. Captured from
    /// the client in detachOwner() and restored to the next client in adopt()
    /// so the pool's did_have_handshaking_error_while_reject_unauthorized_is_false
    /// flag survives across reuse — otherwise a reject_unauthorized=false reuse
    /// would re-pool with the flag erased, letting a later reject_unauthorized=true
    /// request silently reuse a tunnel whose cert failed validation.
    pub(crate) did_have_handshaking_error: bool,
    /// How the inner TLS peer was authenticated. A CA-valid but wrong-hostname
    /// cert produces error_no=0 so did_have_handshaking_error stays false;
    /// without this, a strict caller could reuse a tunnel where the hostname
    /// was never checked natively.
    pub(crate) verification: PeerVerification,
    pub(crate) ref_count: Cell<u32>,
}

impl Default for ProxyTunnel {
    fn default() -> Self {
        Self {
            wrapper: None,
            shutdown_err: Cell::new(crate::Error::ConnectionClosed),
            socket: Socket::None,
            write_buffer: bun_io::StreamBuffer::default(),
            did_have_handshaking_error: false,
            verification: PeerVerification::None,
            ref_count: Cell::new(1),
        }
    }
}

impl Drop for ProxyTunnel {
    fn drop(&mut self) {
        // `wrapper` / `write_buffer` are handled by their own Drop impls;
        // just clear the socket tag.
        self.socket = Socket::None;
    }
}

// ─── intrusive refcount: derived via #[derive(CellRefCounted)] above ─────────

// ─── raw-pointer field accessors ─────────────────────────────────────────────
//
// Centralise the `addr_of!((*ptr).field)` projections used by every SSLWrapper
// callback. Each accessor projects ONE field disjoint from `wrapper` (the field
// the in-flight `&SSLWrapper` overlaps), so the returned borrow does not
// alias the caller. See the ALIASING NOTE below for the full invariant.
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

    /// Callback-safe close: sets `shutdown_err` then drives `wrapper.shutdown()`.
    /// Takes `NonNull<Self>` so the SSLWrapper close callback (which reenters
    /// `on_close` and reborrows tunnel fields via the disjoint accessors above)
    /// does not alias a held `&mut ProxyTunnel`.
    ///
    /// Module-level INVARIANT: `this` is a live intrusive-refcounted tunnel and
    /// the caller's `&mut HTTPClient`/`&mut ProxyTunnel` borrows are NLL-dead
    /// before this call (every callsite in this module follows that shape).
    #[inline]
    fn close_from_callback(this: NonNull<Self>, err: Error) {
        Self::close_raw(this, err);
    }

    #[inline]
    fn wrapper_ssl(this: NonNull<Self>) -> Option<NonNull<bun_boringssl_sys::SSL>> {
        Self::wrapper_ref(this.as_ptr()).and_then(|w| w.ssl.get())
    }

    /// INVARIANT (module): `this` is a live intrusive-refcounted tunnel and
    /// no `&mut ProxyTunnel` (whole-struct) is held across the call.
    #[inline]
    fn wrapper_ref<'a>(this: *const Self) -> Option<&'a ProxyTunnelWrapper> {
        // SAFETY: see INVARIANT above. Projects only the `wrapper` field; no
        // intermediate `&Self` is formed.
        unsafe { (*addr_of!((*this).wrapper)).as_ref() }
    }

    /// Bump the intrusive refcount and return a guard that releases it on Drop.
    ///
    /// INVARIANT (module): `this` is the `HTTPClient.proxy_tunnel` handle's
    /// pointer (the callbacks read it from the client; `on_writable` /
    /// `receive` are passed it), so the tunnel is live and the guard's
    /// eventual release, which is the last one whenever the guarded call
    /// released the client's ref, goes through the holder's own pointer
    /// rather than through a `&mut self` that would still be live at that
    /// point. `RefPtr::init_ref` bumps via raw `CellRefCounted::ref_count_raw`
    /// field projection — touching only `ref_count`, never the whole tunnel —
    /// so it does not alias the caller's `&SSLWrapper` (see ALIASING NOTE).
    /// HTTP-thread-only.
    #[inline]
    fn ref_guard(this: NonNull<Self>) -> RefPtr<Self> {
        // SAFETY: see INVARIANT above.
        unsafe { RefPtr::init_ref(this.as_ptr()) }
    }
}

/// Recover `&mut HTTPClient` from the SSLWrapper-handlers `ctx` pointer.
///
/// INVARIANT (module): every SSLWrapper callback (`on_open`/`on_data`/
/// `on_handshake`/`on_close`) receives `handlers.ctx` set to the live
/// `*mut HTTPClient` registered in [`ProxyTunnel::start`]/`adopt`. The client
/// is embedded in its `AsyncHTTP` and outlives the tunnel. Each callback's
/// outer `&mut HTTPClient` must be NLL-dead before any reentrant call that
/// re-derives it via raw ptr (`close_from_callback`, `progress_update_*`,
/// `on_writable`); call sites are shaped accordingly.
#[inline]
fn client_from_ctx<'a, 'c>(ctx: *mut HTTPClient<'c>) -> &'a mut HTTPClient<'c> {
    // SAFETY: see INVARIANT above.
    unsafe { &mut *ctx }
}

// ─── SSLWrapper callbacks (ctx = *mut HTTPClient) ────────────────────────────
//
// ALIASING NOTE: every callback below is invoked *synchronously from inside* an
// SSLWrapper method whose `&self` receiver IS `(*proxy_tunnel).wrapper`.
// Forming `&mut ProxyTunnel` here would create a unique borrow of memory that
// overlaps the caller's `&SSLWrapper` — UB under Stacked Borrows. Callbacks
// therefore never materialise `&mut ProxyTunnel`; they access individual
// fields through raw `addr_of!`/`addr_of_mut!` projections so each borrow
// covers only memory disjoint from `wrapper`.

fn on_open(ctx: *mut HTTPClient) {
    // HTTPClient owns ProxyTunnel only by `NonNull` pointer, so the borrow
    // here does not overlap the caller's `&SSLWrapper`.
    let this = client_from_ctx(ctx);
    scoped_log!(http_proxy_tunnel, "ProxyTunnel onOpen");
    bun_analytics::features::http_client_proxy.fetch_add(1, Ordering::Relaxed);
    this.state.response_stage = HTTPStage::ProxyHandshake;
    this.state.request_stage = HTTPStage::ProxyHandshake;
    let Some(proxy_nn) = this.proxy_tunnel_ptr() else {
        return;
    };
    // Live intrusive-refcounted tunnel allocated in `start()`. Do NOT form
    // `&mut ProxyTunnel` — see ALIASING NOTE.
    let _guard = ProxyTunnel::ref_guard(proxy_nn);
    if let Some(ssl_ptr) = ProxyTunnel::wrapper_ssl(proxy_nn) {
        let _hostname = crate::get_tls_hostname(this, false);

        // SAFETY: `ssl_ptr` is the live SSL handle from the tunnel's SSLWrapper.
        let ssl = unsafe { &mut *ssl_ptr.as_ptr() };
        if bun_core::ip_address::is_ip_address(_hostname) {
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
    // `&SSLWrapper` (HTTPClient holds the tunnel only by pointer). NLL
    // ends this borrow before any reentrant call below that re-derives
    // `&mut *ctx` (close → on_close, progress_update).
    let this = client_from_ctx(ctx);
    let Some(proxy_nn) = this.proxy_tunnel_ptr() else {
        return;
    };
    let _guard = ProxyTunnel::ref_guard(proxy_nn);
    // While parked waiting for the JS `checkServerIdentity` verdict no request
    // has been written through the tunnel, so any decrypted application data
    // arriving here is unexpected.
    if this.state.flags.is_waiting_for_cert_check {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onData while parked");
        // SAFETY: `this` dead (NLL); reenter via raw ptr.
        ProxyTunnel::close_from_callback(proxy_nn, crate::Error::UnexpectedData);
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
            // `hctx` is the pool the finished tunnel is released into. It must
            // be the context that owns the outer socket (the per-config custom
            // context when `tls` needs one, see `HTTPThread::connect`), which
            // is also the only pool the next request with that config searches.
            match ProxyTunnel::socket_of(proxy_nn) {
                &Socket::Ssl(socket) => {
                    let hctx = this.get_ssl_ctx::<true>();
                    this.handle_on_data_headers::<true>(decoded_data, hctx, socket);
                }
                &Socket::Tcp(socket) => {
                    let hctx = this.get_ssl_ctx::<false>();
                    this.handle_on_data_headers::<false>(decoded_data, hctx, socket);
                }
                Socket::None => {}
            }
        }
        _ => {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onData unexpected data");
            // SAFETY: `this` dead (NLL); reenter via raw ptr.
            ProxyTunnel::close_from_callback(proxy_nn, crate::Error::UnexpectedData);
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
    let Some(proxy_nn) = this.proxy_tunnel_ptr() else {
        return;
    };
    scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake");
    // Do NOT form `&mut ProxyTunnel` (see ALIASING NOTE).
    let _guard = ProxyTunnel::ref_guard(proxy_nn);
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
            // Assert the wrapper is Some, then silently return
            // (no debug_assert) on the ssl-None sub-case.
            debug_assert!(ProxyTunnel::wrapper_ref(proxy_nn.as_ptr()).is_some());
            let Some(ssl_ptr) = ProxyTunnel::wrapper_ssl(proxy_nn) else {
                return;
            };

            // SAFETY: `ssl_ptr` is the live SSL handle from the tunnel's
            // SSLWrapper for the open inner TLS connection (NonNull invariant).
            let ssl = unsafe { &mut *ssl_ptr.as_ptr() };
            match ProxyTunnel::socket_of(proxy_nn) {
                &Socket::Ssl(socket) => {
                    if !this.check_server_identity::<true>(socket, ssl, false) {
                        scoped_log!(
                            http_proxy_tunnel,
                            "ProxyTunnel onHandshake checkServerIdentity failed"
                        );
                        // checkServerIdentity already called closeAndFail()
                        // → fail() → result callback, which may have
                        // destroyed the AsyncHTTP that embeds `this`. Do not
                        // touch `this` after a `false` return.
                        return;
                    }
                }
                &Socket::Tcp(socket) => {
                    if !this.check_server_identity::<false>(socket, ssl, false) {
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

        // `this.on_writable` may reach ProxyTunnel::on_writable → flush() →
        // write_encrypted, which reborrows the tunnel via raw ptr. Read the
        // socket out first, then let `this` (NLL) end before the call so the
        // reentrant `&mut *ctx` inside write_encrypted does not alias.
        // `client_from_ctx` re-derives the fresh sole `&mut HTTPClient`.
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
        ProxyTunnel::close_from_callback(proxy_nn, crate::Error::ConnectionRefused);
        return;
    }
}

pub(crate) fn write_encrypted(ctx: *mut HTTPClient, encoded_data: &[u8]) {
    // write_encrypted is fired from inside SSLWrapper::flush/handle_traffic;
    // the call chains that reach here (e.g. on_handshake → on_writable → flush,
    // on_open → flush) each NLL-end their `client_from_ctx`/`*ctx` borrow
    // before reentering, so there is NO live `&mut HTTPClient` anywhere up the
    // stack — re-deriving via the centralised `client_from_ctx` accessor here
    // is the sole live borrow, dropped immediately after copying out the
    // tunnel pointer. The pointee is alive: this client holds a
    // strong ref to the tunnel for the duration of tunneling.
    let Some(proxy_nn) = client_from_ctx(ctx).proxy_tunnel_ptr() else {
        return;
    };
    // Live intrusive-refcounted tunnel. Access `write_buffer` and `socket` via
    // disjoint field accessors only — never form `&mut ProxyTunnel`, because
    // the caller (flush/handle_traffic) holds `&SSLWrapper` which IS
    // `(*proxy).wrapper`; a whole-struct `&mut` would overlap it.
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
    // on_close is fired from inside SSLWrapper::shutdown (via close_raw) whose
    // caller may itself be a callback that already held `&mut *ctx`; that
    // outer borrow is required to be NLL-dead before close_raw is invoked
    // (see on_data/on_handshake), so this fresh `&mut` is sole.
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
    let Some(proxy_nn) = this.proxy_tunnel_ptr() else {
        return;
    };
    // Keeps the tunnel alive across this callback; released on the next
    // loop tick via `schedule_proxy_deref` to avoid freeing within the callback.
    let keepalive = ProxyTunnel::ref_guard(proxy_nn);

    // If a response is in progress, mirror HTTPClient.onClose semantics:
    // treat connection close as end-of-body for identity transfer when no content-length.
    let in_progress = this.state.stage != Stage::Done
        && this.state.stage != Stage::Fail
        && !this.state.flags.is_redirect_pending;
    let mut fail_err: Option<crate::Error> = None;
    if in_progress && this.state.is_body_complete_on_close() {
        match this.state.finalize_body_on_eof() {
            Ok(()) => {
                // `this` dead (NLL); reborrow via `client_from_ctx` inside.
                progress_update_for_proxy_socket(ctx, proxy_nn);
                crate::http_thread().schedule_proxy_deref(keepalive);
                return;
            }
            Err(e) => fail_err = Some(e),
        }
    }

    // Otherwise, treat as failure. `close_and_fail` de-tags the outer socket
    // before `fail()` frees the AsyncHTTP that embeds `self` (the uSockets ext
    // still points here until then).
    let err = fail_err.unwrap_or_else(|| ProxyTunnel::shutdown_err_of(proxy_nn).get());
    match ProxyTunnel::socket_of(proxy_nn) {
        &Socket::Ssl(socket) => {
            this.close_and_fail::<true>(err, socket);
        }
        &Socket::Tcp(socket) => {
            this.close_and_fail::<false>(err, socket);
        }
        Socket::None => {
            if fail_err.is_some() {
                this.fail(err);
            }
        }
    }
    ProxyTunnel::set_socket(proxy_nn, Socket::None);
    crate::http_thread().schedule_proxy_deref(keepalive);
}

/// `ctx` and `proxy` must be live. Caller must not hold `&mut HTTPClient` or
/// `&mut ProxyTunnel` across this call (they are reborrowed inside via the
/// module's `client_from_ctx` invariant — see ALIASING NOTE above).
fn progress_update_for_proxy_socket(ctx: *mut HTTPClient, proxy: NonNull<ProxyTunnel>) {
    // Same context rule as the ProxyHeaders arm of `on_data`: the tunnel is
    // pooled into whichever context `progress_update` is handed.
    match ProxyTunnel::socket_of(proxy) {
        &Socket::Ssl(socket) => {
            let client = client_from_ctx(ctx);
            let hctx = client.get_ssl_ctx::<true>();
            client.progress_update::<true>(hctx, socket);
        }
        &Socket::Tcp(socket) => {
            let client = client_from_ctx(ctx);
            let hctx = client.get_ssl_ctx::<false>();
            client.progress_update::<false>(hctx, socket);
        }
        Socket::None => {}
    }
}

// ─── ProxyTunnel methods ─────────────────────────────────────────────────────

impl ProxyTunnel {
    pub(crate) fn start<const IS_SSL: bool>(
        this: &mut HTTPClient,
        socket: HTTPSocket<IS_SSL>,
        ssl_options: &SSLConfig,
        start_payload: &[u8],
    ) {
        // We always request the cert so we can verify it and also we manually abort the connection if the hostname doesn't match
        let custom_options = ssl_options.as_usockets_for_client_verification();
        let wrapper = match ProxyTunnelWrapper::init_from_options(
            &custom_options,
            true,
            SSLWrapperHandlers {
                on_open,
                on_data,
                on_handshake,
                on_close,
                write: write_encrypted,
                // fetch's proxy tunnel surfaces no 'session'/'keylog' events;
                // opting out keeps its SSL off the parked queues entirely.
                on_session: None,
                on_keylog: None,
                ctx: this.as_erased_ptr().as_ptr(),
            },
        ) {
            Ok(w) => w,
            Err(e) => {
                if e == InitError::OutOfMemory {
                    bun_core::out_of_memory();
                }

                // invalid TLS Options
                this.close_and_fail::<IS_SSL>(crate::Error::ConnectionRefused, socket);
                return;
            }
        };
        // `RefPtr::new` owns the tunnel's initial ref (`ref_count == 1` from
        // `Default`); the client holds it until `close_proxy_tunnel` or the
        // hand-off to the keep-alive pool.
        let mut tunnel = ProxyTunnel::default();
        tunnel.wrapper = Some(wrapper);
        tunnel.socket = Socket::from_generic::<IS_SSL>(socket);
        let proxy_tunnel = RefPtr::new(tunnel);
        let proxy_ptr = proxy_tunnel.as_ptr();
        this.proxy_tunnel = Some(proxy_tunnel);
        // `this` is not used below: start() synchronously fires on_open() /
        // write_encrypted(), which re-derive `&mut HTTPClient` from the raw ctx
        // pointer and touch only tunnel fields disjoint from `wrapper` via
        // `addr_of!` (see ALIASING NOTE), so the `&SSLWrapper` formed here is
        // never aliased by a `&mut`.
        let wrapper = ProxyTunnel::wrapper_ref(proxy_ptr).unwrap();
        if !start_payload.is_empty() {
            scoped_log!(http_proxy_tunnel, "proxy tunnel start with payload");
            wrapper.start_with_payload(start_payload);
        } else {
            scoped_log!(http_proxy_tunnel, "proxy tunnel start");
            wrapper.start();
        }
    }

    /// Raw-pointer close: sets `shutdown_err` then drives `wrapper.shutdown()`.
    /// Takes `NonNull<Self>` so the SSLWrapper close callback (which reenters
    /// on_close and reborrows tunnel fields via raw projection) does not alias
    /// a held `&mut ProxyTunnel`.
    ///
    /// All field access goes through the disjoint-field accessors
    /// ([`Self::shutdown_err_of`], [`Self::wrapper_ref`]), which already
    /// encode the module INVARIANT that `this` is a live intrusive-refcounted
    /// tunnel and no whole-struct `&mut ProxyTunnel` is held across the call.
    /// Callers satisfy that by construction (see [`Self::close_from_callback`]).
    pub(crate) fn close_raw(this: NonNull<Self>, err: Error) {
        // `shutdown_err` is a `Cell<Error>` disjoint from `wrapper`; safe set.
        Self::shutdown_err_of(this).set(err);
        // shutdown() fires on_close synchronously, which accesses only
        // disjoint tunnel fields via `addr_of!` (see on_close), so the
        // `&SSLWrapper` from `wrapper_ref` is never aliased by a `&mut`
        // across the reentrant call.
        if let Some(wrapper) = ProxyTunnel::wrapper_ref(this.as_ptr()) {
            // fast shutdown the connection
            let _ = wrapper.shutdown(true);
        }
    }

    pub(crate) fn shutdown(this: NonNull<Self>) {
        // SAFETY: module INVARIANT — `this` is a live intrusive-refcounted
        // tunnel and the caller's `&mut` borrows are NLL-dead before this call.
        if let Some(wrapper) = unsafe { &*addr_of!((*this.as_ptr()).wrapper) } {
            // fast shutdown the connection
            let _ = wrapper.shutdown(true);
        }
    }

    /// Outer socket became writable. `this` is the client's `proxy_tunnel`
    /// handle (see [`Self::ref_guard`]): the flush below can complete or fail
    /// the request, which releases that handle, leaving the guard's ref as the
    /// last one. A `&mut self` receiver would then be freed while still live.
    pub(crate) fn on_writable<const IS_SSL: bool>(this: NonNull<Self>, socket: HTTPSocket<IS_SSL>) {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onWritable");
        let _guard = Self::ref_guard(this);
        // flush() must run AFTER the body but BEFORE the guard's deref; that
        // order is written out explicitly at the single exit below.
        // flush() → handle_traffic → write_encrypted reenters and touches
        // `write_buffer`/`socket` via raw projection; we must not hold a
        // `&mut ProxyTunnel` (or any borrow overlapping those fields) across it.
        {
            let write_buffer = ProxyTunnel::write_buffer_of(this);
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
        // the `&wrapper` returned by `wrapper_ref`.
        if let Some(wrapper) = ProxyTunnel::wrapper_ref(this.as_ptr()) {
            // Cycle to through the SSL state machine
            let _ = wrapper.flush();
        }
        // _guard derefs here.
    }

    /// Encrypted bytes arrived on the outer socket. Same contract as
    /// [`Self::on_writable`]: delivering the decrypted data can release the
    /// client's handle, so the guard taken from it may hold the last ref.
    pub(crate) fn receive(this: NonNull<Self>, buf: &[u8]) {
        let _guard = Self::ref_guard(this);
        // receive_data() fires on_data/on_handshake/write_encrypted/on_close
        // synchronously; each accesses only tunnel fields disjoint from
        // `wrapper` via the accessors above (see ALIASING NOTE), so the
        // `&SSLWrapper` from `wrapper_ref` is never aliased by a `&mut`
        // across those reentrant calls.
        if let Some(wrapper) = ProxyTunnel::wrapper_ref(this.as_ptr()) {
            wrapper.receive_data(buf);
        }
        // _guard derefs here.
    }

    pub(crate) fn write(&mut self, buf: &[u8]) -> Result<usize, Error> {
        if let Some(wrapper) = &self.wrapper {
            return wrapper.write_data(buf).map_err(|e| match e {
                WriteDataError::ConnectionClosed => crate::Error::ConnectionClosed,
                WriteDataError::WantRead => crate::Error::WantRead,
                WriteDataError::WantWrite => crate::Error::WantWrite,
            });
        }
        Err(crate::Error::ConnectionClosed)
    }

    /// Forget the outer socket. Holders call this before dropping their
    /// `RefPtr`, so a tunnel that outlives them (a deferred `on_close` deref
    /// is still pending) never retains a dangling socket.
    #[inline]
    pub(crate) fn detach_socket(&mut self) {
        self.socket = Socket::None;
    }

    /// Detach the tunnel from its current HTTPClient owner so it can be safely
    /// pooled for keepalive. The inner TLS session is preserved. The tunnel's
    /// refcount is NOT changed — the caller must ensure the ref is transferred
    /// to the pool (or dereffed on failure to pool).
    pub(crate) fn detach_owner(&mut self, client: &HTTPClient) {
        self.socket = Socket::None;
        // Capture the handshaking-error flag from the client — this is a property
        // of the inner TLS session, not the client. adopt() restores it to the
        // next client so re-pooling doesn't erase it.
        self.did_have_handshaking_error = client.flags.did_have_handshaking_error;
        // max semantics — a lax client is allowed to reuse a strict tunnel (the
        // existingSocket guard only blocks the reverse). When that lax client
        // detaches, it must not downgrade a hostname-verified TLS session.
        self.verification = self.verification.max(client.target_verification());
        // We intentionally leave wrapper.handlers.ctx stale here. The tunnel is
        // idle in the pool and no callbacks will fire until adopt() reattaches
        // a new owner and socket.
    }

    /// Reattach a pooled tunnel to a new HTTPClient and socket. The TLS session
    /// is reused as-is — no CONNECT and no new TLS handshake. The client's
    /// request/response stage is set to .proxy_headers so the next onWritable
    /// writes the HTTP request directly into the tunnel.
    ///
    /// `tunnel` is the pool's handle; it moves into `client.proxy_tunnel` as
    /// is, so the ref the client later releases is the one the pool held.
    pub(crate) fn adopt<const IS_SSL: bool>(
        tunnel: RefPtr<ProxyTunnel>,
        client: &mut HTTPClient,
        socket: HTTPSocket<IS_SSL>,
    ) {
        scoped_log!(
            http_proxy_tunnel,
            "ProxyTunnel adopt (reusing pooled tunnel)"
        );
        // `tunnel` holds the strong ref, so the pointee is live for these
        // writes; nothing re-enters the tunnel until the client's next socket
        // event, after this borrow has ended.
        let this = raw_as_mut(tunnel.as_ptr());
        // Discard any stale encrypted bytes from the previous request. A clean
        // request boundary should leave this empty, but an early server response
        // (e.g. HTTP 413) with Connection: keep-alive before the full body was
        // consumed could leave unsent bytes that would corrupt the next request.
        this.write_buffer.reset();
        if let Some(wrapper) = &this.wrapper {
            let mut handlers = wrapper.handlers.get();
            handlers.ctx = client.as_erased_ptr().as_ptr();
            wrapper.handlers.set(handlers);
        }
        this.socket = Socket::from_generic::<IS_SSL>(socket);
        // Restore the cert-error flag captured in detachOwner() — no handshake
        // runs here, so the client's own flag would otherwise stay false and
        // re-pooling would erase the record.
        client.flags.did_have_handshaking_error = this.did_have_handshaking_error;
        client.proxy_tunnel = Some(tunnel);
        client.flags.proxy_tunneling = false;
        client.state.request_stage = HTTPStage::ProxyHeaders;
        client.state.response_stage = HTTPStage::ProxyHeaders;
        client.state.request_sent_len = 0;
    }
}
