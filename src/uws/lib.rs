#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]

use core::ffi::{c_char, c_int, c_uint, c_void};

use bun_string::ZStr;

// ──────────────────────────────────────────────────────────────────────────
// Thin re-exports from uws_sys / runtime
// ──────────────────────────────────────────────────────────────────────────
// B-2: bun_uws_sys still gates every module (only opaque handles exported), so
// the Phase-A re-export list stays parked. Local opaque stubs below keep higher
// tiers compiling.
// TODO(b2-blocked): bun_uws_sys::{us_socket_t, socket, Timer, SocketGroup,
//   SocketKind, SocketContext, ConnectingSocket, InternalLoopData, Loop,
//   Request, Response, App, WebSocket, ListenSocket, udp, BodyReaderMixin,
//   h3, quic, vtable} — modules gated in lower tier.
// The bun_runtime::* items (dispatch, WindowsNamedPipe, UpgradedDuplex) are
// upward refs and intentionally remain local stub modules.

#[cfg(any())]
mod _phase_a_reexports {
    pub use bun_uws_sys::us_socket_t::us_socket_t;
    pub use bun_uws_sys::us_socket_t::us_socket_stream_buffer_t;
    pub use bun_uws_sys::socket::SocketTLS;
    pub use bun_uws_sys::socket::SocketTCP;
    pub use bun_uws_sys::socket::InternalSocket;
    pub use bun_uws_sys::timer::Timer;
    pub use bun_uws_sys::socket_group::SocketGroup;
    pub use bun_uws_sys::socket_kind::SocketKind;
    pub use bun_uws_sys::vtable;
    pub use bun_runtime::socket::uws_dispatch as dispatch;
    pub use bun_uws_sys::socket_context as SocketContext;
    pub use bun_uws_sys::connecting_socket::ConnectingSocket;
    pub use bun_uws_sys::internal_loop_data::InternalLoopData;
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
    pub use bun_runtime::socket::upgraded_duplex as UpgradedDuplex;
    pub use bun_uws_sys::listen_socket::ListenSocket;
    pub use bun_uws_sys::response::State;
    pub use bun_uws_sys::loop_::Loop;
    pub use bun_uws_sys::udp;
    pub use bun_uws_sys::body_reader_mixin::BodyReaderMixin;
    pub use bun_uws_sys::h3 as H3;
    pub use bun_uws_sys::quic;
}

// ── B-1 stub surface ──────────────────────────────────────────────────────
// Opaque placeholders for the gated re-exports above. Higher tiers reference
// these by name; bodies arrive in B-2 when uws_sys un-gates.
macro_rules! opaque_stub {
    ($($name:ident),+ $(,)?) => {$(
        #[repr(C)] pub struct $name { _p: [u8; 0], _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)> }
    )+};
}
// TODO(b1): bun_uws_sys::{socket,timer,loop_,request,response,app,web_socket,...} gated
opaque_stub!(
    us_socket_stream_buffer_t, SocketKind, NewApp,
    uws_res, RawWebSocket, AnyWebSocket, State, BodyReaderMixin,
);
pub struct WebSocketBehavior<T>(core::marker::PhantomData<T>);

// Local opaque handles. `bun_uws_sys` is mid-un-gating (concurrent B-2 pass)
// and its surface is unstable — `us_socket_t` flipped from a type to a module
// there — so we define the FFI handles here directly. They are `#[repr(C)]`
// zero-sized opaques, ABI-identical to whatever bun_uws_sys settles on; once
// that crate stabilizes, collapse these back to `pub use bun_uws_sys::*`.
opaque_stub!(us_socket_t, ConnectingSocket, ListenSocket, Request, Timer);
pub type Socket = us_socket_t;

pub mod udp {
    #[repr(C)] pub struct Socket { _p: [u8; 0], _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)> }
    #[repr(C)] pub struct PacketBuffer { _p: [u8; 0], _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)> }
}
pub mod vtable {
    pub struct VTable; // B-2: real socket dispatch vtable in bun_uws_sys
}

// TODO(b1): bun_runtime not in deps — module-namespace stubs.
pub mod dispatch {}
pub mod WindowsNamedPipe {}
pub mod UpgradedDuplex {}
pub mod H3 {
    // Opaque lsquic-backed request/response — full bodies live in bun_uws_sys::h3 (gated).
    #[repr(C)] pub struct Request { _p: [u8; 0], _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)> }
    #[repr(C)] pub struct Response { _p: [u8; 0], _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)> }
}
pub mod quic {}

