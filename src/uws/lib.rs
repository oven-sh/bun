#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use)]

#![warn(unreachable_pub)]
use core::ffi::{c_char, c_int, c_uint, c_void};

use bun_string::ZStr;

// ──────────────────────────────────────────────────────────────────────────
// Thin re-exports from uws_sys / runtime
// ──────────────────────────────────────────────────────────────────────────
// `bun_uws_sys` is now un-gated; pull the opaque FFI handles and module
// namespaces straight through. Items that this crate *defines* itself
// (SocketKind, SocketGroup, SocketContext, NewSocketHandler/SocketTCP/SocketTLS,
// InternalSocket, AnySocket, AnyRequest, SocketAddress,
// WebSocketUpgradeContext) are NOT re-exported here — the local definitions
// below remain the canonical `bun_uws::*` types until the sys-crate versions
// are reconciled in a follow-up pass.
//
// `bun_runtime::*` items (dispatch, WindowsNamedPipe, UpgradedDuplex) are upward
// refs into a higher tier and intentionally remain local stub modules.

pub use bun_uws_sys::{
    us_socket_t, us_socket_stream_buffer_t, ConnectingSocket, ListenSocket, Request, Timer,
    uws_res, RawWebSocket, AnyWebSocket, WebSocketBehavior, BodyReaderMixin, NewApp,
};

/// `#[uws_callback]` — wraps a `&self`/`&mut self` method in an `extern "C"`
/// thunk that recovers `Self` from `*mut c_void`, lowers `&[T]` params to
/// `(ptr, len)` pairs, and guards the body with `catch_unwind` → abort. See
/// `bun_jsc_macros::uws_callback` for the full contract; the runtime panic
/// barrier lives in `bun_core::ffi::catch_unwind_ffi`.
pub use bun_jsc_macros::uws_callback;
pub use bun_uws_sys::response::State;
pub use bun_uws_sys::{h3 as H3, quic, udp, vtable};
pub type Socket = us_socket_t;

// Upward refs into `bun_runtime` (higher tier) — kept as empty namespace stubs.
// TODO(port): bun_runtime::socket::{uws_dispatch, windows_named_pipe, upgraded_duplex}
pub mod dispatch {}
pub mod WindowsNamedPipe {}
pub mod UpgradedDuplex {}

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

// Re-export the `_sys` definition so higher tiers see one type. `to_js`
// (Zig: `@import("../runtime/socket/uws_jsc.zig").createBunSocketErrorToJS`)
// lives as an extension trait in the *_jsc crate per PORTING.md.
pub use bun_uws_sys::create_bun_socket_error_t;

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
    bun_core::Output::warn(&format_args!(
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
        pub(crate) fn us_get_default_ciphers() -> *const core::ffi::c_char;
    }
}

