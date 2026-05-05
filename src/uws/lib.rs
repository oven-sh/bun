use core::ffi::{c_char, c_int, c_uint, c_void};

use bun_str::ZStr;

// ──────────────────────────────────────────────────────────────────────────
// Thin re-exports from uws_sys / runtime
// ──────────────────────────────────────────────────────────────────────────

pub use bun_uws_sys::us_socket_t::us_socket_t;
pub use bun_uws_sys::us_socket_t::us_socket_stream_buffer_t;
pub use bun_uws_sys::socket::SocketTLS;
pub use bun_uws_sys::socket::SocketTCP;
pub use bun_uws_sys::socket::InternalSocket;
pub type Socket = us_socket_t;
pub use bun_uws_sys::timer::Timer;
pub use bun_uws_sys::socket_group::SocketGroup;
pub use bun_uws_sys::socket_kind::SocketKind;
pub use bun_uws_sys::vtable;
pub use bun_runtime::socket::uws_dispatch as dispatch;
/// The opaque `us_socket_context_t` is gone; this namespace now only carries
/// the SSL-options extern struct (`SSLConfig.asUSockets()` return type).
// TODO(port): module aliased to PascalCase to mirror Zig namespace; revisit in Phase B.
pub use bun_uws_sys::socket_context as SocketContext;
/// Bare BoringSSL `SSL_CTX`. `SSL_CTX_up_ref`/`SSL_CTX_free` is the refcount;
/// policy (verify mode, reneg limits) is encoded on the SSL_CTX itself via
/// `us_ssl_ctx_from_options`, so there's no wrapper struct. `Option<*mut SslCtx>`
/// is what listen/connect/adopt take.
pub type SslCtx = bun_boringssl::c::SSL_CTX;
pub use bun_uws_sys::connecting_socket::ConnectingSocket;
pub use bun_uws_sys::internal_loop_data::InternalLoopData;
// TODO(port): module aliased to PascalCase to mirror Zig namespace; revisit in Phase B.
pub use bun_runtime::socket::windows_named_pipe as WindowsNamedPipe;
pub use bun_uws_sys::loop_::PosixLoop;
pub use bun_uws_sys::loop_::WindowsLoop;
pub use bun_uws_sys::request::Request;
pub use bun_uws_sys::request::AnyRequest;
pub use bun_uws_sys::response::AnyResponse;
pub use bun_uws_sys::app::NewApp;
pub use bun_uws_sys::response::uws_res;
pub use bun_uws_sys::web_socket::RawWebSocket;
pub use bun_uws_sys::web_socket::AnyWebSocket;
pub use bun_uws_sys::web_socket::WebSocketBehavior;
pub use bun_uws_sys::socket::AnySocket;
pub use bun_uws_sys::socket::NewSocketHandler;
// TODO(port): module aliased to PascalCase to mirror Zig namespace; revisit in Phase B.
pub use bun_runtime::socket::upgraded_duplex as UpgradedDuplex;
pub use bun_uws_sys::listen_socket::ListenSocket;
pub use bun_uws_sys::response::State;
pub use bun_uws_sys::loop_::Loop;
pub use bun_uws_sys::udp;
pub use bun_uws_sys::body_reader_mixin::BodyReaderMixin;
pub use bun_uws_sys::h3 as H3;
pub use bun_uws_sys::quic;