/// Bare BoringSSL `SSL_CTX`. `SSL_CTX_up_ref`/`SSL_CTX_free` is the refcount;
/// policy (verify mode, reneg limits) is encoded on the SSL_CTX itself via
/// `us_ssl_ctx_from_options`, so there's no wrapper struct. `Option<*mut SslCtx>`
/// is what listen/connect/adopt take.
pub type SslCtx = bun_boringssl::c::SSL_CTX;

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

        pub use bun_boringssl::c::{SSL, SSL_CTX};

        // ── opaque handles not yet in bun_boringssl_sys ────────────────
        macro_rules! opaque {
            ($($name:ident),+ $(,)?) => {$(
                #[repr(C)] pub struct $name { _p: [u8; 0], _m: PhantomData<(*mut u8, PhantomPinned)> }
            )+};
        }
        opaque!(BIO, BIO_METHOD, X509_STORE, X509_STORE_CTX);

        // ── constants (values from vendor/boringssl/include/openssl/ssl.h) ──
        pub const SSL_ERROR_SSL: c_int = 1;
        pub const SSL_ERROR_WANT_READ: c_int = 2;
        pub const SSL_ERROR_WANT_WRITE: c_int = 3;
        pub const SSL_ERROR_SYSCALL: c_int = 5;
        pub const SSL_ERROR_ZERO_RETURN: c_int = 6;
        pub const SSL_ERROR_WANT_RENEGOTIATE: c_int = 19;

        pub const SSL_VERIFY_NONE: c_int = 0x00;
        pub const SSL_VERIFY_PEER: c_int = 0x01;

        pub const SSL_RECEIVED_SHUTDOWN: c_int = 2;

        // `enum ssl_renegotiate_mode_t` is `BORINGSSL_ENUM_INT` (= c_int).
        pub type ssl_renegotiate_mode_t = c_int;
        pub const ssl_renegotiate_never: ssl_renegotiate_mode_t = 0;
        pub const ssl_renegotiate_explicit: ssl_renegotiate_mode_t = 4;

        pub type SSL_verify_cb =
            Option<unsafe extern "C" fn(preverify_ok: c_int, ctx: *mut X509_STORE_CTX) -> c_int>;

        // ── extern fns ─────────────────────────────────────────────────
        unsafe extern "C" {
            // ssl.h
            pub fn SSL_new(ctx: *mut SSL_CTX) -> *mut SSL;
            pub fn SSL_free(ssl: *mut SSL);
            pub fn SSL_CTX_free(ctx: *mut SSL_CTX);
            pub fn SSL_set_connect_state(ssl: *mut SSL);
            pub fn SSL_set_accept_state(ssl: *mut SSL);
            pub fn SSL_set_bio(ssl: *mut SSL, rbio: *mut BIO, wbio: *mut BIO);
            pub fn SSL_get_rbio(ssl: *const SSL) -> *mut BIO;
            pub fn SSL_get_wbio(ssl: *const SSL) -> *mut BIO;
            pub fn SSL_do_handshake(ssl: *mut SSL) -> c_int;
            pub fn SSL_read(ssl: *mut SSL, buf: *mut c_void, num: c_int) -> c_int;
            pub fn SSL_write(ssl: *mut SSL, buf: *const c_void, num: c_int) -> c_int;
            pub fn SSL_shutdown(ssl: *mut SSL) -> c_int;
            pub fn SSL_get_error(ssl: *const SSL, ret_code: c_int) -> c_int;
            pub fn SSL_is_init_finished(ssl: *const SSL) -> c_int;
            pub fn SSL_get_shutdown(ssl: *const SSL) -> c_int;
            pub fn SSL_set_verify(ssl: *mut SSL, mode: c_int, callback: SSL_verify_cb);
            pub fn SSL_CTX_get_verify_mode(ctx: *const SSL_CTX) -> c_int;
            pub fn SSL_set0_verify_cert_store(ssl: *mut SSL, store: *mut X509_STORE) -> c_int;
            pub fn SSL_set_renegotiate_mode(ssl: *mut SSL, mode: ssl_renegotiate_mode_t);
            pub fn SSL_renegotiate(ssl: *mut SSL) -> c_int;
            // bio.h
            pub fn BIO_new(method: *const BIO_METHOD) -> *mut BIO;
            pub fn BIO_free(bio: *mut BIO) -> c_int;
            pub fn BIO_read(bio: *mut BIO, data: *mut c_void, len: c_int) -> c_int;
            pub fn BIO_write(bio: *mut BIO, data: *const c_void, len: c_int) -> c_int;
            pub fn BIO_ctrl_pending(bio: *const BIO) -> usize;
            pub fn BIO_s_mem() -> *const BIO_METHOD;
            pub fn BIO_set_mem_eof_return(bio: *mut BIO, eof_value: c_int) -> c_int;
            // err.h
            pub fn ERR_clear_error();
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
        #[cfg(any())]
        // TODO(b2-blocked): bun_uws_sys::socket_context::BunSocketContextOptions
        // (module gated in lower tier; signature uses the type and body calls
        // `.create_ssl_context()` on it).
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

// B-2 track-A round 11: bun_uws_sys now provides the real Loop/PosixLoop/
// WindowsLoop/InternalLoopData/SocketGroup. Re-export them here so
// `bun_uws::Loop` and `bun_uws_sys::Loop` are the SAME type (bun_aio's
// EventLoopCtxVTable is typed against the uws_sys version). The B-1 stub
// structs and their inherent impls below are now redundant — gated as
// `_b1_loop_stub` for the diff-pass.
pub use bun_uws_sys::{InternalLoopData, Loop, PosixLoop, Timespec, WindowsLoop};
pub use bun_uws_sys::loop_::LoopHandler;
pub type LoopCb = unsafe extern "C" fn(*mut Loop);

#[cfg(any())]
mod _b1_loop_stub {
use super::*;

#[repr(C)]
pub struct us_internal_async {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

/// `#[repr(C)]` mirror of `us_internal_loop_data_t`. Field order must match the
/// C header byte-for-byte; static asserts live in bun_uws_sys when un-gated.
#[repr(C)]
pub struct InternalLoopData {
    pub sweep_timer: *mut Timer,
    pub sweep_timer_count: i32,
    pub wakeup_async: *mut us_internal_async,
    pub head: *mut SocketGroup,
    pub quic_head: *mut c_void,
    pub quic_next_tick_us: i64,
    pub quic_timer: *mut Timer,
    pub iterator: *mut SocketGroup,
    pub recv_buf: *mut u8,
    pub send_buf: *mut u8,
    pub ssl_data: *mut c_void,
    pub pre_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    pub post_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    pub closed_udp_head: *mut udp::Socket,
    pub closed_head: *mut us_socket_t,
    pub low_prio_head: *mut us_socket_t,
    pub low_prio_budget: i32,
    pub dns_ready_head: *mut ConnectingSocket,
    pub closed_connecting_head: *mut ConnectingSocket,
    mutex: ZigMutex,
    pub parent_ptr: *mut c_void,
    pub parent_tag: core::ffi::c_char,
    pub iteration_nr: usize,
    /// Erased `?*jsc::VM` — tier-0/1 cannot name JSC types. Higher tiers cast.
    pub jsc_vm: *mut c_void,
    pub tick_depth: c_int,
}

/// Carrier trait so `set_parent_event_loop` can accept the higher-tier
/// `EventLoopHandle` without depending on it. The event-loop crate impls this
/// on its enum (`.js` → tag 1, `.mini` → tag 2).
pub trait ParentEventLoopHandle {
    fn into_tag_ptr(self) -> (core::ffi::c_char, *mut c_void);
}

impl InternalLoopData {
    const LIBUS_RECV_BUFFER_LENGTH: usize = 524288;

    pub fn recv_slice(&mut self) -> &mut [u8] {
        // SAFETY: `recv_buf` is malloc'd by C `us_internal_loop_data_init` with
        // at least LIBUS_RECV_BUFFER_LENGTH bytes and lives as long as the loop.
        unsafe { core::slice::from_raw_parts_mut(self.recv_buf, Self::LIBUS_RECV_BUFFER_LENGTH) }
    }

    #[inline]
    pub fn should_enable_date_header_timer(&self) -> bool {
        self.sweep_timer_count > 0
    }

    /// Zig: `setParentEventLoop(this, parent: jsc.EventLoopHandle)`. Tag 1 = JS
    /// event loop, tag 2 = mini event loop. Generic over the handle so this
    /// crate stays free of the `jsc` dependency.
    #[inline]
    pub fn set_parent_event_loop<H: ParentEventLoopHandle>(&mut self, parent: H) {
        let (tag, ptr) = parent.into_tag_ptr();
        self.parent_tag = tag;
        self.parent_ptr = ptr;
    }

    /// Raw form for callers that already have (tag, ptr). See `set_parent_event_loop`.
    #[inline]
    pub fn set_parent_raw(&mut self, tag: core::ffi::c_char, ptr: *mut c_void) {
        self.parent_tag = tag;
        self.parent_ptr = ptr;
    }

    /// Zig: `getParent() jsc.EventLoopHandle`. Low tier returns the (tag, ptr)
    /// pair; the typed enum wrapper lives in the higher-tier crate that can
    /// name `jsc::EventLoop` / `jsc::MiniEventLoop`.
    #[inline]
    pub fn get_parent(&self) -> (core::ffi::c_char, *mut c_void) {
        if self.parent_ptr.is_null() {
            panic!("Parent loop not set - pointer is null");
        }
        if self.parent_tag == 0 {
            panic!("Parent loop not set - tag is zero");
        }
        (self.parent_tag, self.parent_ptr)
    }
}

/// `struct timespec`-shaped argument for `us_loop_run_bun_tick`. Mirrors
/// `bun.timespec` (i64 sec, i64 nsec).
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Timespec {
    pub sec: i64,
    pub nsec: i64,
}

// ── Loop (PosixLoop / WindowsLoop) ────────────────────────────────────────

#[cfg(target_os = "linux")]
pub type LoopEventType = libc::epoll_event;
#[cfg(target_os = "macos")]
pub type LoopEventType = libc::kevent64_s;
#[cfg(target_os = "freebsd")]
pub type LoopEventType = libc::kevent;
#[cfg(windows)]
pub type LoopEventType = *mut c_void;

/// `struct us_loop_t` on epoll/kqueue backends.
#[repr(C, align(16))]
pub struct PosixLoop {
    pub internal_loop_data: InternalLoopData,
    /// Number of non-fallthrough polls in the loop.
    pub num_polls: i32,
    /// Number of ready polls this iteration.
    pub num_ready_polls: i32,
    /// Current index in list of ready polls.
    pub current_ready_poll: i32,
    /// Loop's own file descriptor.
    pub fd: i32,
    /// Number of polls owned by Bun.
    pub active: u32,
    /// Atomically bumped by `wakeup()`; non-zero short-circuits the GC safepoint.
    pub pending_wakeups: u32,
    pub ready_polls: [LoopEventType; 1024],
}

/// `struct us_loop_t` on the libuv backend.
#[cfg(windows)]
#[repr(C, align(16))]
pub struct WindowsLoop {
    pub internal_loop_data: InternalLoopData,
    pub uv_loop: *mut c_void, // *mut uv::Loop — bun_windows_sys::libuv lives in a higher tier
    pub is_default: c_int,
    pub pre: *mut c_void,   // *mut uv_prepare_t
    pub check: *mut c_void, // *mut uv_check_t
}
#[cfg(not(windows))]
pub type WindowsLoop = PosixLoop;

#[cfg(windows)]
pub type Loop = WindowsLoop;
#[cfg(not(windows))]
pub type Loop = PosixLoop;

pub type LoopCb = unsafe extern "C" fn(*mut Loop);

mod loop_c {
    use super::{c_int, c_uint, c_void, Loop, Timespec};
    unsafe extern "C" {
        pub fn us_create_loop(
            hint: *mut c_void,
            wakeup_cb: Option<super::LoopCb>,
            pre_cb: Option<super::LoopCb>,
            post_cb: Option<super::LoopCb>,
            ext_size: c_uint,
        ) -> *mut Loop;
        pub fn us_loop_free(loop_: *mut Loop);
        pub fn us_loop_run(loop_: *mut Loop);
        #[cfg(windows)]
        pub fn us_loop_pump(loop_: *mut Loop);
        pub fn us_wakeup_loop(loop_: *mut Loop);
        pub fn us_loop_run_bun_tick(loop_: *mut Loop, timeout: *const Timespec);
        pub fn uws_get_loop() -> *mut Loop;
        #[cfg(windows)]
        pub fn uws_get_loop_with_native(native: *mut c_void) -> *mut Loop;
    }
}

#[cfg(not(windows))]
impl PosixLoop {
    /// Zig: `create(comptime Handler)`. Higher tiers pass their wakeup/pre/post
    /// trampolines directly; the Zig comptime-handler indirection isn't needed.
    pub fn create(wakeup: LoopCb, pre: LoopCb, post: LoopCb) -> *mut Loop {
        // SAFETY: us_create_loop allocates and returns a new loop; null hint is valid.
        let p = unsafe { loop_c::us_create_loop(core::ptr::null_mut(), Some(wakeup), Some(pre), Some(post), 0) };
        assert!(!p.is_null(), "us_create_loop returned null");
        p
    }

    /// Process-lifetime singleton. Returned as `&'static mut` because callers
    /// reach into `internal_loop_data` fields directly.
    ///
    /// # Safety
    /// Single-threaded access only — the loop is per-thread in usockets but the
    /// `'static mut` lets the borrow checker prove nothing about concurrent use.
    pub fn get() -> &'static mut Loop {
        // SAFETY: uws_get_loop returns the thread's singleton, never null after
        // the runtime has called `create`.
        unsafe { &mut *loop_c::uws_get_loop() }
    }

    /// `&InternalLoopData` accessor — the field is also `pub` for callers that
    /// have a `*mut Loop` and dereference it directly.
    #[inline]
    pub fn internal_loop_data(&mut self) -> &mut InternalLoopData {
        &mut self.internal_loop_data
    }

    pub fn iteration_number(&self) -> u64 {
        self.internal_loop_data.iteration_nr as u64
    }

    pub fn inc(&mut self) {
        self.num_polls += 1;
    }
    pub fn dec(&mut self) {
        self.num_polls -= 1;
    }
    pub fn ref_(&mut self) {
        self.num_polls += 1;
        self.active += 1;
    }
    pub fn unref(&mut self) {
        self.num_polls -= 1;
        self.active = self.active.saturating_sub(1);
    }
    #[inline]
    pub fn is_active(&self) -> bool {
        self.active > 0
    }

    pub fn wakeup(&mut self) {
        // SAFETY: self is a valid loop pointer.
        unsafe { loop_c::us_wakeup_loop(self) };
    }
    #[inline]
    pub fn wake(&mut self) {
        self.wakeup();
    }

    pub fn tick(&mut self) {
        // SAFETY: self is a valid loop pointer.
        unsafe { loop_c::us_loop_run_bun_tick(self, core::ptr::null()) };
    }
    pub fn tick_without_idle(&mut self) {
        let ts = Timespec { sec: 0, nsec: 0 };
        // SAFETY: self is valid; &ts lives for the call.
        unsafe { loop_c::us_loop_run_bun_tick(self, &ts) };
    }
    pub fn tick_with_timeout(&mut self, timespec: Option<&Timespec>) {
        // SAFETY: self is a valid loop pointer.
        unsafe { loop_c::us_loop_run_bun_tick(self, timespec.map_or(core::ptr::null(), |t| t as *const _)) };
    }

    pub fn run(&mut self) {
        // SAFETY: self is a valid loop pointer.
        unsafe { loop_c::us_loop_run(self) };
    }

    /// FFI-destroy: `us_loop_free` frees the C-allocated loop. Not `Drop`
    /// because the loop is C-owned and never lives as a Rust-owned value.
    ///
    /// # Safety
    /// `this` must have been returned by `create`/`get` and not yet freed.
    pub unsafe fn deinit(this: *mut Loop) {
        // SAFETY: caller contract.
        unsafe { loop_c::us_loop_free(this) };
    }
}

#[cfg(windows)]
impl WindowsLoop {
    pub fn create(wakeup: LoopCb, pre: LoopCb, post: LoopCb) -> *mut Loop {
        // SAFETY: us_create_loop allocates and returns a new loop; null hint is valid.
        let p = unsafe { loop_c::us_create_loop(core::ptr::null_mut(), Some(wakeup), Some(pre), Some(post), 0) };
        assert!(!p.is_null(), "us_create_loop returned null");
        p
    }

    pub fn get() -> &'static mut Loop {
        // TODO(b2-blocked): bun_windows_sys::libuv::Loop::get() — pass libuv
        // default loop as the native hint. Null hint also works for the singleton.
        // SAFETY: uws_get_loop_with_native returns the thread's singleton.
        unsafe { &mut *loop_c::uws_get_loop_with_native(core::ptr::null_mut()) }
    }

    #[inline]
    pub fn internal_loop_data(&mut self) -> &mut InternalLoopData {
        &mut self.internal_loop_data
    }

    pub fn iteration_number(&self) -> u64 {
        self.internal_loop_data.iteration_nr as u64
    }

    // ref/unref/inc/dec forward to libuv on Windows; the uv loop pointer is
    // type-erased here so we cannot call `(*self.uv_loop).inc()` directly.
    // TODO(b2-blocked): bun_windows_sys::libuv::Loop — wire to uv_loop->active_handles.
    pub fn inc(&mut self) {}
    pub fn dec(&mut self) {}
    #[inline] pub fn ref_(&mut self) { self.inc(); }
    #[inline] pub fn unref(&mut self) { self.dec(); }
    pub fn is_active(&self) -> bool {
        // TODO(b2-blocked): bun_windows_sys::libuv::Loop::is_active
        false
    }

    pub fn wakeup(&mut self) {
        // SAFETY: self is a valid loop pointer.
        unsafe { loop_c::us_wakeup_loop(self) };
    }
    #[inline] pub fn wake(&mut self) { self.wakeup(); }

    pub fn tick(&mut self) {
        // SAFETY: self is a valid loop pointer.
        unsafe { loop_c::us_loop_run(self) };
    }
    pub fn tick_with_timeout(&mut self, _timespec: Option<&Timespec>) {
        // SAFETY: self is a valid loop pointer.
        unsafe { loop_c::us_loop_run(self) };
    }
    pub fn tick_without_idle(&mut self) {
        // SAFETY: self is a valid loop pointer.
        unsafe { loop_c::us_loop_pump(self) };
    }
    pub fn run(&mut self) {
        // SAFETY: self is a valid loop pointer.
        unsafe { loop_c::us_loop_run(self) };
    }

    /// # Safety
    /// `this` must have been returned by `create`/`get` and not yet freed.
    pub unsafe fn deinit(this: *mut Loop) {
        // SAFETY: caller contract.
        unsafe { loop_c::us_loop_free(this) };
    }
}

} // end #[cfg(any())] mod _b1_loop_stub

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

