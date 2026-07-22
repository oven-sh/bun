#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
use core::ffi::{c_char, c_void};

use bun_core::ZStr;

// ──────────────────────────────────────────────────────────────────────────
// Thin re-exports from uws_sys / runtime
// ──────────────────────────────────────────────────────────────────────────
// FFI types (`us_bun_verify_error_t`, `Opcode`, `SendStatus`, `SocketKind`,
// `SocketGroup`, `ConnectResult`, listen-flag constants) are re-exported from
// `bun_uws_sys` so this crate and `_sys` name the SAME `#[repr(C)]` types —
// callers no longer shim-convert between two layout-identical structs.
//
// Safe raw-pointer wrappers (`NewSocketHandler`/`SocketTCP`/`SocketTLS`,
// `InternalSocket`, `AnySocket`, `ConnectError`, `CloseKind`, owned
// `SocketAddress`) stay defined here; `bun_uws_sys::socket` has lifetime-
// bearing variants of the same names that are not yet reconciled.

#[cfg(windows)]
pub use bun_uws_sys::Timer;
pub use bun_uws_sys::{
    AnyWebSocket, BodyReaderMixin, ConnectingSocket, ListenSocket, NewApp, RawWebSocket, Request,
    WebSocketBehavior, us_socket_stream_buffer_t, us_socket_t, uws_res,
};

/// `#[uws_callback]` — wraps a `&self`/`&mut self` method in an `extern "C"`
/// thunk that recovers `Self` from `*mut c_void` and lowers `&[T]` params to
/// `(ptr, len)` pairs. See `bun_jsc_macros::uws_callback` for the full
/// contract. With `panic = "abort"` Rust panics terminate in the crash-handler
/// hook, so no `catch_unwind` wrapper is emitted.
pub use bun_jsc_macros::uws_callback;
pub use bun_uws_sys::response::State;
pub use bun_uws_sys::{h3 as H3, quic, udp, vtable};
pub type Socket = us_socket_t;

/// Bare BoringSSL `SSL_CTX`. `SSL_CTX_up_ref`/`SSL_CTX_free` is the refcount;
/// policy (verify mode, reneg limits) is encoded on the SSL_CTX itself via
/// `us_ssl_ctx_from_options`, so there's no wrapper struct. `Option<*mut SslCtx>`
/// is what listen/connect/adopt take.
pub type SslCtx = bun_boringssl::c::SSL_CTX;

/// uWS C++ `WebSocketContext<SSL,true,UserData>*`. Only ever produced by the
/// upgrade-handler thunk and round-tripped to `uws_res_upgrade`; Rust never
/// dereferences it. Re-exported from `bun_uws_sys` so the trait
/// `bun_uws_sys::web_socket::WebSocketUpgradeServer` and higher-tier callers
/// (`bun_runtime::server`, `bake::dev_server`) all name the *same* opaque.
pub use bun_uws_sys::WebSocketUpgradeContext;

/// Recovers the concrete uWS response type from `*mut c_void` across the
/// Rust→C++ boundary. Mirrors `UWSResponseKind` in headers-handwritten.h.
#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ResponseKind {
    Tcp = 0,
    Ssl = 1,
    H3 = 2,
}

impl ResponseKind {
    pub const fn from(ssl: bool, http3: bool) -> ResponseKind {
        if http3 {
            ResponseKind::H3
        } else if ssl {
            ResponseKind::Ssl
        } else {
            ResponseKind::Tcp
        }
    }
}

pub(crate) const _COMPRESSOR_MASK: i32 = 255;
pub(crate) const _DECOMPRESSOR_MASK: i32 = 3840;
pub const SHARED_COMPRESSOR: i32 = 1;
pub const SHARED_DECOMPRESSOR: i32 = 256;
pub const DEDICATED_DECOMPRESSOR: i32 = 3840;
pub const DEDICATED_COMPRESSOR_3KB: i32 = 145;
pub const DEDICATED_COMPRESSOR_4KB: i32 = 146;
pub const DEDICATED_COMPRESSOR_8KB: i32 = 163;
pub const DEDICATED_COMPRESSOR_16KB: i32 = 180;
pub const DEDICATED_COMPRESSOR_32KB: i32 = 197;
pub const DEDICATED_COMPRESSOR_64KB: i32 = 214;
pub const DEDICATED_COMPRESSOR_128KB: i32 = 231;
pub const DEDICATED_COMPRESSOR_256KB: i32 = 248;
pub const DEDICATED_COMPRESSOR: i32 = 248;

pub use bun_uws_sys::{
    LIBUS_LISTEN_DEFAULT, LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE, LIBUS_LISTEN_EXCLUSIVE_PORT,
    LIBUS_LISTEN_REUSE_ADDR, LIBUS_LISTEN_REUSE_PORT, LIBUS_SOCKET_ALLOW_HALF_OPEN,
    LIBUS_SOCKET_IPV6_ONLY,
};

// Re-export the `_sys` definitions so higher tiers see one type. `to_js`
// (`createBunSocketErrorToJS` / `verifyErrorToJS`) live as extension traits
// in the *_jsc crate.
pub use bun_uws_sys::{Opcode, SendStatus, create_bun_socket_error_t, us_bun_verify_error_t};

/// Owned socket-address shape (boxed IP). Distinct from the sys type by
/// design — that one stores the IP text inline as returned from
/// `Response::get_remote_socket_info`.
pub struct SocketAddress {
    pub ip: Box<[u8]>,
    pub port: i32,
    pub is_ipv6: bool,
}

pub use bun_uws_sys::loop_::on_thread_exit;

/// # Safety
/// `filename` and `error_msg` must be valid NUL-terminated C strings.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn BUN__warn__extra_ca_load_failed(
    filename: *const c_char,
    error_msg: *const c_char,
) {
    // SAFETY: caller contract guarantees valid NUL-terminated strings.
    let filename = unsafe { bun_core::ffi::cstr(filename) };
    // SAFETY: caller contract guarantees valid NUL-terminated strings.
    let error_msg = unsafe { bun_core::ffi::cstr(error_msg) };
    bun_core::warn!(
        "ignoring extra certs from {}, load failed: {}",
        bstr::BStr::new(filename.to_bytes()),
        bstr::BStr::new(error_msg.to_bytes()),
    );
}

pub use bun_uws_sys::LIBUS_SOCKET_DESCRIPTOR;

mod c {
    unsafe extern "C" {
        // safe: no args; returns a process-static NUL-terminated cipher list.
        pub(crate) safe fn us_get_default_ciphers() -> *const core::ffi::c_char;
    }
}

