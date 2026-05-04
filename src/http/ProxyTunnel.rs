use core::cell::Cell;
use core::ffi::CStr;

use bun_core::{err, Error};
use bun_output::scoped_log;
use bun_str::{strings, ZStr};
use bun_uws as uws;

use crate::http_cert_error::HTTPCertError;
use crate::new_http_context::NewHTTPContext;
use crate::HTTPClient;
// TODO(port): SSLWrapper lives at src/runtime/socket/ssl_wrapper.zig → bun_runtime::socket::ssl_wrapper
use bun_runtime::socket::ssl_wrapper::SSLWrapper;
// TODO(port): jsc.API.ServerConfig.SSLConfig — actual crate path may be bun_runtime::api::server_config
use bun_jsc::api::server_config::SSLConfig;

bun_output::declare_scope!(http_proxy_tunnel, visible);

// Intrusive single-thread refcount (bun.ptr.RefCount). `ref_count` field at
// matching offset; deref() hitting 0 calls ProxyTunnel::deinit (mapped to Drop
// + dealloc via IntrusiveRc).
pub type RefPtr = bun_ptr::IntrusiveRc<ProxyTunnel>;

type ProxyTunnelWrapper = SSLWrapper<*mut HTTPClient>;

/// active socket is the socket that is currently being used
pub enum Socket {
    // TODO(port): inherent associated types are unstable; Phase B may need
    // `type HTTPSocket<const SSL: bool>` alias instead of `NewHTTPContext::<B>::HTTPSocket`.
    Tcp(NewHTTPContext::<false>::HTTPSocket),
    Ssl(NewHTTPContext::<true>::HTTPSocket),
    None,
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
            shutdown_err: err!("ConnectionClosed"),
            socket: Socket::None,
            write_buffer: bun_io::StreamBuffer::default(),
            did_have_handshaking_error: false,
            established_with_reject_unauthorized: false,
            ref_count: Cell::new(1),
        }
    }
}

// ─── SSLWrapper callbacks (ctx = *mut HTTPClient) ────────────────────────────

fn on_open(this: &mut HTTPClient) {
    scoped_log!(http_proxy_tunnel, "ProxyTunnel onOpen");
    // TODO(port): bun.analytics.Features counter API
    bun_analytics::features::HTTP_CLIENT_PROXY.inc();
    this.state.response_stage = .proxy_handshake;
    this.state.request_stage = .proxy_handshake;
    if let Some(proxy) = this.proxy_tunnel {
        proxy.ref_();
        let _guard = scopeguard::guard((), |_| proxy.deref_());
        if let Some(wrapper) = &mut proxy.wrapper {
            let Some(ssl_ptr) = wrapper.ssl else { return };
            let _hostname = this.hostname.as_deref().unwrap_or(this.url.hostname);

            // PORT NOTE: reshaped for borrowck — configure_http_client must be
            // called while the TEMP_HOSTNAME borrow is live (the ZStr slices it).
            if strings::is_ip_address(_hostname) {
                ssl_ptr.configure_http_client(ZStr::EMPTY);
            } else {
                // TODO(port): crate::TEMP_HOSTNAME is a threadlocal/static mut buffer in http.zig
                crate::TEMP_HOSTNAME.with_borrow_mut(|temp_hostname| {
                    let hostname: &ZStr;
                    let _hostname_owned: Box<[u8]>;
                    if _hostname.len() < temp_hostname.len() {
                        temp_hostname[.._hostname.len()].copy_from_slice(_hostname);
                        temp_hostname[_hostname.len()] = 0;
                        // SAFETY: temp_hostname[_hostname.len()] == 0 written above
                        hostname = unsafe { ZStr::from_raw(temp_hostname.as_ptr(), _hostname.len()) };
                    } else {
                        let owned = ZStr::from_bytes(_hostname);
                        // SAFETY: ZStr::from_bytes NUL-terminates; Box backing storage does not move
                        hostname = unsafe { ZStr::from_raw(owned.as_ptr(), _hostname.len()) };
                        _hostname_owned = owned.into_boxed_bytes();
                        // _hostname_owned drops at scope exit (was: defer if hostname_needs_free free(hostname))
                    }
                    ssl_ptr.configure_http_client(hostname);
                });
            }
        }
    }
}

