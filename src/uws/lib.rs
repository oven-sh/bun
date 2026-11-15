#![feature(core_io_borrowed_buf)]
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
    AnyWebSocket, BodyReaderMixin, ConnectingSocket, NewApp, RawWebSocket, Request,
    WebSocketBehavior, us_socket_stream_buffer_t, us_socket_t, uws_res,
};

/// `#[uws_callback]` — wraps a `&self`/`&mut self` method in an `extern "C"`
/// thunk that recovers `Self` from `*mut c_void` and lowers `&[T]` params to
/// `(ptr, len)` pairs. See `bun_jsc_macros::uws_callback` for the full
/// contract. With `panic = "abort"` Rust panics terminate in the crash-handler
/// hook, so no `catch_unwind` wrapper is emitted.
pub use bun_jsc_macros::uws_callback;
pub use bun_uws_sys::response::State;
pub use bun_uws_sys::{h2 as H2, h3 as H3, quic, socket_transfer, udp, vtable};
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
    H2 = 2,
    H3 = 3,
}

impl ResponseKind {
    #[inline]
    pub const fn of(resp: AnyResponse) -> ResponseKind {
        match resp {
            AnyResponse::TCP(_) => ResponseKind::Tcp,
            AnyResponse::SSL(_) => ResponseKind::Ssl,
            AnyResponse::H2(_) => ResponseKind::H2,
            AnyResponse::H3(_) => ResponseKind::H3,
        }
    }
}

pub use bun_uws_sys::web_socket::c::{SHARED_COMPRESSOR, SHARED_DECOMPRESSOR};
pub const DEDICATED_DECOMPRESSOR_2KB: i32 = 11 << 8;
pub const DEDICATED_DECOMPRESSOR_4KB: i32 = 12 << 8;
pub const DEDICATED_DECOMPRESSOR_8KB: i32 = 13 << 8;
pub const DEDICATED_DECOMPRESSOR_16KB: i32 = 14 << 8;
pub const DEDICATED_DECOMPRESSOR_32KB: i32 = 15 << 8;
pub const DEDICATED_DECOMPRESSOR: i32 = DEDICATED_DECOMPRESSOR_32KB;
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
    LIBUS_LISTEN_DEFAULT, LIBUS_LISTEN_EXCLUSIVE_PORT, LIBUS_LISTEN_REUSE_ADDR,
    LIBUS_LISTEN_REUSE_PORT, LIBUS_SOCKET_ALLOW_HALF_OPEN, LIBUS_SOCKET_IPV6_ONLY,
    LIBUS_SOCKET_OPEN_PAUSED,
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

pub use bun_uws_sys::loop_::free_thread_loop;