pub fn get_default_ciphers() -> &'static ZStr {
    // SAFETY: us_get_default_ciphers returns a static NUL-terminated string;
    // bun_core::ffi::cstr computes the length, ZStr::from_raw rebuilds the
    // length-carrying slice (excluding the NUL).
    unsafe {
        let p = c::us_get_default_ciphers();
        let len = bun_core::ffi::cstr(p).to_bytes().len();
        ZStr::from_raw(p.cast::<u8>(), len)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ssl_wrapper (moved down from bun_runtime::socket::ssl_wrapper for http_jsc)
// ═══════════════════════════════════════════════════════════════════════════
pub mod ssl_wrapper {
    use core::ffi::{c_int, c_void};
    use core::ptr::NonNull;

    // Re-export the canonical BoringSSL FFI surface; the lower-tier crate now
    // declares every symbol SSLWrapper needs, so the old local shim is gone.
    mod boring_sys {
        pub(super) use bun_boringssl::c::{
            BIO_ctrl_pending, BIO_free, BIO_new, BIO_read, BIO_s_mem, BIO_set_mem_eof_return,
            BIO_write, ERR_clear_error, SSL, SSL_CTX, SSL_CTX_free, SSL_CTX_get_verify_mode,
            SSL_ERROR_SSL, SSL_ERROR_SYSCALL, SSL_ERROR_WANT_READ, SSL_ERROR_WANT_RENEGOTIATE,
            SSL_ERROR_WANT_WRITE, SSL_ERROR_ZERO_RETURN, SSL_RECEIVED_SHUTDOWN,
            SSL_VERIFY_FAIL_IF_NO_PEER_CERT, SSL_VERIFY_NONE, SSL_VERIFY_PEER, SSL_do_handshake,
            SSL_free, SSL_get_error, SSL_get_rbio, SSL_get_shutdown, SSL_get_wbio,
            SSL_is_init_finished, SSL_new, SSL_pending, SSL_read, SSL_renegotiate,
            SSL_set_accept_state, SSL_set_bio, SSL_set_connect_state, SSL_set_renegotiate_mode,
            SSL_set_verify, SSL_set0_verify_cert_store, SSL_shutdown, SSL_write, X509_STORE,
            X509_STORE_CTX, ssl_renegotiate_explicit, ssl_renegotiate_never,
        };
    }

    use crate::us_bun_verify_error_t;
    use bun_ptr::LaunderedSelf; // brings `Self::r` into scope for SSLWrapper

    bun_core::define_scoped_log!(log, SSLWrapper, hidden);

    // Mimics the behavior of openssl.c in uSockets, wrapping data that can be
    // received from anywhere (network, DuplexStream, etc).
    //
    // receive_data() is called when we receive data from the network
    // (encrypted data that will be decrypted by SSLWrapper). write_data() is
    // called when we want to send data to the network (unencrypted data that
    // will be encrypted by SSLWrapper).
    //
    // After init we need to call start() to start the SSL handshake. This
    // triggers the on_open callback before the handshake starts and the
    // on_handshake callback after the handshake completes. on_data and write
    // callbacks are triggered when we have data to read or write
    // respectively. on_data passes the decrypted data that we received from
    // the network. write passes the encrypted data that we want to send to
    // the network. on_close is triggered when we want the network connection
    // to be closed (remember to flush before closing).
    //
    // Notes:
    //   SSL_read()  reads unencrypted data which is stored in the input BIO.
    //   SSL_write() writes unencrypted data into the output BIO.
    //   BIO_write() writes encrypted data into the input BIO.
    //   BIO_read()  reads encrypted data from the output BIO.

    /// 64kb nice buffer size for SSL reads and writes, should be enough for
    /// most cases. In reads we loop until we have no more data to read and in
    /// writes we loop until we have no more data to write/backpressure.
    const BUFFER_SIZE: usize = 65536;

    /// Cap on peer-initiated TLS renegotiations per
    /// [`MAX_RENEGOTIATION_WINDOW`]. Mirrors the `us_reneg_policy` defaults in
    /// the uSockets C path (openssl.c) and Node's
    /// `CLIENT_RENEG_LIMIT`/`CLIENT_RENEG_WINDOW`. Unbounded renegotiation is
    /// a CPU DoS (CVE-2011-1473).
    const MAX_RENEGOTIATIONS: u8 = 3;
    /// See [`MAX_RENEGOTIATIONS`].
    const MAX_RENEGOTIATION_WINDOW: core::time::Duration = core::time::Duration::from_secs(600);

    pub struct SSLWrapper<T: Copy> {
        pub handlers: Handlers<T>,
        pub ssl: Option<NonNull<boring_sys::SSL>>,
        pub ctx: Option<NonNull<boring_sys::SSL_CTX>>,
        pub flags: Flags,
        pub renegotiation_count: u8,
        pub renegotiation_window_start: Option<std::time::Instant>,
    }

    /// CamelCase alias for callers that use the alternate spelling
    /// (e.g. `http_jsc`).
    pub type SslWrapper<T> = SSLWrapper<T>;

    /// `Cell`-backed bitfield so the R-2 noalias-laundered self-backref (see
    /// [`SSLWrapper::r`]) can read AND write flags through a shared `&Self`
    /// borrow — collapses the `unsafe { (*this).flags.set_X(..) }` pattern in
    /// `shutdown` / `update_handshake_state` / `handle_writing` into safe
    /// `Self::r(this).flags.set_X(..)` field-projection calls. The wrapper
    /// is single-JS-thread (`!Sync` already via `NonNull<SSL>`), so `Cell`
    /// adds no auto-trait churn.
    #[repr(transparent)]
    #[derive(Default)]
    pub struct Flags(core::cell::Cell<u8>);

    // Bit layout (LSB-first):
    //   bits 0-1: handshake_state (u2)
    //   bit  2:   received_ssl_shutdown
    //   bit  3:   sent_ssl_shutdown
    //   bit  4:   is_client
    //   bit  5:   authorized
    //   bit  6:   fatal_error
    //   bit  7:   closed_notified
    impl Flags {
        const HANDSHAKE_MASK: u8 = 0b0000_0011;
        const RECEIVED_SSL_SHUTDOWN: u8 = 1 << 2;
        const SENT_SSL_SHUTDOWN: u8 = 1 << 3;
        const IS_CLIENT: u8 = 1 << 4;
        const AUTHORIZED: u8 = 1 << 5;
        const FATAL_ERROR: u8 = 1 << 6;
        const CLOSED_NOTIFIED: u8 = 1 << 7;

        #[inline(always)]
        fn bits(&self) -> u8 {
            self.0.get()
        }
        #[inline(always)]
        fn set_bit(&self, mask: u8, v: bool) {
            let b = self.0.get();
            self.0.set(if v { b | mask } else { b & !mask });
        }

        #[inline]
        pub fn handshake_state(&self) -> HandshakeState {
            // bits 0-1 are always written via set_handshake_state with a valid
            // discriminant in range 0..=2; the 4th bit-state traps rather than
            // silently folding bitfield corruption to a valid variant.
            match self.bits() & Self::HANDSHAKE_MASK {
                0 => HandshakeState::HandshakePending,
                1 => HandshakeState::HandshakeCompleted,
                2 => HandshakeState::HandshakeRenegotiationPending,
                n => unreachable!("invalid HandshakeState {n}"),
            }
        }
        #[inline]
        pub fn set_handshake_state(&self, s: HandshakeState) {
            self.0
                .set((self.bits() & !Self::HANDSHAKE_MASK) | (s as u8));
        }

        #[inline]
        pub fn received_ssl_shutdown(&self) -> bool {
            self.bits() & Self::RECEIVED_SSL_SHUTDOWN != 0
        }
        #[inline]
        pub fn set_received_ssl_shutdown(&self, v: bool) {
            self.set_bit(Self::RECEIVED_SSL_SHUTDOWN, v)
        }
        #[inline]
        pub fn sent_ssl_shutdown(&self) -> bool {
            self.bits() & Self::SENT_SSL_SHUTDOWN != 0
        }
        #[inline]
        pub fn set_sent_ssl_shutdown(&self, v: bool) {
            self.set_bit(Self::SENT_SSL_SHUTDOWN, v)
        }
        #[inline]
        pub fn is_client(&self) -> bool {
            self.bits() & Self::IS_CLIENT != 0
        }
        #[inline]
        pub fn set_is_client(&self, v: bool) {
            self.set_bit(Self::IS_CLIENT, v)
        }
        #[inline]
        pub fn authorized(&self) -> bool {
            self.bits() & Self::AUTHORIZED != 0
        }
        #[inline]
        pub fn set_authorized(&self, v: bool) {
            self.set_bit(Self::AUTHORIZED, v)
        }
        #[inline]
        pub fn fatal_error(&self) -> bool {
            self.bits() & Self::FATAL_ERROR != 0
        }
        #[inline]
        pub fn set_fatal_error(&self, v: bool) {
            self.set_bit(Self::FATAL_ERROR, v)
        }
        #[inline]
        pub fn closed_notified(&self) -> bool {
            self.bits() & Self::CLOSED_NOTIFIED != 0
        }
        #[inline]
        pub fn set_closed_notified(&self, v: bool) {
            self.set_bit(Self::CLOSED_NOTIFIED, v)
        }
    }

    #[repr(u8)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum HandshakeState {
        HandshakePending = 0,
        HandshakeCompleted = 1,
        HandshakeRenegotiationPending = 2,
    }

    pub struct Handlers<T: Copy> {
        /// Backref to the parent (e.g. *mut HTTPClient / *mut WebSocketProxyTunnel / *mut UpgradedDuplex).
        pub ctx: T,
        pub on_open: fn(T),
        pub on_handshake: fn(T, bool, us_bun_verify_error_t),
        pub write: fn(T, &[u8]),
        pub on_data: fn(T, &[u8]),
        pub on_close: fn(T),
        /// A new resumable TLS session arrived (serialized SSL_SESSION bytes)
        /// - node's `'session'` event. `None` opts the SSL out of session
        /// parking entirely (fetch / WebSocket tunnels have no consumer).
        pub on_session: Option<fn(T, &[u8])>,
        /// An NSS key-log line (with the trailing newline node appends) -
        /// node's `'keylog'` event. Same opt-in rules as `on_session`.
        pub on_keylog: Option<fn(T, &[u8])>,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
    pub enum InitError {
        OutOfMemory,
        InvalidOptions,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
    pub enum WriteDataError {
        ConnectionClosed,
        WantRead,
        WantWrite,
    }

    // SAFETY: SSLWrapper is an inline field of the owning socket; handler vtable
    // re-entry may write `flags`/`ssl` but never frees the wrapper (only
    // `deinit()` clears `ssl`/`ctx`); single JS thread.
    unsafe impl<T: Copy> bun_ptr::LaunderedSelf for SSLWrapper<T> {}

    impl<T: Copy> SSLWrapper<T> {
        /// Initialize the SSLWrapper with a specific SSL_CTX*, remember to
        /// call SSL_CTX_up_ref if you want to keep the SSL_CTX alive after
        /// the SSLWrapper is deinitialized.
        pub fn init_with_ctx(
            ctx: NonNull<boring_sys::SSL_CTX>,
            is_client: bool,
            handlers: Handlers<T>,
        ) -> Result<Self, InitError> {
            bun_boringssl::load();
            // SAFETY: ctx is a valid non-null SSL_CTX*; SSL_new returns null on OOM.
            let ssl = NonNull::new(unsafe { boring_sys::SSL_new(ctx.as_ptr()) })
                .ok_or(InitError::OutOfMemory)?;
            // errdefer BoringSSL.SSL_free(ssl) — FFI cleanup on early return
            let ssl_guard = scopeguard::guard(ssl, |ssl| {
                // SAFETY: ssl was created by SSL_new above and is solely owned by this guard until disarmed.
                unsafe { boring_sys::SSL_free(ssl.as_ptr()) };
            });

            // OpenSSL enables TLS renegotiation by default and accepts
            // renegotiation requests from the peer transparently.
            // Renegotiation is an extremely problematic protocol feature, so
            // BoringSSL rejects peer renegotiations by default. We explicitly
            // set the SSL_set_renegotiate_mode so if we switch to OpenSSL we
            // keep the same behavior. See:
            // https://boringssl.googlesource.com/boringssl/+/HEAD/PORTING.md#TLS-renegotiation
            // SAFETY: ssl is valid for the duration of this block; all calls are simple property setters.
            unsafe {
                if is_client {
                    // Set the renegotiation mode to explicit so that we can
                    // renegotiate on the client side if needed (better
                    // performance than ssl_renegotiate_freely). BoringSSL:
                    // Renegotiation is only supported as a client in TLS and
                    // the HelloRequest must be received at a quiet point in
                    // the application protocol. This is sufficient to support
                    // the common use of requesting a new client certificate
                    // between an HTTP request and response in (unpipelined)
                    // HTTP/1.1.
                    boring_sys::SSL_set_renegotiate_mode(
                        ssl.as_ptr(),
                        boring_sys::ssl_renegotiate_explicit,
                    );
                    boring_sys::SSL_set_connect_state(ssl.as_ptr());
                    // Mirror `us_internal_ssl_attach`: a SecureContext is
                    // mode-neutral, so a `tls.connect()` without
                    // `ca`/`requestCert` hands us a CTX with VERIFY_NONE and
                    // no trust store. Clients must always run verification so
                    // `verify_error` is real for the JS-side
                    // `rejectUnauthorized` decision; load the shared system
                    // roots per-SSL so a server using the same CTX never sees
                    // CertificateRequest. (Pre-redesign this happened by
                    // accident: net.ts forced `requestCert: true` after
                    // `[buntls]` and `SSLConfig.fromJS` rebuilt the CTX with
                    // roots from that.)
                    if boring_sys::SSL_CTX_get_verify_mode(ctx.as_ptr())
                        == boring_sys::SSL_VERIFY_NONE
                    {
                        boring_sys::SSL_set_verify(
                            ssl.as_ptr(),
                            boring_sys::SSL_VERIFY_PEER,
                            Some(always_continue_verify),
                        );
                        if let Some(roots) = NonNull::new(us_get_shared_default_ca_store()) {
                            let _ = boring_sys::SSL_set0_verify_cert_store(
                                ssl.as_ptr(),
                                roots.as_ptr(),
                            );
                        }
                    }
                } else {
                    // Set the renegotiation mode to never so that we can't
                    // renegotiate on the server side (security reasons).
                    // BoringSSL: There is no support for renegotiation as a
                    // server. (Attempts by clients will result in a fatal
                    // alert so that ClientHello messages cannot be used to
                    // flood a server and escape higher-level limits.)
                    boring_sys::SSL_set_renegotiate_mode(
                        ssl.as_ptr(),
                        boring_sys::ssl_renegotiate_never,
                    );
                    boring_sys::SSL_set_accept_state(ssl.as_ptr());
                }
            }
            // SAFETY: BIO_s_mem returns a static method table; BIO_new returns null on OOM.
            let input = NonNull::new(unsafe { boring_sys::BIO_new(boring_sys::BIO_s_mem()) })
                .ok_or(InitError::OutOfMemory)?;
            // errdefer _ = BoringSSL.BIO_free(input)
            let input_guard = scopeguard::guard(input, |bio| {
                // SAFETY: bio was created by BIO_new above and not yet transferred to SSL_set_bio.
                unsafe {
                    let _ = boring_sys::BIO_free(bio.as_ptr());
                }
            });
            // SAFETY: same as above.
            let output = NonNull::new(unsafe { boring_sys::BIO_new(boring_sys::BIO_s_mem()) })
                .ok_or(InitError::OutOfMemory)?;
            // Set the EOF return value to -1 so that we can detect when the BIO is empty using BIO_ctrl_pending
            // SAFETY: input/output are valid BIOs we just created; ssl is valid.
            unsafe {
                let _ = boring_sys::BIO_set_mem_eof_return(input.as_ptr(), -1);
                let _ = boring_sys::BIO_set_mem_eof_return(output.as_ptr(), -1);
                // Set the input and output BIOs
                boring_sys::SSL_set_bio(ssl.as_ptr(), input.as_ptr(), output.as_ptr());
            }
            // Ownership of input/output transferred to ssl via SSL_set_bio; disarm guards.
            let _ = scopeguard::ScopeGuard::into_inner(input_guard);
            let ssl = scopeguard::ScopeGuard::into_inner(ssl_guard);

            // Opt into the parked new-session/keylog queues only when a
            // handler will drain them (see `flush_pending_events`); the C
            // callbacks skip un-opted SSLs entirely.
            if handlers.on_session.is_some() || handlers.on_keylog.is_some() {
                // SAFETY: `ssl` is the live SSL* created above.
                unsafe { us_ssl_enable_pending_events(ssl.as_ptr()) };
            }

            let flags = Flags::default();
            flags.set_is_client(is_client);

            Ok(Self {
                handlers,
                flags,
                ctx: Some(ctx),
                ssl: Some(ssl),
                renegotiation_count: 0,
                renegotiation_window_start: None,
            })
        }

        /// Tier-neutral constructor.
        /// Higher-tier callers convert their `SSLConfig` via `.as_usockets()` and pass the
        /// resulting `BunSocketContextOptions` here, so this crate stays free of the
        /// `jsc`/`http_types` dependency. The original `SSLConfig`-taking `init` lives as
        /// an extension in the higher tier.
        pub fn init_from_options(
            ctx_opts: &crate::SocketContext::BunSocketContextOptions,
            is_client: bool,
            handlers: Handlers<T>,
        ) -> Result<Self, InitError> {
            bun_boringssl::load();

            let mut err = crate::create_bun_socket_error_t::none;
            let Some(ssl_ctx) = ctx_opts.create_ssl_context(&mut err).and_then(NonNull::new) else {
                return Err(InitError::InvalidOptions);
            };
            // init_with_ctx adopts the SSL_CTX* (one ref). The passphrase was
            // already freed inside create_ssl_context, so SSL_CTX_free is
            // sufficient on the error path.
            let ctx_guard = scopeguard::guard(ssl_ctx, |c| {
                // SAFETY: ssl_ctx ref was just created by create_ssl_context and not yet adopted by init_with_ctx.
                unsafe { boring_sys::SSL_CTX_free(c.as_ptr()) };
            });
            let this = Self::init_with_ctx(ssl_ctx, is_client, handlers)?;
            let _ = scopeguard::ScopeGuard::into_inner(ctx_guard);
            Ok(this)
        }

        /// Mirror `us_socket_adopt_tls`'s server-side `SSL_set_verify` override.
        ///
        /// `us_ssl_ctx_from_options` turns on `SSL_VERIFY_PEER |
        /// SSL_VERIFY_FAIL_IF_NO_PEER_CERT` whenever the options carry a `ca`,
        /// because for a server that flag is what decides whether a
        /// CertificateRequest is sent. Node instead keys that off `requestCert`
        /// alone, so a server given `ca` but no `requestCert` must not ask for
        /// a client certificate. The real-fd upgrade path already corrects
        /// this per-SSL; without the same correction a duplex-wrapped server
        /// rejects every cert-less client with UNABLE_TO_GET_ISSUER_CERT.
        ///
        /// No-op for clients: their verify mode is set in `init_with_ctx` so
        /// `verify_error` is populated for the JS `rejectUnauthorized`
        /// decision.
        pub fn set_server_verify(&mut self, request_cert: bool, reject_unauthorized: bool) {
            if self.flags.is_client() {
                return;
            }
            let Some(ssl) = self.ssl else { return };
            let mode = if request_cert {
                boring_sys::SSL_VERIFY_PEER
                    | if reject_unauthorized {
                        boring_sys::SSL_VERIFY_FAIL_IF_NO_PEER_CERT
                    } else {
                        0
                    }
            } else {
                boring_sys::SSL_VERIFY_NONE
            };
            // SAFETY: `ssl` is this wrapper's live `SSL*`, before any handshake
            // byte has been processed. The callback always returns 1 so
            // BoringSSL never aborts mid-flight; JS reads `verify_error` and
            // decides.
            unsafe {
                boring_sys::SSL_set_verify(ssl.as_ptr(), mode, Some(always_continue_verify));
            }
        }

        pub fn start(&mut self) {
            // trigger the onOpen callback so the user can configure the SSL connection before first handshake
            (self.handlers.on_open)(self.handlers.ctx);
            // start the handshake
            self.handle_traffic();
        }

        pub fn start_with_payload(&mut self, payload: &[u8]) {
            (self.handlers.on_open)(self.handlers.ctx);
            self.receive_data(payload);
            // start the handshake
            self.handle_traffic();
        }

        /// Shutdown the read direction of the SSL (fake it just for convenience)
        pub fn shutdown_read(&mut self) {
            // We cannot shutdown read in SSL, the read direction is closed by
            // the peer. So we just ignore the onData data, we still wanna to
            // wait until we received the shutdown.
            fn dummy_on_data<T: Copy>(_: T, _: &[u8]) {}
            self.handlers.on_data = dummy_on_data::<T>;
        }

        /// Shutdown the write direction of the SSL and returns if we are
        /// completed closed or not. We cannot assume that the read part will
        /// remain open after we sent a shutdown, the other side will probably
        /// complete the 2-step shutdown ASAP. Caution: never reuse a socket if
        /// fast_shutdown = true, this will also fully close both read and
        /// write directions.
        pub fn shutdown(&mut self, fast_shutdown: bool) -> bool {
            // PORT_NOTES_PLAN R-2: `&mut self` carries LLVM `noalias`, but
            // `trigger_handshake_callback` / `trigger_close_callback` invoke
            // the user-supplied handler vtable (`handlers.on_close` /
            // `on_handshake`) which can re-enter via a fresh `&mut SSLWrapper`
            // from the owning socket and write `self.flags` / `self.ssl`. LLVM
            // was caching `self.flags` across those calls (ASM-verified
            // PROVEN_CACHED). Launder so all `flags`/`ssl` reads after the
            // first callback go through an opaque pointer; mirrors the cork
            // fix at b818e70e1c57. All field access goes through [`Self::r`],
            // whose doc comment carries the encapsulated SAFETY proof.
            let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
            let Some(ssl) = Self::r(this).ssl else {
                return false;
            };
            // we already sent the ssl shutdown
            if Self::r(this).flags.sent_ssl_shutdown() || Self::r(this).flags.fatal_error() {
                if fast_shutdown {
                    // A fast shutdown is a full teardown — the owner calls it
                    // right before detaching/freeing handlers.ctx (proxy tunnel
                    // on response-complete; TLS-over-duplex on raw EOF).
                    //
                    // Run the close callback now, regardless of whether the
                    // peer's close_notify has arrived: if it HAS (processed
                    // mid handle_reading, which sets sent_ssl_shutdown before
                    // flushing the final decrypted bytes), closed_notified may
                    // still be unset and handle_reading's deferred
                    // trigger_close_callback would otherwise fire on_close
                    // into the freed ctx; if it has NOT (peer went away after
                    // our shutdown), the TLS-over-duplex teardown chain
                    // (UpgradedDuplex::on_close -> DuplexUpgradeContext::on_close
                    // -> deinit) never runs and leaks the whole context graph.
                    // trigger_close_callback is idempotent (closed_notified).
                    Self::r(this).flags.set_received_ssl_shutdown(true);
                    Self::r(this).trigger_close_callback();
                    // Do not read self after the close callback: the owner's
                    // teardown chain has started.
                    return true;
                }
                return Self::r(this).flags.received_ssl_shutdown();
            }

            // Calling SSL_shutdown() only closes the write direction of the
            // connection; the read direction is closed by the peer. Once
            // SSL_shutdown() is called, SSL_write(3) can no longer be used,
            // but SSL_read(3) may still be used until the peer decides to
            // close the connection in turn. The peer might continue sending
            // data for some period of time before handling the local
            // application's shutdown indication. This will start a full
            // shutdown process if fast_shutdown = false, we can assume that
            // the other side will complete the 2-step shutdown ASAP.
            // SAFETY: ssl is a live SSL* owned by self.
            let ret = unsafe { boring_sys::SSL_shutdown(ssl.as_ptr()) };
            // when doing a fast shutdown we don't need to wait for the peer to send a shutdown so we just call SSL_shutdown again
            if fast_shutdown {
                // This allows for a more rapid shutdown process if the
                // application does not wish to wait for the peer. This
                // alternative "fast shutdown" approach should only be done if
                // it is known that the peer will not send more data,
                // otherwise there is a risk of an application exposing itself
                // to a truncation attack. The full SSL_shutdown() process, in
                // which both parties send close_notify alerts and
                // SSL_shutdown() returns 1, provides a cryptographically
                // authenticated indication of the end of a connection.
                //
                // The fast shutdown approach can only be used if there is no
                // intention to reuse the underlying connection (e.g. a TCP
                // connection) for further communication; in this case, the
                // full shutdown process must be performed to ensure
                // synchronisation.
                // SAFETY: ssl is still valid.
                unsafe {
                    let _ = boring_sys::SSL_shutdown(ssl.as_ptr());
                }
                Self::r(this).flags.set_received_ssl_shutdown(true);
                // Reset pending handshake because we are closed for sure now
                if Self::r(this).flags.handshake_state() != HandshakeState::HandshakeCompleted {
                    Self::r(this)
                        .flags
                        .set_handshake_state(HandshakeState::HandshakeCompleted);
                    let verify = Self::r(this).get_verify_error();
                    Self::r(this).trigger_handshake_callback(false, verify);
                }

                // we need to trigger close because we are not receiving a SSL_shutdown
                Self::r(this).trigger_close_callback();
                return false;
            }

            // we sent the shutdown
            Self::r(this).flags.set_sent_ssl_shutdown(ret >= 0);
            if ret < 0 {
                // SAFETY: ssl is still valid.
                let err = unsafe { boring_sys::SSL_get_error(ssl.as_ptr(), ret) };
                boring_sys::ERR_clear_error();

                if err == boring_sys::SSL_ERROR_SSL || err == boring_sys::SSL_ERROR_SYSCALL {
                    Self::r(this).flags.set_fatal_error(true);
                    Self::r(this).trigger_close_callback();
                    return false;
                }
            }
            // SSL_shutdown only queues close_notify into the write BIO; nothing
            // else pumps it on the memory-BIO paths (duplex / named pipe), so
            // drain it now or the peer never sees our shutdown. A close_notify
            // record is ~31 bytes and handle_writing loops on BIO_read, so a
            // small buffer suffices — shutdown() runs inside handle_traffic's
            // frame, which already holds a BUFFER_SIZE array.
            let mut buffer = [0u8; 4096];
            Self::r(this).handle_writing(&mut buffer);
            ret == 1 // truly closed
        }

        /// flush buffered data and returns amount of pending data to write
        pub fn flush(&mut self) -> usize {
            // handle_traffic may trigger a close callback which frees ssl,
            // so we must not capture the ssl pointer before calling it.
            self.handle_traffic();
            let Some(ssl) = self.ssl else { return 0 };
            // SAFETY: ssl is a live SSL*; SSL_get_wbio returns the BIO bound in init_with_ctx.
            unsafe { boring_sys::BIO_ctrl_pending(boring_sys::SSL_get_wbio(ssl.as_ptr())) }
        }

        /// Return if we have pending data to be read or write. Covers both
        /// BIOs and `SSL_pending` — decrypted bytes of a partially-returned
        /// record are buffered inside the SSL, invisible to either BIO.
        pub fn has_pending_data(&self) -> bool {
            let Some(ssl) = self.ssl else { return false };
            // SAFETY: ssl is a live SSL*; rbio/wbio bound in init_with_ctx.
            unsafe {
                boring_sys::SSL_pending(ssl.as_ptr()) > 0
                    || boring_sys::BIO_ctrl_pending(boring_sys::SSL_get_wbio(ssl.as_ptr())) > 0
                    || boring_sys::BIO_ctrl_pending(boring_sys::SSL_get_rbio(ssl.as_ptr())) > 0
            }
        }

        /// Return if we buffered data inside the BIO read buffer, not
        /// necessarily will return data to read. This dont reflect
        /// SSL_pending().
        fn has_pending_read(&self) -> bool {
            let Some(ssl) = self.ssl else { return false };
            // SAFETY: ssl is a live SSL*.
            unsafe { boring_sys::BIO_ctrl_pending(boring_sys::SSL_get_rbio(ssl.as_ptr())) > 0 }
        }

        /// We sent or received a shutdown (closing or closed)
        pub fn is_shutdown(&self) -> bool {
            self.flags.closed_notified()
                || self.flags.received_ssl_shutdown()
                || self.flags.sent_ssl_shutdown()
        }

        /// We sent and received the shutdown (fully closed)
        pub fn is_closed(&self) -> bool {
            self.flags.received_ssl_shutdown() && self.flags.sent_ssl_shutdown()
        }

        pub fn is_authorized(&self) -> bool {
            // handshake ended we know if we are authorized or not
            if self.flags.handshake_state() == HandshakeState::HandshakeCompleted {
                return self.flags.authorized();
            }
            // hanshake still in progress
            false
        }

        /// Receive data from the network (encrypted data)
        pub fn receive_data(&mut self, data: &[u8]) {
            let Some(ssl) = self.ssl else { return };

            // SAFETY: ssl is a live SSL*; rbio bound in init_with_ctx.
            let Some(input) = NonNull::new(unsafe { boring_sys::SSL_get_rbio(ssl.as_ptr()) })
            else {
                return;
            };
            // SAFETY: input is a valid BIO*; data is a valid &[u8] for len bytes.
            let written = unsafe {
                boring_sys::BIO_write(
                    input.as_ptr(),
                    data.as_ptr().cast::<c_void>(),
                    c_int::try_from(data.len()).expect("int cast"),
                )
            };
            if written > -1 {
                self.handle_traffic();
            }
        }

        /// Send data to the network (unencrypted data)
        pub fn write_data(&mut self, data: &[u8]) -> Result<usize, WriteDataError> {
            let Some(ssl) = self.ssl else {
                return Err(WriteDataError::ConnectionClosed);
            };

            // shutdown is sent we cannot write anymore
            if self.flags.sent_ssl_shutdown() {
                return Err(WriteDataError::ConnectionClosed);
            }

            if data.is_empty() {
                // just cycle through internal openssl's state
                self.handle_traffic();
                return Ok(0);
            }
            // SAFETY: ssl is a live SSL*; data is a valid &[u8] for len bytes.
            let written = unsafe {
                boring_sys::SSL_write(
                    ssl.as_ptr(),
                    data.as_ptr().cast::<c_void>(),
                    c_int::try_from(data.len()).expect("int cast"),
                )
            };
            if written <= 0 {
                // SAFETY: ssl is still valid.
                let err = unsafe { boring_sys::SSL_get_error(ssl.as_ptr(), written) };
                boring_sys::ERR_clear_error();

                if err == boring_sys::SSL_ERROR_WANT_READ {
                    // we wanna read/write
                    self.handle_traffic();
                    return Err(WriteDataError::WantRead);
                }
                if err == boring_sys::SSL_ERROR_WANT_WRITE {
                    // we wanna read/write
                    self.handle_traffic();
                    return Err(WriteDataError::WantWrite);
                }
                // some bad error happened here we must close
                self.flags.set_fatal_error(
                    err == boring_sys::SSL_ERROR_SSL || err == boring_sys::SSL_ERROR_SYSCALL,
                );
                self.trigger_close_callback();
                return Err(WriteDataError::ConnectionClosed);
            }
            self.handle_traffic();
            Ok(usize::try_from(written).expect("int cast"))
        }

        /// Explicit teardown. Idempotent (`.take()`); also runs from `Drop` so
        /// `Option<SSLWrapper>` owners (UpgradedDuplex / WindowsNamedPipe) free
        /// the BoringSSL handles by setting the field to `None`.
        pub fn deinit(&mut self) {
            self.flags.set_closed_notified(true);
            if let Some(ssl) = self.ssl.take() {
                // SAFETY: ssl was created by SSL_new and is owned by self; SSL_free also frees the input and output BIOs.
                unsafe { boring_sys::SSL_free(ssl.as_ptr()) };
            }
            if let Some(ctx) = self.ctx.take() {
                // SAFETY: ctx ref was adopted in init/init_with_ctx; SSL_CTX_free decrements the C refcount and frees the SSL context and all the certificates when it hits zero.
                unsafe { boring_sys::SSL_CTX_free(ctx.as_ptr()) };
            }
        }

        fn trigger_handshake_callback(&mut self, success: bool, result: us_bun_verify_error_t) {
            if self.flags.closed_notified() {
                return;
            }
            self.flags.set_authorized(success);
            // trigger the handshake callback
            (self.handlers.on_handshake)(self.handlers.ctx, success, result);
        }

        fn trigger_wanna_write_callback(&mut self, data: &[u8]) {
            if self.flags.closed_notified() {
                return;
            }
            // trigger the write callback
            (self.handlers.write)(self.handlers.ctx, data);
        }

        fn trigger_data_callback(&mut self, data: &[u8]) {
            if self.flags.closed_notified() {
                return;
            }
            // trigger the onData callback
            (self.handlers.on_data)(self.handlers.ctx, data);
        }

        fn trigger_close_callback(&mut self) {
            if self.flags.closed_notified() {
                return;
            }
            self.flags.set_closed_notified(true);
            // trigger the onClose callback
            (self.handlers.on_close)(self.handlers.ctx);
        }

        fn get_verify_error(&self) -> us_bun_verify_error_t {
            if self.is_shutdown() {
                return us_bun_verify_error_t::default();
            }
            let Some(ssl) = self.ssl else {
                return us_bun_verify_error_t::default();
            };
            // SAFETY: ssl is a live SSL*; uSockets helper reads the verify result off it.
            unsafe { us_ssl_socket_verify_error_from_ssl(ssl.as_ptr()) }
        }

        /// Update the handshake state. Returns true if we can call handle_reading.
        fn update_handshake_state(&mut self) -> bool {
            // PORT_NOTES_PLAN R-2: `&mut self` carries LLVM `noalias`, but
            // `shutdown()` / `trigger_close_callback()` /
            // `trigger_handshake_callback()` invoke the user-supplied handler
            // vtable which can re-enter via a fresh `&mut SSLWrapper` from the
            // owning socket and write `self.flags` / `self.ssl`. ASM-verified
            // PROVEN_CACHED on `self.flags` reads after those calls. Launder
            // so all field accesses go through an opaque pointer; mirrors the
            // cork fix at b818e70e1c57. All field access goes through
            // [`Self::r`], whose doc comment carries the encapsulated SAFETY
            // proof.
            let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
            if Self::r(this).flags.closed_notified() {
                return false;
            }
            let Some(ssl) = Self::r(this).ssl else {
                return false;
            };

            // SAFETY: ssl is a live SSL*.
            if unsafe { boring_sys::SSL_is_init_finished(ssl.as_ptr()) } != 0 {
                // handshake already completed nothing to do here
                // SAFETY: ssl is a live SSL*.
                if (unsafe { boring_sys::SSL_get_shutdown(ssl.as_ptr()) }
                    & boring_sys::SSL_RECEIVED_SHUTDOWN)
                    != 0
                {
                    // we received a shutdown
                    Self::r(this).flags.set_received_ssl_shutdown(true);
                    // 2-step shutdown
                    let _ = Self::r(this).shutdown(false);
                    Self::r(this).trigger_close_callback();

                    return false;
                }
                return true;
            }

            if Self::r(this).flags.handshake_state()
                == HandshakeState::HandshakeRenegotiationPending
            {
                // we are in the middle of a renegotiation need to call read/write
                return true;
            }

            // SAFETY: ssl is a live SSL*.
            let result = unsafe { boring_sys::SSL_do_handshake(ssl.as_ptr()) };

            if result <= 0 {
                // SAFETY: ssl is still valid.
                let err = unsafe { boring_sys::SSL_get_error(ssl.as_ptr(), result) };
                boring_sys::ERR_clear_error();
                if err == boring_sys::SSL_ERROR_ZERO_RETURN {
                    // Remotely-Initiated Shutdown
                    // See: https://www.openssl.org/docs/manmaster/man3/SSL_shutdown.html
                    Self::r(this).flags.set_received_ssl_shutdown(true);
                    // 2-step shutdown
                    let _ = Self::r(this).shutdown(false);
                    Self::r(this).handle_end_of_renegotiation();
                    return false;
                }
                // as far as I know these are the only errors we want to handle
                if err != boring_sys::SSL_ERROR_WANT_READ && err != boring_sys::SSL_ERROR_WANT_WRITE
                {
                    // clear per thread error queue if it may contain something
                    Self::r(this).flags.set_fatal_error(
                        err == boring_sys::SSL_ERROR_SSL || err == boring_sys::SSL_ERROR_SYSCALL,
                    );

                    Self::r(this)
                        .flags
                        .set_handshake_state(HandshakeState::HandshakeCompleted);
                    let verify = Self::r(this).get_verify_error();
                    Self::r(this).trigger_handshake_callback(false, verify);

                    if Self::r(this).flags.fatal_error() {
                        Self::r(this).trigger_close_callback();
                        return false;
                    }
                    return true;
                }
                Self::r(this)
                    .flags
                    .set_handshake_state(HandshakeState::HandshakePending);
                return true;
            }

            // handshake completed
            Self::r(this)
                .flags
                .set_handshake_state(HandshakeState::HandshakeCompleted);
            let verify = Self::r(this).get_verify_error();
            Self::r(this).trigger_handshake_callback(true, verify);

            true
        }

        /// Handle the end of a renegotiation if it was pending. This function
        /// is called when we receive a SSL_ERROR_ZERO_RETURN or successfully
        /// read data.
        fn handle_end_of_renegotiation(&mut self) {
            if self.flags.handshake_state() == HandshakeState::HandshakeRenegotiationPending
                && (self.ssl.is_none()
                    // SAFETY: ssl is Some and live in this branch.
                    || unsafe { boring_sys::SSL_is_init_finished(self.ssl.unwrap().as_ptr()) } != 0)
            {
                // renegotiation ended successfully call on_handshake
                self.flags
                    .set_handshake_state(HandshakeState::HandshakeCompleted);
                let verify = self.get_verify_error();
                self.trigger_handshake_callback(true, verify);
            }
        }

        /// Handle reading data. Returns true if we can call handle_writing.
        fn handle_reading(&mut self, buffer: &mut [u8; BUFFER_SIZE]) -> bool {
            let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
            let mut read: usize = 0;

            // read data from the input BIO
            loop {
                log!("handleReading");
                let Some(ssl) = Self::r(this).ssl else {
                    return false;
                };

                let available = &mut buffer[read..];
                // SAFETY: ssl is a live SSL*; available is a valid mutable slice.
                let just_read = unsafe {
                    boring_sys::SSL_read(
                        ssl.as_ptr(),
                        available.as_mut_ptr().cast::<c_void>(),
                        c_int::try_from(available.len()).expect("int cast"),
                    )
                };
                log!("just read {}", just_read);
                if just_read <= 0 {
                    // SAFETY: ssl is still valid.
                    let err = unsafe { boring_sys::SSL_get_error(ssl.as_ptr(), just_read) };
                    boring_sys::ERR_clear_error();

                    if err != boring_sys::SSL_ERROR_WANT_READ
                        && err != boring_sys::SSL_ERROR_WANT_WRITE
                    {
                        if err == boring_sys::SSL_ERROR_WANT_RENEGOTIATE {
                            Self::r(this)
                                .flags
                                .set_handshake_state(HandshakeState::HandshakeRenegotiationPending);
                            // An over-limit renegotiation request is treated
                            // like a failed SSL_renegotiate(). The count
                            // resets each MAX_RENEGOTIATION_WINDOW, matching
                            // the C path's `us_reneg_policy`.
                            let now = std::time::Instant::now();
                            match Self::r(this).renegotiation_window_start {
                                Some(start)
                                    if now.duration_since(start) < MAX_RENEGOTIATION_WINDOW => {}
                                _ => {
                                    Self::r(this).renegotiation_window_start = Some(now);
                                    Self::r(this).renegotiation_count = 0;
                                }
                            }
                            let renegotiation_allowed =
                                Self::r(this).renegotiation_count < MAX_RENEGOTIATIONS;
                            Self::r(this).renegotiation_count =
                                Self::r(this).renegotiation_count.saturating_add(1);
                            // SAFETY: ssl is still valid.
                            let renegotiated = renegotiation_allowed
                                && unsafe { boring_sys::SSL_renegotiate(ssl.as_ptr()) } != 0;
                            if !renegotiated {
                                Self::r(this)
                                    .flags
                                    .set_handshake_state(HandshakeState::HandshakeCompleted);
                                // we failed to renegotiate
                                let verify = Self::r(this).get_verify_error();
                                Self::r(this).trigger_handshake_callback(false, verify);
                                Self::r(this).trigger_close_callback();
                                return false;
                            }
                            // ok, we are done here, we need to call SSL_read again
                            // this dont mean that we are done with the handshake renegotiation
                            // we need to call SSL_read again
                            continue;
                        } else if err == boring_sys::SSL_ERROR_ZERO_RETURN {
                            // Remotely-Initiated Shutdown
                            // See: https://www.openssl.org/docs/manmaster/man3/SSL_shutdown.html
                            Self::r(this).flags.set_received_ssl_shutdown(true);
                            // 2-step shutdown
                            let _ = Self::r(this).shutdown(false);
                            Self::r(this).handle_end_of_renegotiation();
                        }
                        if err == boring_sys::SSL_ERROR_SSL || err == boring_sys::SSL_ERROR_SYSCALL
                        {
                            Self::r(this).flags.set_fatal_error(true);
                        }

                        // flush the reading
                        if read > 0 {
                            log!("triggering data callback (read {})", read);
                            Self::r(this).trigger_data_callback(&buffer[0..read]);
                            // The data callback may have closed the connection
                            if Self::r(this).ssl.is_none() || Self::r(this).flags.closed_notified()
                            {
                                return false;
                            }
                        }
                        // A NewSessionTicket/keylog line that rode in ahead of the
                        // peer's close_notify is still parked; deliver it before the
                        // close tears the wrapper down (mirrors the C ZERO_RETURN path).
                        Self::flush_pending_events(this, buffer);
                        if Self::r(this).ssl.is_none() || Self::r(this).flags.closed_notified() {
                            return false;
                        }
                        Self::r(this).trigger_close_callback();
                        return false;
                    } else {
                        log!("wanna read/write just break");
                        // we wanna read/write just break
                        break;
                    }
                }

                Self::r(this).handle_end_of_renegotiation();

                read += usize::try_from(just_read).expect("int cast");
                if read == buffer.len() {
                    log!(
                        "triggering data callback (read {}) and resetting read buffer",
                        read
                    );
                    // we filled the buffer
                    Self::r(this).trigger_data_callback(&buffer[0..read]);
                    // The callback may have closed the connection - check before continuing
                    // Check ssl first as a proxy for whether we were deinited
                    if Self::r(this).ssl.is_none() || Self::r(this).flags.closed_notified() {
                        return false;
                    }
                    read = 0;
                }
            }
            // we finished reading
            if read > 0 {
                log!("triggering data callback (read {})", read);
                Self::r(this).trigger_data_callback(&buffer[0..read]);
                // The callback may have closed the connection
                // Check ssl first as a proxy for whether we were deinited
                if Self::r(this).ssl.is_none() || Self::r(this).flags.closed_notified() {
                    return false;
                }
            }
            true
        }

        fn handle_writing(&mut self, buffer: &mut [u8]) {
            // PORT_NOTES_PLAN R-2: `&mut self` carries LLVM `noalias`, but
            // `trigger_wanna_write_callback` invokes the user-supplied
            // `handlers.write` which can re-enter via a fresh
            // `&mut SSLWrapper` from the owning socket and `deinit()` (sets
            // `self.ssl = None`). LLVM was caching `self.ssl` across the
            // callback (ASM-verified PROVEN_CACHED), so the next loop
            // iteration's `let Some(ssl) = self.ssl` saw the stale `Some`
            // and called `SSL_get_wbio` on a freed `SSL*`. Launder so each
            // iteration re-reads `ssl` through an opaque pointer; mirrors the
            // cork fix at b818e70e1c57. All field access goes through
            // [`Self::r`], whose doc comment carries the encapsulated SAFETY
            // proof.
            let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
            let mut read: usize = 0;
            loop {
                let Some(ssl) = Self::r(this).ssl else { return };
                // SAFETY: ssl is a live SSL*; wbio bound in init_with_ctx.
                let Some(output) = NonNull::new(unsafe { boring_sys::SSL_get_wbio(ssl.as_ptr()) })
                else {
                    return;
                };
                let available = &mut buffer[read..];
                // SAFETY: output is a valid BIO*; available is a valid mutable slice.
                let just_read = unsafe {
                    boring_sys::BIO_read(
                        output.as_ptr(),
                        available.as_mut_ptr().cast::<c_void>(),
                        c_int::try_from(available.len()).expect("int cast"),
                    )
                };
                if just_read > 0 {
                    read += usize::try_from(just_read).expect("int cast");
                    if read == buffer.len() {
                        Self::r(this).trigger_wanna_write_callback(&buffer[0..read]);
                        read = 0;
                    }
                } else {
                    break;
                }
            }
            if read > 0 {
                Self::r(this).trigger_wanna_write_callback(&buffer[0..read]);
            }
        }

        fn handle_traffic(&mut self) {
            let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
            // always handle the handshake first
            if Self::r(this).update_handshake_state() {
                // shared stack buffer for reading and writing
                // PERF: 64KiB on-stack array — verify stack-size headroom.
                let mut buffer = [0u8; BUFFER_SIZE];
                // drain the input BIO first
                Self::r(this).handle_writing(&mut buffer);

                // drain the output BIO in loop, because read can trigger writing and vice versa
                while Self::r(this).has_pending_read() && Self::r(this).handle_reading(&mut buffer)
                {
                    // read data can trigger writing so we need to handle it
                    Self::r(this).handle_writing(&mut buffer);
                }

                // The SSL_do_handshake/SSL_read calls above may have parked
                // new-session tickets / keylog lines (BoringSSL surfaces them
                // mid-read, where dispatching JS could free the SSL out from
                // under the caller). The stack has unwound here, so hand them
                // to the owner - same ordering as the C path's
                // ssl_flush_pending_session: handshake/data callbacks first,
                // then sessions.
                Self::flush_pending_events(this, &mut buffer);
            }
        }

        /// Drain the parked new-session / keylog queues into the owner's
        /// callbacks. Only SSLs whose handlers opted in ever park (see
        /// `init_with_ctx`), so this is a no-op FFI probe otherwise. The
        /// callbacks run JS which may close the wrapper; `self.ssl` is
        /// re-checked between pops and nothing else of `self` is borrowed
        /// across a dispatch.
        fn flush_pending_events(this: *mut Self, buffer: &mut [u8; BUFFER_SIZE]) {
            if Self::r(this).handlers.on_session.is_some() {
                loop {
                    let Some(ssl) = Self::r(this).ssl else { return };
                    // SAFETY: ssl is live (checked above); buffer is writable
                    // for BUFFER_SIZE bytes, which covers the 64 KB parking cap.
                    let len = unsafe {
                        us_ssl_pop_pending_session(
                            ssl.as_ptr(),
                            buffer.as_mut_ptr(),
                            c_int::try_from(BUFFER_SIZE).expect("int cast"),
                        )
                    };
                    if len <= 0 {
                        break;
                    }
                    if let Some(on_session) = Self::r(this).handlers.on_session {
                        on_session(Self::r(this).handlers.ctx, &buffer[..len as usize]);
                    }
                }
            }
            if Self::r(this).handlers.on_keylog.is_some() {
                loop {
                    let Some(ssl) = Self::r(this).ssl else { return };
                    // SAFETY: same as the session pop above; keylog entries
                    // are capped at 4 KB+1, well within BUFFER_SIZE.
                    let len = unsafe {
                        us_ssl_pop_pending_keylog(
                            ssl.as_ptr(),
                            buffer.as_mut_ptr(),
                            c_int::try_from(BUFFER_SIZE).expect("int cast"),
                        )
                    };
                    if len <= 0 {
                        break;
                    }
                    if let Some(on_keylog) = Self::r(this).handlers.on_keylog {
                        on_keylog(Self::r(this).handlers.ctx, &buffer[..len as usize]);
                    }
                }
            }
        }
    }

    impl<T: Copy> Drop for SSLWrapper<T> {
        fn drop(&mut self) {
            // `deinit()` is idempotent (Option::take on both NonNull fields), so
            // an explicit `deinit()` followed by drop is a no-op the second time.
            self.deinit();
        }
    }

    /// `us_verify_callback` equivalent — let the handshake complete regardless of
    /// verify result so JS reads `authorizationError` and `rejectUnauthorized`
    /// decides, instead of BoringSSL aborting mid-flight.
    // Body is a constant `1` with no preconditions; the safe fn item still
    // coerces to the `SSL_verify_cb` fn-pointer type at the `Some(..)` site.
    extern "C" fn always_continue_verify(_: c_int, _: *mut boring_sys::X509_STORE_CTX) -> c_int {
        1
    }

    unsafe extern "C" {
        /// Process-wide bundled root store from `root_certs.cpp` — built once and
        /// up_ref'd per consumer so the ~150-cert load happens once total, not per
        /// CTX. Returns null if root loading fails (treated as "no roots").
        // safe: no args; idempotent lazy init reading a process global — no preconditions.
        safe fn us_get_shared_default_ca_store() -> *mut boring_sys::X509_STORE;
        /// Implemented in uSockets C; reads
        /// `SSL_get_verify_result` and maps it onto the C `us_bun_verify_error_t`.
        fn us_ssl_socket_verify_error_from_ssl(ssl: *mut boring_sys::SSL) -> us_bun_verify_error_t;
        /// Opt this SSL into the parked new-session/keylog queues
        /// (openssl.c's `us_ssl_new_session_cb` / `us_ssl_keylog_cb` skip
        /// SSLs without the marker).
        // SAFETY (unsafe fn): `ssl` must be a live `SSL*`.
        fn us_ssl_enable_pending_events(ssl: *mut boring_sys::SSL);
        /// Pop the oldest parked session/keylog entry into `out`; returns the
        /// entry length or 0 when the queue is empty.
        // SAFETY (unsafe fn): `ssl` live; `out` writable for `out_cap` bytes.
        fn us_ssl_pop_pending_session(
            ssl: *mut boring_sys::SSL,
            out: *mut u8,
            out_cap: c_int,
        ) -> c_int;
        // SAFETY (unsafe fn): `ssl` live; `out` writable for `out_cap` bytes.
        fn us_ssl_pop_pending_keylog(
            ssl: *mut boring_sys::SSL,
            out: *mut u8,
            out_cap: c_int,
        ) -> c_int;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Loop / InternalLoopData
// ═══════════════════════════════════════════════════════════════════════════
// Mirrors `struct us_internal_loop_data_t` (packages/bun-usockets/src/internal/
// loop_data.h) and `struct us_loop_t` (epoll_kqueue.h / libuv.h). Re-exported
// from bun_uws_sys so `bun_uws::Loop` and `bun_uws_sys::Loop` are the same
// type (bun_io's EventLoopCtxVTable is typed against the uws_sys version).
pub use bun_uws_sys::loop_::{LoopHandler, us_wakeup_loop};
pub use bun_uws_sys::{InternalLoopData, Loop, NOW_NS_UNKNOWN, PosixLoop, Timespec, WindowsLoop};

/// Carrier trait so `set_parent_event_loop` can accept the higher-tier
/// `EventLoopHandle` without depending on it. The event-loop crate impls this
/// on its enum (`.js` → tag 1, `.mini` → tag 2).
pub trait ParentEventLoopHandle {
    fn into_tag_ptr(self) -> (core::ffi::c_char, *mut c_void);
}

/// Extension methods on the re-exported `bun_uws_sys::InternalLoopData` for the
/// typed parent-loop accessors. The sys crate only stores tag+ptr; this tier
/// adds the trait-generic setter and the panicking getter that callers use.
pub trait InternalLoopDataExt {
    fn set_parent_event_loop<H: ParentEventLoopHandle>(&mut self, parent: H);
    fn get_parent(&self) -> (core::ffi::c_char, *mut c_void);
}

impl InternalLoopDataExt for InternalLoopData {
    /// Tag 1 = JS
    /// event loop, tag 2 = mini event loop. Generic over the handle so this
    /// crate stays free of the `jsc` dependency.
    #[inline]
    fn set_parent_event_loop<H: ParentEventLoopHandle>(&mut self, parent: H) {
        let (tag, ptr) = parent.into_tag_ptr();
        self.set_parent_raw(tag, ptr);
    }

    /// Low tier returns the (tag, ptr)
    /// pair; the typed enum wrapper lives in the higher-tier crate that can
    /// name `jsc::EventLoop` / `jsc::MiniEventLoop`.
    #[inline]
    fn get_parent(&self) -> (core::ffi::c_char, *mut c_void) {
        self.get_parent_raw()
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SocketGroup
// ═══════════════════════════════════════════════════════════════════════════
// Re-exported from `bun_uws_sys` so this crate and `_sys` name the SAME
// `#[repr(C)]` mirror of `struct us_socket_group_t`. The previous duplicate
// definition forced callers (e.g. `socket_body.rs` start_tls) to
// `.cast::<bun_uws_sys::SocketGroup>()` between two layout-identical types.

/// Alias for the per-group C vtable struct under its pre-merge name.
pub use bun_uws_sys::socket_group::VTable as SocketGroupVTable;
pub use bun_uws_sys::{ConnectResult, SocketGroup};

// ═══════════════════════════════════════════════════════════════════════════
// SocketContext::BunSocketContextOptions
// ═══════════════════════════════════════════════════════════════════════════
pub mod SocketContext {
    /// `#[repr(C)]` mirror of `us_bun_socket_context_options_t`. What
    /// `SSLConfig.asUSockets()` produces and `us_ssl_ctx_from_options` consumes.
    /// The struct body, `Default`, `digest()` and `create_ssl_context()` live in
    /// `bun_uws_sys`; re-exported so this crate and `_sys` share one definition
    /// (callers in higher tiers pass values to `_sys` constructors directly).
    pub use bun_uws_sys::BunSocketContextOptions;
}
/// Snake-case module alias.
pub use SocketContext as socket_context;

/// C-name alias for `SocketContext::BunSocketContextOptions` — what
/// `SSLConfig.asUSockets()` produces and `us_ssl_ctx_from_options` consumes.
/// Higher tiers (http, runtime/socket) reference it under the C struct name.
pub type us_bun_socket_context_options_t = SocketContext::BunSocketContextOptions;

// ═══════════════════════════════════════════════════════════════════════════
// SocketKind (a.k.a. DispatchKind) / CloseKind
// ═══════════════════════════════════════════════════════════════════════════

/// Re-exported from `bun_uws_sys` so dispatch tables in both crates agree on
/// one `#[repr(u8)]` enum.
pub use bun_uws_sys::SocketKind;

/// Alias used by some callers (`websocket_client`, `sql_jsc`) that named
/// the dispatch tag `DispatchKind`. Same enum.
pub type DispatchKind = SocketKind;

pub use bun_uws_sys::CloseCode;
/// Legacy alias — `bun_uws_sys::CloseCode` is the one canonical `#[repr(i32)]`
/// enum (`normal`/`failure`/`fast_shutdown`, with `Normal`/`Failure`/
/// `FastShutdown` associated-const aliases).
pub type CloseKind = CloseCode;

// ═══════════════════════════════════════════════════════════════════════════
// Socket handlers (NewSocketHandler / SocketHandler / AnySocket)
// ═══════════════════════════════════════════════════════════════════════════
// Re-exported from `bun_uws_sys::socket` — that is the ONE canonical
// definition. Do NOT add a parallel `InternalSocket` / `NewSocketHandler`
// here again; an earlier "thin placeholder" that grew full bodies has been
// deleted.
pub use bun_uws_sys::socket::{
    AnySocket, ConnectError, InternalSocket, NewSocketHandler, SocketHandler, SocketTCP, SocketTLS,
    SocketTcp, SocketTls,
};

/// Runtime-tagged TCP/TLS socket with a `None` arm for the "no active socket"
/// state. Used by proxy-tunnel layers (HTTP `ProxyTunnel`, WebSocket
/// `WebSocketProxyTunnel`) where the inner socket may be either transport and
/// may be detached. Distinct from [`AnySocket`] which has no `None` variant.
pub enum MaybeAnySocket {
    Tcp(SocketTCP),
    Ssl(SocketTLS),
    None,
}

impl MaybeAnySocket {
    /// Convert a const-generic `NewSocketHandler<IS_SSL>` to the runtime-tagged
    /// enum. `NewSocketHandler<true>` and `<false>` are layout-identical
    /// (`#[derive(Copy)]` over a single `InternalSocket` field); only the const
    /// generic differs.
    #[inline]
    pub fn from_generic<const IS_SSL: bool>(socket: NewSocketHandler<IS_SSL>) -> Self {
        // `assume_ssl`/`assume_tcp` are safe field moves with a matching
        // `debug_assert!(SSL)` — the const generic only gates `get_native_handle`.
        if IS_SSL {
            MaybeAnySocket::Ssl(socket.assume_ssl())
        } else {
            MaybeAnySocket::Tcp(socket.assume_tcp())
        }
    }

    #[inline]
    pub fn write(&self, data: &[u8]) -> i32 {
        match self {
            MaybeAnySocket::Tcp(s) => s.write(data),
            MaybeAnySocket::Ssl(s) => s.write(data),
            MaybeAnySocket::None => 0,
        }
    }

    #[inline]
    pub fn is_closed(&self) -> bool {
        match self {
            MaybeAnySocket::Tcp(s) => s.is_closed(),
            MaybeAnySocket::Ssl(s) => s.is_closed(),
            MaybeAnySocket::None => true,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// AnyRequest / AnyResponse
// ═══════════════════════════════════════════════════════════════════════════

/// Transport-agnostic request handle. Static/file routes take this so the same
/// handler body serves HTTP/1.1 and HTTP/3. Re-exported from `bun_uws_sys` —
/// the sys-crate version already carries `header`/`method`/`url`/`set_yield`,
/// so route handlers need no local extension trait.
/// Variants: `H1(*mut Request)`, `H3(*mut H3::Request)` (same field types as
/// the previous local enum — both crates name `bun_uws_sys::{Request, h3::Request}`).
pub use bun_uws_sys::AnyRequest;

/// `uws::Response<SSL>` — re-exported from `bun_uws_sys` so callers get the full
/// method surface (`write`/`end`/`try_end`/`on_aborted`/`on_writable`/...) without
/// a separate local opaque. Both are `#[repr(C)]` zero-sized handles, so this is
/// a pure namespace reconciliation.
pub type Response<const SSL: bool> = bun_uws_sys::response::Response<SSL>;

/// Transport-agnostic response handle. Re-exported from `bun_uws_sys` — the
/// sys-crate version already carries the full dispatch impl (`write`, `end`,
/// `try_end`, `on_aborted`, `on_writable`, `corked`, `write_status`,
/// `write_header`, `end_stream`, `clear_*`, `timeout`, `state`, `upgrade`, ...).
/// Variants: `SSL(*mut Response<true>)`, `TCP(*mut Response<false>)`,
/// `H3(*mut H3::Response)`.
pub use bun_uws_sys::AnyResponse;

pub use bun_uws_sys::response::WriteResult;
