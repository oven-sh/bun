use core::cell::Cell;
use core::ffi::CStr;
use core::ptr::{addr_of, addr_of_mut, NonNull};
use core::sync::atomic::Ordering;

use bun_core::{err, Error, ZStr};
use bun_core::scoped_log;
use bun_uws as uws;

use crate::http_cert_error::HTTPCertError;
use crate::http_context::HTTPSocket;
use crate::internal_state::{HTTPStage, Stage};
use crate::ssl_config::SSLConfig;
use crate::ssl_wrapper::{self, Handlers as SSLWrapperHandlers, InitError, SSLWrapper, WriteDataError};
use crate::{AlpnOffer, GenHttpContext, HTTPClient};

bun_core::declare_scope!(http_proxy_tunnel, visible);

// Intrusive single-thread refcount (bun.ptr.RefCount). `ref_count` field at
// matching offset; deref() hitting 0 calls ProxyTunnel::deinit (mapped to Drop
// + dealloc via IntrusiveRc).
pub type RefPtr = bun_ptr::IntrusiveRc<ProxyTunnel>;

type ProxyTunnelWrapper = SSLWrapper<*mut HTTPClient>;

/// active socket is the socket that is currently being used
// PORT NOTE: Zig used `NewHTTPContext(B).HTTPSocket`; inherent associated types
// are unstable in Rust, so the free `HTTPSocket<SSL>` alias from http_context
// is used instead.
pub enum Socket {
    Tcp(HTTPSocket<false>),
    Ssl(HTTPSocket<true>),
    None,
}

impl Socket {
    /// Convert a const-generic `HTTPSocket<IS_SSL>` to the runtime-tagged enum.
    /// `NewSocketHandler<true>` and `<false>` are layout-identical (`#[derive(Copy)]`
    /// over a single `InternalSocket` field); only the const generic differs.
    #[inline]
    fn from_generic<const IS_SSL: bool>(socket: HTTPSocket<IS_SSL>) -> Self {
        if IS_SSL {
            // SAFETY: `HTTPSocket<IS_SSL>` and `HTTPSocket<true>` are the same
            // type when `IS_SSL == true`; transmute_copy bridges the const-generic.
            Socket::Ssl(unsafe { core::mem::transmute_copy::<HTTPSocket<IS_SSL>, HTTPSocket<true>>(&socket) })
        } else {
            // SAFETY: same as above for the `false` arm.
            Socket::Tcp(unsafe { core::mem::transmute_copy::<HTTPSocket<IS_SSL>, HTTPSocket<false>>(&socket) })
        }
    }
}

pub struct ProxyTunnel {
    pub wrapper: Option<ProxyTunnelWrapper>,
    pub shutdown_err: Error,
    /// active socket is the socket that is currently being used
    pub socket: Socket,
    pub write_buffer: bun_io::StreamBuffer,
    /// Property of the inner TLS session, not the owning client. Captured from
    /// the client in detachOwner() and restored to the next client in adopt()
    /// so the pool's did_have_handshaking_error_while_reject_unauthorized_is_false
    /// flag survives across reuse — otherwise a reject_unauthorized=false reuse
    /// would re-pool with the flag erased, letting a later reject_unauthorized=true
    /// request silently reuse a tunnel whose cert failed validation.
    pub did_have_handshaking_error: bool,
    /// Whether the inner TLS session was established with reject_unauthorized=true
    /// (and therefore hostname-verified via checkServerIdentity). A CA-valid but
    /// wrong-hostname cert produces error_no=0 so did_have_handshaking_error stays
    /// false; without this flag, a strict caller could reuse a tunnel where
    /// hostname was never checked.
    pub established_with_reject_unauthorized: bool,
    pub ref_count: Cell<u32>,
}