fn on_data(this: &mut HTTPClient, decoded_data: &[u8]) {
    if decoded_data.is_empty() {
        return;
    }
    scoped_log!(http_proxy_tunnel, "ProxyTunnel onData decoded {}", decoded_data.len());
    if let Some(proxy) = this.proxy_tunnel {
        proxy.ref_();
        let _guard = scopeguard::guard((), |_| proxy.deref_());
        match this.state.response_stage {
            ResponseStage::Body => {
                scoped_log!(http_proxy_tunnel, "ProxyTunnel onData body");
                if decoded_data.is_empty() {
                    return;
                }
                let report_progress = match this.handle_response_body(decoded_data, false) {
                    Ok(v) => v,
                    Err(err) => {
                        proxy.close(err);
                        return;
                    }
                };

                if report_progress {
                    match proxy.socket {
                        Socket::Ssl(socket) => {
                            this.progress_update(true, &mut crate::http_thread().https_context, socket);
                        }
                        Socket::Tcp(socket) => {
                            this.progress_update(false, &mut crate::http_thread().http_context, socket);
                        }
                        Socket::None => {}
                    }
                    return;
                }
            }
            ResponseStage::BodyChunk => {
                scoped_log!(http_proxy_tunnel, "ProxyTunnel onData body_chunk");
                if decoded_data.is_empty() {
                    return;
                }
                let report_progress = match this.handle_response_body_chunked_encoding(decoded_data) {
                    Ok(v) => v,
                    Err(err) => {
                        proxy.close(err);
                        return;
                    }
                };

                if report_progress {
                    match proxy.socket {
                        Socket::Ssl(socket) => {
                            this.progress_update(true, &mut crate::http_thread().https_context, socket);
                        }
                        Socket::Tcp(socket) => {
                            this.progress_update(false, &mut crate::http_thread().http_context, socket);
                        }
                        Socket::None => {}
                    }
                    return;
                }
            }
            ResponseStage::ProxyHeaders => {
                scoped_log!(http_proxy_tunnel, "ProxyTunnel onData proxy_headers");
                match proxy.socket {
                    Socket::Ssl(socket) => {
                        this.handle_on_data_headers(true, decoded_data, &mut crate::http_thread().https_context, socket);
                    }
                    Socket::Tcp(socket) => {
                        this.handle_on_data_headers(false, decoded_data, &mut crate::http_thread().http_context, socket);
                    }
                    Socket::None => {}
                }
            }
            _ => {
                scoped_log!(http_proxy_tunnel, "ProxyTunnel onData unexpected data");
                this.state.pending_response = None;
                proxy.close(err!("UnexpectedData"));
            }
        }
    }
}

fn on_handshake(this: &mut HTTPClient, handshake_success: bool, ssl_error: uws::us_bun_verify_error_t) {
    if let Some(proxy) = this.proxy_tunnel {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake");
        proxy.ref_();
        let _guard = scopeguard::guard((), |_| proxy.deref_());
        this.state.response_stage = .proxy_headers;
        this.state.request_stage = .proxy_headers;
        this.state.request_sent_len = 0;
        let handshake_error = HTTPCertError {
            error_no: ssl_error.error_no,
            // SAFETY: ssl_error.code/reason are NUL-terminated C strings when non-null
            code: if ssl_error.code.is_null() {
                ZStr::EMPTY
            } else {
                unsafe { ZStr::from_ptr(ssl_error.code) }
            },
            reason: if ssl_error.code.is_null() {
                ZStr::EMPTY
            } else {
                unsafe { ZStr::from_ptr(ssl_error.reason) }
            },
        };
        if handshake_success {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake success");
            // handshake completed but we may have ssl errors
            this.flags.did_have_handshaking_error = handshake_error.error_no != 0;
            if this.flags.reject_unauthorized {
                // only reject the connection if reject_unauthorized == true
                if this.flags.did_have_handshaking_error {
                    proxy.close(bun_boringssl::c::get_cert_error_from_no(handshake_error.error_no));
                    return;
                }

                // if checkServerIdentity returns false, we dont call open this means that the connection was rejected
                debug_assert!(proxy.wrapper.is_some());
                let Some(ssl_ptr) = proxy.wrapper.as_ref().unwrap().ssl else { return };

                match proxy.socket {
                    Socket::Ssl(socket) => {
                        if !this.check_server_identity(true, socket, handshake_error, ssl_ptr, false) {
                            scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake checkServerIdentity failed");
                            // checkServerIdentity already called closeAndFail()
                            // → fail() → result callback, which may have
                            // destroyed the AsyncHTTP that embeds `this`. Do not
                            // touch `this` after a `false` return.
                            return;
                        }
                    }
                    Socket::Tcp(socket) => {
                        if !this.check_server_identity(false, socket, handshake_error, ssl_ptr, false) {
                            scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake checkServerIdentity failed");
                            // see Ssl arm — `this` may be freed here.
                            return;
                        }
                    }
                    Socket::None => {}
                }
            }

            match proxy.socket {
                Socket::Ssl(socket) => {
                    this.on_writable(true, true, socket);
                }
                Socket::Tcp(socket) => {
                    this.on_writable(true, false, socket);
                }
                Socket::None => {}
            }
        } else {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake failed");
            // if we are here is because server rejected us, and the error_no is the cause of this
            // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
            if this.flags.did_have_handshaking_error && handshake_error.error_no != 0 {
                proxy.close(bun_boringssl::c::get_cert_error_from_no(handshake_error.error_no));
                return;
            }
            // if handshake_success it self is false, this means that the connection was rejected
            proxy.close(err!("ConnectionRefused"));
            return;
        }
    }
}