// ═══════════════════════════════════════════════════════════════════════════
// SocketContext::BunSocketContextOptions
// ═══════════════════════════════════════════════════════════════════════════
pub mod SocketContext {
    use core::ffi::c_char;
    use core::ptr;

    /// `#[repr(C)]` mirror of `us_bun_socket_context_options_t`. What
    /// `SSLConfig.asUSockets()` produces and `us_ssl_ctx_from_options` consumes.
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct BunSocketContextOptions {
        pub key_file_name: *const c_char,
        pub cert_file_name: *const c_char,
        pub passphrase: *const c_char,
        pub dh_params_file_name: *const c_char,
        pub ca_file_name: *const c_char,
        pub ssl_ciphers: *const c_char,
        pub ssl_prefer_low_memory_usage: i32,
        pub key: *const *const c_char,
        pub key_count: u32,
        pub cert: *const *const c_char,
        pub cert_count: u32,
        pub ca: *const *const c_char,
        pub ca_count: u32,
        pub secure_options: u32,
        pub reject_unauthorized: i32,
        pub request_cert: i32,
        pub client_renegotiation_limit: u32,
        pub client_renegotiation_window: u32,
    }

    impl Default for BunSocketContextOptions {
        fn default() -> Self {
            Self {
                key_file_name: ptr::null(),
                cert_file_name: ptr::null(),
                passphrase: ptr::null(),
                dh_params_file_name: ptr::null(),
                ca_file_name: ptr::null(),
                ssl_ciphers: ptr::null(),
                ssl_prefer_low_memory_usage: 0,
                key: ptr::null(),
                key_count: 0,
                cert: ptr::null(),
                cert_count: 0,
                ca: ptr::null(),
                ca_count: 0,
                secure_options: 0,
                reject_unauthorized: 0,
                request_cert: 0,
                client_renegotiation_limit: 3,
                client_renegotiation_window: 600,
            }
        }
    }

