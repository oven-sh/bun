//! kind → static vtable dispatch over the link-time const kind table
//! (`BUN_UWS_KIND_TABLE`, defined in the runtime dispatch module) + the
//! compile-time vtable generator moved unchanged from `src/uws_sys/vtable.rs`. The extern "C" trampolines live in
//! `unsafe_core::trampolines`. Dispatch rules per docs/semantics.md §12 and
//! contract C17 (every callback may synchronously re-enter; never touch ext
//! after a terminal callback).

use core::any::TypeId;
use core::ffi::{c_int, c_void};

use crate::connecting::ConnectingSocket;
use crate::group::VTable;
use crate::kind::SocketKind;
use crate::socket::us_socket_t;
use crate::tls::context::us_bun_verify_error_t;
use crate::unsafe_core::trampolines::{self, Trampolines};

pub use crate::unsafe_core::ext::ExtMut;

/// Handlers implement this and set the `HAS_ON_*` consts for each method they
/// provide. Default impls are `unreachable!()`; the corresponding vtable slot
/// is left `None` when the const is `false`. Ext arrives as an [`ExtMut`]
/// per-use token, not a call-spanning `&mut` — take the borrow only inside
/// `with`, and never re-enter dispatch on the same socket while inside (C17).
pub trait Handler: 'static {
    /// What the socket ext holds. Ignored when `HAS_EXT == false`.
    type Ext;
    /// When false, handlers take `(s, …)` instead of `(ext, s, …)` and
    /// recover their owner from `s.group().owner::<T>()`.
    const HAS_EXT: bool = true;

    const HAS_ON_OPEN: bool = false;
    const HAS_ON_DATA: bool = false;
    const HAS_ON_FD: bool = false;
    const HAS_ON_WRITABLE: bool = false;
    const HAS_ON_CLOSE: bool = false;
    const HAS_ON_TIMEOUT: bool = false;
    const HAS_ON_LONG_TIMEOUT: bool = false;
    const HAS_ON_END: bool = false;
    const HAS_ON_CONNECT_ERROR: bool = false;
    const HAS_ON_CONNECTING_ERROR: bool = false;
    const HAS_ON_HANDSHAKE: bool = false;

    fn on_open(_ext: ExtMut<'_, Self::Ext>, _s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        unreachable!()
    }
    fn on_data(_ext: ExtMut<'_, Self::Ext>, _s: *mut us_socket_t, _data: &[u8]) {
        unreachable!()
    }
    fn on_fd(_ext: ExtMut<'_, Self::Ext>, _s: *mut us_socket_t, _fd: c_int) {
        unreachable!()
    }
    fn on_writable(_ext: ExtMut<'_, Self::Ext>, _s: *mut us_socket_t) {
        unreachable!()
    }
    fn on_close(
        _ext: ExtMut<'_, Self::Ext>,
        _s: *mut us_socket_t,
        _code: i32,
        _reason: Option<*mut c_void>,
    ) {
        unreachable!()
    }
    fn on_timeout(_ext: ExtMut<'_, Self::Ext>, _s: *mut us_socket_t) {
        unreachable!()
    }
    fn on_long_timeout(_ext: ExtMut<'_, Self::Ext>, _s: *mut us_socket_t) {
        unreachable!()
    }
    fn on_end(_ext: ExtMut<'_, Self::Ext>, _s: *mut us_socket_t) {
        unreachable!()
    }
    fn on_connect_error(_ext: ExtMut<'_, Self::Ext>, _s: *mut us_socket_t, _code: i32) {
        unreachable!()
    }
    fn on_connecting_error(_cs: *mut ConnectingSocket, _code: i32) {
        unreachable!()
    }
    fn on_handshake(
        _ext: ExtMut<'_, Self::Ext>,
        _s: *mut us_socket_t,
        _ok: bool,
        _err: us_bun_verify_error_t,
    ) {
        unreachable!()
    }

    // `HAS_EXT == false` variants (Rust can't change a trait method's arity
    // by a const, so these are separate methods).
    fn on_open_no_ext(_s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        unreachable!()
    }
    fn on_data_no_ext(_s: *mut us_socket_t, _data: &[u8]) {
        unreachable!()
    }
    fn on_fd_no_ext(_s: *mut us_socket_t, _fd: c_int) {
        unreachable!()
    }
    fn on_writable_no_ext(_s: *mut us_socket_t) {
        unreachable!()
    }
    fn on_close_no_ext(_s: *mut us_socket_t, _code: i32, _reason: Option<*mut c_void>) {
        unreachable!()
    }
    fn on_timeout_no_ext(_s: *mut us_socket_t) {
        unreachable!()
    }
    fn on_long_timeout_no_ext(_s: *mut us_socket_t) {
        unreachable!()
    }
    fn on_end_no_ext(_s: *mut us_socket_t) {
        unreachable!()
    }
    fn on_connect_error_no_ext(_s: *mut us_socket_t, _code: i32) {
        unreachable!()
    }
    fn on_handshake_no_ext(_s: *mut us_socket_t, _ok: bool, _err: us_bun_verify_error_t) {
        unreachable!()
    }
}