pub fn get_default_ciphers() -> &'static ZStr {
    // SAFETY: us_get_default_ciphers returns a static NUL-terminated string;
    // CStr::from_ptr computes the length, ZStr::from_raw rebuilds the
    // length-carrying slice (excluding the NUL).
    unsafe {
        let p = c::us_get_default_ciphers();
        let len = core::ffi::CStr::from_ptr(p).to_bytes().len();
        ZStr::from_raw(p.cast::<u8>(), len)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// MOVE-IN: ssl_wrapper (MOVE_DOWN bun_runtime::socket::ssl_wrapper → bun_uws)
// Ground truth: src/runtime/socket/ssl_wrapper.zig
// Requested by: http_jsc (CYCLEBREAK §move-in → uws)
// ═══════════════════════════════════════════════════════════════════════════
// B-2: module un-gated. `bun_boringssl_sys` is currently empty (bindgen not yet
// run), so every fn body that calls a BoringSSL symbol is re-gated below; the
// type/struct surface compiles against opaque `SSL`/`SSL_CTX` from
// `bun_boringssl::c`. `init_from_options` additionally needs
// `bun_uws_sys::socket_context::BunSocketContextOptions` (gated in lower tier).
pub mod ssl_wrapper {
    use core::ffi::{c_int, c_void};
    use core::ptr::NonNull;

    // Local FFI shim — `bun_boringssl_sys` only exports `SSL`/`SSL_CTX` opaques
    // today, so the SSLWrapper-specific surface is declared here against the
    // same C symbols (verified vs `vendor/boringssl/include/openssl/{ssl,bio}.h`
    // and `src/boringssl_sys/boringssl.zig`). When the lower tier grows these,
    // collapse this mod to a `pub use bun_boringssl::c::*;`.
    // TODO(b2-blocked): bun_boringssl_sys::{SSL_new, SSL_free, SSL_CTX_free,
    //   SSL_read, SSL_write, SSL_shutdown, SSL_get_error, SSL_do_handshake,
    //   SSL_is_init_finished, SSL_get_shutdown, SSL_get_rbio, SSL_get_wbio,
    //   SSL_set_bio, SSL_set_renegotiate_mode, SSL_set_connect_state,
    //   SSL_set_accept_state, SSL_set_verify, SSL_CTX_get_verify_mode,
    //   SSL_set0_verify_cert_store, SSL_renegotiate, BIO_new, BIO_free,
    //   BIO_s_mem, BIO_read, BIO_write, BIO_ctrl_pending,
    //   BIO_set_mem_eof_return, ERR_clear_error, X509_STORE, X509_STORE_CTX,
    //   ssl_renegotiate_explicit, ssl_renegotiate_never, SSL_ERROR_*,
    //   SSL_VERIFY_*, SSL_RECEIVED_SHUTDOWN}
    mod boring_sys {
        use core::ffi::{c_int, c_void};
        use core::marker::{PhantomData, PhantomPinned};

        pub(super) use bun_boringssl::c::{SSL, SSL_CTX};

        // ── opaque handles not yet in bun_boringssl_sys ────────────────
        macro_rules! opaque {
            ($($name:ident),+ $(,)?) => {$(
                #[repr(C)] pub(super) struct $name { _p: [u8; 0], _m: PhantomData<(*mut u8, PhantomPinned)> }
            )+};
        }
        opaque!(BIO, BIO_METHOD, X509_STORE, X509_STORE_CTX);

        // ── constants (values from vendor/boringssl/include/openssl/ssl.h) ──
        pub(super) const SSL_ERROR_SSL: c_int = 1;
        pub(super) const SSL_ERROR_WANT_READ: c_int = 2;
        pub(super) const SSL_ERROR_WANT_WRITE: c_int = 3;
        pub(super) const SSL_ERROR_SYSCALL: c_int = 5;
        pub(super) const SSL_ERROR_ZERO_RETURN: c_int = 6;
        pub(super) const SSL_ERROR_WANT_RENEGOTIATE: c_int = 19;

        pub(super) const SSL_VERIFY_NONE: c_int = 0x00;
        pub(super) const SSL_VERIFY_PEER: c_int = 0x01;

        pub(super) const SSL_RECEIVED_SHUTDOWN: c_int = 2;

        // `enum ssl_renegotiate_mode_t` is `BORINGSSL_ENUM_INT` (= c_int).
        pub(super) type ssl_renegotiate_mode_t = c_int;
        pub(super) const ssl_renegotiate_never: ssl_renegotiate_mode_t = 0;
        pub(super) const ssl_renegotiate_explicit: ssl_renegotiate_mode_t = 4;

        pub(super) type SSL_verify_cb =
            Option<unsafe extern "C" fn(preverify_ok: c_int, ctx: *mut X509_STORE_CTX) -> c_int>;

        // ── extern fns ─────────────────────────────────────────────────
        unsafe extern "C" {
            // ssl.h
            pub(super) fn SSL_new(ctx: *mut SSL_CTX) -> *mut SSL;
            pub(super) fn SSL_free(ssl: *mut SSL);
            pub(super) fn SSL_CTX_free(ctx: *mut SSL_CTX);
            pub(super) fn SSL_set_connect_state(ssl: *mut SSL);
            pub(super) fn SSL_set_accept_state(ssl: *mut SSL);
            pub(super) fn SSL_set_bio(ssl: *mut SSL, rbio: *mut BIO, wbio: *mut BIO);
            pub(super) fn SSL_get_rbio(ssl: *const SSL) -> *mut BIO;
            pub(super) fn SSL_get_wbio(ssl: *const SSL) -> *mut BIO;
            pub(super) fn SSL_do_handshake(ssl: *mut SSL) -> c_int;
            pub(super) fn SSL_read(ssl: *mut SSL, buf: *mut c_void, num: c_int) -> c_int;
            pub(super) fn SSL_write(ssl: *mut SSL, buf: *const c_void, num: c_int) -> c_int;
            pub(super) fn SSL_shutdown(ssl: *mut SSL) -> c_int;
            pub(super) fn SSL_get_error(ssl: *const SSL, ret_code: c_int) -> c_int;
            pub(super) fn SSL_is_init_finished(ssl: *const SSL) -> c_int;
            pub(super) fn SSL_get_shutdown(ssl: *const SSL) -> c_int;
            pub(super) fn SSL_set_verify(ssl: *mut SSL, mode: c_int, callback: SSL_verify_cb);
            pub(super) fn SSL_CTX_get_verify_mode(ctx: *const SSL_CTX) -> c_int;
            pub(super) fn SSL_set0_verify_cert_store(ssl: *mut SSL, store: *mut X509_STORE) -> c_int;
            pub(super) fn SSL_set_renegotiate_mode(ssl: *mut SSL, mode: ssl_renegotiate_mode_t);
            pub(super) fn SSL_renegotiate(ssl: *mut SSL) -> c_int;
            // bio.h
            pub(super) fn BIO_new(method: *const BIO_METHOD) -> *mut BIO;
            pub(super) fn BIO_free(bio: *mut BIO) -> c_int;
            pub(super) fn BIO_read(bio: *mut BIO, data: *mut c_void, len: c_int) -> c_int;
            pub(super) fn BIO_write(bio: *mut BIO, data: *const c_void, len: c_int) -> c_int;
            pub(super) fn BIO_ctrl_pending(bio: *const BIO) -> usize;
            pub(super) fn BIO_s_mem() -> *const BIO_METHOD;
            pub(super) fn BIO_set_mem_eof_return(bio: *mut BIO, eof_value: c_int) -> c_int;
            // err.h
            pub(super) fn ERR_clear_error();
        }
    }

    use crate::{create_bun_socket_error_t, us_bun_verify_error_t};

    bun_core::declare_scope!(SSLWrapper, hidden);
    /// Local alias for `scoped_log!(SSLWrapper, ...)` so the body reads like
    /// the Zig `const log = bun.Output.scoped(.SSLWrapper, .hidden)`.
    macro_rules! log {
        ($($t:tt)*) => { bun_core::scoped_log!(SSLWrapper, $($t)*) };
    }

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
            ctx_opts: crate::SocketContext::BunSocketContextOptions,
            is_client: bool,
            handlers: Handlers<T>,
        ) -> Result<Self, InitError> {
            bun_boringssl::load();

            let mut err = crate::create_bun_socket_error_t::none;
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
                return usize::try_from(pending).expect("int cast");
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
                    c_int::try_from(data.len()).expect("int cast"),
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
                    c_int::try_from(data.len()).expect("int cast"),
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
            Ok(usize::try_from(written).expect("int cast"))
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
                        c_int::try_from(available.len()).expect("int cast"),
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

                read += usize::try_from(just_read).expect("int cast");
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
                        c_int::try_from(available.len()).expect("int cast"),
                    )
                };
                if just_read > 0 {
                    read += usize::try_from(just_read).expect("int cast");
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
    unsafe extern "C" fn always_continue_verify(_: c_int, _: *mut boring_sys::X509_STORE_CTX) -> c_int {
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

// ═══════════════════════════════════════════════════════════════════════════
// Loop / InternalLoopData
// ═══════════════════════════════════════════════════════════════════════════
// Mirrors `struct us_internal_loop_data_t` (packages/bun-usockets/src/internal/
// loop_data.h) and `struct us_loop_t` (epoll_kqueue.h / libuv.h). Defined here
// rather than re-exported from bun_uws_sys because that crate currently gates
// every module and only exposes opaques — and we cannot `impl` foreign opaques.
// When bun_uws_sys un-gates, collapse these into `pub use bun_uws_sys::loop_::*`.

/// `zig_mutex_t` from loop_data.h — never touched from Rust, only sized for
/// correct field offsets of `parent_ptr`/`jsc_vm` after it.
#[cfg(target_vendor = "apple")]
type ZigMutex = u32; // os_unfair_lock
#[cfg(any(target_os = "linux", target_os = "freebsd"))]
type ZigMutex = u32;
#[cfg(windows)]
type ZigMutex = *mut c_void; // SRWLOCK

// bun_uws_sys provides the real Loop/PosixLoop/WindowsLoop/InternalLoopData/
// SocketGroup. Re-export them here so `bun_uws::Loop` and `bun_uws_sys::Loop`
// are the SAME type (bun_aio's EventLoopCtxVTable is typed against the uws_sys
// version).
pub use bun_uws_sys::{InternalLoopData, Loop, PosixLoop, Timespec, WindowsLoop};
pub use bun_uws_sys::loop_::LoopHandler;
pub type LoopCb = unsafe extern "C" fn(*mut Loop);

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
    /// Zig: `setParentEventLoop(this, parent: jsc.EventLoopHandle)`. Tag 1 = JS
    /// event loop, tag 2 = mini event loop. Generic over the handle so this
    /// crate stays free of the `jsc` dependency.
    #[inline]
    fn set_parent_event_loop<H: ParentEventLoopHandle>(&mut self, parent: H) {
        let (tag, ptr) = parent.into_tag_ptr();
        self.set_parent_raw(tag, ptr);
    }

    /// Zig: `getParent() jsc.EventLoopHandle`. Low tier returns the (tag, ptr)
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
// `#[repr(C)]` mirror of `struct us_socket_group_t`. Embedded by value in its
// owner; the loop links it lazily on first socket and unlinks on last.

#[repr(C)]
pub struct SocketGroupVTable {
    pub on_open: Option<unsafe extern "C" fn(*mut us_socket_t, c_int, *mut u8, c_int) -> *mut us_socket_t>,
    pub on_data: Option<unsafe extern "C" fn(*mut us_socket_t, *mut u8, c_int) -> *mut us_socket_t>,
    pub on_fd: Option<unsafe extern "C" fn(*mut us_socket_t, c_int) -> *mut us_socket_t>,
    pub on_writable: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_close: Option<unsafe extern "C" fn(*mut us_socket_t, c_int, *mut c_void) -> *mut us_socket_t>,
    pub on_timeout: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_long_timeout: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_end: Option<unsafe extern "C" fn(*mut us_socket_t) -> *mut us_socket_t>,
    pub on_connect_error: Option<unsafe extern "C" fn(*mut us_socket_t, c_int) -> *mut us_socket_t>,
    pub on_connecting_error: Option<unsafe extern "C" fn(*mut ConnectingSocket, c_int) -> *mut ConnectingSocket>,
    pub on_handshake: Option<unsafe extern "C" fn(*mut us_socket_t, c_int, us_bun_verify_error_t, *mut c_void)>,
}

#[repr(C)]
pub struct SocketGroup {
    pub loop_: *mut Loop,
    pub vtable: Option<&'static SocketGroupVTable>,
    /// Embedding owner — heterogenous (`Listener` / uWS App / RareData / null).
    /// Typed access via `owner<T>()` in bun_uws_sys when un-gated.
    pub ext: *mut c_void,
    pub head_sockets: *mut us_socket_t,
    pub head_connecting_sockets: *mut ConnectingSocket,
    pub head_listen_sockets: *mut ListenSocket,
    pub iterator: *mut us_socket_t,
    pub prev: *mut SocketGroup,
    pub next: *mut SocketGroup,
    pub global_tick: u32,
    pub low_prio_count: u16,
    pub timestamp: u8,
    pub long_timestamp: u8,
    pub linked: u8,
}

impl Default for SocketGroup {
    fn default() -> Self {
        // SAFETY: all-zero is a valid SocketGroup — every field is a raw
        // pointer (null), `Option<&'static _>` (None via NPO), or an integer (0).
        unsafe { core::mem::zeroed() }
    }
}

/// Discriminated return of `SocketGroup::connect` — context.c writes
/// `*is_connecting` to tell which pointer shape came back.
pub enum ConnectResult {
    Socket(*mut us_socket_t),
    Connecting(*mut ConnectingSocket),
    Failed,
}

mod group_c {
    use super::{us_socket_t, ConnectingSocket, ListenSocket, Loop, SocketGroup, SocketGroupVTable, SslCtx, LIBUS_SOCKET_DESCRIPTOR};
    use core::ffi::{c_char, c_int, c_void};
    unsafe extern "C" {
        pub(crate) fn us_socket_group_init(group: *mut SocketGroup, loop_: *mut Loop, vt: *const SocketGroupVTable, ext: *mut c_void);
        pub(crate) fn us_socket_group_deinit(group: *mut SocketGroup);
        pub(crate) fn us_socket_group_close_all(group: *mut SocketGroup);
        pub(crate) fn us_socket_group_listen(group: *mut SocketGroup, kind: u8, ssl_ctx: *mut SslCtx, host: *const c_char, port: c_int, options: c_int, socket_ext_size: c_int, err: *mut c_int) -> *mut ListenSocket;
        pub(crate) fn us_socket_group_listen_unix(group: *mut SocketGroup, kind: u8, ssl_ctx: *mut SslCtx, path: *const u8, pathlen: usize, options: c_int, socket_ext_size: c_int, err: *mut c_int) -> *mut ListenSocket;
        /// Returns `us_socket_t*` (fast path) OR `us_connecting_socket_t*` (slow
        /// path), discriminated by `*is_connecting`. Call `SocketGroup::connect`.
        pub(crate) fn us_socket_group_connect(group: *mut SocketGroup, kind: u8, ssl_ctx: *mut SslCtx, host: *const c_char, port: c_int, options: c_int, socket_ext_size: c_int, is_connecting: *mut c_int) -> *mut c_void;
        pub(crate) fn us_socket_group_connect_unix(group: *mut SocketGroup, kind: u8, ssl_ctx: *mut SslCtx, path: *const u8, pathlen: usize, options: c_int, socket_ext_size: c_int) -> *mut us_socket_t;
        pub(crate) fn us_socket_from_fd(group: *mut SocketGroup, kind: u8, ssl_ctx: *mut SslCtx, socket_ext_size: c_int, fd: LIBUS_SOCKET_DESCRIPTOR, ipc: c_int) -> *mut us_socket_t;
    }
}

impl SocketGroup {
    /// Initialise an embedded group. `owner_ptr` is what `owner::<T>()` recovers
    /// inside handlers — pass the embedding struct so dispatch can find it from
    /// a raw `*us_socket_t`.
    pub fn init(&mut self, loop_: *mut Loop, vt: Option<&'static SocketGroupVTable>, owner_ptr: *mut c_void) {
        // SAFETY: C initializes all fields of `self` in-place; `self` is a valid
        // `#[repr(C)]` slot embedded in the caller.
        unsafe {
            group_c::us_socket_group_init(
                self,
                loop_,
                match vt {
                    Some(v) => std::ptr::from_ref::<SocketGroupVTable>(v),
                    None => core::ptr::null(),
                },
                owner_ptr,
            );
        }
    }

    // PORT NOTE: not `impl Drop`. SocketGroup is `#[repr(C)]`, embedded by-value
    // in its owner, and its lifecycle is FFI-managed (C unlinks it from the
    // loop). Expose explicit teardown that the owner calls.
    ///
    /// # Safety
    /// `this` must point to a group previously passed to `init`; not called
    /// concurrently with the loop walking this group.
    pub unsafe fn destroy(this: *mut Self) {
        unsafe { group_c::us_socket_group_deinit(this) }
    }

    pub fn close_all(&mut self) {
        // SAFETY: `self` was previously passed to `init`.
        unsafe { group_c::us_socket_group_close_all(self) }
    }

    /// Non-null after `init`.
    #[inline]
    pub fn get_loop(&self) -> *mut Loop {
        debug_assert!(!self.loop_.is_null());
        self.loop_
    }

    /// Recover the embedding owner. Only valid for groups whose `init` passed a
    /// non-null owner.
    ///
    /// # Safety
    /// `T` must be the exact type whose pointer was passed to `init`, and that
    /// object must still be alive (it embeds this group by value, so it is).
    #[inline]
    pub unsafe fn owner<T>(&self) -> *mut T {
        debug_assert!(!self.ext.is_null());
        self.ext.cast::<T>()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.head_sockets.is_null()
            && self.head_connecting_sockets.is_null()
            && self.head_listen_sockets.is_null()
            && self.low_prio_count == 0
    }

    pub fn listen(
        &mut self,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        host: Option<&core::ffi::CStr>,
        port: c_int,
        options: c_int,
        socket_ext_size: c_int,
        err: &mut c_int,
    ) -> *mut ListenSocket {
        // SAFETY: forwarding to C; all pointers valid or null as documented.
        unsafe {
            group_c::us_socket_group_listen(
                self,
                kind as u8,
                ssl_ctx.unwrap_or(core::ptr::null_mut()),
                host.map_or(core::ptr::null(), |h| h.as_ptr()),
                port,
                options,
                socket_ext_size,
                err,
            )
        }
    }

    pub fn listen_unix(
        &mut self,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        path: &[u8],
        options: c_int,
        socket_ext_size: c_int,
        err: &mut c_int,
    ) -> *mut ListenSocket {
        // SAFETY: forwarding to C; `path` ptr+len derived from a valid slice.
        unsafe {
            group_c::us_socket_group_listen_unix(
                self,
                kind as u8,
                ssl_ctx.unwrap_or(core::ptr::null_mut()),
                path.as_ptr(),
                path.len(),
                options,
                socket_ext_size,
                err,
            )
        }
    }

    pub fn connect(
        &mut self,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        host: &core::ffi::CStr,
        port: c_int,
        options: c_int,
        socket_ext_size: c_int,
    ) -> ConnectResult {
        // context.c writes 1 here on the synchronous path (DNS already resolved
        // → real `us_socket_t*` returned), 0 when it hands back a
        // `us_connecting_socket_t*` placeholder.
        let mut has_dns_resolved: c_int = 0;
        // SAFETY: forwarding to C; `host` is a valid NUL-terminated C string.
        let ptr = unsafe {
            group_c::us_socket_group_connect(
                self,
                kind as u8,
                ssl_ctx.unwrap_or(core::ptr::null_mut()),
                host.as_ptr(),
                port,
                options,
                socket_ext_size,
                &raw mut has_dns_resolved,
            )
        };
        if ptr.is_null() {
            return ConnectResult::Failed;
        }
        if has_dns_resolved != 0 {
            ConnectResult::Socket(ptr.cast::<us_socket_t>())
        } else {
            ConnectResult::Connecting(ptr.cast::<ConnectingSocket>())
        }
    }

    pub fn connect_unix(
        &mut self,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        path: &[u8],
        options: c_int,
        socket_ext_size: c_int,
    ) -> *mut us_socket_t {
        // SAFETY: forwarding to C; `path` ptr+len derived from a valid slice.
        unsafe {
            group_c::us_socket_group_connect_unix(
                self,
                kind as u8,
                ssl_ctx.unwrap_or(core::ptr::null_mut()),
                path.as_ptr(),
                path.len(),
                options,
                socket_ext_size,
            )
        }
    }

    pub fn from_fd(
        &mut self,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        socket_ext_size: c_int,
        fd: LIBUS_SOCKET_DESCRIPTOR,
        ipc: bool,
    ) -> *mut us_socket_t {
        // SAFETY: forwarding to C.
        unsafe {
            group_c::us_socket_from_fd(
                self,
                kind as u8,
                ssl_ctx.unwrap_or(core::ptr::null_mut()),
                socket_ext_size,
                fd,
                ipc as c_int,
            )
        }
    }
}

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
/// Snake-case module alias for the porting tooling that lowercases Zig namespaces.
pub use SocketContext as socket_context;

/// C-name alias for `SocketContext::BunSocketContextOptions` — what
/// `SSLConfig.asUSockets()` produces and `us_ssl_ctx_from_options` consumes.
/// Higher tiers (http, runtime/socket) reference it under the C struct name.
pub type us_bun_socket_context_options_t = SocketContext::BunSocketContextOptions;

// ═══════════════════════════════════════════════════════════════════════════
// SocketKind (a.k.a. DispatchKind) / CloseKind
// ═══════════════════════════════════════════════════════════════════════════

/// Closed-world enum of every `us_socket_t` consumer in Bun. Stamped on the
/// socket at creation (`s->kind`) and switched on in `dispatch.rs` so the
/// event loop calls straight into the right handler with the ext already
/// typed — no per-context vtable, no runtime SSL flag.
///
/// Source of truth: `src/uws_sys/SocketKind.zig`.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SocketKind {
    /// Reserved. `loop.c` callocs sockets, so 0 must be a value that crashes
    /// loudly if dispatch ever sees it instead of silently routing somewhere.
    Invalid = 0,
    /// Dispatch reads `group->vtable->on_*`. For sockets whose handler set is
    /// only known at runtime (uWS C++ via per-App vtable, tests).
    Dynamic,
    // ── Bun.connect / Bun.listen ──────────────────────────────────────────
    BunSocketTcp,
    BunSocketTls,
    BunListenerTcp,
    BunListenerTls,
    // ── HTTP client thread ────────────────────────────────────────────────
    HttpClient,
    HttpClientTls,
    // ── new WebSocket(...) client ─────────────────────────────────────────
    WsClientUpgrade,
    WsClientUpgradeTls,
    WsClient,
    WsClientTls,
    // ── Database drivers ──────────────────────────────────────────────────
    Postgres,
    PostgresTls,
    Mysql,
    MysqlTls,
    Valkey,
    ValkeyTls,
    // ── Bun.spawn IPC over socketpair ─────────────────────────────────────
    SpawnIpc,
    // ── Bun.serve / uWS — handlers live in C++ ───────────────────────────
    UwsHttp,
    UwsHttpTls,
    UwsWs,
    UwsWsTls,
}

impl SocketKind {
    #[inline]
    pub const fn is_tls(self) -> bool {
        matches!(
            self,
            SocketKind::BunSocketTls
                | SocketKind::BunListenerTls
                | SocketKind::HttpClientTls
                | SocketKind::WsClientUpgradeTls
                | SocketKind::WsClientTls
                | SocketKind::PostgresTls
                | SocketKind::MysqlTls
                | SocketKind::ValkeyTls
                | SocketKind::UwsHttpTls
                | SocketKind::UwsWsTls
        )
    }
}

/// Alias used by some Phase-A ports (`websocket_client`, `sql_jsc`) that named
/// the dispatch tag `DispatchKind`. Same enum.
pub type DispatchKind = SocketKind;

/// `us_socket_t.CloseCode` — selects FIN / RST / fast-shutdown behaviour for
/// `us_socket_close`. `#[repr(i32)]` to match the C enum passed by value.
#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum CloseKind {
    /// TLS: send close_notify and defer fd close until peer replies. TCP: FIN.
    Normal = 0,
    /// TLS: fast-shutdown (no wait). TCP: SO_LINGER{1,0} → RST, dropping any
    /// unflushed send buffer. Only for `terminate()` / GC abort.
    Failure = 1,
    /// TLS: fast-shutdown (no wait). TCP: FIN. For `_handle.close()` where
    /// the JS wrapper detaches immediately so `Normal`'s deferral would
    /// orphan the `us_socket_t`, but already-written data must still drain.
    FastShutdown = 2,
}
/// C-name alias.
pub type CloseCode = CloseKind;

