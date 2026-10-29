use core::ffi::{c_char, c_int, c_uint, c_void};

use bun_lsquic_sys::{SSL_CTX, lsquic_conn, lsquic_out_spec, lsquic_stream, sockaddr};

use super::{QuicEndpoint, QuicSession, QuicStream};

/// SAFETY CONTRACT (why the reference each `node:quic` callback takes is valid):
///
/// * Every context pointer the shim hands back — the engine's `owner`
///   (`ea_stream_if_ctx` / `peer_ctx`), a conn-ctx, or a stream-ctx — is a
///   pointer we ourselves installed: a `QuicEndpoint`, `QuicSession`, or
///   `QuicStream` stored inline in its JS wrapper, whose first field is the
///   `*const NqVtable` that `packages/bun-usockets/src/node_quic_shim.c` reads
///   back via `*(us_nq_vtable**)ctx`. Those structs are `#[repr(C)]` precisely
///   so that first-field read stays valid, and the shim never invents or
///   offsets a context pointer.
/// * The only other value the shim can pass is NULL — teardown clears the
///   conn/stream ctx (and lsquic passes NULL for crypto/mini-conn streams that
///   never got one), so a null check is the whole liveness test. A non-null
///   ctx is a live `T`: `teardown` and `Drop` null it (`detach_for_finalize` for `owner`) before the engine that
///   could call us is destroyed.
/// * lsquic calls us only from inside a call we make, always on the JS thread, so the `&T` cannot race, and every
///   mutable field of these types is `Cell`-based (shared-ref interior
///   mutability), so `&T` is the right reference to hand the callback body.
///
/// Layout must match `struct us_nq_vtable` in node_quic_shim.c exactly.
#[repr(C)]
pub(super) struct NqVtable {
    pub(super) owner: *const QuicEndpoint,
    pub(super) on_new_conn:
        unsafe extern "C" fn(owner: Option<&QuicEndpoint>, c: *mut lsquic_conn) -> *mut c_void,
    pub(super) on_hsk_done: unsafe extern "C" fn(conn_ctx: Option<&QuicSession>, status: c_int),
    pub(super) on_hsk_confirmed: unsafe extern "C" fn(conn_ctx: Option<&QuicSession>),
    pub(super) on_goaway_received: unsafe extern "C" fn(conn_ctx: Option<&QuicSession>),
    pub(super) on_conn_closed: unsafe extern "C" fn(conn_ctx: Option<&QuicSession>),
    pub(super) on_conncloseframe: unsafe extern "C" fn(
        conn_ctx: Option<&QuicSession>,
        app_error: c_int,
        code: u64,
        reason: *const c_char,
        reason_len: c_int,
    ),
    pub(super) on_new_token:
        unsafe extern "C" fn(conn_ctx: Option<&QuicSession>, token: *const u8, token_size: usize),
    pub(super) on_sess_resume:
        unsafe extern "C" fn(conn_ctx: Option<&QuicSession>, blob: *const u8, blob_size: usize),
    pub(super) on_new_stream:
        unsafe extern "C" fn(owner: Option<&QuicEndpoint>, s: *mut lsquic_stream) -> *mut c_void,
    pub(super) on_stream_read:
        unsafe extern "C" fn(stream_ctx: Option<&QuicStream>, s: *mut lsquic_stream),
    pub(super) on_stream_write:
        unsafe extern "C" fn(stream_ctx: Option<&QuicStream>, s: *mut lsquic_stream),
    pub(super) on_stream_close:
        unsafe extern "C" fn(stream_ctx: Option<&QuicStream>, s: *mut lsquic_stream),
    pub(super) on_stream_reset:
        unsafe extern "C" fn(stream_ctx: Option<&QuicStream>, how: c_int, error_code: u64),
    pub(super) on_dg_write: unsafe extern "C" fn(
        conn_ctx: Option<&QuicSession>,
        buf: *mut c_void,
        buf_sz: usize,
    ) -> isize,
    pub(super) on_datagram:
        unsafe extern "C" fn(conn_ctx: Option<&QuicSession>, buf: *const c_void, sz: usize),
    pub(super) on_datagram_status:
        unsafe extern "C" fn(conn_ctx: Option<&QuicSession>, count: c_uint, acked: c_int),
    pub(super) on_early_data_failed: unsafe extern "C" fn(conn_ctx: Option<&QuicSession>),
    pub(super) on_path_switch: unsafe extern "C" fn(
        conn_ctx: Option<&QuicSession>,
        validated: c_int,
        is_preferred: c_int,
        new_local: *const sockaddr,
        new_peer: *const sockaddr,
        old_local: *const sockaddr,
        old_peer: *const sockaddr,
    ),
    pub(super) on_origin: unsafe extern "C" fn(
        conn_ctx: Option<&QuicSession>,
        chunk: *const u8,
        len: usize,
        fin: c_int,
    ),
    pub(super) get_ssl_ctx:
        unsafe extern "C" fn(owner: Option<&QuicEndpoint>, local: *const sockaddr) -> *mut SSL_CTX,
    pub(super) get_client_ssl_ctx:
        unsafe extern "C" fn(owner: Option<&QuicEndpoint>, local: *const sockaddr) -> *mut SSL_CTX,
    pub(super) lookup_cert: unsafe extern "C" fn(
        owner: Option<&QuicEndpoint>,
        local: *const sockaddr,
        sni: *const c_char,
    ) -> *mut SSL_CTX,
    pub(super) packets_out: unsafe extern "C" fn(
        owner: Option<&QuicEndpoint>,
        specs: *const lsquic_out_spec,
        n: c_uint,
    ) -> c_int,
    pub(super) on_mini_conn_failed: unsafe extern "C" fn(
        owner: Option<&QuicEndpoint>,
        peer_sa: *const sockaddr,
        error_code: u64,
    ),
}

macro_rules! lsquic_callback {
    () => {};

    (
        $(#[$meta:meta])*
        $vis:vis fn $name:ident(
            $r:ident: &$ty:ty $(, $arg:ident: $argty:ty)* $(,)?
        ) -> $ret:ty = $default:expr; $body:block
        $($rest:tt)*
    ) => {
        $(#[$meta])*
        $vis unsafe extern "C" fn $name($r: Option<&$ty> $(, $arg: $argty)*) -> $ret {
            let Some($r) = $r else {
                return $default;
            };
            $body
        }
        lsquic_callback! { $($rest)* }
    };

    (
        $(#[$meta:meta])*
        $vis:vis fn $name:ident(
            $r:ident: &$ty:ty $(, $arg:ident: $argty:ty)* $(,)?
        ) $body:block
        $($rest:tt)*
    ) => {
        $(#[$meta])*
        $vis unsafe extern "C" fn $name($r: Option<&$ty> $(, $arg: $argty)*) {
            let Some($r) = $r else {
                return;
            };
            $body
        }
        lsquic_callback! { $($rest)* }
    };
}

pub(super) use lsquic_callback;