/// Produce a `&'static VTable` for `H` — a const address into `.rodata`,
/// safe to store in any number of `SocketGroup`s.
pub fn make<H: Handler>() -> &'static VTable {
    &Make::<H>::VT
}

struct Make<H>(core::marker::PhantomData<H>);

impl<H: Handler> Make<H> {
    const VT: VTable = {
        // Rust-handled kinds store ext IN the header's 8-byte word (docs/design.md
        // §Strategy 3); unsafe_core::ext::downcast_raw relies on this fitting.
        assert!(
            !H::HAS_EXT
                || (core::mem::size_of::<H::Ext>() <= core::mem::size_of::<*mut c_void>()
                    && core::mem::align_of::<H::Ext>() <= core::mem::align_of::<*mut c_void>()),
            "Handler::Ext must fit the 8-byte socket ext word"
        );
        VTable {
            on_open: if H::HAS_ON_OPEN {
                Some(Trampolines::<H>::on_open)
            } else {
                None
            },
            on_data: if H::HAS_ON_DATA {
                Some(Trampolines::<H>::on_data)
            } else {
                None
            },
            on_fd: if H::HAS_ON_FD {
                Some(Trampolines::<H>::on_fd)
            } else {
                None
            },
            on_writable: if H::HAS_ON_WRITABLE {
                Some(Trampolines::<H>::on_writable)
            } else {
                None
            },
            on_close: if H::HAS_ON_CLOSE {
                Some(Trampolines::<H>::on_close)
            } else {
                None
            },
            on_timeout: if H::HAS_ON_TIMEOUT {
                Some(Trampolines::<H>::on_timeout)
            } else {
                None
            },
            on_long_timeout: if H::HAS_ON_LONG_TIMEOUT {
                Some(Trampolines::<H>::on_long_timeout)
            } else {
                None
            },
            on_end: if H::HAS_ON_END {
                Some(Trampolines::<H>::on_end)
            } else {
                None
            },
            on_connect_error: if H::HAS_ON_CONNECT_ERROR {
                Some(Trampolines::<H>::on_connect_error)
            } else {
                None
            },
            on_connecting_error: if H::HAS_ON_CONNECTING_ERROR {
                Some(Trampolines::<H>::on_connecting_error)
            } else {
                None
            },
            on_handshake: if H::HAS_ON_HANDSHAKE {
                Some(Trampolines::<H>::on_handshake)
            } else {
                None
            },
        }
    };
}

// ── kind → handler dispatch (loop-driven) ────────────────────────────────────
// The loop NEVER reads `group->vtable` itself except through here: dispatch
// switches on `s.kind` and falls back to the group vtable for UwsHttp{,Tls},
// UwsWs{,Tls} and Dynamic (docs/cabi.md §2.1).

