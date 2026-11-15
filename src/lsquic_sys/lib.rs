#![allow(non_camel_case_types)]

use core::cell::Cell;
use core::ffi::{CStr, c_char, c_int, c_uint, c_ulong, c_void};
use core::mem::MaybeUninit;
use core::ptr::{NonNull, null_mut};

use bun_core::strings;

#[repr(C)]
pub struct lsquic_engine {
    _opaque: [u8; 0],
}
#[repr(C)]
pub struct lsquic_conn {
    _opaque: [u8; 0],
}
#[repr(C)]
pub struct lsquic_stream {
    _opaque: [u8; 0],
}
#[repr(C)]
pub struct lsquic_engine_settings {
    _opaque: [u8; 0],
}
pub type sockaddr = c_void;

/// Only lsquic makes one. The bytes are valid for as long as the `iovec` is.
#[repr(C)]
pub struct iovec {
    iov_base: *mut c_void,
    iov_len: usize,
}

bun_core::assert_ffi_layout!(iovec, 16, 8; iov_base @ 0, iov_len @ 8);

impl iovec {
    pub fn as_slice(&self) -> &[u8] {
        // SAFETY: see the type.
        unsafe { bun_core::ffi::slice(self.iov_base.cast(), self.iov_len) }
    }
}

pub const LSQ_HSK_OK: c_int = 1;
pub const LSQ_HSK_RESUMED_OK: c_int = 2;

pub const LSCONN_ST_HSK_FAILURE: c_int = 2;
pub const LSCONN_ST_TIMED_OUT: c_int = 4;
pub const LSCONN_ST_RESET: c_int = 5;
pub const LSCONN_ST_ERROR: c_int = 7;
pub const LSCONN_ST_VERNEG_FAILURE: c_int = 10;

pub const N_LSQVER: c_int = 8;

const CONN_STATUS_ERRBUF_LEN: usize = 256;