/// # Safety
/// `filename` and `error_msg` must be valid NUL-terminated C strings.
#[unsafe(no_mangle)]
unsafe extern "C" fn BUN__warn__extra_ca_load_failed(
    filename: *const c_char,
    error_msg: *const c_char,
) {
    // SAFETY: caller contract guarantees valid NUL-terminated strings.
    let filename = unsafe { bun_core::ffi::cstr(filename) };
    // SAFETY: caller contract guarantees valid NUL-terminated strings.
    let error_msg = unsafe { bun_core::ffi::cstr(error_msg) };
    // Node's wording: test-tls-env-bad-extra-ca.js matches on it.
    bun_core::pretty_errorln!(
        "Warning: Ignoring extra certs from `{}`, load failed: {}",
        bstr::BStr::new(filename.to_bytes()),
        bstr::BStr::new(error_msg.to_bytes()),
    );
    // stderr is buffered per thread: without this a Worker drops the line and the main thread holds it until exit.
    bun_core::Output::flush();
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
pub use ssl_wrapper::check_server_identity;

pub mod ssl_wrapper {
    use core::cell::{Cell, RefCell};
    use core::ffi::{c_char, c_int, c_long, c_uint, c_void};
    use core::mem::MaybeUninit;
    use core::ptr::NonNull;
    use core::sync::atomic::{AtomicPtr, Ordering};
    use std::collections::VecDeque;
    use std::sync::OnceLock;

    use bun_boringssl::AlpnSelection;
    use bun_boringssl::c::SslErrorCode;
    use bun_core::UnwrapOrOom;
    use bun_core::vec::BorrowedBuf;
    use bun_ptr::{AliasableBox, CellExt as _};

    // Re-export the canonical BoringSSL FFI surface; the lower-tier crate now
    // declares every symbol SSLWrapper needs, so the old local shim is gone.
    mod boring_sys {
        pub(super) use bun_boringssl::c::{
            BIO, BIO_CTRL_FLUSH, BIO_METHOD, BIO_TYPE_SOURCE_SINK, BIO_clear_retry_flags,
            BIO_get_data, BIO_get_new_index, BIO_meth_new, BIO_meth_set_ctrl, BIO_meth_set_read,
            BIO_meth_set_write, BIO_new, BIO_set_data, BIO_set_init, BIO_set_retry_read,
            ERR_clear_error, OpensslBytes, OwnedSsl, OwnedSslSession, RenegotiateMode, SSL,
            SSL_CTX, SSL_SESSION, SSL_VERIFY_FAIL_IF_NO_PEER_CERT, SSL_VERIFY_NONE,
            SSL_VERIFY_PEER, SSL_set_bio, SSL_set_verify, X509_STORE_CTX, X509_V_OK,
        };
    }

    use crate::us_bun_verify_error_t;

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

    /// 64kb nice buffer size for SSL reads: we loop until we have no more data to read.
    const BUFFER_SIZE: usize = 65536;

    /// Stack scratch of `SSL_read`.
    type IoBuffer = [MaybeUninit<u8>; BUFFER_SIZE];

    /// A queue that empties with more capacity than this gives it back.
    const QUEUE_RETAIN_LIMIT: usize = 2 * BUFFER_SIZE;

    /// `SSL3_RT_MAX_PLAIN_LENGTH`
    const MAX_RECORD_PLAINTEXT: usize = 16384;
    /// `SSL3_RT_HEADER_LENGTH + SSL3_RT_SEND_MAX_ENCRYPTED_OVERHEAD`
    const MAX_RECORD_OVERHEAD: usize = 5 + 88;

    /// What the one BIO of the `SSL` reads and writes. No borrow spans an `SSL_*` call or a handler.
    #[derive(Default)]
    struct Ciphertext {
        /// Sealed, not yet given to `Handlers::write`.
        outgoing: RefCell<Vec<u8>>,
        /// From the peer, not yet read by BoringSSL.
        incoming: RefCell<VecDeque<u8>>,
    }

    /// # Safety
    /// `init_with_ctx` made `bio`, and `data` is readable for `len` bytes.
    unsafe extern "C" fn bio_write(
        bio: *mut boring_sys::BIO,
        data: *const c_char,
        len: c_int,
    ) -> c_int {
        let Ok(count) = usize::try_from(len) else {
            return -1;
        };
        // SAFETY: `init_with_ctx` pointed this live BIO at the `Ciphertext` of the box that outlives it; BoringSSL passes `len` readable bytes.
        let (ciphertext, data) = unsafe {
            (
                &*boring_sys::BIO_get_data(bio).cast::<Ciphertext>(),
                core::slice::from_raw_parts(data.cast::<u8>(), count),
            )
        };
        let mut outgoing = ciphertext.outgoing.borrow_mut();
        outgoing.try_reserve(count).unwrap_or_oom();
        outgoing.extend_from_slice(data);
        len
    }

    /// # Safety
    /// `init_with_ctx` made `bio`, and `out` is writable for `len` bytes.
    unsafe extern "C" fn bio_read(
        bio: *mut boring_sys::BIO,
        out: *mut c_char,
        len: c_int,
    ) -> c_int {
        // SAFETY: as in `bio_write`.
        let ciphertext = unsafe {
            boring_sys::BIO_clear_retry_flags(bio);
            &*boring_sys::BIO_get_data(bio).cast::<Ciphertext>()
        };
        let mut incoming = ciphertext.incoming.borrow_mut();
        // BoringSSL reads again for what lies past the point where the ring wraps.
        let (front, _) = incoming.as_slices();
        let count = front.len().min(usize::try_from(len).unwrap_or(0));
        if count == 0 {
            // SAFETY: `bio` is live.
            unsafe { boring_sys::BIO_set_retry_read(bio) };
            return -1;
        }
        // SAFETY: BoringSSL passes `len` writable bytes of its own, and `count <= len`.
        unsafe { core::ptr::copy_nonoverlapping(front.as_ptr(), out.cast::<u8>(), count) };
        incoming.drain(..count);
        if incoming.is_empty() && incoming.capacity() > QUEUE_RETAIN_LIMIT {
            *incoming = VecDeque::new();
        }
        c_int::try_from(count).unwrap_or(len)
    }

    /// BoringSSL fails a flight whose `BIO_flush` reports 0.
    extern "C" fn bio_ctrl(
        _: *mut boring_sys::BIO,
        cmd: c_int,
        _: c_long,
        _: *mut c_void,
    ) -> c_long {
        c_long::from(cmd == boring_sys::BIO_CTRL_FLUSH)
    }

    fn bio_method() -> *const boring_sys::BIO_METHOD {
        static METHOD: OnceLock<AtomicPtr<boring_sys::BIO_METHOD>> = OnceLock::new();
        METHOD
            .get_or_init(|| {
                // A type of its own: see `us_ssl_is_socket` in openssl.c.
                let r#type = boring_sys::BIO_get_new_index() | boring_sys::BIO_TYPE_SOURCE_SINK;
                // SAFETY: the name is static, and a null `method` does not get past the check.
                unsafe {
                    let method = boring_sys::BIO_meth_new(r#type, c"SSLWrapper".as_ptr());
                    if method.is_null() {
                        bun_core::out_of_memory();
                    }
                    boring_sys::BIO_meth_set_write(method, Some(bio_write));
                    boring_sys::BIO_meth_set_read(method, Some(bio_read));
                    boring_sys::BIO_meth_set_ctrl(method, Some(bio_ctrl));
                    AtomicPtr::new(method)
                }
            })
            .load(Ordering::Relaxed)
    }

    /// Cap on peer-initiated TLS renegotiations per
    /// [`MAX_RENEGOTIATION_WINDOW`]. Mirrors the `us_reneg_policy` defaults in
    /// the uSockets C path (openssl.c) and Node's
    /// `CLIENT_RENEG_LIMIT`/`CLIENT_RENEG_WINDOW`. Unbounded renegotiation is
    /// a CPU DoS (CVE-2011-1473).
    const MAX_RENEGOTIATIONS: u8 = 3;
    /// See [`MAX_RENEGOTIATIONS`].
    const MAX_RENEGOTIATION_WINDOW: core::time::Duration = core::time::Duration::from_secs(600);

    /// `US_SSL_FATAL_ERROR_REASON_MAX` in openssl.c.
    const FATAL_ERROR_REASON_MAX: usize = 256;

    /// What BoringSSL's callbacks read and write. The `SSL` points at it: see `us_ssl_set_wrapper`.
    struct CallbackState {
        inline_reject: Cell<bool>,
        verify_failed: Cell<bool>,
        identity_checked: Cell<bool>,
        /// `SSLWrapper::<T>::server_identity`, which finds its wrapper from this field's address.
        server_identity: Option<
            unsafe fn(*const CallbackState, &boring_sys::SSL) -> bun_boringssl::ServerIdentity,
        >,
        /// `SSLWrapper::<T>::alpn_select`.
        alpn_select: for<'a> unsafe fn(
            *const CallbackState,
            &boring_sys::SSL,
            &'a [u8],
        ) -> AlpnSelection<'a>,
        wants_session: bool,
        wants_keylog: bool,
        latest_session: Cell<Option<boring_sys::OwnedSslSession>>,
        sessions: RefCell<VecDeque<boring_sys::OpensslBytes>>,
        keylog: RefCell<VecDeque<Box<[u8]>>>,
    }

    /// Boxed: the `SSL` holds a pointer to the state, so the state must not move.
    pub struct SSLWrapper<T: Copy> {
        inner: AliasableBox<Inner<T>>,
    }

    impl<T: Copy> core::ops::Deref for SSLWrapper<T> {
        type Target = Inner<T>;
        #[inline]
        fn deref(&self) -> &Inner<T> {
            &self.inner
        }
    }

    pub struct Inner<T: Copy> {
        /// First, so that it drops before `callbacks` and `ciphertext`, which it points to.
        ssl: boring_sys::OwnedSsl,
        callbacks: CallbackState,
        pub handlers: Cell<Handlers<T>>,
        pub flags: Flags,
        pub(crate) renegotiation_count: Cell<u8>,
        pub(crate) renegotiation_window_start: Cell<Option<std::time::Instant>>,
        traffic: Cell<Traffic>,
        ciphertext: Ciphertext,
    }

    /// Re-entrancy state of [`SSLWrapper::handle_traffic`].
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Traffic {
        Idle,
        /// A pass is on the stack.
        Running,
        /// A callback of the running pass called `handle_traffic` again.
        RerunRequested,
    }

    /// CamelCase alias for callers that use the alternate spelling
    /// (e.g. `http_jsc`).
    pub type SslWrapper<T> = SSLWrapper<T>;

    #[repr(transparent)]
    #[derive(Default)]
    pub struct Flags(Cell<u8>);

    // Bit layout (LSB-first):
    //   bits 0-1: handshake_state (u2)
    //   bit  2:   received_ssl_shutdown
    //   bit  3:   sent_ssl_shutdown
    //   bit  4:   is_client
    //   bit  5:   stopped
    //   bit  6:   fatal_error
    //   bit  7:   closed_notified
    impl Flags {
        const HANDSHAKE_MASK: u8 = 0b0000_0011;
        const RECEIVED_SSL_SHUTDOWN: u8 = 1 << 2;
        const SENT_SSL_SHUTDOWN: u8 = 1 << 3;
        const IS_CLIENT: u8 = 1 << 4;
        const STOPPED: u8 = 1 << 5;
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
        pub(crate) fn handshake_state(&self) -> HandshakeState {
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
        pub(crate) fn set_handshake_state(&self, s: HandshakeState) {
            self.0
                .set((self.bits() & !Self::HANDSHAKE_MASK) | (s as u8));
        }

        #[inline]
        pub(crate) fn received_ssl_shutdown(&self) -> bool {
            self.bits() & Self::RECEIVED_SSL_SHUTDOWN != 0
        }
        #[inline]
        pub(crate) fn set_received_ssl_shutdown(&self, v: bool) {
            self.set_bit(Self::RECEIVED_SSL_SHUTDOWN, v)
        }
        #[inline]
        pub(crate) fn sent_ssl_shutdown(&self) -> bool {
            self.bits() & Self::SENT_SSL_SHUTDOWN != 0
        }
        #[inline]
        pub(crate) fn set_sent_ssl_shutdown(&self, v: bool) {
            self.set_bit(Self::SENT_SSL_SHUTDOWN, v)
        }
        #[inline]
        pub(crate) fn is_client(&self) -> bool {
            self.bits() & Self::IS_CLIENT != 0
        }
        #[inline]
        pub(crate) fn set_is_client(&self, v: bool) {
            self.set_bit(Self::IS_CLIENT, v)
        }
        #[inline]
        fn stopped(&self) -> bool {
            self.bits() & Self::STOPPED != 0
        }
        #[inline]
        fn set_stopped(&self, v: bool) {
            self.set_bit(Self::STOPPED, v)
        }
        #[inline]
        pub fn fatal_error(&self) -> bool {
            self.bits() & Self::FATAL_ERROR != 0
        }
        #[inline]
        pub(crate) fn set_fatal_error(&self, v: bool) {
            self.set_bit(Self::FATAL_ERROR, v)
        }
        #[inline]
        pub(crate) fn closed_notified(&self) -> bool {
            self.bits() & Self::CLOSED_NOTIFIED != 0
        }
        #[inline]
        pub(crate) fn set_closed_notified(&self, v: bool) {
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

    /// What `trigger_handshake_callback` reports.
    #[derive(Clone, Copy)]
    enum HandshakeOutcome<'a> {
        /// A handshake or a renegotiation finished.
        Established,
        /// `set_inline_reject` stopped the handshake on the peer's chain.
        InlineRejected,
        /// `SSL_do_handshake` failed, or `SSL_read` on the established session. Carries the queued reason of a fatal failure.
        HandshakeError(Option<&'a core::ffi::CStr>),
        /// We closed before the first handshake finished.
        Aborted,
        /// The peer's close_notify ended the first handshake.
        PeerClosed,
    }

    #[derive(Clone, Copy)]
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
        /// The name check of the verify step. `None`: the owner checks after the handshake.
        pub server_identity: Option<fn(T, &boring_sys::SSL) -> bun_boringssl::ServerIdentity>,
        /// Called for a server whose `SSL_CTX` was given to `enable_alpn_select`.
        pub alpn_select: Option<AlpnSelectFn<T>>,
    }

    pub type AlpnSelectFn<T> = for<'a> fn(T, &boring_sys::SSL, &'a [u8]) -> AlpnSelection<'a>;

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

    impl<T: Copy> SSLWrapper<T> {
        pub fn init_with_ctx(
            ctx: &boring_sys::SSL_CTX,
            is_client: bool,
            handlers: Handlers<T>,
        ) -> Result<Self, InitError> {
            bun_boringssl::load();
            let ssl = boring_sys::OwnedSsl::new(ctx, is_client).ok_or(InitError::OutOfMemory)?;
            // SAFETY: the method lives as long as the process; BIO_new returns null on OOM.
            let bio = NonNull::new(unsafe { boring_sys::BIO_new(bio_method()) })
                .unwrap_or_else(|| bun_core::out_of_memory());

            // OpenSSL enables TLS renegotiation by default and accepts
            // renegotiation requests from the peer transparently.
            // Renegotiation is an extremely problematic protocol feature, so
            // BoringSSL rejects peer renegotiations by default. We explicitly
            // set the SSL_set_renegotiate_mode so if we switch to OpenSSL we
            // keep the same behavior. See:
            // https://boringssl.googlesource.com/boringssl/+/HEAD/PORTING.md#TLS-renegotiation
            if is_client {
                // `handle_reading` accepts or refuses each HelloRequest.
                ssl.set_renegotiate_mode(boring_sys::RenegotiateMode::Explicit);
                // A client keeps no session id context (see `us_internal_ssl_attach`).
                ssl.clear_session_id_context();
                // SAFETY: `ssl` was made from `ctx`, and has not started its handshake.
                unsafe { us_internal_ssl_client_verify_defaults(&ssl, ctx) };
            } else {
                // A client that tries to renegotiate gets a fatal alert.
                ssl.set_renegotiate_mode(boring_sys::RenegotiateMode::Never);
            }

            let flags = Flags::default();
            flags.set_is_client(is_client);

            let inner = AliasableBox::new(Inner {
                ssl,
                callbacks: CallbackState {
                    wants_session: handlers.on_session.is_some(),
                    wants_keylog: handlers.on_keylog.is_some(),
                    inline_reject: Cell::new(false),
                    verify_failed: Cell::new(false),
                    identity_checked: Cell::new(false),
                    server_identity: handlers
                        .server_identity
                        .is_some()
                        .then_some(Self::server_identity),
                    alpn_select: Self::alpn_select,
                    latest_session: Cell::new(None),
                    sessions: RefCell::default(),
                    keylog: RefCell::default(),
                },
                handlers: Cell::new(handlers),
                flags,
                renegotiation_count: Cell::new(0),
                renegotiation_window_start: Cell::new(None),
                traffic: Cell::new(Traffic::Idle),
                ciphertext: Ciphertext::default(),
            });
            let inner_ptr = inner.as_ptr();
            // SAFETY: `bio` is live, and one BIO for both ends gives `ssl` its one reference. `ssl` drops before `ciphertext` and `callbacks`, which the box does not move.
            unsafe {
                boring_sys::BIO_set_data(bio.as_ptr(), (&raw mut (*inner_ptr).ciphertext).cast());
                boring_sys::BIO_set_init(bio.as_ptr(), 1);
                boring_sys::SSL_set_bio(&inner.ssl, bio.as_ptr(), bio.as_ptr());
                us_ssl_set_wrapper(&inner.ssl, (&raw mut (*inner_ptr).callbacks).cast())
            };
            Ok(Self { inner })
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
            let Some(ssl_ctx) = ctx_opts.create_ssl_context(&mut err) else {
                return Err(InitError::InvalidOptions);
            };
            Self::init_with_ctx(&ssl_ctx, is_client, handlers)
        }

        /// `None` after `stop`.
        pub fn ssl(&self) -> Option<&boring_sys::SSL> {
            (!self.flags.stopped()).then_some(&*self.ssl)
        }

        /// As in `us_socket_adopt_tls`, a server's own `requestCert` / `rejectUnauthorized` replace the mode of the shared `SSL_CTX`. No-op for clients.
        pub fn set_server_verify(&self, request_cert: bool, reject_unauthorized: bool) {
            if self.flags.is_client() {
                return;
            }
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
            self.ssl.set_verify_always_continue(mode);
        }

        /// Client whose `rejectUnauthorized` policy is on: refuse a bad server
        /// chain during the handshake, before the client certificate goes out
        /// (see the tripped check in `update_handshake_state`). Call it before
        /// `start()`. No-op for servers.
        pub fn set_inline_reject(&self) {
            if !self.flags.is_client() {
                return;
            }
            self.callbacks.inline_reject.set(true);
            // SAFETY: `init_with_ctx` made `self.ssl`, as `record_verify_failure` requires.
            unsafe {
                boring_sys::SSL_set_verify(
                    &self.ssl,
                    boring_sys::SSL_VERIFY_PEER,
                    Some(record_verify_failure),
                );
            }
        }

        /// # Safety
        /// `state` is what `init_with_ctx` gave to `us_ssl_set_wrapper`, for a live `Inner<T>`.
        unsafe fn server_identity(
            state: *const CallbackState,
            ssl: &boring_sys::SSL,
        ) -> bun_boringssl::ServerIdentity {
            // SAFETY: caller contract; `init_with_ctx` derived `state` from a pointer to the whole `Inner<T>`.
            let this = unsafe { &*bun_core::from_field_ptr!(Inner<T>, callbacks, state) };
            let handlers = this.handlers.get();
            handlers
                .server_identity
                .map_or(bun_boringssl::ServerIdentity::Unchecked, |check| {
                    check(handlers.ctx, ssl)
                })
        }

        /// # Safety
        /// As for `server_identity`.
        unsafe fn alpn_select<'a>(
            state: *const CallbackState,
            ssl: &boring_sys::SSL,
            offered: &'a [u8],
        ) -> AlpnSelection<'a> {
            // SAFETY: as in `server_identity`.
            let this = unsafe { &*bun_core::from_field_ptr!(Inner<T>, callbacks, state) };
            let handlers = this.handlers.get();
            handlers.alpn_select.map_or(AlpnSelection::NoAck, |select| {
                select(handlers.ctx, ssl, offered)
            })
        }

        /// The session most recently given to the new-session callback.
        pub fn latest_session(&self) -> Option<boring_sys::OwnedSslSession> {
            self.callbacks
                .latest_session
                .with_taken(|s| s.as_deref().map(boring_sys::OwnedSslSession::retain))
        }

        pub fn start(&self) {
            // trigger the onOpen callback so the user can configure the SSL connection before first handshake
            let handlers = self.handlers.get();
            (handlers.on_open)(handlers.ctx);
            // start the handshake
            self.handle_traffic();
        }

        pub fn start_with_payload(&self, payload: &[u8]) {
            let handlers = self.handlers.get();
            (handlers.on_open)(handlers.ctx);
            self.receive_data(payload);
            // start the handshake
            self.handle_traffic();
        }

        /// Shutdown the read direction of the SSL (fake it just for convenience)
        pub fn shutdown_read(&self) {
            // We cannot shutdown read in SSL, the read direction is closed by
            // the peer. So we just ignore the onData data, we still wanna to
            // wait until we received the shutdown.
            fn dummy_on_data<T: Copy>(_: T, _: &[u8]) {}
            let mut handlers = self.handlers.get();
            handlers.on_data = dummy_on_data::<T>;
            self.handlers.set(handlers);
        }

        /// Shutdown the write direction of the SSL and returns if we are
        /// completed closed or not. We cannot assume that the read part will
        /// remain open after we sent a shutdown, the other side will probably
        /// complete the 2-step shutdown ASAP. Caution: never reuse a socket if
        /// fast_shutdown = true, this will also fully close both read and
        /// write directions.
        pub fn shutdown(&self, fast_shutdown: bool) -> bool {
            if self.flags.stopped() {
                return false;
            }
            // we already sent the ssl shutdown
            if self.flags.sent_ssl_shutdown() || self.flags.fatal_error() {
                if fast_shutdown {
                    // The owner frees handlers.ctx next, so run the close callback now (#31959).
                    self.flags.set_received_ssl_shutdown(true);
                    self.trigger_close_callback();
                    // Do not read self after the close callback: the owner's
                    // teardown chain has started.
                    return true;
                }
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
            let ret = self.ssl.shutdown();
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
                let _ = self.ssl.shutdown();
                self.flags.set_received_ssl_shutdown(true);
                self.handle_end_of_renegotiation();
                // Reset pending handshake because we are closed for sure now
                if self.flags.handshake_state() == HandshakeState::HandshakePending {
                    self.flags
                        .set_handshake_state(HandshakeState::HandshakeCompleted);
                    self.trigger_handshake_callback(HandshakeOutcome::Aborted);
                }

                // we need to trigger close because we are not receiving a SSL_shutdown
                self.trigger_close_callback();
                return false;
            }

            // we sent the shutdown
            self.flags.set_sent_ssl_shutdown(ret.is_ok());
            if let Err(err) = ret {
                boring_sys::ERR_clear_error();

                if err.is_fatal() {
                    self.flags.set_fatal_error(true);
                    self.trigger_close_callback();
                    return false;
                }
            }
            // SSL_shutdown only queues close_notify, and nothing else hands it to the owner.
            self.handle_writing();
            ret == Ok(true) // truly closed
        }

        /// flush buffered data and returns amount of pending data to write
        pub fn flush(&self) -> usize {
            self.handle_traffic();
            self.ciphertext.outgoing.borrow().len()
        }

        /// Ciphertext is queued in either direction, or the SSL holds the rest of a partially-returned record.
        pub fn has_pending_data(&self) -> bool {
            let Some(ssl) = self.ssl() else {
                return false;
            };
            ssl.pending() > 0
                || !self.ciphertext.outgoing.borrow().is_empty()
                || self.has_pending_read()
        }

        /// Ciphertext from the peer is queued. This dont reflect SSL_pending().
        fn has_pending_read(&self) -> bool {
            !self.ciphertext.incoming.borrow().is_empty()
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

        /// Receive data from the network (encrypted data)
        pub fn receive_data(&self, data: &[u8]) {
            if self.flags.stopped() {
                return;
            }
            {
                let mut incoming = self.ciphertext.incoming.borrow_mut();
                incoming.try_reserve(data.len()).unwrap_or_oom();
                incoming.extend(data);
            }
            self.handle_traffic();
        }

        /// Send data to the network (unencrypted data)
        pub fn write_data(&self, data: &[u8]) -> Result<usize, WriteDataError> {
            if self.flags.stopped() {
                return Err(WriteDataError::ConnectionClosed);
            }

            // shutdown is sent we cannot write anymore
            if self.flags.sent_ssl_shutdown() {
                return Err(WriteDataError::ConnectionClosed);
            }
            // The fatal read closes once its callbacks return. A close from here
            // would run the owner's `on_close` under one of them.
            if self.flags.fatal_error() {
                return Err(WriteDataError::ConnectionClosed);
            }

            if data.is_empty() {
                // just cycle through internal openssl's state
                self.handle_traffic();
                return Ok(0);
            }
            // SSL_write would drive the pending handshake itself, bypassing on_handshake.
            if self.flags.handshake_state() == HandshakeState::HandshakePending {
                self.handle_traffic();
                return Err(WriteDataError::WantRead);
            }
            let data = &data[..data.len().min(c_int::MAX as usize)];
            // One growth for all the records of this write.
            let records = data.len() / MAX_RECORD_PLAINTEXT + 1;
            self.ciphertext
                .outgoing
                .borrow_mut()
                .try_reserve(data.len() + records * MAX_RECORD_OVERHEAD)
                .unwrap_or_oom();
            let err = match self.ssl.write(data) {
                Ok(written) => {
                    self.handle_traffic();
                    return Ok(written);
                }
                Err(err) => err,
            };
            boring_sys::ERR_clear_error();

            match err {
                SslErrorCode::WANT_READ => {
                    self.handle_traffic();
                    Err(WriteDataError::WantRead)
                }
                SslErrorCode::WANT_WRITE => {
                    self.handle_traffic();
                    Err(WriteDataError::WantWrite)
                }
                _ => {
                    // some bad error happened here we must close
                    self.flags.set_fatal_error(err.is_fatal());
                    self.trigger_close_callback();
                    Err(WriteDataError::ConnectionClosed)
                }
            }
        }

        /// Ends all traffic and all callbacks. BoringSSL can be on the stack (ALPNCallback), so the `SSL` stays until `self` drops.
        pub fn stop(&self) {
            self.flags.set_closed_notified(true);
            self.flags.set_stopped(true);
        }

        fn trigger_handshake_callback(&self, outcome: HandshakeOutcome<'_>) {
            if self.flags.closed_notified() {
                return;
            }
            let (success, result) = match outcome {
                HandshakeOutcome::Established => (true, self.verify_error()),
                HandshakeOutcome::InlineRejected | HandshakeOutcome::HandshakeError(None) => {
                    (false, self.verify_error())
                }
                // The callback below copies `reason` before this borrow ends.
                HandshakeOutcome::HandshakeError(Some(reason)) => (
                    false,
                    us_bun_verify_error_t {
                        error_no: -71,
                        code: c"EPROTO".as_ptr(),
                        reason: reason.as_ptr(),
                    },
                ),
                // node:tls reads a failure with no error after end() as its own close.
                HandshakeOutcome::Aborted => (false, us_bun_verify_error_t::default()),
                HandshakeOutcome::PeerClosed => (false, us_bun_verify_error_t::peer_disconnected()),
            };
            // trigger the handshake callback
            let handlers = self.handlers.get();
            (handlers.on_handshake)(handlers.ctx, success, result);
        }

        fn trigger_wanna_write_callback(&self, data: &[u8]) {
            if self.flags.closed_notified() {
                return;
            }
            // trigger the write callback
            let handlers = self.handlers.get();
            (handlers.write)(handlers.ctx, data);
        }

        fn trigger_data_callback(&self, data: &[u8]) {
            if self.flags.closed_notified() {
                return;
            }
            // trigger the onData callback
            let handlers = self.handlers.get();
            (handlers.on_data)(handlers.ctx, data);
        }

        fn trigger_close_callback(&self) {
            if self.flags.closed_notified() {
                return;
            }
            self.flags.set_closed_notified(true);
            // trigger the onClose callback
            let handlers = self.handlers.get();
            (handlers.on_close)(handlers.ctx);
        }

        /// The SSL's X509 verdict. Shutdown state does not change it.
        fn verify_error(&self) -> us_bun_verify_error_t {
            // SAFETY: the call only reads the `SSL`, and the strings it returns are static.
            unsafe { us_ssl_socket_verify_error_from_ssl(&self.ssl) }
        }

        /// Why the `SSL_*` call that just returned failed. Clears the thread's queue.
        fn take_queued_error(buf: &mut [u8; FATAL_ERROR_REASON_MAX]) -> Option<&core::ffi::CStr> {
            // SAFETY: buf is a valid mutable buffer for `buf.len()` bytes.
            if unsafe { us_ssl_take_error_reason(buf.as_mut_ptr().cast(), buf.len()) } == 0 {
                return None;
            }
            core::ffi::CStr::from_bytes_until_nul(buf).ok()
        }

        /// Update the handshake state. Returns true if we can call handle_reading.
        fn update_handshake_state(&self) -> bool {
            if self.flags.closed_notified() {
                return false;
            }

            if self.ssl.is_init_finished() {
                // handshake already completed nothing to do here
                debug_assert!(
                    self.flags.handshake_state() != HandshakeState::HandshakePending,
                    "the initial handshake completed outside update_handshake_state, unreported"
                );
                if self.ssl.has_received_shutdown() {
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

            let result = self.ssl.do_handshake();

            // A rejecting client (`set_inline_reject`) saw the server's chain
            // fail. All output queued since that verdict is the flight that
            // carries the client certificate. TLS 1.2 queues it before the
            // server's Finished, so `on_handshake` would be too late to stop it.
            // Only the final verdict rejects: an alternate chain can recover a per-depth failure.
            if self.callbacks.inline_reject.get()
                && self.callbacks.verify_failed.get()
                && self.ssl.verify_result() != boring_sys::X509_V_OK
            {
                boring_sys::ERR_clear_error();
                // Not only skipped below: a re-entered `handle_traffic` flushes the queue and never gets here.
                self.ciphertext.outgoing.borrow_mut().clear();
                // The peer never gets our Finished, so it cannot read a close_notify.
                self.flags.set_fatal_error(true);
                self.flags
                    .set_handshake_state(HandshakeState::HandshakeCompleted);
                self.trigger_handshake_callback(HandshakeOutcome::InlineRejected);
                self.trigger_close_callback();
                return false;
            }

            if let Err(err) = result {
                let is_fatal = err.is_fatal();
                let mut reason_buf = [0u8; FATAL_ERROR_REASON_MAX];
                let fatal_reason = Self::take_queued_error(&mut reason_buf).filter(|_| is_fatal);
                if err == SslErrorCode::ZERO_RETURN {
                    // Remotely-Initiated Shutdown
                    // See: https://www.openssl.org/docs/manmaster/man3/SSL_shutdown.html
                    self.flags.set_received_ssl_shutdown(true);
                    // 2-step shutdown
                    let _ = self.shutdown(false);
                    if self.flags.handshake_state() == HandshakeState::HandshakePending {
                        self.flags
                            .set_handshake_state(HandshakeState::HandshakeCompleted);
                        self.trigger_handshake_callback(HandshakeOutcome::PeerClosed);
                    }
                    self.trigger_close_callback();
                    return false;
                }
                // as far as I know these are the only errors we want to handle
                if err != SslErrorCode::WANT_READ && err != SslErrorCode::WANT_WRITE {
                    self.flags.set_fatal_error(is_fatal);

                    self.flags
                        .set_handshake_state(HandshakeState::HandshakeCompleted);
                    // Our fatal alert leaves before the owner tears the transport down.
                    self.handle_writing();
                    self.trigger_handshake_callback(HandshakeOutcome::HandshakeError(fatal_reason));

                    if self.flags.fatal_error() {
                        self.trigger_close_callback();
                        return false;
                    }
                    return true;
                }
                self.flags
                    .set_handshake_state(HandshakeState::HandshakePending);
                return true;
            }

            // handshake completed
            self.flags
                .set_handshake_state(HandshakeState::HandshakeCompleted);
            self.trigger_handshake_callback(HandshakeOutcome::Established);

            true
        }

        /// Handle the end of a renegotiation if it was pending. This function
        /// is called when we receive a SSL_ERROR_ZERO_RETURN or successfully
        /// read data.
        fn handle_end_of_renegotiation(&self) {
            if self.flags.handshake_state() == HandshakeState::HandshakeRenegotiationPending
                && self.ssl.is_init_finished()
            {
                // renegotiation ended successfully call on_handshake
                self.flags
                    .set_handshake_state(HandshakeState::HandshakeCompleted);
                self.trigger_handshake_callback(HandshakeOutcome::Established);
            }
        }

        /// Handle reading data. Returns true if we can call handle_writing.
        fn handle_reading(&self, buffer: &mut IoBuffer) -> bool {
            let mut buffer = BorrowedBuf::from(&mut buffer[..]);

            // read data from the input BIO
            loop {
                log!("handleReading");
                if self.flags.stopped() {
                    return false;
                }

                let just_read = self.ssl.read(buffer.unfilled());
                log!("just read {:?}", just_read);
                if let Err(err) = just_read {
                    if err != SslErrorCode::WANT_READ && err != SslErrorCode::WANT_WRITE {
                        let mut is_fatal = err.is_fatal();
                        if err == SslErrorCode::WANT_RENEGOTIATE {
                            // The count resets each MAX_RENEGOTIATION_WINDOW, matching
                            // the C path's `us_reneg_policy`.
                            let now = std::time::Instant::now();
                            match self.renegotiation_window_start.get() {
                                Some(start)
                                    if now.duration_since(start) < MAX_RENEGOTIATION_WINDOW => {}
                                _ => {
                                    self.renegotiation_window_start.set(Some(now));
                                    self.renegotiation_count.set(0);
                                }
                            }
                            let over_limit = self.renegotiation_count.get() >= MAX_RENEGOTIATIONS;
                            self.renegotiation_count
                                .set(self.renegotiation_count.get().saturating_add(1));
                            // BoringSSL refuses, so every refusal queues the same error.
                            if over_limit {
                                self.ssl
                                    .set_renegotiate_mode(boring_sys::RenegotiateMode::Never);
                            }
                            if self.ssl.renegotiate() {
                                self.flags.set_handshake_state(
                                    HandshakeState::HandshakeRenegotiationPending,
                                );
                                // SSL_read drives the renegotiation.
                                continue;
                            }
                            // After our own close_notify the request has no answer: that is the end of our close.
                            if self.is_shutdown() {
                                boring_sys::ERR_clear_error();
                            }
                            is_fatal = true;
                        } else if err == SslErrorCode::ZERO_RETURN {
                            // Remotely-Initiated Shutdown
                            // See: https://www.openssl.org/docs/manmaster/man3/SSL_shutdown.html
                            self.flags.set_received_ssl_shutdown(true);
                            self.handle_end_of_renegotiation();
                        }
                        // Taken now: the callbacks below run JS, which can change the queue.
                        let mut reason_buf = [0u8; FATAL_ERROR_REASON_MAX];
                        let reason = Self::take_queued_error(&mut reason_buf).filter(|_| is_fatal);
                        if is_fatal {
                            // Before the data callback: an owner that is done there must not keep this wrapper.
                            self.flags.set_fatal_error(true);
                            self.flags
                                .set_handshake_state(HandshakeState::HandshakeCompleted);
                        }

                        if !self.dispatch_read(buffer.filled()) {
                            return false;
                        }
                        if err == SslErrorCode::ZERO_RETURN {
                            // 2-step shutdown, last: write_data fails once our close_notify is out.
                            let _ = self.shutdown(false);
                        }
                        if is_fatal {
                            // Our fatal alert leaves before the owner tears the transport down.
                            self.handle_writing();
                        }
                        if reason.is_some() {
                            self.trigger_handshake_callback(HandshakeOutcome::HandshakeError(
                                reason,
                            ));
                        }
                        // Whatever the owner did with the report.
                        self.trigger_close_callback();
                        return false;
                    } else {
                        log!("wanna read/write just break");
                        boring_sys::ERR_clear_error();
                        self.handle_end_of_renegotiation();
                        if self.flags.closed_notified() {
                            return false;
                        }
                        break;
                    }
                }

                self.handle_end_of_renegotiation();

                if buffer.len() == BUFFER_SIZE {
                    log!(
                        "triggering data callback (read {}) and resetting read buffer",
                        buffer.len()
                    );
                    // we filled the buffer
                    if !self.dispatch_read(buffer.filled()) {
                        return false;
                    }
                    buffer.clear();
                }
            }
            self.dispatch_read(buffer.filled())
        }

        /// Wire order: what `SSL_read` parked came before these bytes. False once a callback closed the wrapper.
        fn dispatch_read(&self, data: &[u8]) -> bool {
            self.flush_pending_events();
            if !data.is_empty() {
                self.trigger_data_callback(data);
            }
            !self.flags.closed_notified()
        }

        /// This frame owns what it hands out: a write made from inside `write` queues behind it.
        fn handle_writing(&self) {
            let mut pending = self.ciphertext.outgoing.take();
            if !pending.is_empty() {
                self.trigger_wanna_write_callback(&pending);
                pending.clear();
            }
            let mut outgoing = self.ciphertext.outgoing.borrow_mut();
            if outgoing.capacity() == 0 && pending.capacity() <= QUEUE_RETAIN_LIMIT {
                *outgoing = pending;
            }
        }

        /// Not re-entrant. A call made from inside a pass's callback (a write
        /// from `on_data`, a synchronous peer feeding `receive_data`) flushes the
        /// ciphertext queued so far and schedules another pass; decrypting there
        /// would hand the owner the next chunk while it is still inside its
        /// callback for the previous one.
        fn handle_traffic(&self) {
            if self.traffic.get() != Traffic::Idle {
                log!("handleTraffic re-entered, flushing and deferring to the outer pass");
                self.handle_writing();
                self.traffic.set(Traffic::RerunRequested);
                return;
            }
            loop {
                self.traffic.set(Traffic::Running);
                self.traffic_pass();
                if self.traffic.get() != Traffic::RerunRequested {
                    break;
                }
            }
            self.traffic.set(Traffic::Idle);
        }

        fn traffic_pass(&self) {
            // always handle the handshake first
            if self.update_handshake_state() {
                // send what the handshake queued first
                self.handle_writing();

                // PERF: 64KiB on-stack array — verify stack-size headroom.
                let mut buffer: IoBuffer = [const { MaybeUninit::uninit() }; BUFFER_SIZE];
                // drain the incoming queue in loop, because read can trigger writing and vice versa
                // Once a callback re-entered, the next pass takes over: the bytes it fed in
                // may belong to the handshake, which only update_handshake_state reports.
                while self.traffic.get() == Traffic::Running
                    && self.has_pending_read()
                    && self.handle_reading(&mut buffer)
                {
                    // read data can trigger writing so we need to handle it
                    self.handle_writing();
                }
                if self.traffic.get() != Traffic::Running {
                    return;
                }

                // What SSL_do_handshake parked. `dispatch_read` hands over what SSL_read parks.
                self.flush_pending_events();
            } else {
                debug_assert!(
                    self.flags.closed_notified(),
                    "update_handshake_state stopped the pass and left the wrapper open"
                );
            }
        }

        /// Hand the parked sessions and keylog lines to the owner. The callbacks run JS, which may close the wrapper.
        fn flush_pending_events(&self) {
            while !self.flags.closed_notified() {
                let Some(entry) = self.callbacks.sessions.borrow_mut().pop_front() else {
                    break;
                };
                let handlers = self.handlers.get();
                if let Some(on_session) = handlers.on_session {
                    on_session(handlers.ctx, &entry);
                }
            }
            while !self.flags.closed_notified() {
                let Some(entry) = self.callbacks.keylog.borrow_mut().pop_front() else {
                    break;
                };
                let handlers = self.handlers.get();
                if let Some(on_keylog) = handlers.on_keylog {
                    on_keylog(handlers.ctx, &entry);
                }
            }
        }
    }

    /// Verify callback of a rejecting client: continues the handshake and remembers that the chain had an error.
    ///
    /// # Safety
    /// `ctx` verifies the peer of an `SSL` that `init_with_ctx` made.
    unsafe extern "C" fn record_verify_failure(
        ok: c_int,
        ctx: *mut boring_sys::X509_STORE_CTX,
    ) -> c_int {
        if ok == 0 {
            // SAFETY: BoringSSL passes the live store context of an `SSL` that `init_with_ctx` made.
            let state = unsafe {
                us_ssl_wrapper_from_verify(ctx)
                    .cast::<CallbackState>()
                    .as_ref()
            };
            if let Some(state) = state {
                state.verify_failed.set(true);
            }
        }
        1
    }

    /// openssl.c's name check of the verify step, for an `SSL` that no `us_socket_t` drives: a `US_IDENTITY_*` verdict.
    ///
    /// # Safety
    /// `state_ptr` is what `init_with_ctx` gave to `us_ssl_set_wrapper` for `ssl`.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn us_ssl_wrapper_server_identity(
        state_ptr: *const CallbackState,
        ssl: &boring_sys::SSL,
    ) -> c_int {
        use bun_boringssl::ServerIdentity;
        // SAFETY: openssl.c passes the pointer that `us_ssl_set_wrapper` stored on this live `ssl`.
        let state = unsafe { &*state_ptr };
        let Some(check) = state.server_identity else {
            return ServerIdentity::Unchecked as c_int;
        };
        // SAFETY: as above; `check` is `SSLWrapper::<T>::server_identity` for the `T` of that wrapper.
        let verdict = unsafe { check(state_ptr, ssl) };
        state
            .identity_checked
            .set(verdict != ServerIdentity::Unchecked);
        if verdict == ServerIdentity::Rejected {
            state.verify_failed.set(true);
        }
        verdict as c_int
    }

    /// openssl.c's ALPN select callback, for an `SSL` that no `us_socket_t` drives.
    ///
    /// # Safety
    /// As for `us_ssl_wrapper_server_identity`, and `offered` is readable for `offered_len` bytes until BoringSSL has copied from `out`.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn us_ssl_wrapper_alpn_select(
        state: *const CallbackState,
        ssl: &boring_sys::SSL,
        out: &mut *const u8,
        out_len: &mut u8,
        offered: *const u8,
        offered_len: c_uint,
    ) -> c_int {
        // SAFETY: caller contract; `alpn_select` is `SSLWrapper::<T>::alpn_select` for the `T` of that wrapper.
        unsafe {
            let offered = core::slice::from_raw_parts(offered, offered_len as usize);
            ((*state).alpn_select)(state, ssl, offered).write_to(out, out_len)
        }
    }

    #[unsafe(no_mangle)]
    extern "C" fn us_ssl_wrapper_identity_checked(state: &CallbackState) -> c_int {
        c_int::from(state.identity_checked.get())
    }

    /// The name check after the handshake. The verify step's verdict stands when it gave one.
    pub fn check_server_identity(ssl: &boring_sys::SSL, host: &[u8]) -> bool {
        // SAFETY: the call reads the wrapper of `ssl`, which outlives `ssl`, or the `ssl_socket` of
        // the loop, which is null or a socket that has not been freed.
        if unsafe { us_ssl_identity_checked(ssl) } != 0 {
            return ssl.verify_result() == boring_sys::X509_V_OK;
        }
        bun_boringssl::check_server_identity(ssl, host)
    }

    /// openssl.c's new-session callback, for an `SSL` that no `us_socket_t` drives.
    #[unsafe(no_mangle)]
    extern "C" fn us_ssl_wrapper_new_session(
        state: &CallbackState,
        session: &boring_sys::SSL_SESSION,
    ) {
        if !state.wants_session {
            return;
        }
        state
            .latest_session
            .set(Some(boring_sys::OwnedSslSession::retain(session)));
        if let Some(der) = session.to_der().filter(|der| der.len() <= BUFFER_SIZE) {
            state.sessions.borrow_mut().push_back(der);
        }
    }

    /// openssl.c's keylog callback, for an `SSL` that no `us_socket_t` drives.
    ///
    /// # Safety
    /// `line` is readable for `len` bytes.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn us_ssl_wrapper_keylog(
        state: &CallbackState,
        line: *const c_char,
        len: usize,
    ) {
        if !state.wants_keylog {
            return;
        }
        // SAFETY: openssl.c passes `len` readable bytes.
        let line = unsafe { core::slice::from_raw_parts(line.cast::<u8>(), len) };
        // Node appends the newline before it emits 'keylog'.
        let entry = [line, b"\n"].concat().into_boxed_slice();
        state.keylog.borrow_mut().push_back(entry);
    }

    unsafe extern "C" {
        /// openssl.c: the client half of `us_internal_ssl_attach`. `ssl` was made from `ctx`.
        fn us_internal_ssl_client_verify_defaults(ssl: &boring_sys::SSL, ctx: &boring_sys::SSL_CTX);
        /// Implemented in uSockets C; reads
        /// `SSL_get_verify_result` and maps it onto the C `us_bun_verify_error_t`.
        fn us_ssl_socket_verify_error_from_ssl(ssl: &boring_sys::SSL) -> us_bun_verify_error_t;
        /// openssl.c: 1 when the verify step of this handshake asked the owner for the server's name.
        fn us_ssl_identity_checked(ssl: &boring_sys::SSL) -> c_int;
        /// openssl.c: formats the reason into `reason[..length]`, NUL-terminated. 0 when nothing is queued.
        fn us_ssl_take_error_reason(reason: *mut c_char, length: usize) -> c_int;
        /// openssl.c: makes the callbacks of `ssl` go to `wrapper`. `wrapper` must outlive `ssl`.
        fn us_ssl_set_wrapper(ssl: &boring_sys::SSL, wrapper: *mut c_void);
        /// openssl.c: the pointer `us_ssl_set_wrapper` stored on the `SSL` that `ctx` verifies, or null.
        fn us_ssl_wrapper_from_verify(ctx: *mut boring_sys::X509_STORE_CTX) -> *mut c_void;
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
pub use bun_uws_sys::{InternalLoopData, Loop, NOW_NS_UNKNOWN, ThreadLoop};

/// Extension methods on the re-exported `bun_uws_sys::InternalLoopData` for the
/// typed parent-loop accessors. The sys crate only stores tag+ptr; this tier
/// adds the getter that callers use.
pub trait InternalLoopDataExt {
    fn get_parent(&self) -> (core::ffi::c_char, *mut c_void);
}

impl InternalLoopDataExt for InternalLoopData {
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
pub use bun_uws_sys::QueuedInput;
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
};

/// Runtime-tagged TCP/TLS socket with a `None` arm for the "no active socket"
/// state. Used by proxy-tunnel layers (HTTP `ProxyTunnel`, WebSocket
/// `WebSocketProxyTunnel`) where the inner socket may be either transport and
/// may be detached. Distinct from [`AnySocket`] which has no `None` variant.
#[derive(Clone, Copy)]
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
        // `debug_assert!(SSL)` — the const generic only gates `ssl`.
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

/// Transport-agnostic response handle. Re-exported from `bun_uws_sys` — the
/// sys-crate version already carries the full dispatch impl (`write`, `end`,
/// `try_end`, `on_aborted`, `on_writable`, `corked`, `write_status`,
/// `write_header`, `end_stream`, `clear_*`, `timeout`, `state`, `upgrade`, ...).
/// Variants: `SSL(*mut Response<true>)`, `TCP(*mut Response<false>)`,
/// `H3(*mut H3::Response)`.
pub use bun_uws_sys::AnyResponse;

pub use bun_uws_sys::response::WriteResult;