pub const SOCKET_KIND_COUNT: usize = SocketKind::TestChannel as usize + 1;

/// Type-erased owner operations for a Protocol v2 kind. A table entry
/// carrying these marks the kind as v2: terminal dispatch releases the
/// core-owned ext ref through `deref` (trampolines::release_owner_ext).
#[derive(Copy, Clone)]
pub(crate) struct OwnerOps {
    /// SAFETY (caller): the word points to a live owner of the registered
    /// type with an outstanding strong ref — the one being released.
    pub(crate) deref: unsafe fn(*mut c_void),
}

/// One row of the link-time kind table: the const-built vtable and owner ops
/// for a Rust-handled `SocketKind`. Built ONLY by [`crate::kind_entry`];
/// fields stay crate-private so the runtime crate can hold entries but not
/// forge them.
pub struct KindEntry {
    /// The kind this row was built for ([`validate_kind_table`] traps rows
    /// placed at the wrong index).
    pub(crate) kind: SocketKind,
    pub(crate) vtable: &'static VTable,
    pub(crate) owner_ops: OwnerOps,
    /// Registered protocol type (debug dispatch checks).
    pub(crate) handler_type: fn() -> TypeId,
    /// Registered `Protocol::Owner` type (attach surface fails closed).
    pub(crate) owner_type: fn() -> TypeId,
}

/// The process-wide kind→handler table, fully const-initialized in the one
/// crate that sees every protocol type (`bun_runtime::socket::uws_dispatch`)
/// and resolved here at link time — the Rust analog of the C loop's fixed
/// dispatch switch. `None` = kind never dispatches through the static tables
/// (Invalid trap, group-vtable kinds, ABI-reserved listener kinds).
pub type KindTable = [Option<&'static KindEntry>; SOCKET_KIND_COUNT];

/// Const-eval integrity check for the link-time table: every present row
/// must sit at its own kind's index, and kinds outside the static tables
/// (Invalid, Dynamic/uWS group-vtable kinds) must be `None`. Run it in a
/// `const _: () = ...` next to the table so a misplaced row is a compile
/// error.
pub const fn validate_kind_table(t: &KindTable) {
    let mut i = 0;
    while i < SOCKET_KIND_COUNT {
        match t[i] {
            Some(e) => assert!(e.kind as usize == i, "kind-table row at the wrong index"),
            None => {}
        }
        i += 1;
    }
    assert!(t[SocketKind::Invalid as usize].is_none());
    assert!(t[SocketKind::Dynamic as usize].is_none());
    assert!(t[SocketKind::UwsHttp as usize].is_none());
    assert!(t[SocketKind::UwsHttpTls as usize].is_none());
    assert!(t[SocketKind::UwsWs as usize].is_none());
    assert!(t[SocketKind::UwsWsTls as usize].is_none());
}

#[inline]
fn entry(kind: SocketKind) -> Option<&'static KindEntry> {
    crate::unsafe_core::trampolines::kind_table()[kind as usize]
}

/// True iff `kind` is a Protocol v2 kind whose table-registered owner type is
/// `O`. The attach surface fails closed on anything else: a kind without a
/// table entry would leak the ref at the terminal, a different owner type is
/// confusion.
pub(crate) fn owner_registered_as<O: 'static>(kind: SocketKind) -> bool {
    entry(kind).is_some_and(|e| (e.owner_type)() == TypeId::of::<O>())
}

/// `Some` iff `kind` has a Protocol v2 table entry (owner-carrying ext).
pub(crate) fn owner_ops(kind: SocketKind) -> Option<&'static OwnerOps> {
    entry(kind).map(|e| &e.owner_ops)
}

/// Silent-terminal owner release (C1: SEMI_SOCKET closes and detach dispatch
/// NO callback, but core's ext-held owner ref is still released exactly once
/// — documented deviation from C parity, Protocol v2 terminal contract).
pub(crate) fn release_owner_on_silent_terminal(s: *mut us_socket_t) {
    trampolines::release_owner_ext(s);
}

