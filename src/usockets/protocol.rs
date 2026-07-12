//! Protocol v2 — the safe consumer socket interface (docs/design.md,
//! Consumer protocol). Owners are `bun_ptr::RefCounted` objects; the dispatch trampoline
//! holds a strong ref across every handler call, so an owner dropping to zero
//! refs mid-callback stays alive until dispatch returns. The v1 raw
//! [`crate::dispatch::Handler`] stays for Dynamic/UwsHttp*/UwsWs* kinds.

use core::any::TypeId;

use crate::dispatch::{self, OwnerOps};
use crate::handle::{AnySocket, CloseCode};
use crate::kind::SocketKind;
use crate::tls::context::us_bun_verify_error_t;
use crate::unsafe_core::trampolines;

/// Safe owner-borrow bridges (bodies audited in unsafe_core): mint an
/// [`OwnerRef`] / legacy `ThisPtr` from a live `&Owner`.
pub use crate::unsafe_core::trampolines::{owner_ref_of, this_ptr_of};

/// The safe strong owner ref consumers attach at connect/from_fd/adopt.
/// `bun_ptr::RefPtr` has NO `Drop` — passing one to an attach method
/// TRANSFERS the ref to core; core releases it exactly once at the socket's
/// terminal (on_close / on_connect_error / silent SEMI_SOCKET close).
pub type OwnerRef<O> = bun_ptr::RefPtr<O>;

pub type VerifyError = us_bun_verify_error_t;

/// Payload of [`Protocol::on_connect_error`]; covers both direct-connect
/// failures (errno namespace) and connecting-socket failures (errno or
/// getaddrinfo rc — the same value the v1 `on_connecting_error` received).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct ConnectFailure {
    pub errno: i32,
}

/// Decoded close selector for [`Protocol::on_close`] (contract C3: the raw
/// wire value is 0..2 = [`CloseCode`], anything else = a real errno).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum CloseCode2 {
    Normal,
    Failure,
    FastShutdown,
    /// Peer/transport error close; the errno arrives alongside.
    Error,
}

impl CloseCode2 {
    /// `(code, errno)` from the raw C close code; errno is 0 unless `Error`.
    pub(crate) fn decode(code: core::ffi::c_int) -> (CloseCode2, i32) {
        match code {
            c if c == CloseCode::normal as i32 => (CloseCode2::Normal, 0),
            c if c == CloseCode::failure as i32 => (CloseCode2::Failure, 0),
            c if c == CloseCode::fast_shutdown as i32 => (CloseCode2::FastShutdown, 0),
            errno => (CloseCode2::Error, errno),
        }
    }
}

/// Protocol v2 handler set. Handlers receive `&Owner` (owners are
/// interior-mutable) and a generation-checked [`AnySocket`] handle; every
/// safe socket method (incl. close/adopt/connect) may be called
/// synchronously from inside a handler (C17). Defaults are no-ops.
pub trait Protocol: Sized + 'static {
    /// Loop-local (!Send) interior-mutable owner. The attach APIs transfer
    /// one strong ref to core; the trampoline additionally brackets every
    /// handler call with its own ref, so the owner's LAST release always
    /// happens outside a running handler.
    type Owner: bun_ptr::RefCounted<DestructorCtx: Default> + 'static;

    const KIND: SocketKind;
    /// SSL sibling of [`Self::KIND`] for family pairs (e.g. Valkey/ValkeyTls).
    const KIND_TLS: Option<SocketKind> = None;

    fn on_open(owner: &Self::Owner, s: AnySocket, is_client: bool, ip: &[u8]) {
        let _ = (owner, s, is_client, ip);
    }
    fn on_data(owner: &Self::Owner, s: AnySocket, data: &mut [u8]) {
        let _ = (owner, s, data);
    }
    fn on_writable(owner: &Self::Owner, s: AnySocket) {
        let _ = (owner, s);
    }
    fn on_close(owner: &Self::Owner, s: AnySocket, code: CloseCode2, errno: i32) {
        let _ = (owner, s, code, errno);
    }
    fn on_end(owner: &Self::Owner, s: AnySocket) {
        let _ = (owner, s);
    }
    fn on_timeout(owner: &Self::Owner, s: AnySocket) {
        let _ = (owner, s);
    }
    fn on_long_timeout(owner: &Self::Owner, s: AnySocket) {
        let _ = (owner, s);
    }
    /// Terminal for a failed connect (direct AND connecting-socket paths;
    /// exactly one of on_open/on_connect_error fires per connect, C2). No
    /// socket handle: like v1, the handler closes via its owner-held handle.
    fn on_connect_error(owner: &Self::Owner, err: ConnectFailure) {
        let _ = (owner, err);
    }
    fn on_handshake(owner: &Self::Owner, s: AnySocket, ok: bool, err: VerifyError) {
        let _ = (owner, s, ok, err);
    }
    /// SCM_RIGHTS-received descriptor. OWNERSHIP transfers to the handler:
    /// close it (or wrap it in an owning type) — an ignored callback leaks
    /// the fd. (Spec signature is OwnedFd; plain `Fd` kept for FFI parity.)
    fn on_fd(owner: &Self::Owner, s: AnySocket, fd: bun_core::Fd) {
        let _ = (owner, s, fd);
    }
}

/// Const-build the kind-table row for `P` at `kind` (the runtime dispatch
/// module places one per Rust-handled `SocketKind` in `BUN_UWS_KIND_TABLE`).
/// Const-eval traps when `kind` is not `P::KIND` / `P::KIND_TLS`, so a row
/// placed at the wrong index is a compile error.
pub const fn kind_entry<P: Protocol>(kind: SocketKind) -> dispatch::KindEntry {
    let matches_kind = kind as usize == P::KIND as usize
        || match P::KIND_TLS {
            Some(tls) => kind as usize == tls as usize,
            None => false,
        };
    assert!(matches_kind, "kind_entry placed at a kind P does not handle");
    dispatch::KindEntry {
        kind,
        vtable: trampolines::make2::<P>(),
        owner_ops: OwnerOps {
            deref: trampolines::owner_deref_erased::<P::Owner>,
        },
        handler_type: TypeId::of::<P>,
        owner_type: TypeId::of::<P::Owner>,
    }
}