// ═══════════════════════════════════════════════════════════════════════════
// Socket handlers (NewSocketHandler / SocketHandler / AnySocket)
// ═══════════════════════════════════════════════════════════════════════════
// Thin placeholders: full bodies live in `bun_uws_sys::socket` (gated). Higher
// tiers need the *types* to compile their own dispatch tables; method bodies
// arrive when the sys crate un-gates.

/// State of a single connection. Full impl lives in bun_uws_sys::socket.
// PORT NOTE: Copy/Clone — Zig passed `socket` by value through the entire
// HTTP-client state machine; the Rust port mirrors that, so the handle must
// be trivially copyable (it's just a tagged pointer).
#[derive(Copy, Clone)]
pub enum InternalSocket {
    Connected(*mut us_socket_t),
    Connecting(*mut ConnectingSocket),
    Detached,
    /// `*mut UpgradedDuplex` (type-erased — higher-tier owned).
    UpgradedDuplex(*mut c_void),
    #[cfg(windows)]
    Pipe(*mut c_void), // *mut WindowsNamedPipe
    #[cfg(not(windows))]
    Pipe,
}

// Zig `InternalSocket.eq` — variant + pointer-identity equality.
// PORT NOTE: Zig's `.pipe` arm returns `false` even for `(pipe, pipe)` on
// non-Windows (the variant carries no payload there, so identity is
// meaningless). Mirrored exactly so debug-asserts that compare sockets behave
// identically to the Zig build.
impl PartialEq for InternalSocket {
    fn eq(&self, other: &Self) -> bool {
        match (*self, *other) {
            (InternalSocket::Connected(a), InternalSocket::Connected(b)) => core::ptr::eq(a, b),
            (InternalSocket::Connecting(a), InternalSocket::Connecting(b)) => core::ptr::eq(a, b),
            (InternalSocket::Detached, InternalSocket::Detached) => true,
            (InternalSocket::UpgradedDuplex(a), InternalSocket::UpgradedDuplex(b)) => {
                core::ptr::eq(a, b)
            }
            #[cfg(windows)]
            (InternalSocket::Pipe(a), InternalSocket::Pipe(b)) => core::ptr::eq(a, b),
            #[cfg(not(windows))]
            (InternalSocket::Pipe, InternalSocket::Pipe) => false,
            _ => false,
        }
    }
}