/// Debug ext-type check backing `Trampolines::ext` (docs/design.md kind registry):
/// a static kind's trampoline belongs to the handler in its table entry.
/// Kinds without an entry (group-vtable) are vacuously true.
pub(crate) fn kind_dispatches_to<H: Handler>(kind: SocketKind) -> bool {
    entry(kind).is_none_or(|e| (e.handler_type)() == TypeId::of::<H>())
}

/// TLS side-channel hooks (raw ciphertext tap / new-session / keylog). These
/// are not vtable slots (the 11-slot layout is FROZEN, docs/cabi.md §3.7);
/// only `BunSocketTls` sockets consume them (docs/tls.md §2.7, §3.3) and
/// the ext-null / unstamped window is the consumer's silent no-op.
pub struct TlsSideChannelHooks {
    pub ssl_raw_tap: fn(s: *mut us_socket_t, data: &[u8]),
    pub session: fn(s: *mut us_socket_t, session: &[u8]),
    pub keylog: fn(s: *mut us_socket_t, line: &[u8]),
}

/// The link-time hooks (`BUN_UWS_TLS_SIDE_CHANNEL`, defined next to the kind
/// table in the runtime dispatch module) — always present, so raw-tap
/// ciphertext can never be silently dropped (docs/tls.md §2.7).
fn tls_hooks() -> &'static TlsSideChannelHooks {
    crate::unsafe_core::trampolines::tls_side_channel()
}

/// Resolve the vtable for a socket event. `None` = vacant slab slot (stale
/// kernel pointer, OQ-4 structural fix) — the caller drops the event.
/// Panics: kind=Invalid (calloc trap, crash-by-design), missing group vtable
/// for Dynamic/uWS kinds, kind without a table entry.
fn vt(s: *mut us_socket_t) -> Option<&'static VTable> {
    if !trampolines::socket_slot_live(s) {
        return None;
    }
    let kind = trampolines::socket_kind(s);
    match kind {
        SocketKind::Invalid => panic!(
            "us_socket_t with kind=invalid (group={:p})",
            trampolines::socket_group(s)
        ),
        k if uses_group_vtable(k) => Some(
            trampolines::socket_group_vtable(s)
                .unwrap_or_else(|| panic!("socket kind {k:?} has no group vtable")),
        ),
        k => Some(
            entry(k)
                .unwrap_or_else(|| panic!("dispatch on socket kind {k:?} with no table entry"))
                .vtable,
        ),
    }
}

/// Connecting-socket variant of [`vt`].
fn vtc(cs: *mut ConnectingSocket) -> Option<&'static VTable> {
    if !trampolines::connecting_slot_live(cs) {
        return None;
    }
    let kind = trampolines::connecting_kind(cs);
    match kind {
        SocketKind::Invalid => panic!("us_connecting_socket_t with kind=invalid"),
        k if uses_group_vtable(k) => Some(
            trampolines::connecting_group_vtable(cs)
                .unwrap_or_else(|| panic!("connecting socket kind {k:?} has no group vtable")),
        ),
        k => Some(
            entry(k)
                .unwrap_or_else(|| panic!("dispatch on socket kind {k:?} with no table entry"))
                .vtable,
        ),
    }
}

// The drivers below never touch ext themselves (C17): the trampoline wraps
// the ext pointer in a per-use `ExtMut` immediately before the handler call
// and never touches it after — no `&mut` spans the handler.

pub(crate) fn dispatch_open(s: *mut us_socket_t, is_client: bool, ip: &[u8]) {
    if let Some(vt) = vt(s) {
        trampolines::invoke_open(vt, s, is_client, ip);
    }
}

pub(crate) fn dispatch_data(s: *mut us_socket_t, data: &mut [u8]) {
    if let Some(vt) = vt(s) {
        trampolines::invoke_data(vt, s, data);
    }
}