impl Default for ProxyTunnel {
    fn default() -> Self {
        Self {
            wrapper: None,
            shutdown_err: err!(ConnectionClosed),
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

// ─── intrusive refcount (bun.ptr.RefCount) ───────────────────────────────────
impl ProxyTunnel {
    #[inline]
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }
    /// # Safety
    /// `this` must point to a live `ProxyTunnel` allocated by `start`/`adopt`
    /// (i.e. originated from `Box::into_raw`). Takes a raw `*mut` so the
    /// `Box::from_raw` on the zero-count path inherits write provenance from
    /// the original allocation — a `&self` receiver here would force a
    /// `*const → *mut` cast, which is UB to deallocate through.
    #[inline]
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract — `this` is live; `ref_count` is a `Cell`
        // so the shared borrow taken by `.get()/.set()` is sound even if other
        // raw aliases exist on this single thread.
        let rc = unsafe { &(*this).ref_count };
        let n = rc.get() - 1;
        rc.set(n);
        if n == 0 {
            // SAFETY: every live ProxyTunnel was created by `start` (Box::into_raw);
            // ref_count hitting 0 means no other alias remains.
            drop(unsafe { Box::from_raw(this) });
        }
    }
}

// ─── SSLWrapper callbacks (ctx = *mut HTTPClient) ────────────────────────────
//
// ALIASING NOTE: every callback below is invoked *synchronously from inside* an
// SSLWrapper method whose `&mut self` receiver IS `(*proxy_tunnel).wrapper`.
// Forming `&mut ProxyTunnel` here would create a second live unique borrow of
// memory that overlaps the caller's `&mut SSLWrapper` — UB under Stacked
// Borrows. Callbacks therefore never materialise `&mut ProxyTunnel`; they
// access individual fields through raw `addr_of!`/`addr_of_mut!` projections so
// each borrow covers only memory disjoint from `wrapper`. The Zig original
// (ProxyTunnel.zig) has no exclusive-alias rule so this was never modelled.

/// Bump the intrusive refcount via a raw field projection so the borrow covers
/// only `ref_count` (a `Cell`), never the whole tunnel — avoids overlapping the
/// caller's live `&mut SSLWrapper`.
#[inline]
unsafe fn ref_raw(proxy: *mut ProxyTunnel) {
    // SAFETY: `proxy` is live; `ref_count` is a `Cell<u32>` so a shared borrow
    // is sound regardless of other raw aliases on this single thread.
    let rc = unsafe { &*addr_of!((*proxy).ref_count) };
    rc.set(rc.get() + 1);
}

fn on_open(ctx: *mut HTTPClient) {
    // SAFETY: ctx was set in `start()` to a live `&mut HTTPClient`; the SSLWrapper
    // never invokes a callback after `detach_and_deref` clears `proxy_tunnel`.
    // HTTPClient owns ProxyTunnel only by `NonNull` pointer, so `&mut *ctx`
    // does not overlap the caller's `&mut SSLWrapper`.
    let this = unsafe { &mut *ctx };
    scoped_log!(http_proxy_tunnel, "ProxyTunnel onOpen");
    bun_analytics::features::http_client_proxy.fetch_add(1, Ordering::Relaxed);
    this.state.response_stage = HTTPStage::ProxyHandshake;
    this.state.request_stage = HTTPStage::ProxyHandshake;
    let Some(proxy_nn) = this.proxy_tunnel else { return };
    // SAFETY: live intrusive-refcounted tunnel allocated in `start()`. Do NOT
    // form `&mut ProxyTunnel` — see ALIASING NOTE. Bump the refcount via raw
    // field projection.
    unsafe { ref_raw(proxy_nn.as_ptr()) };
    let _guard = scopeguard::guard(proxy_nn, |p| {
        // SAFETY: balances the ref_raw above; tunnel still allocated until count hits 0.
        unsafe { ProxyTunnel::deref(p.as_ptr()) };
    });
    // SAFETY: shared read of a Copy field (`ssl: Option<NonNull<SSL>>`) through
    // the raw pointer. The caller's `&mut SSLWrapper` is live on this same
    // memory, but a read-only place access does not assert uniqueness.
    let ssl_opt = unsafe { (*proxy_nn.as_ptr()).wrapper.as_ref().and_then(|w| w.ssl) };
    if let Some(ssl_ptr) = ssl_opt {
        let _hostname = this.hostname.unwrap_or(this.url.hostname);

        // PORT NOTE: Zig `configureHTTPClient` is `configureHTTPClientWithALPN(ssl, host, .h1)`;
        // the Rust port already exposes the ALPN form in `crate::configure_http_client_with_alpn`.
        if bun_string::strings::is_ip_address(_hostname) {
            crate::configure_http_client_with_alpn(ssl_ptr.as_ptr(), core::ptr::null(), AlpnOffer::H1);
        } else {
            // SAFETY: TEMP_HOSTNAME is only accessed from the single HTTP thread.
            let temp_hostname = unsafe { &mut crate::TEMP_HOSTNAME };
            if _hostname.len() < temp_hostname.len() {
                temp_hostname[.._hostname.len()].copy_from_slice(_hostname);
                temp_hostname[_hostname.len()] = 0;
                crate::configure_http_client_with_alpn(
                    ssl_ptr.as_ptr(),
                    temp_hostname.as_ptr().cast(),
                    AlpnOffer::H1,
                );
            } else {
                let mut owned = _hostname.to_vec();
                owned.push(0);
                crate::configure_http_client_with_alpn(
                    ssl_ptr.as_ptr(),
                    owned.as_ptr().cast(),
                    AlpnOffer::H1,
                );
                // owned drops here (was: defer if hostname_needs_free free(hostname))
            }
        }
    }
}

fn on_data(ctx: *mut HTTPClient, decoded_data: &[u8]) {
    if decoded_data.is_empty() {
        return;
    }
    scoped_log!(http_proxy_tunnel, "ProxyTunnel onData decoded {}", decoded_data.len());
    // SAFETY: see on_open. `&mut HTTPClient` is disjoint from the caller's
    // `&mut SSLWrapper` (HTTPClient holds the tunnel only by pointer). NLL
    // ends this borrow before any reentrant call below that re-derives
    // `&mut *ctx` (close → on_close, progress_update).
    let this = unsafe { &mut *ctx };
    let Some(proxy_nn) = this.proxy_tunnel else { return };
    let proxy_ptr = proxy_nn.as_ptr();
    // SAFETY: live intrusive-refcounted tunnel; raw field projection only.
    unsafe { ref_raw(proxy_ptr) };
    let _guard = scopeguard::guard(proxy_nn, |p| {
        // SAFETY: balances the ref_raw above.
        unsafe { ProxyTunnel::deref(p.as_ptr()) };
    });
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
                    unsafe { ProxyTunnel::close_raw(proxy_ptr, err) };
                    return;
                }
            };

            if report_progress {
                // SAFETY: `this` dead; progress_update reborrows via raw ptrs.
                unsafe { progress_update_for_proxy_socket(ctx, proxy_ptr) };
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
                    unsafe { ProxyTunnel::close_raw(proxy_ptr, err) };
                    return;
                }
            };

            if report_progress {
                // SAFETY: see Body arm.
                unsafe { progress_update_for_proxy_socket(ctx, proxy_ptr) };
                return;
            }
        }
        HTTPStage::ProxyHeaders => {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onData proxy_headers");
            // SAFETY: shared borrow of `socket` only — disjoint from `wrapper`.
            match unsafe { &*addr_of!((*proxy_ptr).socket) } {
                &Socket::Ssl(socket) => {
                    let hctx = (&mut crate::http_thread().https_context) as *mut GenHttpContext<true>;
                    this.handle_on_data_headers::<true>(decoded_data, hctx, socket);
                }
                &Socket::Tcp(socket) => {
                    let hctx = (&mut crate::http_thread().http_context) as *mut GenHttpContext<false>;
                    this.handle_on_data_headers::<false>(decoded_data, hctx, socket);
                }
                Socket::None => {}
            }
        }
        _ => {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onData unexpected data");
            this.state.pending_response = None;
            // SAFETY: `this` dead (NLL); reenter via raw ptr.
            unsafe { ProxyTunnel::close_raw(proxy_ptr, err!(UnexpectedData)) };
        }
    }
}