/// Zig `NewSocketHandler(comptime is_ssl: bool)`. The const generic only
/// selects `*SSL` vs fd for `get_native_handle`; it is NOT forwarded to C.
#[derive(Copy, Clone)]
pub struct NewSocketHandler<const SSL: bool> {
    pub socket: InternalSocket,
}

// ── FFI surface used by the method bodies below. Signatures verified against
//    `src/uws_sys/us_socket_t.zig` / `ConnectingSocket.zig` `extern fn` blocks.
#[allow(non_snake_case, dead_code)]
mod sock_c {
    use super::{us_socket_t, us_bun_verify_error_t, ConnectingSocket, SocketGroup, LIBUS_SOCKET_DESCRIPTOR};
    use core::ffi::{c_int, c_uint, c_void};
    unsafe extern "C" {
        // ── us_socket_t ──────────────────────────────────────────────────────
        pub(crate) fn us_socket_close(s: *mut us_socket_t, code: i32, reason: *mut c_void) -> *mut us_socket_t;
        pub(crate) fn us_socket_is_closed(s: *mut us_socket_t) -> i32;
        pub(crate) fn us_socket_is_shut_down(s: *mut us_socket_t) -> i32;
        pub(crate) fn us_socket_is_established(s: *mut us_socket_t) -> i32;
        pub(crate) fn us_socket_shutdown(s: *mut us_socket_t);
        pub(crate) fn us_socket_shutdown_read(s: *mut us_socket_t);
        pub(crate) fn us_socket_write(s: *mut us_socket_t, data: *const u8, length: i32) -> i32;
        #[cfg(not(windows))]
        pub(crate) fn us_socket_ipc_write_fd(s: *mut us_socket_t, data: *const u8, length: i32, fd: i32) -> i32;
        pub(crate) fn us_socket_raw_write(s: *mut us_socket_t, data: *const u8, length: i32) -> i32;
        pub(crate) fn us_socket_flush(s: *mut us_socket_t);
        pub(crate) fn us_socket_timeout(s: *mut us_socket_t, seconds: c_uint);
        pub(crate) fn us_socket_long_timeout(s: *mut us_socket_t, minutes: c_uint);
        pub(crate) fn us_socket_get_native_handle(s: *mut us_socket_t) -> *mut c_void;
        pub(crate) fn us_socket_ext(s: *mut us_socket_t) -> *mut c_void;
        pub(crate) fn us_socket_group(s: *mut us_socket_t) -> *mut SocketGroup;
        pub(crate) fn us_socket_get_fd(s: *mut us_socket_t) -> LIBUS_SOCKET_DESCRIPTOR;
        pub(crate) fn us_socket_local_port(s: *mut us_socket_t) -> i32;
        pub(crate) fn us_socket_remote_port(s: *mut us_socket_t) -> i32;
        pub(crate) fn us_socket_verify_error(s: *mut us_socket_t) -> us_bun_verify_error_t;
        pub(crate) fn us_socket_get_error(s: *mut us_socket_t) -> c_int;
        pub(crate) fn us_socket_sendfile_needs_more(s: *mut us_socket_t);
        pub(crate) fn us_socket_open(s: *mut us_socket_t, is_client: i32, ip: *const u8, ip_length: i32) -> *mut us_socket_t;
        pub(crate) fn us_socket_adopt(s: *mut us_socket_t, group: *mut SocketGroup, kind: u8, old_ext_size: i32, ext_size: i32) -> *mut us_socket_t;

        // ── us_connecting_socket_t ───────────────────────────────────────────
        pub(crate) fn us_connecting_socket_close(s: *mut ConnectingSocket);
        pub(crate) fn us_connecting_socket_is_closed(s: *mut ConnectingSocket) -> i32;
        pub(crate) fn us_connecting_socket_is_shut_down(s: *mut ConnectingSocket) -> i32;
        pub(crate) fn us_connecting_socket_shutdown(s: *mut ConnectingSocket);
        pub(crate) fn us_connecting_socket_shutdown_read(s: *mut ConnectingSocket);
        pub(crate) fn us_connecting_socket_timeout(s: *mut ConnectingSocket, seconds: c_uint);
        pub(crate) fn us_connecting_socket_long_timeout(s: *mut ConnectingSocket, minutes: c_uint);
        pub(crate) fn us_connecting_socket_get_native_handle(s: *mut ConnectingSocket) -> *mut c_void;
        pub(crate) fn us_connecting_socket_ext(s: *mut ConnectingSocket) -> *mut c_void;
        pub(crate) fn us_connecting_socket_group(s: *mut ConnectingSocket) -> *mut SocketGroup;
        pub(crate) fn us_connecting_socket_get_error(s: *mut ConnectingSocket) -> i32;

        // ── UpgradedDuplex (link-time dispatch into bun_runtime::socket) ────
        // The real type lives in a higher tier; `InternalSocket::UpgradedDuplex`
        // carries a type-erased `*mut c_void` and these symbols are exported by
        // `src/runtime/socket/UpgradedDuplex.rs` via `#[uws_callback(export = …)]`.
        pub(crate) fn UpgradedDuplex__ssl(this: *const c_void) -> *mut c_void;
        pub(crate) fn UpgradedDuplex__ssl_error(this: *const c_void) -> us_bun_verify_error_t;
        pub(crate) fn UpgradedDuplex__is_closed(this: *const c_void) -> bool;
        pub(crate) fn UpgradedDuplex__is_shutdown(this: *const c_void) -> bool;
        pub(crate) fn UpgradedDuplex__is_established(this: *const c_void) -> bool;
        pub(crate) fn UpgradedDuplex__set_timeout(this: *mut c_void, seconds: c_uint);
        pub(crate) fn UpgradedDuplex__flush(this: *mut c_void);
        pub(crate) fn UpgradedDuplex__encode_and_write(this: *mut c_void, ptr: *const u8, len: usize) -> i32;
        pub(crate) fn UpgradedDuplex__raw_write(this: *mut c_void, ptr: *const u8, len: usize) -> i32;
        pub(crate) fn UpgradedDuplex__shutdown(this: *mut c_void);
        pub(crate) fn UpgradedDuplex__shutdown_read(this: *mut c_void);
        pub(crate) fn UpgradedDuplex__close(this: *mut c_void);

        // ── WindowsNamedPipe (same link-time-dispatch pattern) ──────────────
        #[cfg(windows)] pub(crate) fn WindowsNamedPipe__ssl(this: *const c_void) -> *mut c_void;
        #[cfg(windows)] pub(crate) fn WindowsNamedPipe__ssl_error(this: *const c_void) -> us_bun_verify_error_t;
        #[cfg(windows)] pub(crate) fn WindowsNamedPipe__is_closed(this: *const c_void) -> bool;
        #[cfg(windows)] pub(crate) fn WindowsNamedPipe__is_shutdown(this: *const c_void) -> bool;
        #[cfg(windows)] pub(crate) fn WindowsNamedPipe__is_established(this: *const c_void) -> bool;
        #[cfg(windows)] pub(crate) fn WindowsNamedPipe__set_timeout(this: *mut c_void, seconds: c_uint);
        #[cfg(windows)] pub(crate) fn WindowsNamedPipe__flush(this: *mut c_void);
        #[cfg(windows)] pub(crate) fn WindowsNamedPipe__encode_and_write(this: *mut c_void, ptr: *const u8, len: usize) -> i32;
        #[cfg(windows)] pub(crate) fn WindowsNamedPipe__raw_write(this: *mut c_void, ptr: *const u8, len: usize) -> i32;
        #[cfg(windows)] pub(crate) fn WindowsNamedPipe__shutdown(this: *mut c_void);
        #[cfg(windows)] pub(crate) fn WindowsNamedPipe__shutdown_read(this: *mut c_void);
        #[cfg(windows)] pub(crate) fn WindowsNamedPipe__close(this: *mut c_void);
    }
}