pub fn write_encrypted(this: &mut HTTPClient, encoded_data: &[u8]) {
    if let Some(proxy) = this.proxy_tunnel {
        // Preserve TLS record ordering: if any encrypted bytes are buffered,
        // enqueue new bytes and flush them in FIFO via onWritable.
        if proxy.write_buffer.is_not_empty() {
            proxy.write_buffer.write(encoded_data);
            return;
        }
        let written = match proxy.socket {
            Socket::Ssl(socket) => socket.write(encoded_data),
            Socket::Tcp(socket) => socket.write(encoded_data),
            Socket::None => 0,
        };
        let pending = &encoded_data[usize::try_from(written).unwrap()..];
        if !pending.is_empty() {
            // lets flush when we are truly writable
            proxy.write_buffer.write(pending);
        }
    }
}

fn on_close(this: &mut HTTPClient) {
    scoped_log!(
        http_proxy_tunnel,
        "ProxyTunnel onClose {}",
        bstr::BStr::new(if this.proxy_tunnel.is_none() { b"tunnel is detached" } else { b"tunnel exists" })
    );
    if let Some(proxy) = this.proxy_tunnel {
        proxy.ref_();

        // If a response is in progress, mirror HTTPClient.onClose semantics:
        // treat connection close as end-of-body for identity transfer when no content-length.
        let in_progress = this.state.stage != Stage::Done
            && this.state.stage != Stage::Fail
            && !this.state.flags.is_redirect_pending;
        if in_progress {
            if this.state.is_chunked_encoding() {
                match this.state.chunked_decoder._state {
                    ChunkedState::CHUNKED_IN_TRAILERS_LINE_HEAD
                    | ChunkedState::CHUNKED_IN_TRAILERS_LINE_MIDDLE => {
                        this.state.flags.received_last_chunk = true;
                        progress_update_for_proxy_socket(this, proxy);
                        // Drop our temporary ref asynchronously to avoid freeing within callback
                        crate::http_thread().schedule_proxy_deref(proxy);
                        return;
                    }
                    _ => {}
                }
            } else if this.state.content_length.is_none()
                && this.state.response_stage == ResponseStage::Body
            {
                this.state.flags.received_last_chunk = true;
                progress_update_for_proxy_socket(this, proxy);
                // Balance the ref we took asynchronously
                crate::http_thread().schedule_proxy_deref(proxy);
                return;
            }
        }

        // Otherwise, treat as failure.
        let err = proxy.shutdown_err;
        match proxy.socket {
            Socket::Ssl(socket) => {
                this.close_and_fail(err, true, socket);
            }
            Socket::Tcp(socket) => {
                this.close_and_fail(err, false, socket);
            }
            Socket::None => {}
        }
        proxy.detach_socket();
        // Deref after returning to the event loop to avoid lifetime hazards.
        crate::http_thread().schedule_proxy_deref(proxy);
    }
}

fn progress_update_for_proxy_socket(this: &mut HTTPClient, proxy: &mut ProxyTunnel) {
    match proxy.socket {
        Socket::Ssl(socket) => this.progress_update(true, &mut crate::http_thread().https_context, socket),
        Socket::Tcp(socket) => this.progress_update(false, &mut crate::http_thread().http_context, socket),
        Socket::None => {}
    }
}

// ─── ProxyTunnel methods ─────────────────────────────────────────────────────