/// uWS C++ `WebSocketContext<SSL,true,UserData>*`. Only ever produced by the
/// upgrade-handler thunk and round-tripped to `uws_res_upgrade`; Rust never
/// dereferences it. Typed as a named opaque so it can't be confused with the
/// dozen other handles that flow through the upgrade path.
#[repr(C)]
pub struct WebSocketUpgradeContext {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

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
    // PERF(port): was comptime monomorphization — profile in Phase B
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

pub const LIBUS_TIMEOUT_GRANULARITY: i32 = 4;
pub const LIBUS_RECV_BUFFER_PADDING: i32 = 32;
pub const LIBUS_EXT_ALIGNMENT: i32 = 16;

pub const _COMPRESSOR_MASK: i32 = 255;
pub const _DECOMPRESSOR_MASK: i32 = 3840;
pub const DISABLED: i32 = 0;
pub const SHARED_COMPRESSOR: i32 = 1;
pub const SHARED_DECOMPRESSOR: i32 = 256;
pub const DEDICATED_DECOMPRESSOR_32KB: i32 = 3840;
pub const DEDICATED_DECOMPRESSOR_16KB: i32 = 3584;
pub const DEDICATED_DECOMPRESSOR_8KB: i32 = 3328;
pub const DEDICATED_DECOMPRESSOR_4KB: i32 = 3072;
pub const DEDICATED_DECOMPRESSOR_2KB: i32 = 2816;
pub const DEDICATED_DECOMPRESSOR_1KB: i32 = 2560;
pub const DEDICATED_DECOMPRESSOR_512B: i32 = 2304;
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

pub const LIBUS_LISTEN_DEFAULT: i32 = 0;
pub const LIBUS_LISTEN_EXCLUSIVE_PORT: i32 = 1;
pub const LIBUS_SOCKET_ALLOW_HALF_OPEN: i32 = 2;
pub const LIBUS_LISTEN_REUSE_PORT: i32 = 4;
pub const LIBUS_SOCKET_IPV6_ONLY: i32 = 8;
pub const LIBUS_LISTEN_REUSE_ADDR: i32 = 16;
pub const LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE: i32 = 32;

// TODO: refactor to error union
#[repr(C)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum create_bun_socket_error_t {
    none = 0,
    load_ca_file,
    invalid_ca_file,
    invalid_ca,
    invalid_ciphers,
}

impl create_bun_socket_error_t {
    pub fn message(self) -> Option<&'static [u8]> {
        match self {
            Self::none => None,
            Self::load_ca_file => Some(b"Failed to load CA file"),
            Self::invalid_ca_file => Some(b"Invalid CA file"),
            Self::invalid_ca => Some(b"Invalid CA"),
            Self::invalid_ciphers => Some(b"Invalid ciphers"),
        }
    }

    // Zig: `pub const toJS = @import("../runtime/socket/uws_jsc.zig").createBunSocketErrorToJS;`
    // Deleted per PORTING.md — `to_js` lives as an extension trait in the *_jsc crate.
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct us_bun_verify_error_t {
    pub error_no: i32,
    pub code: *const c_char,
    pub reason: *const c_char,
}

impl Default for us_bun_verify_error_t {
    fn default() -> Self {
        Self {
            error_no: 0,
            code: core::ptr::null(),
            reason: core::ptr::null(),
        }
    }
}

// Zig: `pub const toJS = @import("../runtime/socket/uws_jsc.zig").verifyErrorToJS;`
// Deleted per PORTING.md — `to_js` lives as an extension trait in the *_jsc crate.

pub struct SocketAddress {
    // TODO(port): lifetime — Zig `[]const u8` field with no deinit; likely borrows a socket buffer.
    pub ip: Box<[u8]>,
    pub port: i32,
    pub is_ipv6: bool,
}

/// WebSocket frame opcode. Zig uses an open `enum(i32)` (`_` catch-all), so any
/// i32 is a valid bit pattern — modeled here as a transparent newtype.
// TODO(port): open enum — verify callers don't need exhaustive `match`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct Opcode(pub i32);

impl Opcode {
    pub const CONTINUATION: Opcode = Opcode(0);
    pub const TEXT: Opcode = Opcode(1);
    pub const BINARY: Opcode = Opcode(2);
    pub const CLOSE: Opcode = Opcode(8);
    pub const PING: Opcode = Opcode(9);
    pub const PONG: Opcode = Opcode(10);
}

#[repr(C)] // c_uint
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SendStatus {
    Backpressure = 0,
    Success = 1,
    Dropped = 2,
}

// TODO(port): move to uws_sys
unsafe extern "C" {
    fn bun_clear_loop_at_thread_exit();
}

pub fn on_thread_exit() {
    // SAFETY: FFI call with no preconditions; clears thread-local loop pointer.
    unsafe { bun_clear_loop_at_thread_exit() }
}

#[unsafe(no_mangle)]
pub extern "C" fn BUN__warn__extra_ca_load_failed(filename: *const c_char, error_msg: *const c_char) {
    // SAFETY: C++ caller passes valid NUL-terminated strings.
    let filename = unsafe { core::ffi::CStr::from_ptr(filename) };
    let error_msg = unsafe { core::ffi::CStr::from_ptr(error_msg) };
    bun_core::Output::warn(format_args!(
        "ignoring extra certs from {}, load failed: {}",
        bstr::BStr::new(filename.to_bytes()),
        bstr::BStr::new(error_msg.to_bytes()),
    ));
}