fn on_handshake(ctx: *mut HTTPClient, handshake_success: bool, ssl_error: uws::us_bun_verify_error_t) {
    // SAFETY: see on_open. NLL ends `this` before any reentrant call below.
    let this = unsafe { &mut *ctx };
    let Some(proxy_nn) = this.proxy_tunnel else { return };
    let proxy_ptr = proxy_nn.as_ptr();
    scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake");
    // SAFETY: live intrusive-refcounted tunnel; raw field projection only —
    // do NOT form `&mut ProxyTunnel` (see ALIASING NOTE).
    unsafe { ref_raw(proxy_ptr) };
    let _guard = scopeguard::guard(proxy_nn, |p| {
        // SAFETY: balances the ref_raw above.
        unsafe { ProxyTunnel::deref(p.as_ptr()) };
    });
    this.state.response_stage = HTTPStage::ProxyHeaders;
    this.state.request_stage = HTTPStage::ProxyHeaders;
    this.state.request_sent_len = 0;
    let handshake_error = HTTPCertError {
        error_no: ssl_error.error_no,
        code: if ssl_error.code.is_null() {
            ZStr::EMPTY
        } else {
            // SAFETY: ssl_error.code is a NUL-terminated C string from uSockets.
            unsafe {
                ZStr::from_raw(
                    ssl_error.code.cast::<u8>(),
                    CStr::from_ptr(ssl_error.code).count_bytes(),
                )
            }
        },
        reason: if ssl_error.code.is_null() {
            ZStr::EMPTY
        } else {
            // SAFETY: ssl_error.reason is a NUL-terminated C string from uSockets.
            unsafe {
                ZStr::from_raw(
                    ssl_error.reason.cast::<u8>(),
                    CStr::from_ptr(ssl_error.reason).count_bytes(),
                )
            }
        },
    };
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
                unsafe { ProxyTunnel::close_raw(proxy_ptr, err) };
                return;
            }

            // if checkServerIdentity returns false, we dont call open this means that the connection was rejected
            // SAFETY: shared read of Copy field through raw ptr; caller's
            // `&mut SSLWrapper` is live on this memory but we only read.
            let ssl_opt = unsafe { (*proxy_ptr).wrapper.as_ref().and_then(|w| w.ssl) };
            debug_assert!(unsafe { (*proxy_ptr).wrapper.is_some() });
            let Some(ssl_ptr) = ssl_opt else { return };

            // SAFETY: shared borrow of `socket` only — disjoint from `wrapper`.
            match unsafe { &*addr_of!((*proxy_ptr).socket) } {
                &Socket::Ssl(socket) => {
                    if !this.check_server_identity::<true>(socket, handshake_error, ssl_ptr.as_ptr(), false) {
                        scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake checkServerIdentity failed");
                        // checkServerIdentity already called closeAndFail()
                        // → fail() → result callback, which may have
                        // destroyed the AsyncHTTP that embeds `this`. Do not
                        // touch `this` after a `false` return.
                        return;
                    }
                }
                &Socket::Tcp(socket) => {
                    if !this.check_server_identity::<false>(socket, handshake_error, ssl_ptr.as_ptr(), false) {
                        scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake checkServerIdentity failed");
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
        // SAFETY: shared borrow of `socket` only — disjoint from `wrapper`.
        match unsafe { &*addr_of!((*proxy_ptr).socket) } {
            &Socket::Ssl(socket) => {
                unsafe { (*ctx).on_writable::<true, true>(socket) };
            }
            &Socket::Tcp(socket) => {
                unsafe { (*ctx).on_writable::<true, false>(socket) };
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
            unsafe { ProxyTunnel::close_raw(proxy_ptr, err) };
            return;
        }
        // if handshake_success it self is false, this means that the connection was rejected
        // SAFETY: `this` dead (NLL); reenter via raw ptr.
        unsafe { ProxyTunnel::close_raw(proxy_ptr, err!(ConnectionRefused)) };
        return;
    }
}

pub fn write_encrypted(ctx: *mut HTTPClient, encoded_data: &[u8]) {
    // SAFETY: see on_open. Read `proxy_tunnel` (a Copy `Option<NonNull>`) via
    // raw place so we never hold `&mut HTTPClient` here — write_encrypted is
    // fired from inside SSLWrapper::flush/handle_traffic whose caller may
    // already hold `&mut HTTPClient` (e.g. on_handshake → on_writable).
    let Some(proxy_nn) = (unsafe { (*ctx).proxy_tunnel }) else { return };
    let proxy_ptr = proxy_nn.as_ptr();
    // SAFETY: live intrusive-refcounted tunnel. Access `write_buffer` and
    // `socket` via raw field projection only — never form `&mut ProxyTunnel`,
    // because the caller (flush/handle_traffic) holds `&mut SSLWrapper` which
    // IS `(*proxy_ptr).wrapper`; a whole-struct `&mut` would overlap it.
    let write_buffer = unsafe { &mut *addr_of_mut!((*proxy_ptr).write_buffer) };
    // Preserve TLS record ordering: if any encrypted bytes are buffered,
    // enqueue new bytes and flush them in FIFO via onWritable.
    if write_buffer.is_not_empty() {
        if write_buffer.write(encoded_data).is_err() {
            bun_core::out_of_memory();
        }
        return;
    }
    // SAFETY: shared borrow of `socket` only — disjoint from `wrapper`.
    let written = match unsafe { &*addr_of!((*proxy_ptr).socket) } {
        &Socket::Ssl(socket) => socket.write(encoded_data),
        &Socket::Tcp(socket) => socket.write(encoded_data),
        Socket::None => 0,
    };
    let pending = &encoded_data[usize::try_from(written).unwrap()..];
    if !pending.is_empty() {
        // lets flush when we are truly writable
        if write_buffer.write(pending).is_err() {
            bun_core::out_of_memory();
        }
    }
}

fn on_close(ctx: *mut HTTPClient) {
    // SAFETY: see on_open. on_close is fired from inside SSLWrapper::shutdown
    // (via close_raw) whose caller may itself be a callback that already held
    // `&mut *ctx`; that outer borrow is required to be NLL-dead before close_raw
    // is invoked (see on_data/on_handshake), so this fresh `&mut` is sole.
    let this = unsafe { &mut *ctx };
    scoped_log!(
        http_proxy_tunnel,
        "ProxyTunnel onClose {}",
        if this.proxy_tunnel.is_none() { "tunnel is detached" } else { "tunnel exists" }
    );
    let Some(proxy_nn) = this.proxy_tunnel else { return };
    let proxy_ptr = proxy_nn.as_ptr();
    // SAFETY: live intrusive-refcounted tunnel; raw field projection only —
    // close_raw still holds `&mut SSLWrapper` on `(*proxy_ptr).wrapper`.
    unsafe { ref_raw(proxy_ptr) };

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
                    // SAFETY: `this` dead (NLL); reborrow via raw ptrs.
                    unsafe { progress_update_for_proxy_socket(ctx, proxy_ptr) };
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
            // SAFETY: `this` dead (NLL); reborrow via raw ptrs.
            unsafe { progress_update_for_proxy_socket(ctx, proxy_ptr) };
            // Balance the ref we took asynchronously
            crate::http_thread().schedule_proxy_deref(proxy_ptr);
            return;
        }
    }

    // Otherwise, treat as failure.
    // SAFETY: read Copy field via raw place; disjoint from `wrapper`.
    let err = unsafe { *addr_of!((*proxy_ptr).shutdown_err) };
    // SAFETY: shared borrow of `socket` only — disjoint from `wrapper`.
    match unsafe { &*addr_of!((*proxy_ptr).socket) } {
        &Socket::Ssl(socket) => {
            this.close_and_fail::<true>(err, socket);
        }
        &Socket::Tcp(socket) => {
            this.close_and_fail::<false>(err, socket);
        }
        Socket::None => {}
    }
    // SAFETY: write to `socket` only — disjoint from `wrapper`.
    unsafe { *addr_of_mut!((*proxy_ptr).socket) = Socket::None };
    // Deref after returning to the event loop to avoid lifetime hazards.
    crate::http_thread().schedule_proxy_deref(proxy_ptr);
}