unsafe extern "C" {
    pub fn lsquic_engine_destroy(engine: *mut lsquic_engine);
    pub fn lsquic_engine_conn_count(engine: *const lsquic_engine) -> c_uint;
    pub fn lsquic_engine_cid_in_use(
        engine: *mut lsquic_engine,
        cid: *const u8,
        cid_len: usize,
    ) -> c_int;
    pub fn lsquic_engine_packet_in(
        engine: *mut lsquic_engine,
        data: *const u8,
        size: usize,
        sa_local: *const sockaddr,
        sa_peer: *const sockaddr,
        peer_ctx: *mut c_void,
        ecn: c_int,
    ) -> c_int;
    pub fn lsquic_engine_process_conns(engine: *mut lsquic_engine);
    pub fn lsquic_engine_set_idle_timeout_ms(engine: *mut lsquic_engine, ms: c_uint);
    pub fn lsquic_engine_earliest_adv_tick(engine: *mut lsquic_engine, diff: *mut c_int) -> c_int;
    pub fn lsquic_engine_has_unsent_packets(engine: *mut lsquic_engine) -> c_int;
    pub fn lsquic_engine_send_unsent_packets(engine: *mut lsquic_engine);
    pub fn lsquic_engine_connect(
        engine: *mut lsquic_engine,
        version: c_int,
        local_sa: *const sockaddr,
        peer_sa: *const sockaddr,
        peer_ctx: *mut c_void,
        conn_ctx: *mut c_void,
        hostname: *const c_char,
        base_plpmtu: u16,
        sess_resume: *const u8,
        sess_resume_len: usize,
        token: *const u8,
        token_sz: usize,
    ) -> *mut lsquic_conn;

    pub fn lsquic_conn_get_ctx(c: *const lsquic_conn) -> *mut c_void;
    pub fn lsquic_conn_get_peer_ctx(c: *const lsquic_conn, local_sa: *const c_void) -> *mut c_void;
    pub fn lsquic_conn_get_engine(c: *mut lsquic_conn) -> *mut lsquic_engine;
    fn lsquic_conn_set_ctx(c: *mut lsquic_conn, ctx: *mut c_void);
    pub fn lsquic_conn_close(c: *mut lsquic_conn);
    fn lsquic_conn_going_away(c: *mut lsquic_conn);
    fn lsquic_conn_status(c: *mut lsquic_conn, errbuf: *mut c_char, bufsz: usize) -> c_int;
    pub fn lsquic_conn_make_stream(c: *mut lsquic_conn);
    pub fn lsquic_conn_make_uni_stream(c: *mut lsquic_conn);
    pub fn lsquic_conn_get_sockaddr(
        c: *mut lsquic_conn,
        local: *mut *const sockaddr,
        peer: *mut *const sockaddr,
    ) -> c_int;
    fn lsquic_conn_get_sni(c: *mut lsquic_conn) -> *const c_char;
    fn lsquic_conn_want_datagram_write(c: *mut lsquic_conn, is_want: c_int) -> c_int;
    fn lsquic_conn_crypto_cipher(c: *const lsquic_conn) -> *const c_char;
    pub fn lsquic_conn_get_ssl(c: *const lsquic_conn) -> *mut c_void;
    pub fn lsquic_ssl_to_conn(ssl: *const c_void) -> *mut lsquic_conn;
    fn lsquic_conn_abort_error(
        c: *mut lsquic_conn,
        is_app: c_int,
        code: c_uint,
        reason: *const c_char,
    );
    pub fn lsquic_conn_get_info(c: *mut lsquic_conn, info: *mut ConnInfo) -> c_int;
    pub fn us_nq_conn_transport_params(
        c: *const lsquic_conn,
        peer: c_int,
        out: *mut NqTransportParams,
    ) -> c_int;
    pub safe fn us_nq_tp_size() -> usize;

    fn lsquic_stream_id(s: *const lsquic_stream) -> u64;
    pub fn lsquic_stream_conn(s: *const lsquic_stream) -> *mut lsquic_conn;
    pub fn lsquic_stream_get_ctx(s: *const lsquic_stream) -> *mut c_void;
    fn lsquic_stream_set_ctx(s: *mut lsquic_stream, ctx: *mut c_void);
    pub fn lsquic_stream_read(s: *mut lsquic_stream, buf: *mut c_void, len: usize) -> isize;
    pub fn lsquic_stream_write(s: *mut lsquic_stream, buf: *const c_void, len: usize) -> isize;
    pub fn lsquic_stream_flush(s: *mut lsquic_stream) -> c_int;
    pub fn lsquic_stream_shutdown(s: *mut lsquic_stream, how: c_int) -> c_int;
    pub fn lsquic_stream_close(s: *mut lsquic_stream) -> c_int;
    pub fn lsquic_stream_wantread(s: *mut lsquic_stream, is_want: c_int) -> c_int;
    pub fn lsquic_stream_wantwrite(s: *mut lsquic_stream, is_want: c_int) -> c_int;

    pub fn us_nq_enable_logging(level: *const c_char);
    pub safe fn us_nq_settings_size() -> usize;
    pub fn us_nq_settings_init(s: *mut lsquic_engine_settings, is_server: c_int, is_http: c_int);
    pub fn us_nq_engine_new(
        is_server: c_int,
        is_http: c_int,
        ctx: *mut c_void,
        settings: *const lsquic_engine_settings,
    ) -> *mut lsquic_engine;
    pub fn us_nq_stream_reset(s: *mut lsquic_stream, code: u64);
    pub fn us_nq_hset_pairs(hset: *mut c_void, len: *mut usize) -> *const c_char;
    pub fn us_nq_hset_free(hset: *mut c_void);
    pub fn us_nq_stream_send_headers(
        s: *mut lsquic_stream,
        buf: *const c_char,
        len: usize,
        expected: c_int,
        eos: c_int,
    ) -> c_int;
    pub fn lsquic_stream_get_hset(s: *mut lsquic_stream) -> *mut c_void;

    fn us_nq_settings_set_idle_timeout(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_idle_timeout_ms(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_delayed_acks(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_handshake_to(s: *mut lsquic_engine_settings, v: c_ulong);
    fn us_nq_settings_set_ping_period(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_ping_period_us(s: *mut lsquic_engine_settings, v: u64);
    fn lsquic_conn_pings_received(c: *const lsquic_conn) -> u64;
    fn us_nq_settings_set_init_max_data(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_init_max_stream_data_bidi_local(
        s: *mut lsquic_engine_settings,
        v: c_uint,
    );
    fn us_nq_settings_set_init_max_stream_data_bidi_remote(
        s: *mut lsquic_engine_settings,
        v: c_uint,
    );
    fn us_nq_settings_set_init_max_stream_data_uni(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_init_max_streams_bidi(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_init_max_streams_uni(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_max_udp_payload_size_rx(s: *mut lsquic_engine_settings, v: u16);
    fn us_nq_settings_set_datagrams(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_h3_datagram(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_send_prst(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_honor_prst(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_sreset_burst(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_sreset_rate(s: *mut lsquic_engine_settings, v: f64);
    fn us_nq_settings_set_h3_connect_protocol(s: *mut lsquic_engine_settings, v: c_int);
    pub fn us_nq_settings_set_preferred_address(s: *mut lsquic_engine_settings, addr: *const u8);
    pub fn lsquic_engine_sreset_stats(e: *const lsquic_engine, sent: *mut u64, limited: *mut u64);
    fn us_nq_settings_set_max_datagram_frame_size(s: *mut lsquic_engine_settings, v: u16);
    fn us_nq_settings_set_max_h3_header_pairs(s: *mut lsquic_engine_settings, v: u16);
    fn us_nq_settings_set_max_h3_header_bytes(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_allow_migration(s: *mut lsquic_engine_settings, v: c_int);
    pub fn us_nq_settings_set_origin_blob(
        s: *mut lsquic_engine_settings,
        blob: *const u8,
        len: usize,
    );
    fn us_nq_settings_set_scid_len(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_silent_close(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_cc_algo(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_delay_onclose(s: *mut lsquic_engine_settings, v: c_int);
}

pub struct Settings {
    words: Vec<u64>,
}

impl Settings {
    /// RFC 9000 preferred_address transport parameter: 4-byte IPv4 + 2-byte
    /// port + 16-byte IPv6 + 2-byte port (network order), zeros = absent.
    pub fn preferred_address(&mut self, addr: &[u8; 24]) {
        // SAFETY: `self.words` is the live settings blob; the shim copies.
        unsafe { us_nq_settings_set_preferred_address(self.raw(), addr.as_ptr()) }
    }

    /// Pre-encoded HTTP/3 ORIGIN frame payload (RFC 9412) the server sends
    /// after SETTINGS.
    ///
    /// # Safety
    /// `blob` is not copied: it must outlive the engine that gets these settings.
    pub unsafe fn origin_blob(&mut self, blob: &[u8]) {
        // SAFETY: `self.words` is the live settings blob; the caller
        // guarantees `blob` outlives the engine.
        unsafe { us_nq_settings_set_origin_blob(self.raw(), blob.as_ptr(), blob.len()) }
    }

    pub fn new(is_server: bool, is_http: bool) -> Self {
        let mut words = vec![0u64; us_nq_settings_size().div_ceil(size_of::<u64>())];
        // SAFETY: `words` is a fresh zeroed allocation of the right size and alignment.
        unsafe {
            us_nq_settings_init(
                words.as_mut_ptr().cast(),
                is_server as c_int,
                is_http as c_int,
            )
        };
        Self { words }
    }
    fn raw(&mut self) -> *mut lsquic_engine_settings {
        self.words.as_mut_ptr().cast()
    }
    pub fn as_ptr(&self) -> *const lsquic_engine_settings {
        self.words.as_ptr().cast()
    }
}

macro_rules! settings_setters {
    ($($name:ident => $ffi:ident : $ty:ty),* $(,)?) => {
        impl Settings {
            $(pub fn $name(&mut self, v: $ty) -> &mut Self {
                // SAFETY: `raw()` is a live settings struct of the size the
                // shim expects.
                unsafe { $ffi(self.raw(), v) };
                self
            })*
        }
    };
}
macro_rules! settings_getters {
    ($($name:ident => $ffi:ident : $ty:ty),* $(,)?) => {
        unsafe extern "C" { $(fn $ffi(s: *const lsquic_engine_settings) -> $ty;)* }
        impl Settings {
            $(pub fn $name(&self) -> u64 {
                // SAFETY: `as_ptr()` is a live settings struct.
                unsafe { $ffi(self.as_ptr()) as u64 }
            })*
        }
    };
}
settings_getters! {
    get_init_max_data => us_nq_settings_get_init_max_data : c_uint,
    get_init_max_stream_data_bidi_local => us_nq_settings_get_init_max_stream_data_bidi_local : c_uint,
    get_init_max_stream_data_bidi_remote => us_nq_settings_get_init_max_stream_data_bidi_remote : c_uint,
    get_init_max_stream_data_uni => us_nq_settings_get_init_max_stream_data_uni : c_uint,
    get_init_max_streams_bidi => us_nq_settings_get_init_max_streams_bidi : c_uint,
    get_init_max_streams_uni => us_nq_settings_get_init_max_streams_uni : c_uint,
    get_idle_timeout => us_nq_settings_get_idle_timeout : c_uint,
    get_idle_timeout_ms => us_nq_settings_get_idle_timeout_ms : c_uint,
    get_max_udp_payload_size_rx => us_nq_settings_get_max_udp_payload_size_rx : u16,
    get_allow_migration => us_nq_settings_get_allow_migration : c_int,
    get_datagrams => us_nq_settings_get_datagrams : c_int,
    get_max_datagram_frame_size => us_nq_settings_get_max_datagram_frame_size : u16,
}

settings_setters! {
    idle_timeout => us_nq_settings_set_idle_timeout : c_uint,
    idle_timeout_ms => us_nq_settings_set_idle_timeout_ms : c_uint,
    delayed_acks => us_nq_settings_set_delayed_acks : c_int,
    handshake_to => us_nq_settings_set_handshake_to : c_ulong,
    ping_period => us_nq_settings_set_ping_period : c_uint,
    ping_period_us => us_nq_settings_set_ping_period_us : u64,
    init_max_data => us_nq_settings_set_init_max_data : c_uint,
    init_max_stream_data_bidi_local => us_nq_settings_set_init_max_stream_data_bidi_local : c_uint,
    init_max_stream_data_bidi_remote => us_nq_settings_set_init_max_stream_data_bidi_remote : c_uint,
    init_max_stream_data_uni => us_nq_settings_set_init_max_stream_data_uni : c_uint,
    init_max_streams_bidi => us_nq_settings_set_init_max_streams_bidi : c_uint,
    init_max_streams_uni => us_nq_settings_set_init_max_streams_uni : c_uint,
    max_udp_payload_size_rx => us_nq_settings_set_max_udp_payload_size_rx : u16,
    datagrams => us_nq_settings_set_datagrams : c_int,
    h3_datagram => us_nq_settings_set_h3_datagram : c_int,
    send_prst => us_nq_settings_set_send_prst : c_int,
    honor_prst => us_nq_settings_set_honor_prst : c_int,
    sreset_burst => us_nq_settings_set_sreset_burst : c_uint,
    sreset_rate => us_nq_settings_set_sreset_rate : f64,
    h3_connect_protocol => us_nq_settings_set_h3_connect_protocol : c_int,
    max_datagram_frame_size => us_nq_settings_set_max_datagram_frame_size : u16,
    max_h3_header_pairs => us_nq_settings_set_max_h3_header_pairs : u16,
    max_h3_header_bytes => us_nq_settings_set_max_h3_header_bytes : c_uint,
    allow_migration => us_nq_settings_set_allow_migration : c_int,
    scid_len => us_nq_settings_set_scid_len : c_uint,
    silent_close => us_nq_settings_set_silent_close : c_int,
    cc_algo => us_nq_settings_set_cc_algo : c_uint,
    delay_onclose => us_nq_settings_set_delay_onclose : c_int,
}

/// `$Handle` is null or points to what lsquic has not freed. Each method reads the pointer again.
macro_rules! impl_handle {
    ($Handle:ident, $Bound:ident, $raw:ty, $get_ctx:ident, $set_ctx:ident) => {
        impl $Handle {
            /// # Safety
            /// `raw` is null, or lsquic does not free it while the result is in use.
            pub unsafe fn from_raw(raw: *mut $raw) -> Self {
                Self(Cell::new(NonNull::new(raw)))
            }
            pub fn is_null(&self) -> bool {
                self.0.get().is_none()
            }
            /// Valid until lsquic's engine runs again.
            pub fn raw(&self) -> Option<*mut $raw> {
                self.0.get().map(NonNull::as_ptr)
            }
        }

        impl $Bound {
            /// Stores `handle` and sets its ctx. Does nothing if it has a ctx.
            ///
            /// # Safety
            /// The close callback has not run for `handle`, and it unbinds `self` when it gets `ctx`.
            /// `ctx` is valid for the callbacks until `self` is unbound or dropped.
            pub unsafe fn bind(&self, handle: &$Handle, ctx: *mut c_void) {
                let Some(raw) = handle.raw() else { return };
                // SAFETY: a handle that is not null is live, and the caller vouches for `ctx`.
                unsafe {
                    if $get_ctx(raw).is_null() {
                        self.unbind();
                        $set_ctx(raw, ctx);
                        self.0.0.set(handle.0.get());
                    }
                }
            }
            /// Clears the handle and its ctx.
            pub fn unbind(&self) {
                if let Some(raw) = self.0.0.take() {
                    // SAFETY: it was not null. The callbacks accept a null ctx.
                    unsafe { $set_ctx(raw.as_ptr(), null_mut()) };
                }
            }
        }

        impl core::ops::Deref for $Bound {
            type Target = $Handle;
            fn deref(&self) -> &$Handle {
                &self.0
            }
        }

        impl Drop for $Bound {
            fn drop(&mut self) {
                self.unbind();
            }
        }
    };
}

/// Borrowed `lsquic_conn_t`. The methods do nothing while it is null.
#[derive(Default)]
pub struct Conn(Cell<Option<NonNull<lsquic_conn>>>);

/// A [`Conn`] that outlives a callback. `on_conn_closed` unbinds it.
#[derive(Default)]
pub struct BoundConn(Conn);

impl_handle!(
    Conn,
    BoundConn,
    lsquic_conn,
    lsquic_conn_get_ctx,
    lsquic_conn_set_ctx
);

impl Conn {
    pub fn close(&self) {
        let Some(c) = self.raw() else { return };
        // SAFETY: a handle that is not null is live.
        unsafe { lsquic_conn_close(c) }
    }
    pub fn going_away(&self) {
        let Some(c) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { lsquic_conn_going_away(c) }
    }
    pub fn abort_silent(&self) {
        unsafe extern "C" {
            fn lsquic_conn_abort_silent(c: *mut lsquic_conn);
        }
        let Some(c) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { lsquic_conn_abort_silent(c) }
    }
    pub fn abort_error(&self, is_app: bool, code: c_uint, reason: &CStr) {
        let Some(c) = self.raw() else { return };
        // SAFETY: as above; `reason` is NUL-terminated by construction.
        unsafe { lsquic_conn_abort_error(c, is_app as c_int, code, reason.as_ptr()) }
    }
    /// An `LSCONN_ST_*` and lsquic's message.
    pub fn status(&self) -> Option<(c_int, Vec<u8>)> {
        let c = self.raw()?;
        let mut buf = [0u8; CONN_STATUS_ERRBUF_LEN];
        // SAFETY: as above; `buf` is a live slice.
        let status = unsafe { lsquic_conn_status(c, buf.as_mut_ptr().cast(), buf.len()) };
        Some((status, bun_core::slice_to_nul(&buf).to_vec()))
    }
    /// SETTINGS_H3_DATAGRAM state (RFC 9297).
    pub fn peer_h3_datagram(&self) -> Option<bool> {
        unsafe extern "C" {
            fn lsquic_conn_peer_h3_datagram(c: *const lsquic_conn) -> c_int;
        }
        // SAFETY: as above.
        match unsafe { lsquic_conn_peer_h3_datagram(self.raw()?) } {
            -1 => None,
            v => Some(v != 0),
        }
    }
    pub fn want_datagram_write(&self, want: bool) {
        let Some(c) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { lsquic_conn_want_datagram_write(c, want as c_int) };
    }
    pub fn sni(&self) -> Option<Vec<u8>> {
        // SAFETY: as above; lsquic returns NULL or a NUL-terminated string
        // owned by the conn.
        unsafe {
            let p = lsquic_conn_get_sni(self.raw()?);
            (!p.is_null()).then(|| CStr::from_ptr(p).to_bytes().to_vec())
        }
    }
    pub fn pings_received(&self) -> Option<u64> {
        // SAFETY: as above.
        Some(unsafe { lsquic_conn_pings_received(self.raw()?) })
    }
    pub fn set_ping_period_us(&self, usec: u64) {
        unsafe extern "C" {
            fn lsquic_conn_set_ping_period_us(c: *mut lsquic_conn, usec: u64);
        }
        let Some(c) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { lsquic_conn_set_ping_period_us(c, usec) }
    }
    pub fn ack_now(&self) {
        unsafe extern "C" {
            fn lsquic_conn_ack_now(c: *mut lsquic_conn);
        }
        let Some(c) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { lsquic_conn_ack_now(c) }
    }
    pub fn use_preferred_address(&self, on: bool) {
        unsafe extern "C" {
            fn lsquic_conn_use_preferred_address(c: *mut lsquic_conn, on: c_int);
        }
        let Some(c) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { lsquic_conn_use_preferred_address(c, on as c_int) }
    }
    pub fn datagram_early(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_conn_datagram_early(c: *const lsquic_conn) -> c_int;
        }
        // SAFETY: as above.
        self.raw()
            .is_some_and(|c| unsafe { lsquic_conn_datagram_early(c) != 0 })
    }
    pub fn cipher(&self) -> Option<Vec<u8>> {
        // SAFETY: as in `sni`.
        unsafe {
            let p = lsquic_conn_crypto_cipher(self.raw()?);
            (!p.is_null()).then(|| CStr::from_ptr(p).to_bytes().to_vec())
        }
    }
    /// The conn's `SSL*`, which lsquic can free when its engine runs again.
    pub fn ssl(&self) -> Option<NonNull<c_void>> {
        // SAFETY: as above.
        NonNull::new(unsafe { lsquic_conn_get_ssl(self.raw()?) })
    }
}

/// Borrowed `lsquic_stream_t`. The methods do nothing, or fail, while it is null.
#[derive(Default)]
pub struct Stream(Cell<Option<NonNull<lsquic_stream>>>);

/// A [`Stream`] that outlives a callback. `on_close` unbinds it.
#[derive(Default)]
pub struct BoundStream(Stream);

impl_handle!(
    Stream,
    BoundStream,
    lsquic_stream,
    lsquic_stream_get_ctx,
    lsquic_stream_set_ctx
);

impl Stream {
    pub fn id(&self) -> Option<u64> {
        // SAFETY: a handle that is not null is live.
        Some(unsafe { lsquic_stream_id(self.raw()?) })
    }
    /// The bytes that were read: empty at the end of the stream, `None` if lsquic returns an error.
    pub fn read<'a>(&self, buf: &'a mut [MaybeUninit<u8>]) -> Option<&'a [u8]> {
        // SAFETY: as above; lsquic writes as many bytes as it returns.
        unsafe {
            let n = lsquic_stream_read(self.raw()?, buf.as_mut_ptr().cast(), buf.len());
            Some(buf[..usize::try_from(n).ok()?].assume_init_ref())
        }
    }
    /// How many bytes were written: 0 if lsquic returns an error.
    pub fn write(&self, buf: &[u8]) -> usize {
        let Some(s) = self.raw() else { return 0 };
        // SAFETY: as above.
        let n = unsafe { lsquic_stream_write(s, buf.as_ptr().cast(), buf.len()) };
        usize::try_from(n).unwrap_or(0)
    }
    pub fn flush(&self) {
        let Some(s) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { lsquic_stream_flush(s) };
    }
    pub fn shutdown(&self, how: c_int) {
        let Some(s) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { lsquic_stream_shutdown(s, how) };
    }
    pub fn shutdown_internal(&self) {
        unsafe extern "C" {
            fn lsquic_stream_shutdown_internal(s: *mut lsquic_stream);
        }
        let Some(s) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { lsquic_stream_shutdown_internal(s) }
    }
    pub fn close(&self) {
        let Some(s) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { lsquic_stream_close(s) };
    }
    pub fn want_read(&self, want: bool) {
        let Some(s) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { lsquic_stream_wantread(s, want as c_int) };
    }
    pub fn want_write(&self, want: bool) {
        let Some(s) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { lsquic_stream_wantwrite(s, want as c_int) };
    }
    pub fn reset(&self, code: u64) {
        let Some(s) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { us_nq_stream_reset(s, code) }
    }
    pub fn error_code(&self) -> u64 {
        unsafe extern "C" {
            fn lsquic_stream_get_error_code(s: *const lsquic_stream) -> u64;
        }
        // SAFETY: as above.
        self.raw()
            .map_or(0, |s| unsafe { lsquic_stream_get_error_code(s) })
    }
    pub fn take_header_set(&self) -> Option<HeaderSet> {
        // SAFETY: as above.
        let raw = unsafe { lsquic_stream_get_hset(self.raw()?) };
        (!raw.is_null()).then_some(HeaderSet(raw))
    }
    /// `expected` is the caller's header-pair count; the shim rejects a buffer
    /// that does not parse to exactly that many pairs.
    pub fn send_headers(&self, nul_joined: &[u8], expected: c_int, eos: bool) -> bool {
        let Some(s) = self.raw() else { return false };
        // SAFETY: as above; lsquic copies the buffer before returning.
        unsafe {
            us_nq_stream_send_headers(
                s,
                nul_joined.as_ptr().cast(),
                nul_joined.len(),
                expected,
                eos as c_int,
            ) == 0
        }
    }
    /// RFC 9218 Extensible HTTP Priority: urgency 0-7, incremental 0/1.
    pub fn set_http_prio(&self, urgency: u8, incremental: bool) {
        #[repr(C)]
        struct ExtHttpPrio {
            urgency: u8,
            incremental: i8,
        }
        unsafe extern "C" {
            fn lsquic_stream_set_http_prio(s: *mut lsquic_stream, p: *const ExtHttpPrio) -> c_int;
        }
        let Some(s) = self.raw() else { return };
        let p = ExtHttpPrio {
            urgency: urgency.min(7),
            incremental: incremental as i8,
        };
        // SAFETY: as above; `p` is a stack value.
        unsafe { lsquic_stream_set_http_prio(s, core::ptr::from_ref(&p)) };
    }
    pub fn get_http_prio(&self) -> Option<(u8, bool)> {
        #[repr(C)]
        struct ExtHttpPrio {
            urgency: u8,
            incremental: i8,
        }
        unsafe extern "C" {
            fn lsquic_stream_get_http_prio(s: *mut lsquic_stream, p: *mut ExtHttpPrio) -> c_int;
        }
        let mut p = ExtHttpPrio {
            urgency: 3,
            incremental: 0,
        };
        // SAFETY: as above; `p` is a stack out-param.
        if unsafe { lsquic_stream_get_http_prio(self.raw()?, core::ptr::from_mut(&mut p)) } == 0 {
            Some((p.urgency, p.incremental != 0))
        } else {
            None
        }
    }
    /// Bytes sent but not yet acknowledged by the peer (RFC 9000 §2.2).
    pub fn has_unacked_data(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_stream_has_unacked_data(s: *mut lsquic_stream) -> c_int;
        }
        // SAFETY: as above.
        self.raw()
            .is_some_and(|s| unsafe { lsquic_stream_has_unacked_data(s) != 0 })
    }
    pub fn reset_received(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_stream_reset_received(s: *const lsquic_stream) -> c_int;
        }
        // SAFETY: as above.
        self.raw()
            .is_some_and(|s| unsafe { lsquic_stream_reset_received(s) != 0 })
    }
    pub fn is_rejected(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_stream_is_rejected(s: *const lsquic_stream) -> c_int;
        }
        // SAFETY: as above.
        self.raw()
            .is_some_and(|s| unsafe { lsquic_stream_is_rejected(s) != 0 })
    }
    pub fn received_early_data(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_stream_received_early_data(s: *mut lsquic_stream) -> c_int;
        }
        // SAFETY: as above.
        self.raw()
            .is_some_and(|s| unsafe { lsquic_stream_received_early_data(s) != 0 })
    }
    pub fn stop_sending(&self, code: u64) {
        unsafe extern "C" {
            fn lsquic_stream_send_stop_sending(s: *mut lsquic_stream, code: u64);
        }
        let Some(s) = self.raw() else { return };
        // SAFETY: as above.
        unsafe { lsquic_stream_send_stop_sending(s, code) }
    }
}

pub struct HeaderSet(*mut c_void);

impl HeaderSet {
    /// h3 permits bytes that are not valid UTF-8, so the JS boundary picks the
    /// encoding (latin1, as node does for HTTP headers).
    pub fn pairs(&self) -> Vec<Vec<u8>> {
        let mut len: usize = 0;
        // SAFETY: `self.0` is a live `nq_hset` until `Drop`.
        let p = unsafe { us_nq_hset_pairs(self.0, core::ptr::from_mut(&mut len)) };
        if p.is_null() || len == 0 {
            return Vec::new();
        }
        // SAFETY: the shim guarantees `p[..len]` is valid until free.
        let bytes = unsafe { core::slice::from_raw_parts(p.cast::<u8>(), len) };
        let bytes = bytes.strip_suffix(&[0u8][..]).unwrap_or(bytes);
        strings::split(bytes, b"\0").map(<[u8]>::to_vec).collect()
    }
}

impl Drop for HeaderSet {
    fn drop(&mut self) {
        // SAFETY: `self.0` was returned by `lsquic_stream_get_hset` and not
        // freed (lsquic transferred ownership).
        unsafe { us_nq_hset_free(self.0) }
    }
}

/// Mirrors `struct lsquic_conn_info` (lsquic.h).
#[repr(C)]
#[derive(Default)]
pub struct ConnInfo {
    pub cwnd: u32,
    pub(crate) pmtu: u32,
    pub rtt: u32,
    pub rttvar: u32,
    pub rtt_min: u32,
    pub bytes_rcvd: u64,
    pub bytes_sent: u64,
    pub pkts_rcvd: u64,
    pub pkts_sent: u64,
    pub pkts_lost: u64,
    pub pkts_retx: u64,
    pub(crate) bw_estimate: u64,
    pub(crate) max_pacing_rate: u64,
    pub(crate) pacing_rate: u64,
}

impl Conn {
    pub fn info(&self) -> Option<ConnInfo> {
        let mut out = ConnInfo::default();
        // SAFETY: a handle that is not null is live; `out` is a stack out-param.
        if unsafe { lsquic_conn_get_info(self.raw()?, core::ptr::from_mut(&mut out)) } == 0 {
            Some(out)
        } else {
            None
        }
    }
}

/// Mirrors `struct us_nq_tp` (node_quic_shim.c).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct NqTransportParams {
    pub initial_max_stream_data_bidi_local: u64,
    pub initial_max_stream_data_bidi_remote: u64,
    pub initial_max_stream_data_uni: u64,
    pub initial_max_data: u64,
    pub initial_max_streams_bidi: u64,
    pub initial_max_streams_uni: u64,
    pub max_idle_timeout: u64,
    pub max_udp_payload_size: u64,
    pub ack_delay_exponent: u64,
    pub max_ack_delay: u64,
    pub active_connection_id_limit: u64,
    pub max_datagram_frame_size: u64,
    pub disable_active_migration: c_int,
    pub initial_scid: [u8; 2 * MAX_CID_LEN + 1],
    pub retry_scid: [u8; 2 * MAX_CID_LEN + 1],
    pub original_dcid: [u8; 2 * MAX_CID_LEN + 1],
}

pub const MAX_CID_LEN: usize = 20;

impl NqTransportParams {
    fn cid_str(buf: &[u8; 2 * MAX_CID_LEN + 1]) -> &str {
        let nul = strings::index_of_char_usize(buf, 0).unwrap_or(buf.len());
        core::str::from_utf8(&buf[..nul]).unwrap_or("")
    }
    pub fn initial_scid_str(&self) -> &str {
        Self::cid_str(&self.initial_scid)
    }
    pub fn retry_scid_str(&self) -> &str {
        Self::cid_str(&self.retry_scid)
    }
    pub fn original_dcid_str(&self) -> &str {
        Self::cid_str(&self.original_dcid)
    }
}

bun_core::impl_zeroable!(NqTransportParams);

impl Default for NqTransportParams {
    fn default() -> Self {
        bun_core::ffi::zeroed()
    }
}

impl Conn {
    pub fn peer_transport_params(&self) -> Option<NqTransportParams> {
        let mut out = NqTransportParams::default();
        // SAFETY: a handle that is not null is live; `out` is a stack out-param.
        if unsafe { us_nq_conn_transport_params(self.raw()?, 1, core::ptr::from_mut(&mut out)) }
            == 1
        {
            Some(out)
        } else {
            None
        }
    }
}

pub fn debug_assert_layout() {
    debug_assert_eq!(
        us_nq_tp_size(),
        core::mem::size_of::<NqTransportParams>(),
        "us_nq_tp layout mismatch: peer_transport_params passes a stack \
         NqTransportParams that C fills with sizeof(struct us_nq_tp) bytes"
    );
}