#[cfg(windows)]
pub type LIBUS_SOCKET_DESCRIPTOR = *mut c_void;
#[cfg(not(windows))]
pub type LIBUS_SOCKET_DESCRIPTOR = i32;

mod c {
    // TODO(port): move to uws_sys
    unsafe extern "C" {
        pub fn us_get_default_ciphers() -> *const core::ffi::c_char;
    }
}

pub fn get_default_ciphers() -> &'static ZStr {
    // SAFETY: us_get_default_ciphers returns a static NUL-terminated string.
    unsafe { ZStr::from_ptr(c::us_get_default_ciphers().cast()) }
}

// ═══════════════════════════════════════════════════════════════════════════
// MOVE-IN: ssl_wrapper (MOVE_DOWN bun_runtime::socket::ssl_wrapper → bun_uws)
// Ground truth: src/runtime/socket/ssl_wrapper.zig
// Requested by: http_jsc (CYCLEBREAK §move-in → uws)
// ═══════════════════════════════════════════════════════════════════════════
pub mod ssl_wrapper {
    use core::ffi::{c_int, c_void};
    use core::ptr::NonNull;

    use bun_boringssl_sys as boring_sys;

    use crate::{create_bun_socket_error_t, us_bun_verify_error_t};

    bun_output::declare_scope!(SSLWrapper, hidden);

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

    pub struct SSLWrapper<T: Copy> {
        pub handlers: Handlers<T>,
        pub ssl: Option<NonNull<boring_sys::SSL>>,
        pub ctx: Option<NonNull<boring_sys::SSL_CTX>>,
        pub flags: Flags,
    }

    /// CamelCase alias for callers that imported the Zig name through the
    /// snake_case→CamelCase rewriter (e.g. `http_jsc`).
    pub type SslWrapper<T> = SSLWrapper<T>;

    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct Flags(u8);

    // packed struct(u8) layout (Zig packs LSB-first):
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

        #[inline]
        pub fn handshake_state(&self) -> HandshakeState {
            // SAFETY: bits 0-1 are always written via set_handshake_state with a valid #[repr(u8)] discriminant in range 0..=2.
            unsafe { core::mem::transmute::<u8, HandshakeState>(self.0 & Self::HANDSHAKE_MASK) }
        }
        #[inline]
        pub fn set_handshake_state(&mut self, s: HandshakeState) {
            self.0 = (self.0 & !Self::HANDSHAKE_MASK) | (s as u8);
        }