pub(crate) fn dispatch_writable(s: *mut us_socket_t) {
    if let Some(vt) = vt(s) {
        trampolines::invoke_writable(vt, s);
    }
}

pub(crate) fn dispatch_close(s: *mut us_socket_t, code: c_int, reason: *mut c_void) {
    if let Some(vt) = vt(s) {
        trampolines::invoke_close(vt, s, code, reason);
        // Terminal contract: core's ext-held owner ref is released exactly
        // once after on_close returns (Protocol v2 terminal contract; no-op for v1 kinds).
        trampolines::release_owner_ext(s);
    }
}

pub(crate) fn dispatch_end(s: *mut us_socket_t) {
    if let Some(vt) = vt(s) {
        trampolines::invoke_end(vt, s);
    }
}

pub(crate) fn dispatch_timeout(s: *mut us_socket_t) {
    if let Some(vt) = vt(s) {
        trampolines::invoke_timeout(vt, s);
    }
}

pub(crate) fn dispatch_long_timeout(s: *mut us_socket_t) {
    if let Some(vt) = vt(s) {
        trampolines::invoke_long_timeout(vt, s);
    }
}

pub(crate) fn dispatch_fd(s: *mut us_socket_t, fd: c_int) {
    if let Some(vt) = vt(s) {
        trampolines::invoke_fd(vt, s, fd);
    }
}

pub(crate) fn dispatch_connect_error(s: *mut us_socket_t, code: c_int) {
    if let Some(vt) = vt(s) {
        trampolines::invoke_connect_error(vt, s, code);
        // Terminal (C2): release core's owner ref after on_connect_error.
        trampolines::release_owner_ext(s);
    }
}

pub(crate) fn dispatch_connecting_error(cs: *mut ConnectingSocket, code: c_int) {
    if let Some(vt) = vtc(cs) {
        trampolines::invoke_connecting_error(vt, cs, code);
        // Terminal (C2): release the connecting socket's owner ref (also
        // nulls the attempts' borrowed copies).
        trampolines::release_owner_ext_connecting(cs);
    }
}

pub(crate) fn dispatch_handshake(s: *mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
    if let Some(vt) = vt(s) {
        trampolines::invoke_handshake(vt, s, ok, err);
    }
}

// Only bun_socket_tls ever produces side-channel events (docs/tls.md §6.1);
// the kind gate below only differs from the old C in unreachable states.

pub(crate) fn dispatch_ssl_raw_tap(s: *mut us_socket_t, data: &[u8]) {
    if !trampolines::socket_slot_live(s)
        || trampolines::socket_kind(s) != SocketKind::BunSocketTls
    {
        return;
    }
    (tls_hooks().ssl_raw_tap)(s, data);
}

pub(crate) fn dispatch_session(s: *mut us_socket_t, session: &[u8]) {
    if !trampolines::socket_slot_live(s)
        || trampolines::socket_kind(s) != SocketKind::BunSocketTls
    {
        return;
    }
    (tls_hooks().session)(s, session);
}

pub(crate) fn dispatch_keylog(s: *mut us_socket_t, line: &[u8]) {
    if !trampolines::socket_slot_live(s)
        || trampolines::socket_kind(s) != SocketKind::BunSocketTls
    {
        return;
    }
    (tls_hooks().keylog)(s, line);
}

/// True when `kind` routes through the group vtable instead of a static
/// per-kind Rust handler. Also the single source of the ext storage class:
/// these kinds get an inline slab ext area contiguous after the header
/// (`socket::alloc` / `unsafe_core::ext::downcast_raw`); all others
/// store ext in the header word. Invariant (docs/design.md §Strategy 3): adoption never crosses this
/// predicate — `group::adopt_socket` re-stamps kind without touching ext, so
/// `uses_group_vtable(old) == uses_group_vtable(new)` must hold at adopt.
pub(crate) fn uses_group_vtable(kind: SocketKind) -> bool {
    kind.is_uws() || matches!(kind, SocketKind::Dynamic)
}