impl<const SSL: bool> NewSocketHandler<SSL> {
    pub const DETACHED: Self = Self { socket: InternalSocket::Detached };

    /// Zig `pub const detached` — lower-case constructor form used by callers
    /// that wrote `Socket::detached()`.
    #[inline]
    pub const fn detached() -> Self {
        Self { socket: InternalSocket::Detached }
    }

    #[inline]
    pub fn detach(&mut self) {
        self.socket = InternalSocket::Detached;
    }

    #[inline]
    pub fn is_detached(&self) -> bool {
        matches!(self.socket, InternalSocket::Detached)
    }

    pub fn is_closed(&self) -> bool {
        match self.socket {
            // SAFETY: variant pointers are non-null FFI handles owned by uSockets.
            InternalSocket::Connected(s) => unsafe { sock_c::us_socket_is_closed(s) > 0 },
            InternalSocket::Connecting(s) => unsafe { sock_c::us_connecting_socket_is_closed(s) > 0 },
            InternalSocket::Detached => true,
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe { sock_c::UpgradedDuplex__is_closed(s) },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe { sock_c::WindowsNamedPipe__is_closed(s) },
            #[cfg(not(windows))]
            InternalSocket::Pipe => true,
        }
    }

    pub fn is_shutdown(&self) -> bool {
        match self.socket {
            // SAFETY: variant pointers are non-null FFI handles owned by uSockets.
            InternalSocket::Connected(s) => unsafe { sock_c::us_socket_is_shut_down(s) > 0 },
            InternalSocket::Connecting(s) => unsafe { sock_c::us_connecting_socket_is_shut_down(s) > 0 },
            InternalSocket::Detached => true,
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe { sock_c::UpgradedDuplex__is_shutdown(s) },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe { sock_c::WindowsNamedPipe__is_shutdown(s) },
            #[cfg(not(windows))]
            InternalSocket::Pipe => false,
        }
    }

    pub fn is_established(&self) -> bool {
        match self.socket {
            // SAFETY: variant pointer is a non-null FFI handle owned by uSockets.
            InternalSocket::Connected(s) => unsafe { sock_c::us_socket_is_established(s) > 0 },
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe { sock_c::UpgradedDuplex__is_established(s) },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe { sock_c::WindowsNamedPipe__is_established(s) },
            #[cfg(not(windows))]
            InternalSocket::Pipe => false,
            InternalSocket::Connecting(_) | InternalSocket::Detached => false,
        }
    }