impl ProxyTunnel {
    // Intrusive refcount ops — provided by bun_ptr::IntrusiveRc but kept as
    // inherent shims here because callsites operate on `*mut ProxyTunnel`
    // recovered from HTTPClient.proxy_tunnel.
    // TODO(port): wire to bun_ptr::IntrusiveRc<ProxyTunnel> impl
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }
    pub fn deref_(&self) {
        // TODO(port): on hitting 0, run Drop + dealloc (IntrusiveRc handles this)
        self.ref_count.set(self.ref_count.get() - 1);
    }

    pub fn start<const IS_SSL: bool>(
        this: &mut HTTPClient,
        socket: NewHTTPContext::<IS_SSL>::HTTPSocket,
        ssl_options: SSLConfig,
        start_payload: &[u8],
    ) {
        let proxy_tunnel = Box::into_raw(Box::new(ProxyTunnel::default()));
        // SAFETY: just allocated, sole owner
        let proxy_tunnel = unsafe { &mut *proxy_tunnel };

        // We always request the cert so we can verify it and also we manually abort the connection if the hostname doesn't match
        let custom_options = ssl_options.for_client_verification();
        match SSLWrapper::<*mut HTTPClient>::init(
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
            Ok(w) => proxy_tunnel.wrapper = Some(w),
            Err(e) => {
                if e == err!("OutOfMemory") {
                    bun_core::out_of_memory();
                }

                // invalid TLS Options
                proxy_tunnel.detach_and_deref();
                this.close_and_fail(err!("ConnectionRefused"), IS_SSL, socket);
                return;
            }
        }
        this.proxy_tunnel = Some(proxy_tunnel);
        if IS_SSL {
            proxy_tunnel.socket = Socket::Ssl(socket);
        } else {
            proxy_tunnel.socket = Socket::Tcp(socket);
        }
        if !start_payload.is_empty() {
            scoped_log!(http_proxy_tunnel, "proxy tunnel start with payload");
            proxy_tunnel.wrapper.as_mut().unwrap().start_with_payload(start_payload);
        } else {
            scoped_log!(http_proxy_tunnel, "proxy tunnel start");
            proxy_tunnel.wrapper.as_mut().unwrap().start();
        }
    }

    pub fn close(&mut self, err: Error) {
        self.shutdown_err = err;
        self.shutdown();
    }

    pub fn shutdown(&mut self) {
        if let Some(wrapper) = &mut self.wrapper {
            // fast shutdown the connection
            let _ = wrapper.shutdown(true);
        }
    }

    pub fn on_writable<const IS_SSL: bool>(
        &mut self,
        socket: NewHTTPContext::<IS_SSL>::HTTPSocket,
    ) {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onWritable");
        self.ref_();
        let _ref_guard = scopeguard::guard((), |_| self.deref_());
        // PORT NOTE: reshaped for borrowck — Zig `defer wrapper.flush()` runs
        // AFTER the body; here we run it explicitly at every exit point below.
        let flush = |this: &mut Self| {
            if let Some(wrapper) = &mut this.wrapper {
                // Cycle to through the SSL state machine
                let _ = wrapper.flush();
            }
        };

        let encoded_data = self.write_buffer.slice();
        if encoded_data.is_empty() {
            flush(self);
            return;
        }
        let written = usize::try_from(socket.write(encoded_data)).unwrap();
        if written == encoded_data.len() {
            self.write_buffer.reset();
        } else {
            self.write_buffer.cursor += written;
        }
        flush(self);
    }

    pub fn receive(&mut self, buf: &[u8]) {
        self.ref_();
        let _guard = scopeguard::guard((), |_| self.deref_());
        if let Some(wrapper) = &mut self.wrapper {
            wrapper.receive_data(buf);
        }
    }

    pub fn write(&mut self, buf: &[u8]) -> Result<usize, Error> {
        // TODO(port): narrow error set
        if let Some(wrapper) = &mut self.wrapper {
            return wrapper.write_data(buf);
        }
        Err(err!("ConnectionClosed"))
    }

    pub fn detach_socket(&mut self) {
        self.socket = Socket::None;
    }

    pub fn detach_and_deref(&mut self) {
        self.detach_socket();
        self.deref_();
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
        socket: NewHTTPContext::<IS_SSL>::HTTPSocket,
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
        if IS_SSL {
            self.socket = Socket::Ssl(socket);
        } else {
            self.socket = Socket::Tcp(socket);
        }
        client.proxy_tunnel = Some(self);
        client.flags.proxy_tunneling = false;
        // Restore the cert-error flag captured in detachOwner() — no handshake
        // runs here, so the client's own flag would otherwise stay false and
        // re-pooling would erase the record.
        client.flags.did_have_handshaking_error = self.did_have_handshaking_error;
        client.state.request_stage = .proxy_headers;
        client.state.response_stage = .proxy_headers;
        client.state.request_sent_len = 0;
    }
}

// TODO(port): these enum variant paths (ResponseStage, Stage, ChunkedState,
// SSLWrapperHandlers) live in sibling http-crate modules; Phase B wires imports.
use crate::state::{ResponseStage, Stage};
use crate::picohttp::ChunkedState;
use bun_runtime::socket::ssl_wrapper::Handlers as SSLWrapperHandlers;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/ProxyTunnel.zig (452 lines)
//   confidence: medium
//   todos:      9
//   notes:      IntrusiveRc ref/deref shimmed; NewHTTPContext::<B>::HTTPSocket needs inherent-assoc-type workaround; HTTPClient.proxy_tunnel treated as Option<*mut ProxyTunnel>; stage enum literals (.proxy_headers) need qualified paths
// ──────────────────────────────────────────────────────────────────────────