    impl BunSocketContextOptions {
        /// Build a BoringSSL `SSL_CTX*` from these options. Caller owns one ref
        /// and releases with `SSL_CTX_free`.
        pub fn create_ssl_context(
            self,
            err: &mut crate::create_bun_socket_error_t,
        ) -> Option<*mut crate::SslCtx> {
            // SAFETY: `self` is `#[repr(C)]` passed by value; `err` is a valid out-param.
            let ctx = unsafe { us_ssl_ctx_from_options(self, err) };
            if ctx.is_null() { None } else { Some(ctx) }
        }
    }

    unsafe extern "C" {
        fn us_ssl_ctx_from_options(
            options: BunSocketContextOptions,
            err: *mut crate::create_bun_socket_error_t,
        ) -> *mut crate::SslCtx;
    }
}
/// Snake-case module alias for the porting tooling that lowercases Zig namespaces.
pub use SocketContext as socket_context;

// ═══════════════════════════════════════════════════════════════════════════
// Socket handlers (NewSocketHandler / SocketHandler / AnySocket)
// ═══════════════════════════════════════════════════════════════════════════
// Thin placeholders: full bodies live in `bun_uws_sys::socket` (gated). Higher
// tiers need the *types* to compile their own dispatch tables; method bodies
// arrive when the sys crate un-gates.