    pub fn shutdown_read(&self) {
        match self.socket {
            // SAFETY: variant pointers are non-null FFI handles owned by uSockets.
            InternalSocket::Connected(s) => unsafe { sock_c::us_socket_shutdown_read(s) },
            InternalSocket::Connecting(s) => unsafe { sock_c::us_connecting_socket_shutdown_read(s) },
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe { sock_c::UpgradedDuplex__shutdown_read(s) },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe { sock_c::WindowsNamedPipe__shutdown_read(s) },
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
            InternalSocket::Detached => {}
        }
    }

    pub fn close(&self, code: CloseKind) {
        match self.socket {
            // SAFETY: variant pointers are non-null FFI handles owned by uSockets.
            InternalSocket::Connected(s) => unsafe {
                let _ = sock_c::us_socket_close(s, code as i32, core::ptr::null_mut());
            },
            InternalSocket::Connecting(s) => unsafe { sock_c::us_connecting_socket_close(s) },
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe { sock_c::UpgradedDuplex__close(s) },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe { sock_c::WindowsNamedPipe__close(s) },
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
            InternalSocket::Detached => {}
        }
    }

    pub fn write(&self, data: &[u8]) -> i32 {
        match self.socket {
            InternalSocket::Connected(s) => {
                // PERF(port): @intCast — profile in Phase B
                let len = core::cmp::min(data.len(), i32::MAX as usize) as i32;
                // SAFETY: `s` is a non-null FFI handle; data.as_ptr()/len describe a valid slice.
                unsafe { sock_c::us_socket_write(s, data.as_ptr(), len) }
            }
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe {
                sock_c::UpgradedDuplex__encode_and_write(s, data.as_ptr(), data.len())
            },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe {
                sock_c::WindowsNamedPipe__encode_and_write(s, data.as_ptr(), data.len())
            },
            #[cfg(not(windows))]
            InternalSocket::Pipe => 0,
            InternalSocket::Connecting(_) | InternalSocket::Detached => 0,
        }
    }

    /// Write `data` and pass `file_descriptor` over the socket via SCM_RIGHTS.
    /// POSIX-only — Windows IPC fd passing goes through libuv pipes instead.
    ///
    /// LAYERING: takes the raw POSIX fd (`c_int`) rather than `bun_sys::Fd` —
    /// `bun_uws` sits below `bun_sys` in the dep graph; callers extract
    /// `.native()` at the boundary.
    #[cfg(not(windows))]
    pub fn write_fd(&self, data: &[u8], file_descriptor: core::ffi::c_int) -> i32 {
        match self.socket {
            InternalSocket::Connected(s) => {
                let len = core::cmp::min(data.len(), i32::MAX as usize) as i32;
                // SAFETY: `s` is a live us_socket_t handle; `data` is a valid
                // slice for the call; `file_descriptor` is a raw fd copied
                // into the cmsg buffer by usockets.
                unsafe { sock_c::us_socket_ipc_write_fd(s, data.as_ptr(), len, file_descriptor) }
            }
            // Mirror Zig `socket.writeFd`: duplex/pipe fall back to a plain
            // write (the fd is silently dropped).
            InternalSocket::UpgradedDuplex(_) | InternalSocket::Pipe => self.write(data),
            InternalSocket::Connecting(_) | InternalSocket::Detached => 0,
        }
    }

    /// Bypass TLS — raw bytes to the fd even on a TLS socket.
    pub fn raw_write(&self, data: &[u8]) -> i32 {
        match self.socket {
            InternalSocket::Connected(s) => {
                // PERF(port): @intCast — profile in Phase B
                let len = core::cmp::min(data.len(), i32::MAX as usize) as i32;
                // SAFETY: `s` is a non-null FFI handle; data.as_ptr()/len describe a valid slice.
                unsafe { sock_c::us_socket_raw_write(s, data.as_ptr(), len) }
            }
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe {
                sock_c::UpgradedDuplex__raw_write(s, data.as_ptr(), data.len())
            },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe {
                sock_c::WindowsNamedPipe__raw_write(s, data.as_ptr(), data.len())
            },
            #[cfg(not(windows))]
            InternalSocket::Pipe => 0,
            InternalSocket::Connecting(_) | InternalSocket::Detached => 0,
        }
    }

    pub fn flush(&self) {
        match self.socket {
            // SAFETY: variant pointer is a non-null FFI handle owned by uSockets.
            InternalSocket::Connected(s) => unsafe { sock_c::us_socket_flush(s) },
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe { sock_c::UpgradedDuplex__flush(s) },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe { sock_c::WindowsNamedPipe__flush(s) },
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
            InternalSocket::Connecting(_) | InternalSocket::Detached => {}
        }
    }

    pub fn shutdown(&self) {
        match self.socket {
            // SAFETY: variant pointers are non-null FFI handles owned by uSockets.
            InternalSocket::Connected(s) => unsafe { sock_c::us_socket_shutdown(s) },
            InternalSocket::Connecting(s) => unsafe { sock_c::us_connecting_socket_shutdown(s) },
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe { sock_c::UpgradedDuplex__shutdown(s) },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe { sock_c::WindowsNamedPipe__shutdown(s) },
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
            InternalSocket::Detached => {}
        }
    }

    /// Direct seconds timeout (no long-timeout split). Mirrors Zig `timeout`.
    pub fn timeout(&self, seconds: c_uint) {
        match self.socket {
            // SAFETY: variant pointers are non-null FFI handles owned by uSockets.
            InternalSocket::Connected(s) => unsafe { sock_c::us_socket_timeout(s, seconds) },
            InternalSocket::Connecting(s) => unsafe { sock_c::us_connecting_socket_timeout(s, seconds) },
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe { sock_c::UpgradedDuplex__set_timeout(s, seconds) },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe { sock_c::WindowsNamedPipe__set_timeout(s, seconds) },
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
            InternalSocket::Detached => {}
        }
    }

    /// Splits >240s onto the minute-granularity long-timeout wheel.
    pub fn set_timeout(&self, seconds: c_uint) {
        match self.socket {
            InternalSocket::Connected(s) => {
                // SAFETY: `s` is a non-null FFI handle owned by uSockets.
                unsafe {
                    if seconds > 240 {
                        sock_c::us_socket_timeout(s, 0);
                        sock_c::us_socket_long_timeout(s, seconds / 60);
                    } else {
                        sock_c::us_socket_timeout(s, seconds);
                        sock_c::us_socket_long_timeout(s, 0);
                    }
                }
            }
            InternalSocket::Connecting(s) => {
                // SAFETY: `s` is a non-null FFI handle owned by uSockets.
                unsafe {
                    if seconds > 240 {
                        sock_c::us_connecting_socket_timeout(s, 0);
                        sock_c::us_connecting_socket_long_timeout(s, seconds / 60);
                    } else {
                        sock_c::us_connecting_socket_timeout(s, seconds);
                        sock_c::us_connecting_socket_long_timeout(s, 0);
                    }
                }
            }
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe { sock_c::UpgradedDuplex__set_timeout(s, seconds) },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe { sock_c::WindowsNamedPipe__set_timeout(s, seconds) },
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
            InternalSocket::Detached => {}
        }
    }

    pub fn set_timeout_minutes(&self, minutes: c_uint) {
        match self.socket {
            InternalSocket::Connected(s) => {
                // SAFETY: `s` is a non-null FFI handle owned by uSockets.
                unsafe {
                    sock_c::us_socket_timeout(s, 0);
                    sock_c::us_socket_long_timeout(s, minutes);
                }
            }
            InternalSocket::Connecting(s) => {
                // SAFETY: `s` is a non-null FFI handle owned by uSockets.
                unsafe {
                    sock_c::us_connecting_socket_timeout(s, 0);
                    sock_c::us_connecting_socket_long_timeout(s, minutes);
                }
            }
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe { sock_c::UpgradedDuplex__set_timeout(s, minutes * 60) },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe { sock_c::WindowsNamedPipe__set_timeout(s, minutes * 60) },
            #[cfg(not(windows))]
            InternalSocket::Pipe => {}
            InternalSocket::Detached => {}
        }
    }

