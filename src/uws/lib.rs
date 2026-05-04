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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws/uws.zig (177 lines)
//   confidence: medium
//   todos:      6
//   notes:      mostly thin re-exports; module-as-PascalCase aliases and open Opcode enum need Phase B review
// ──────────────────────────────────────────────────────────────────────────