/// State of a single connection. Full impl lives in bun_uws_sys::socket.
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

/// Zig `NewSocketHandler(comptime is_ssl: bool)`. The const generic only
/// selects `*SSL` vs fd for `get_native_handle`; it is NOT forwarded to C.
pub struct NewSocketHandler<const SSL: bool> {
    pub socket: InternalSocket,
}

impl<const SSL: bool> NewSocketHandler<SSL> {
    pub const DETACHED: Self = Self { socket: InternalSocket::Detached };
}

pub type SocketTCP = NewSocketHandler<false>;
pub type SocketTLS = NewSocketHandler<true>;
/// Alias used by `http`, `ipc`, `websocket_client` — same type, less ceremony.
pub type SocketHandler<const SSL: bool> = NewSocketHandler<SSL>;

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
}

// ═══════════════════════════════════════════════════════════════════════════
// AnyRequest / AnyResponse
// ═══════════════════════════════════════════════════════════════════════════

/// Transport-agnostic request handle. Static/file routes take this so the same
/// handler body serves HTTP/1.1 and HTTP/3.
pub enum AnyRequest {
    H1(*mut Request),
    H3(*mut H3::Request),
}

impl AnyRequest {
    /// Look up a request header by lowercase name. Borrows request-internal
    /// storage; valid for the duration of the request callback only.
    pub fn header(&self, name: &[u8]) -> Option<&[u8]> {
        debug_assert!(name.first().is_none_or(|b| b.is_ascii_lowercase()));
        let mut ptr: *const u8 = core::ptr::null();
        // SAFETY: variant pointers are non-null FFI handles owned by uWS/lsquic
        // for the duration of the request callback; the C side writes a pointer
        // into request-owned storage and returns its length.
        let len = match self {
            Self::H1(r) => unsafe { req_c::uws_req_get_header(*r, name.as_ptr(), name.len(), &mut ptr) },
            Self::H3(r) => unsafe { req_c::us_h3_req_get_header(*r, name.as_ptr(), name.len(), &mut ptr) },
        };
        if len == 0 {
            return None;
        }
        // SAFETY: ptr/len describe a slice owned by the request for its lifetime.
        Some(unsafe { core::slice::from_raw_parts(ptr, len) })
    }
}

mod req_c {
    use super::{H3, Request};
    unsafe extern "C" {
        pub fn uws_req_get_header(
            res: *const Request,
            lower_case_header: *const u8,
            lower_case_header_length: usize,
            dest: *mut *const u8,
        ) -> usize;
        pub fn us_h3_req_get_header(
            res: *const H3::Request,
            lower_case_header: *const u8,
            lower_case_header_length: usize,
            dest: *mut *const u8,
        ) -> usize;
    }
}

/// Opaque `uws::Response<SSL>` — bodies live in bun_uws_sys::Response (gated).
#[repr(C)]
pub struct Response<const SSL: bool> {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

/// Transport-agnostic response handle.
#[derive(Clone, Copy)]
pub enum AnyResponse {
    SSL(*mut Response<true>),
    TCP(*mut Response<false>),
    H3(*mut H3::Response),
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws/uws.zig (177 lines)
//   confidence: medium
//   todos:      6
//   notes:      mostly thin re-exports; module-as-PascalCase aliases and open Opcode enum need Phase B review
// ──────────────────────────────────────────────────────────────────────────