    /// Kick TLS open (ClientHello / accept) on an already-connected socket.
    pub fn start_tls(&self, is_client: bool) {
        if let InternalSocket::Connected(s) = self.socket {
            // SAFETY: `s` is a non-null FFI handle owned by uSockets.
            unsafe { let _ = sock_c::us_socket_open(s, is_client as i32, core::ptr::null(), 0); }
        }
    }

    /// `SSL*` if this is a TLS socket, else `None`.
    #[inline]
    pub fn ssl(&self) -> Option<*mut bun_boringssl::c::SSL> {
        if !SSL {
            return None;
        }
        self.get_native_handle().map(|h| h.cast::<bun_boringssl::c::SSL>())
    }

    pub fn get_verify_error(&self) -> us_bun_verify_error_t {
        match self.socket {
            // SAFETY: variant pointer is a non-null FFI handle owned by uSockets.
            InternalSocket::Connected(s) => unsafe { sock_c::us_socket_verify_error(s) },
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe { sock_c::UpgradedDuplex__ssl_error(s) },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe { sock_c::WindowsNamedPipe__ssl_error(s) },
            #[cfg(not(windows))]
            InternalSocket::Pipe => us_bun_verify_error_t::default(),
            InternalSocket::Connecting(_) | InternalSocket::Detached => us_bun_verify_error_t::default(),
        }
    }

    pub fn get_error(&self) -> i32 {
        match self.socket {
            // SAFETY: variant pointers are non-null FFI handles owned by uSockets.
            InternalSocket::Connected(s) => unsafe { sock_c::us_socket_get_error(s) },
            InternalSocket::Connecting(s) => unsafe { sock_c::us_connecting_socket_get_error(s) },
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) => unsafe { sock_c::UpgradedDuplex__ssl_error(s).error_no },
            #[cfg(windows)]
            InternalSocket::Pipe(s) => unsafe { sock_c::WindowsNamedPipe__ssl_error(s).error_no },
            #[cfg(not(windows))]
            InternalSocket::Pipe => 0,
            InternalSocket::Detached => 0,
        }
    }

    /// Typed ext storage. `None` for non-uSockets transports.
    pub fn ext<T>(&self) -> Option<*mut T> {
        match self.socket {
            // SAFETY: ext storage is LIBUS_EXT_ALIGNMENT-aligned and sized for T at creation.
            InternalSocket::Connected(s) => Some(unsafe { sock_c::us_socket_ext(s).cast::<T>() }),
            InternalSocket::Connecting(s) => Some(unsafe { sock_c::us_connecting_socket_ext(s).cast::<T>() }),
            InternalSocket::UpgradedDuplex(_) | InternalSocket::Detached => None,
            #[cfg(windows)]
            InternalSocket::Pipe(_) => None,
            #[cfg(not(windows))]
            InternalSocket::Pipe => None,
        }
    }

    /// Group this socket is linked into. `None` for non-uSockets transports.
    pub fn group(&self) -> Option<*mut SocketGroup> {
        match self.socket {
            // SAFETY: variant pointers are non-null FFI handles owned by uSockets.
            InternalSocket::Connected(s) => Some(unsafe { sock_c::us_socket_group(s) }),
            InternalSocket::Connecting(s) => Some(unsafe { sock_c::us_connecting_socket_group(s) }),
            InternalSocket::UpgradedDuplex(_) | InternalSocket::Detached => None,
            #[cfg(windows)]
            InternalSocket::Pipe(_) => None,
            #[cfg(not(windows))]
            InternalSocket::Pipe => None,
        }
    }

    /// Underlying fd. Same fd regardless of TLS — read directly off the poll.
    #[inline]
    pub fn fd(&self) -> bun_core::Fd {
        match self.socket {
            InternalSocket::Connected(s) => {
                // SAFETY: variant pointer is a non-null FFI handle owned by uSockets.
                let raw = unsafe { sock_c::us_socket_get_fd(s) };
                #[cfg(windows)]
                { bun_core::Fd::from_system(raw) }
                #[cfg(not(windows))]
                { bun_core::Fd::from_native(raw) }
            }
            _ => bun_core::Fd::INVALID,
        }
    }

    pub fn local_port(&self) -> i32 {
        match self.socket {
            // SAFETY: variant pointer is a non-null FFI handle owned by uSockets.
            InternalSocket::Connected(s) => unsafe { sock_c::us_socket_local_port(s) },
            _ => 0,
        }
    }

    pub fn remote_port(&self) -> i32 {
        match self.socket {
            // SAFETY: variant pointer is a non-null FFI handle owned by uSockets.
            InternalSocket::Connected(s) => unsafe { sock_c::us_socket_remote_port(s) },
            _ => 0,
        }
    }

    pub fn mark_needs_more_for_sendfile(&self) {
        // Zig: `if (comptime is_ssl) @compileError(...)` — keep as a const assert.
        const { assert!(!SSL, "SSL sockets do not support sendfile yet") };
        if let InternalSocket::Connected(s) = self.socket {
            // SAFETY: `s` is a non-null FFI handle owned by uSockets.
            unsafe { sock_c::us_socket_sendfile_needs_more(s) };
        }
    }

    /// Wrap an already-open fd. Ext stores `*mut This`; the socket is linked
    /// into `g` with kind `k`. Port of `NewSocketHandler.fromFd` (POSIX path —
    /// the only caller, IPC, uses `windows_configure_client` on Windows).
    pub fn from_fd<This>(
        g: &mut SocketGroup,
        k: SocketKind,
        handle: bun_core::Fd,
        this: *mut This,
        is_ipc: bool,
    ) -> Option<Self> {
        // Zig `?*This` is null-niche optimized (8 bytes); the dispatch
        // trampolines read the ext slot as `Option<NonNull<_>>`, so size and
        // write must match that layout — NOT `Option<*mut This>` (16 bytes).
        let ext_size = core::mem::size_of::<Option<core::ptr::NonNull<This>>>() as c_int;
        let raw = g.from_fd(k, None, ext_size, handle.native() as LIBUS_SOCKET_DESCRIPTOR, is_ipc);
        if raw.is_null() {
            return None;
        }
        // SAFETY: ext storage was sized for `?*This` above; `raw` is a
        // freshly-created live socket.
        unsafe {
            *sock_c::us_socket_ext(raw).cast::<Option<core::ptr::NonNull<This>>>() =
                core::ptr::NonNull::new(this)
        };
        Some(Self { socket: InternalSocket::Connected(raw) })
    }

    /// Connect via a `SocketGroup` and stash `owner` in the socket ext.
    /// Replaces the deleted `connectAnon`/`connectPtr`.
    pub fn connect_group<Owner>(
        g: &mut SocketGroup,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        raw_host: &[u8],
        port: c_int,
        owner: *mut Owner,
        allow_half_open: bool,
    ) -> Result<Self, ConnectError> {
        let opts: c_int = if allow_half_open { LIBUS_SOCKET_ALLOW_HALF_OPEN } else { 0 };
        // getaddrinfo doesn't understand bracketed IPv6 literals; URL parsing
        // leaves them in (`[::1]`), so strip here like the old connectAnon did.
        let host = if raw_host.len() > 1
            && raw_host[0] == b'['
            && raw_host[raw_host.len() - 1] == b']'
        {
            &raw_host[1..raw_host.len() - 1]
        } else {
            raw_host
        };
        // SocketGroup.connect needs a NUL-terminated host.
        let mut stack = [0u8; 256];
        let heap: Vec<u8>;
        let host_z: &core::ffi::CStr = if host.len() < stack.len() {
            stack[..host.len()].copy_from_slice(host);
            stack[host.len()] = 0;
            // SAFETY: stack[host.len()] == 0 written above; bytes before are `host`.
            unsafe { core::ffi::CStr::from_bytes_with_nul_unchecked(&stack[..=host.len()]) }
        } else {
            heap = {
                let mut v = Vec::with_capacity(host.len() + 1);
                v.extend_from_slice(host);
                v.push(0);
                v
            };
            // SAFETY: heap[host.len()] == 0 pushed above.
            unsafe { core::ffi::CStr::from_bytes_with_nul_unchecked(&heap[..]) }
        };

        // Zig `?*Owner` is null-niche optimized (8 bytes); the dispatch
        // trampolines read the ext slot as `Option<NonNull<_>>`, so size and
        // write must match that layout — NOT `Option<*mut Owner>` (16 bytes,
        // discriminant-first), which would hand the trampoline `1` instead of
        // the owner pointer.
        let ext_size = core::mem::size_of::<Option<core::ptr::NonNull<Owner>>>() as c_int;
        match g.connect(kind, ssl_ctx, host_z, port, opts, ext_size) {
            ConnectResult::Failed => Err(ConnectError::FailedToOpenSocket),
            ConnectResult::Socket(s) => {
                // SAFETY: ext storage is sized for `?*Owner` and `s` is live.
                unsafe {
                    *sock_c::us_socket_ext(s).cast::<Option<core::ptr::NonNull<Owner>>>() =
                        core::ptr::NonNull::new(owner)
                };
                Ok(Self { socket: InternalSocket::Connected(s) })
            }
            ConnectResult::Connecting(cs) => {
                // SAFETY: ext storage is sized for `?*Owner` and `cs` is live.
                unsafe {
                    *sock_c::us_connecting_socket_ext(cs).cast::<Option<core::ptr::NonNull<Owner>>>() =
                        core::ptr::NonNull::new(owner)
                };
                Ok(Self { socket: InternalSocket::Connecting(cs) })
            }
        }
    }

    pub fn connect_unix_group<Owner>(
        g: &mut SocketGroup,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        path: &[u8],
        owner: *mut Owner,
        allow_half_open: bool,
    ) -> Result<Self, ConnectError> {
        let opts: c_int = if allow_half_open { LIBUS_SOCKET_ALLOW_HALF_OPEN } else { 0 };
        // Zig `?*Owner` — see connect_group above for layout rationale.
        let ext_size = core::mem::size_of::<Option<core::ptr::NonNull<Owner>>>() as c_int;
        let s = g.connect_unix(kind, ssl_ctx, path, opts, ext_size);
        if s.is_null() {
            return Err(ConnectError::FailedToOpenSocket);
        }
        // SAFETY: ext storage is sized for `?*Owner` and `s` is live.
        unsafe {
            *sock_c::us_socket_ext(s).cast::<Option<core::ptr::NonNull<Owner>>>() =
                core::ptr::NonNull::new(owner)
        };
        Ok(Self { socket: InternalSocket::Connected(s) })
    }

    /// `*SSL` when `SSL == true`, raw fd-as-ptr otherwise. Type-erased to
    /// `*mut c_void` here because const-generic type dispatch
    /// (`NativeSocketHandleType(is_ssl)`) is unsupported in stable Rust;
    /// callers `cast()` immediately anyway.
    pub fn get_native_handle(&self) -> Option<*mut c_void> {
        let h = match self.socket {
            // SAFETY: variant pointers are non-null FFI handles owned by uSockets.
            InternalSocket::Connected(s) => unsafe { sock_c::us_socket_get_native_handle(s) },
            InternalSocket::Connecting(s) => unsafe { sock_c::us_connecting_socket_get_native_handle(s) },
            // SAFETY: variant pointer is a non-null type-erased `*mut UpgradedDuplex`.
            InternalSocket::UpgradedDuplex(s) if SSL => unsafe { sock_c::UpgradedDuplex__ssl(s) },
            InternalSocket::UpgradedDuplex(_) => return None,
            #[cfg(windows)]
            InternalSocket::Pipe(s) if SSL => unsafe { sock_c::WindowsNamedPipe__ssl(s) },
            #[cfg(windows)]
            InternalSocket::Pipe(_) => return None,
            #[cfg(not(windows))]
            InternalSocket::Pipe => return None,
            InternalSocket::Detached => return None,
        };
        if h.is_null() { None } else { Some(h) }
    }

    /// Move an open socket into a new group/kind, stashing `owner` in the ext.
    /// Replaces `Socket.adoptPtr`.
    ///
    /// `set_socket_field` replaces Zig's `comptime field: []const u8` +
    /// `@field(owner, field)` reflection — the closure writes the resulting
    /// `Self` into the owner's socket field via the raw `*mut Owner` (Zig's
    /// `*T` aliases freely; passing `&mut Owner` here would alias any live
    /// `&mut` the caller already holds, so we keep it raw-ptr-only).
    pub fn adopt_group<Owner>(
        tcp: *mut us_socket_t,
        g: *mut SocketGroup,
        kind: SocketKind,
        owner: *mut Owner,
        set_socket_field: impl FnOnce(*mut Owner, Self),
    ) -> bool {
        // SAFETY: `tcp` and `g` are non-null FFI handles; ext sizes are word-sized.
        let new_s = unsafe {
            sock_c::us_socket_adopt(
                tcp,
                g,
                kind as u8,
                core::mem::size_of::<*mut c_void>() as i32,
                core::mem::size_of::<*mut c_void>() as i32,
            )
        };
        if new_s.is_null() {
            return false;
        }
        // SAFETY: ext storage is sized for `*mut c_void` and `new_s` is live.
        unsafe { *sock_c::us_socket_ext(new_s).cast::<*mut c_void>() = owner.cast::<c_void>() };
        // Forward the raw pointer — do NOT materialize `&mut *owner` here:
        // callers (e.g. websocket_client) hold a live `&mut Owner` across this
        // call, so creating a second one would be aliased UB. The closure
        // performs the field write through the raw pointer itself.
        set_socket_field(owner, Self { socket: InternalSocket::Connected(new_s) });
        true
    }

    #[inline]
    pub fn from(socket: *mut us_socket_t) -> Self {
        Self { socket: InternalSocket::Connected(socket) }
    }

    #[inline]
    pub fn from_connecting(connecting: *mut ConnectingSocket) -> Self {
        Self { socket: InternalSocket::Connecting(connecting) }
    }

    #[inline]
    pub fn from_any(socket: InternalSocket) -> Self {
        Self { socket }
    }
}