/// # Safety
/// `ctx` and `proxy` must be live. Caller must not hold `&mut HTTPClient` or
/// `&mut ProxyTunnel` across this call (they are reborrowed inside).
unsafe fn progress_update_for_proxy_socket(ctx: *mut HTTPClient, proxy: *mut ProxyTunnel) {
    // SAFETY: shared borrow of `socket` only — disjoint from `wrapper`.
    match unsafe { &*addr_of!((*proxy).socket) } {
        &Socket::Ssl(socket) => {
            let hctx = (&mut crate::http_thread().https_context) as *mut GenHttpContext<true>;
            // SAFETY: caller contract — no live `&mut *ctx`.
            unsafe { (*ctx).progress_update::<true>(hctx, socket) };
        }
        &Socket::Tcp(socket) => {
            let hctx = (&mut crate::http_thread().http_context) as *mut GenHttpContext<false>;
            // SAFETY: caller contract — no live `&mut *ctx`.
            unsafe { (*ctx).progress_update::<false>(hctx, socket) };
        }
        Socket::None => {}
    }
}

// ─── ProxyTunnel methods ─────────────────────────────────────────────────────

impl ProxyTunnel {
    pub fn start<const IS_SSL: bool>(
        this: &mut HTTPClient,
        socket: HTTPSocket<IS_SSL>,
        ssl_options: SSLConfig,
        start_payload: &[u8],
    ) {
        let proxy_tunnel = Box::into_raw(Box::new(ProxyTunnel::default()));
        // SAFETY: just allocated, sole owner.
        let proxy_tunnel_ref = unsafe { &mut *proxy_tunnel };

        // We always request the cert so we can verify it and also we manually abort the connection if the hostname doesn't match
        let custom_options = ssl_options.as_usockets_for_client_verification();
        match SSLWrapper::<*mut HTTPClient>::init_from_options(
            custom_options,
            true,
            SSLWrapperHandlers {
                on_open,
                on_data,
                on_handshake,
                on_close,
                write: write_encrypted,
                ctx: this as *mut HTTPClient,
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
        // SAFETY: proxy_tunnel is a non-null Box::into_raw result.
        this.proxy_tunnel = Some(unsafe { NonNull::new_unchecked(proxy_tunnel) });
        proxy_tunnel_ref.socket = Socket::from_generic::<IS_SSL>(socket);
        // Drop the unique &mut borrows before calling into the SSLWrapper: start()
        // synchronously fires on_open()/write_encrypted(), which re-derive &mut to
        // both `*this` and `*proxy_tunnel` from the raw ctx pointer. Holding
        // `proxy_tunnel_ref` (and `this`) live across that call would alias &mut.
        let _ = proxy_tunnel_ref;
        let _ = this;
        if !start_payload.is_empty() {
            scoped_log!(http_proxy_tunnel, "proxy tunnel start with payload");
            // SAFETY: sole live access; callbacks reborrow via ctx, never concurrently with this line.
            unsafe { (*proxy_tunnel).wrapper.as_mut().unwrap().start_with_payload(start_payload) };
        } else {
            scoped_log!(http_proxy_tunnel, "proxy tunnel start");
            // SAFETY: see above.
            unsafe { (*proxy_tunnel).wrapper.as_mut().unwrap().start() };
        }
    }

    pub fn close(&mut self, err: Error) {
        self.shutdown_err = err;
        self.shutdown();
    }

    /// Raw-pointer entry for `close()` — used from on_data after the prior
    /// `&mut self` borrow is dead, so the fresh `&mut *this` here does not
    /// alias under Stacked Borrows.
    ///
    /// # Safety
    /// `this` must point to a live, exclusively-accessible `ProxyTunnel`.
    pub unsafe fn close_raw(this: *mut Self, err: Error) {
        // SAFETY: caller contract.
        unsafe { (*this).close(err) }
    }

    pub fn shutdown(&mut self) {
        if let Some(wrapper) = &mut self.wrapper {
            // fast shutdown the connection
            let _ = wrapper.shutdown(true);
        }
    }

    pub fn on_writable<const IS_SSL: bool>(&mut self, socket: HTTPSocket<IS_SSL>) {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onWritable");
        self.ref_();
        let self_ptr: *mut Self = self;
        // PORT NOTE: reshaped for borrowck — Zig `defer wrapper.flush()` runs
        // AFTER the body but BEFORE the `defer deref()` (LIFO). We mirror that
        // LIFO order explicitly at every exit instead of via a scopeguard, since
        // a guard's drop would form a fresh `&mut *self_ptr` while the `self`
        // receiver borrow is still live (locals drop before params) — aliased &mut.
        let encoded_data = self.write_buffer.slice();
        if !encoded_data.is_empty() {
            let written = socket.write(encoded_data);
            let written = usize::try_from(written).unwrap();
            if written == encoded_data.len() {
                self.write_buffer.reset();
            } else {
                self.write_buffer.cursor += written;
            }
        }
        // End the receiver borrow before reentering via raw ptr. flush() may call
        // write_encrypted(ctx) which reborrows this tunnel; deref() may free it.
        let _ = self;
        // SAFETY: refcount > 0 until deref() below; sole live access via raw ptr.
        unsafe {
            if let Some(wrapper) = &mut (*self_ptr).wrapper {
                // Cycle to through the SSL state machine
                let _ = wrapper.flush();
            }
            ProxyTunnel::deref(self_ptr);
        }
    }

    pub fn receive(&mut self, buf: &[u8]) {
        self.ref_();
        let self_ptr: *mut Self = self;
        let _guard = scopeguard::guard((), move |_| {
            // SAFETY: balances the ref_ above; tunnel still allocated.
            unsafe { ProxyTunnel::deref(self_ptr) };
        });
        if let Some(wrapper) = &mut self.wrapper {
            wrapper.receive_data(buf);
        }
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
        // SAFETY: `&mut self` was derived (transitively) from the `Box::into_raw`
        // pointer in `start`/`adopt`; coercing it back to `*mut` preserves write
        // provenance for the dealloc path.
        unsafe { ProxyTunnel::deref(self) };
    }

    /// Detach the tunnel from its current HTTPClient owner so it can be safely
    /// pooled for keepalive. The inner TLS session is preserved. The tunnel's
    /// refcount is NOT changed — the caller must ensure the ref is transferred
    /// to the pool (or dereffed on failure to pool).
    pub fn detach_owner(&mut self, client: &HTTPClient) {
        self.socket = Socket::None;
        // Capture the handshaking-error flag from the client — this is a property
        // of the inner TLS session, not the client. adopt() restores it to the
        // next client so re-pooling doesn't erase it.
        self.did_have_handshaking_error = client.flags.did_have_handshaking_error;
        // OR semantics — a lax client is allowed to reuse a strict tunnel (the
        // existingSocket guard only blocks the reverse). When that lax client
        // detaches, it must not downgrade a hostname-verified TLS session to
        // lax-established; once true, stays true.
        self.established_with_reject_unauthorized =
            self.established_with_reject_unauthorized || client.flags.reject_unauthorized;
        // We intentionally leave wrapper.handlers.ctx stale here. The tunnel is
        // idle in the pool and no callbacks will fire until adopt() reattaches
        // a new owner and socket.
    }

    /// Reattach a pooled tunnel to a new HTTPClient and socket. The TLS session
    /// is reused as-is — no CONNECT and no new TLS handshake. The client's
    /// request/response stage is set to .proxy_headers so the next onWritable
    /// writes the HTTP request directly into the tunnel.
    pub fn adopt<const IS_SSL: bool>(
        &mut self,
        client: &mut HTTPClient,
        socket: HTTPSocket<IS_SSL>,
    ) {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel adopt (reusing pooled tunnel)");
        // Discard any stale encrypted bytes from the previous request. A clean
        // request boundary should leave this empty, but an early server response
        // (e.g. HTTP 413) with Connection: keep-alive before the full body was
        // consumed could leave unsent bytes that would corrupt the next request.
        self.write_buffer.reset();
        if let Some(wrapper) = &mut self.wrapper {
            wrapper.handlers.ctx = client as *mut HTTPClient;
        }
        self.socket = Socket::from_generic::<IS_SSL>(socket);
        // SAFETY: `self` was created by `start` (Box::into_raw); we transfer the
        // pool's strong ref to the client by storing the raw pointer here.
        client.proxy_tunnel = Some(unsafe { NonNull::new_unchecked(self as *mut ProxyTunnel) });
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/ProxyTunnel.zig (452 lines)
//   confidence: medium
//   todos:      0
//   notes:      SSLWrapper<*mut HTTPClient> handlers wired to bun_uws::ssl_wrapper;
//               Socket::from_generic transmute_copy bridges const-generic IS_SSL → enum;
//               HTTPClient.proxy_tunnel is Option<NonNull<ProxyTunnel>> (intrusive-rc).
// ──────────────────────────────────────────────────────────────────────────