        #[inline] pub fn received_ssl_shutdown(&self) -> bool { self.0 & Self::RECEIVED_SSL_SHUTDOWN != 0 }
        #[inline] pub fn set_received_ssl_shutdown(&mut self, v: bool) { if v { self.0 |= Self::RECEIVED_SSL_SHUTDOWN } else { self.0 &= !Self::RECEIVED_SSL_SHUTDOWN } }
        #[inline] pub fn sent_ssl_shutdown(&self) -> bool { self.0 & Self::SENT_SSL_SHUTDOWN != 0 }
        #[inline] pub fn set_sent_ssl_shutdown(&mut self, v: bool) { if v { self.0 |= Self::SENT_SSL_SHUTDOWN } else { self.0 &= !Self::SENT_SSL_SHUTDOWN } }
        #[inline] pub fn is_client(&self) -> bool { self.0 & Self::IS_CLIENT != 0 }
        #[inline] pub fn set_is_client(&mut self, v: bool) { if v { self.0 |= Self::IS_CLIENT } else { self.0 &= !Self::IS_CLIENT } }
        #[inline] pub fn authorized(&self) -> bool { self.0 & Self::AUTHORIZED != 0 }
        #[inline] pub fn set_authorized(&mut self, v: bool) { if v { self.0 |= Self::AUTHORIZED } else { self.0 &= !Self::AUTHORIZED } }
        #[inline] pub fn fatal_error(&self) -> bool { self.0 & Self::FATAL_ERROR != 0 }
        #[inline] pub fn set_fatal_error(&mut self, v: bool) { if v { self.0 |= Self::FATAL_ERROR } else { self.0 &= !Self::FATAL_ERROR } }
        #[inline] pub fn closed_notified(&self) -> bool { self.0 & Self::CLOSED_NOTIFIED != 0 }
        #[inline] pub fn set_closed_notified(&mut self, v: bool) { if v { self.0 |= Self::CLOSED_NOTIFIED } else { self.0 &= !Self::CLOSED_NOTIFIED } }
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
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum InitError {
        OutOfMemory,
        InvalidOptions,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum WriteDataError {
        ConnectionClosed,
        WantRead,
        WantWrite,
    }

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
                    boring_sys::SSL_set_renegotiate_mode(ssl.as_ptr(), boring_sys::ssl_renegotiate_explicit);
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
                    if boring_sys::SSL_CTX_get_verify_mode(ctx.as_ptr()) == boring_sys::SSL_VERIFY_NONE {
                        boring_sys::SSL_set_verify(ssl.as_ptr(), boring_sys::SSL_VERIFY_PEER, Some(always_continue_verify));
                        if let Some(roots) = NonNull::new(us_get_shared_default_ca_store()) {
                            let _ = boring_sys::SSL_set0_verify_cert_store(ssl.as_ptr(), roots.as_ptr());
                        }
                    }
                } else {
                    // Set the renegotiation mode to never so that we can't
                    // renegotiate on the server side (security reasons).
                    // BoringSSL: There is no support for renegotiation as a
                    // server. (Attempts by clients will result in a fatal
                    // alert so that ClientHello messages cannot be used to
                    // flood a server and escape higher-level limits.)
                    boring_sys::SSL_set_renegotiate_mode(ssl.as_ptr(), boring_sys::ssl_renegotiate_never);
                    boring_sys::SSL_set_accept_state(ssl.as_ptr());
                }
            }
            // SAFETY: BIO_s_mem returns a static method table; BIO_new returns null on OOM.
            let input = NonNull::new(unsafe { boring_sys::BIO_new(boring_sys::BIO_s_mem()) })
                .ok_or(InitError::OutOfMemory)?;
            // errdefer _ = BoringSSL.BIO_free(input)
            let input_guard = scopeguard::guard(input, |bio| {
                // SAFETY: bio was created by BIO_new above and not yet transferred to SSL_set_bio.
                unsafe { let _ = boring_sys::BIO_free(bio.as_ptr()); }
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

            let mut flags = Flags::default();
            flags.set_is_client(is_client);

            Ok(Self {
                handlers,
                flags,
                ctx: Some(ctx),
                ssl: Some(ssl),
            })
        }

        /// Tier-neutral form of Zig `init(ssl_options: jsc.API.ServerConfig.SSLConfig, ...)`.
        /// Higher-tier callers convert their `SSLConfig` via `.as_usockets()` and pass the
        /// resulting `BunSocketContextOptions` here, so this crate stays free of the
        /// `jsc`/`http_types` dependency. The original `SSLConfig`-taking `init` lives as
        /// an extension in the higher tier.
        pub fn init_from_options(
            ctx_opts: bun_uws_sys::socket_context::BunSocketContextOptions,
            is_client: bool,
            handlers: Handlers<T>,
        ) -> Result<Self, InitError> {
            bun_boringssl::load();

            let mut err: create_bun_socket_error_t = create_bun_socket_error_t::none;
            let Some(ssl_ctx) = ctx_opts.create_ssl_context(&mut err).and_then(NonNull::new)
            else {
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
            let Some(ssl) = self.ssl else { return false };
            // we already sent the ssl shutdown
            if self.flags.sent_ssl_shutdown() || self.flags.fatal_error() {
                return self.flags.received_ssl_shutdown();
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
                unsafe { let _ = boring_sys::SSL_shutdown(ssl.as_ptr()); }
                self.flags.set_received_ssl_shutdown(true);
                // Reset pending handshake because we are closed for sure now
                if self.flags.handshake_state() != HandshakeState::HandshakeCompleted {
                    self.flags.set_handshake_state(HandshakeState::HandshakeCompleted);
                    let verify = self.get_verify_error();
                    self.trigger_handshake_callback(false, verify);
                }

                // we need to trigger close because we are not receiving a SSL_shutdown
                self.trigger_close_callback();
                return false;
            }

            // we sent the shutdown
            self.flags.set_sent_ssl_shutdown(ret >= 0);
            if ret < 0 {
                // SAFETY: ssl is still valid.
                let err = unsafe { boring_sys::SSL_get_error(ssl.as_ptr(), ret) };
                unsafe { boring_sys::ERR_clear_error() };

                if err == boring_sys::SSL_ERROR_SSL || err == boring_sys::SSL_ERROR_SYSCALL {
                    self.flags.set_fatal_error(true);
                    self.trigger_close_callback();
                    return false;
                }
            }
            ret == 1 // truly closed
        }

        /// flush buffered data and returns amount of pending data to write
        pub fn flush(&mut self) -> usize {
            // handle_traffic may trigger a close callback which frees ssl,
            // so we must not capture the ssl pointer before calling it.
            self.handle_traffic();
            let Some(ssl) = self.ssl else { return 0 };
            // SAFETY: ssl is a live SSL*; SSL_get_wbio returns the BIO bound in init_with_ctx.
            let pending = unsafe { boring_sys::BIO_ctrl_pending(boring_sys::SSL_get_wbio(ssl.as_ptr())) };
            if pending > 0 {
                return usize::try_from(pending).unwrap();
            }
            0
        }

        /// Return if we have pending data to be read or write
        pub fn has_pending_data(&self) -> bool {
            let Some(ssl) = self.ssl else { return false };
            // SAFETY: ssl is a live SSL*; rbio/wbio bound in init_with_ctx.
            unsafe {
                boring_sys::BIO_ctrl_pending(boring_sys::SSL_get_wbio(ssl.as_ptr())) > 0
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
            self.flags.closed_notified() || self.flags.received_ssl_shutdown() || self.flags.sent_ssl_shutdown()
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
            let Some(input) = NonNull::new(unsafe { boring_sys::SSL_get_rbio(ssl.as_ptr()) }) else { return };
            // SAFETY: input is a valid BIO*; data is a valid &[u8] for len bytes.
            let written = unsafe {
                boring_sys::BIO_write(
                    input.as_ptr(),
                    data.as_ptr().cast::<c_void>(),
                    c_int::try_from(data.len()).unwrap(),
                )
            };
            if written > -1 {
                self.handle_traffic();
            }
        }

        /// Send data to the network (unencrypted data)
        pub fn write_data(&mut self, data: &[u8]) -> Result<usize, WriteDataError> {
            let Some(ssl) = self.ssl else { return Err(WriteDataError::ConnectionClosed) };

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
                    c_int::try_from(data.len()).unwrap(),
                )
            };
            if written <= 0 {
                // SAFETY: ssl is still valid.
                let err = unsafe { boring_sys::SSL_get_error(ssl.as_ptr(), written) };
                unsafe { boring_sys::ERR_clear_error() };

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
                self.flags.set_fatal_error(err == boring_sys::SSL_ERROR_SSL || err == boring_sys::SSL_ERROR_SYSCALL);
                self.trigger_close_callback();
                return Err(WriteDataError::ConnectionClosed);
            }
            self.handle_traffic();
            Ok(usize::try_from(written).unwrap())
        }

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
            let Some(ssl) = self.ssl else { return us_bun_verify_error_t::default() };
            // SAFETY: ssl is a live SSL*; uSockets helper reads the verify result off it.
            unsafe { us_ssl_socket_verify_error_from_ssl(ssl.as_ptr()) }
        }

        /// Update the handshake state. Returns true if we can call handle_reading.
        fn update_handshake_state(&mut self) -> bool {
            if self.flags.closed_notified() {
                return false;
            }
            let Some(ssl) = self.ssl else { return false };

            // SAFETY: ssl is a live SSL*.
            if unsafe { boring_sys::SSL_is_init_finished(ssl.as_ptr()) } != 0 {
                // handshake already completed nothing to do here
                // SAFETY: ssl is a live SSL*.
                if (unsafe { boring_sys::SSL_get_shutdown(ssl.as_ptr()) } & boring_sys::SSL_RECEIVED_SHUTDOWN) != 0 {
                    // we received a shutdown
                    self.flags.set_received_ssl_shutdown(true);
                    // 2-step shutdown
                    let _ = self.shutdown(false);
                    self.trigger_close_callback();

                    return false;
                }
                return true;
            }

            if self.flags.handshake_state() == HandshakeState::HandshakeRenegotiationPending {
                // we are in the middle of a renegotiation need to call read/write
                return true;
            }

            // SAFETY: ssl is a live SSL*.
            let result = unsafe { boring_sys::SSL_do_handshake(ssl.as_ptr()) };

            if result <= 0 {
                // SAFETY: ssl is still valid.
                let err = unsafe { boring_sys::SSL_get_error(ssl.as_ptr(), result) };
                unsafe { boring_sys::ERR_clear_error() };
                if err == boring_sys::SSL_ERROR_ZERO_RETURN {
                    // Remotely-Initiated Shutdown
                    // See: https://www.openssl.org/docs/manmaster/man3/SSL_shutdown.html
                    self.flags.set_received_ssl_shutdown(true);
                    // 2-step shutdown
                    let _ = self.shutdown(false);
                    self.handle_end_of_renegotiation();
                    return false;
                }
                // as far as I know these are the only errors we want to handle
                if err != boring_sys::SSL_ERROR_WANT_READ && err != boring_sys::SSL_ERROR_WANT_WRITE {
                    // clear per thread error queue if it may contain something
                    self.flags.set_fatal_error(err == boring_sys::SSL_ERROR_SSL || err == boring_sys::SSL_ERROR_SYSCALL);

                    self.flags.set_handshake_state(HandshakeState::HandshakeCompleted);
                    let verify = self.get_verify_error();
                    self.trigger_handshake_callback(false, verify);

                    if self.flags.fatal_error() {
                        self.trigger_close_callback();
                        return false;
                    }
                    return true;
                }
                self.flags.set_handshake_state(HandshakeState::HandshakePending);
                return true;
            }

            // handshake completed
            self.flags.set_handshake_state(HandshakeState::HandshakeCompleted);
            let verify = self.get_verify_error();
            self.trigger_handshake_callback(true, verify);

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
                self.flags.set_handshake_state(HandshakeState::HandshakeCompleted);
                let verify = self.get_verify_error();
                self.trigger_handshake_callback(true, verify);
            }
        }

        /// Handle reading data. Returns true if we can call handle_writing.
        fn handle_reading(&mut self, buffer: &mut [u8; BUFFER_SIZE]) -> bool {
            let mut read: usize = 0;

            // read data from the input BIO
            loop {
                log!("handleReading");
                let Some(ssl) = self.ssl else { return false };

                let available = &mut buffer[read..];
                // SAFETY: ssl is a live SSL*; available is a valid mutable slice.
                let just_read = unsafe {
                    boring_sys::SSL_read(
                        ssl.as_ptr(),
                        available.as_mut_ptr().cast::<c_void>(),
                        c_int::try_from(available.len()).unwrap(),
                    )
                };
                log!("just read {}", just_read);
                if just_read <= 0 {
                    // SAFETY: ssl is still valid.
                    let err = unsafe { boring_sys::SSL_get_error(ssl.as_ptr(), just_read) };
                    unsafe { boring_sys::ERR_clear_error() };

                    if err != boring_sys::SSL_ERROR_WANT_READ && err != boring_sys::SSL_ERROR_WANT_WRITE {
                        if err == boring_sys::SSL_ERROR_WANT_RENEGOTIATE {
                            self.flags.set_handshake_state(HandshakeState::HandshakeRenegotiationPending);
                            // SAFETY: ssl is still valid.
                            if unsafe { boring_sys::SSL_renegotiate(ssl.as_ptr()) } == 0 {
                                self.flags.set_handshake_state(HandshakeState::HandshakeCompleted);
                                // we failed to renegotiate
                                let verify = self.get_verify_error();
                                self.trigger_handshake_callback(false, verify);
                                self.trigger_close_callback();
                                return false;
                            }
                            // ok, we are done here, we need to call SSL_read again
                            // this dont mean that we are done with the handshake renegotiation
                            // we need to call SSL_read again
                            continue;
                        } else if err == boring_sys::SSL_ERROR_ZERO_RETURN {
                            // Remotely-Initiated Shutdown
                            // See: https://www.openssl.org/docs/manmaster/man3/SSL_shutdown.html
                            self.flags.set_received_ssl_shutdown(true);
                            // 2-step shutdown
                            let _ = self.shutdown(false);
                            self.handle_end_of_renegotiation();
                        }
                        self.flags.set_fatal_error(err == boring_sys::SSL_ERROR_SSL || err == boring_sys::SSL_ERROR_SYSCALL);

                        // flush the reading
                        if read > 0 {
                            log!("triggering data callback (read {})", read);
                            self.trigger_data_callback(&buffer[0..read]);
                            // The data callback may have closed the connection
                            if self.ssl.is_none() || self.flags.closed_notified() {
                                return false;
                            }
                        }
                        self.trigger_close_callback();
                        return false;
                    } else {
                        log!("wanna read/write just break");
                        // we wanna read/write just break
                        break;
                    }
                }

                self.handle_end_of_renegotiation();

                read += usize::try_from(just_read).unwrap();
                if read == buffer.len() {
                    log!("triggering data callback (read {}) and resetting read buffer", read);
                    // we filled the buffer
                    self.trigger_data_callback(&buffer[0..read]);
                    // The callback may have closed the connection - check before continuing
                    // Check ssl first as a proxy for whether we were deinited
                    if self.ssl.is_none() || self.flags.closed_notified() {
                        return false;
                    }
                    read = 0;
                }
            }
            // we finished reading
            if read > 0 {
                log!("triggering data callback (read {})", read);
                self.trigger_data_callback(&buffer[0..read]);
                // The callback may have closed the connection
                // Check ssl first as a proxy for whether we were deinited
                if self.ssl.is_none() || self.flags.closed_notified() {
                    return false;
                }
            }
            true
        }

        fn handle_writing(&mut self, buffer: &mut [u8; BUFFER_SIZE]) {
            let mut read: usize = 0;
            loop {
                let Some(ssl) = self.ssl else { return };
                // SAFETY: ssl is a live SSL*; wbio bound in init_with_ctx.
                let Some(output) = NonNull::new(unsafe { boring_sys::SSL_get_wbio(ssl.as_ptr()) }) else { return };
                let available = &mut buffer[read..];
                // SAFETY: output is a valid BIO*; available is a valid mutable slice.
                let just_read = unsafe {
                    boring_sys::BIO_read(
                        output.as_ptr(),
                        available.as_mut_ptr().cast::<c_void>(),
                        c_int::try_from(available.len()).unwrap(),
                    )
                };
                if just_read > 0 {
                    read += usize::try_from(just_read).unwrap();
                    if read == buffer.len() {
                        self.trigger_wanna_write_callback(&buffer[0..read]);
                        read = 0;
                    }
                } else {
                    break;
                }
            }
            if read > 0 {
                self.trigger_wanna_write_callback(&buffer[0..read]);
            }
        }

        fn handle_traffic(&mut self) {
            // always handle the handshake first
            if self.update_handshake_state() {
                // shared stack buffer for reading and writing
                // PERF(port): 64KiB on-stack array — was Zig stack array; verify Rust stack-size headroom in Phase B.
                let mut buffer = [0u8; BUFFER_SIZE];
                // drain the input BIO first
                self.handle_writing(&mut buffer);

                // drain the output BIO in loop, because read can trigger writing and vice versa
                while self.has_pending_read() && self.handle_reading(&mut buffer) {
                    // read data can trigger writing so we need to handle it
                    self.handle_writing(&mut buffer);
                }
            }
        }
    }

    /// `us_verify_callback` equivalent — let the handshake complete regardless of
    /// verify result so JS reads `authorizationError` and `rejectUnauthorized`
    /// decides, instead of BoringSSL aborting mid-flight.
    extern "C" fn always_continue_verify(_: c_int, _: *mut boring_sys::X509_STORE_CTX) -> c_int {
        1
    }

    unsafe extern "C" {
        /// Process-wide bundled root store from `root_certs.cpp` — built once and
        /// up_ref'd per consumer so the ~150-cert load happens once total, not per
        /// CTX. Returns null if root loading fails (treated as "no roots").
        fn us_get_shared_default_ca_store() -> *mut boring_sys::X509_STORE;
        /// Zig `BoringSSL.SSL.getVerifyError` — implemented in uSockets C; reads
        /// `SSL_get_verify_result` and maps it onto the C `us_bun_verify_error_t`.
        fn us_ssl_socket_verify_error_from_ssl(ssl: *mut boring_sys::SSL) -> us_bun_verify_error_t;
    }

    // ──────────────────────────────────────────────────────────────────────
    // PORT STATUS
    //   source:     src/runtime/socket/ssl_wrapper.zig (542 lines)
    //   moved-in:   MOVE_DOWN bun_runtime → bun_uws (for http_jsc)
    //   confidence: medium
    //   omitted:    `init(SSLConfig, ..)` — SSLConfig is tier-6/http_types;
    //               callers convert via `.as_usockets()` and use
    //               `init_from_options` (or wrap it as an extension trait
    //               in their own tier).
    // ──────────────────────────────────────────────────────────────────────
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws/uws.zig (177 lines)
//   confidence: medium
//   todos:      6
//   notes:      mostly thin re-exports; module-as-PascalCase aliases and open Opcode enum need Phase B review
// ──────────────────────────────────────────────────────────────────────────