pub type SocketTCP = NewSocketHandler<false>;
pub type SocketTLS = NewSocketHandler<true>;
/// Alias used by `http`, `ipc`, `websocket_client` — same type, less ceremony.
pub type SocketHandler<const SSL: bool> = NewSocketHandler<SSL>;

/// Error from `connect_group` / `connect_unix_group`.
#[derive(strum::IntoStaticStr, Debug)]
pub enum ConnectError {
    FailedToOpenSocket,
}
impl From<ConnectError> for bun_core::Error {
    fn from(_: ConnectError) -> Self {
        bun_core::err!("FailedToOpenSocket")
    }
}

/// TODO: rename to ConnectedSocket
pub enum AnySocket {
    SocketTcp(SocketTCP),
    SocketTls(SocketTLS),
}

impl AnySocket {
    #[inline]
    pub fn is_ssl(&self) -> bool {
        matches!(self, AnySocket::SocketTls(_))
    }
    #[inline]
    pub fn socket(&self) -> &InternalSocket {
        match self {
            AnySocket::SocketTcp(s) => &s.socket,
            AnySocket::SocketTls(s) => &s.socket,
        }
    }
    /// `*SSL` for `SocketTls`, fd-as-ptr for `SocketTcp`. Type-erased; callers
    /// `cast()` immediately. Mirrors Zig `AnySocket.getNativeHandle`.
    #[inline]
    pub fn get_native_handle(&self) -> Option<*mut c_void> {
        match self {
            AnySocket::SocketTcp(s) => s.get_native_handle(),
            AnySocket::SocketTls(s) => s.get_native_handle(),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// AnyRequest / AnyResponse
// ═══════════════════════════════════════════════════════════════════════════

/// Transport-agnostic request handle. Static/file routes take this so the same
/// handler body serves HTTP/1.1 and HTTP/3. Re-exported from `bun_uws_sys` —
/// the sys-crate version already carries `header`/`method`/`url`/`set_yield`/
/// `date_for_header`, so route handlers need no local extension trait.
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws/uws.zig (177 lines)
//   confidence: medium
//   todos:      6
//   notes:      mostly thin re-exports; module-as-PascalCase aliases and open Opcode enum need Phase B review
// ──────────────────────────────────────────────────────────────────────────
