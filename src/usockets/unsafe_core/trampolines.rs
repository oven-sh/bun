//! extern "C" vtable/dispatch shims. Moved from `src/uws_sys/vtable.rs`
//! (`Trampolines<H>`) with pointer types adapted to the native crate; the
//! Handler trait and `vtable::make` live in dispatch.rs. Exposed pub(crate)
//! so dispatch.rs can direct-call per-kind, bypassing the vtable pointer.
//!
//! Also home to the raw-header readers and vtable-slot invokers the dispatch
//! driver uses (dispatch.rs is deny(unsafe_code)). Shared invariant: the loop
//! only dispatches slab-resident headers, and slab memory is never returned
//! to the OS while the loop lives — so slot reads are in-bounds even for
//! vacant (freed-and-bumped) slots. Listener headers are slab-resident too
//! (group::finish_listen allocates via socket::alloc with kind=Invalid; only
//! the ListenerData is boxed into the ext word), so one reaching dispatch_*
//! reads an in-bounds generation and traps in `vt()` on kind=Invalid (R7.2).

use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use crate::connecting::ConnectingSocket;
use crate::dispatch::Handler;
use crate::group::{SocketGroup, VTable};
use crate::kind::SocketKind;
use crate::socket::us_socket_t;
use crate::tls::context::us_bun_verify_error_t;
use crate::unsafe_core::ext;
use crate::unsafe_core::slab::ChunkedSlab;

// ── link-time dispatch tables ────────────────────────────────────────────────
// The const kind table and TLS side-channel hooks are DEFINED (no_mangle) in
// the one crate that sees every protocol type — bun_runtime's
// socket/uws_dispatch.rs — and resolved here at link time, the same single
// seam the C loop's fixed dispatch switch used. Crate unit tests provide the
// empty fallbacks below so the test binary links without the runtime crate.

#[cfg(not(test))]
unsafe extern "Rust" {
    safe static BUN_UWS_KIND_TABLE: crate::dispatch::KindTable;
    safe static BUN_UWS_TLS_SIDE_CHANNEL: crate::dispatch::TlsSideChannelHooks;
}

#[cfg(test)]
static BUN_UWS_KIND_TABLE: crate::dispatch::KindTable = [None; crate::dispatch::SOCKET_KIND_COUNT];
#[cfg(test)]
static BUN_UWS_TLS_SIDE_CHANNEL: crate::dispatch::TlsSideChannelHooks =
    crate::dispatch::TlsSideChannelHooks {
        ssl_raw_tap: |_, _| {},
        session: |_, _| {},
        keylog: |_, _| {},
    };

#[inline]
pub(crate) fn kind_table() -> &'static crate::dispatch::KindTable {
    &BUN_UWS_KIND_TABLE
}

#[inline]
pub(crate) fn tls_side_channel() -> &'static crate::dispatch::TlsSideChannelHooks {
    &BUN_UWS_TLS_SIDE_CHANNEL
}

pub(crate) struct Trampolines<H>(core::marker::PhantomData<H>);

impl<H: Handler> Trampolines<H> {
    #[inline(always)]
    fn ext<'a>(s: *mut us_socket_t) -> ext::ExtMut<'a, H::Ext>
    where
        H::Ext: 'a,
    {
        // Generation validation before the ext read: parity odd = occupied
        // (deferred-close slots stay occupied until the tick postlude, C6).
        debug_assert!(socket_slot_live(s), "ext read on a dead slab slot");
        // Kind-registry type check (docs/design.md §Handle surface): the invoked
        // handler is the one registered for this static kind.
        debug_assert!(
            crate::dispatch::kind_dispatches_to::<H>(socket_kind(s)),
            "trampoline invoked for a kind registered to a different handler"
        );
        // SAFETY: dispatch only invokes trampolines on live sockets whose ext
        // storage was sized for `H::Ext` at creation. No reference is formed
        // here — every deref is a per-use reborrow inside `ExtMut::with`, so
        // C17 re-entry (close/adopt from inside the handler) cannot overlap
        // a live `&mut` to the same storage.
        ext::ExtMut::new(unsafe { ext::downcast_raw::<H::Ext>(s) })
    }

    pub(crate) extern "C" fn on_open(
        s: *mut us_socket_t,
        is_client: c_int,
        ip: *mut u8,
        ip_len: c_int,
    ) -> *mut us_socket_t {
        // SAFETY: the loop guarantees `ip[0..ip_len]` is valid when non-null.
        let ip_slice: &[u8] =
            unsafe { ext::c_slice(ip, usize::try_from(ip_len).expect("int cast")) };
        if H::HAS_EXT {
            H::on_open(Self::ext(s), s, is_client != 0, ip_slice);
        } else {
            H::on_open_no_ext(s, is_client != 0, ip_slice);
        }
        s
    }

    pub(crate) extern "C" fn on_data(
        s: *mut us_socket_t,
        data: *mut u8,
        len: c_int,
    ) -> *mut us_socket_t {
        // SAFETY: the loop guarantees `data[0..len]` is valid (shared recv_buf).
        let data_slice = unsafe { ext::c_slice(data, usize::try_from(len).expect("int cast")) };
        if H::HAS_EXT {
            H::on_data(Self::ext(s), s, data_slice);
        } else {
            H::on_data_no_ext(s, data_slice);
        }
        s
    }

    pub(crate) extern "C" fn on_fd(s: *mut us_socket_t, fd: c_int) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_fd(Self::ext(s), s, fd);
        } else {
            H::on_fd_no_ext(s, fd);
        }
        s
    }

    pub(crate) extern "C" fn on_writable(s: *mut us_socket_t) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_writable(Self::ext(s), s);
        } else {
            H::on_writable_no_ext(s);
        }
        s
    }

    pub(crate) extern "C" fn on_close(
        s: *mut us_socket_t,
        code: c_int,
        reason: *mut c_void,
    ) -> *mut us_socket_t {
        let reason = if reason.is_null() { None } else { Some(reason) };
        if H::HAS_EXT {
            H::on_close(Self::ext(s), s, code, reason);
        } else {
            H::on_close_no_ext(s, code, reason);
        }
        s
    }

    pub(crate) extern "C" fn on_timeout(s: *mut us_socket_t) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_timeout(Self::ext(s), s);
        } else {
            H::on_timeout_no_ext(s);
        }
        s
    }

    pub(crate) extern "C" fn on_long_timeout(s: *mut us_socket_t) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_long_timeout(Self::ext(s), s);
        } else {
            H::on_long_timeout_no_ext(s);
        }
        s
    }

    pub(crate) extern "C" fn on_end(s: *mut us_socket_t) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_end(Self::ext(s), s);
        } else {
            H::on_end_no_ext(s);
        }
        s
    }

    pub(crate) extern "C" fn on_connect_error(
        s: *mut us_socket_t,
        code: c_int,
    ) -> *mut us_socket_t {
        if H::HAS_EXT {
            H::on_connect_error(Self::ext(s), s, code);
        } else {
            H::on_connect_error_no_ext(s, code);
        }
        s
    }

    pub(crate) extern "C" fn on_connecting_error(
        cs: *mut ConnectingSocket,
        code: c_int,
    ) -> *mut ConnectingSocket {
        H::on_connecting_error(cs, code);
        cs
    }

    pub(crate) extern "C" fn on_handshake(
        s: *mut us_socket_t,
        ok: c_int,
        err: us_bun_verify_error_t,
        _user: *mut c_void,
    ) {
        if H::HAS_EXT {
            H::on_handshake(Self::ext(s), s, ok != 0, err);
        } else {
            H::on_handshake_no_ext(s, ok != 0, err);
        }
    }
}

// ── raw header reads for the dispatch driver ────────────────────────────────
// Short-lived field copies only — never a `&`/`&mut SocketHeader` that could
// alias re-entrant callback state (C17).

/// Slot occupancy via generation parity (odd = occupied). Vacant ⇒ the event
/// is stale (quirk OQ-4 structural fix — docs/semantics.md) and must be dropped.
/// Parity cannot detect slot REUSE: stale kernel udata for a slot freed in a
/// prior tick postlude and re-allocated has odd parity again. Safe only
/// because deferred free (C6) covers intra-batch staleness and the backend
/// purges kernel-held udata (fd close/EPOLL_CTL_DEL) before slot reuse.
pub(crate) fn socket_slot_live(s: *mut us_socket_t) -> bool {
    match NonNull::new(s) {
        // SAFETY: slab-resident header per module invariant; the slot's
        // generation cell is in-bounds even when the slot is vacant.
        Some(nn) => (unsafe { ChunkedSlab::generation(nn) }) % 2 == 1,
        None => false,
    }
}

/// Connecting-socket variant of [`socket_slot_live`].
pub(crate) fn connecting_slot_live(cs: *mut ConnectingSocket) -> bool {
    match NonNull::new(cs) {
        // SAFETY: slab-resident per module invariant (connecting sockets live
        // in the per-loop slab like sockets).
        Some(nn) => (unsafe { ChunkedSlab::generation(nn) }) % 2 == 1,
        None => false,
    }
}

pub(crate) fn socket_kind(s: *mut us_socket_t) -> SocketKind {
    // SAFETY: occupied slab slot (dispatch validates parity first).
    unsafe { (*s).kind }
}

pub(crate) fn connecting_kind(cs: *mut ConnectingSocket) -> SocketKind {
    // SAFETY: occupied slab slot (dispatch validates parity first).
    unsafe { (*cs).kind }
}

pub(crate) fn socket_group(s: *mut us_socket_t) -> *mut SocketGroup {
    // SAFETY: occupied slab slot (dispatch validates parity first).
    unsafe { (*s).group }
}

pub(crate) fn socket_group_vtable(s: *mut us_socket_t) -> Option<&'static VTable> {
    let g = socket_group(s);
    // SAFETY: the group is embedded by-value in a live owner for as long as
    // any of its sockets exists; the vtable slot is a `&'static` copy-out.
    unsafe { (*g).vtable }
}

pub(crate) fn connecting_group_vtable(cs: *mut ConnectingSocket) -> Option<&'static VTable> {
    // SAFETY: occupied slab slot; group liveness as in `socket_group_vtable`.
    unsafe { (*(*cs).group).vtable }
}

// ── vtable slot invocation (NULL slot ⇒ skipped no-op, docs/cabi.md §4.1) ───
// The `-> *mut us_socket_t` return is always the input with in-place adoption
// (docs/design.md §Strategy 3) and is deliberately discarded.

fn c_len(len: usize) -> c_int {
    c_int::try_from(len).expect("dispatch buffer length exceeds c_int")
}

pub(crate) fn invoke_open(vt: &VTable, s: *mut us_socket_t, is_client: bool, ip: &[u8]) {
    if let Some(f) = vt.on_open {
        // SAFETY: slot signature matches this lowering; `ip` outlives the
        // call. The `*mut` is C-ABI shape only — `ip` is lowered from a
        // shared borrow, so the handler must not write through it (cabi §4.1).
        let _ = unsafe {
            f(
                s,
                is_client as c_int,
                ip.as_ptr().cast_mut(),
                c_len(ip.len()),
            )
        };
    }
}

pub(crate) fn invoke_data(vt: &VTable, s: *mut us_socket_t, data: &mut [u8]) {
    if let Some(f) = vt.on_data {
        // SAFETY: slot signature matches; `data` (shared recv_buf view, writable
        // for in-place WS unmasking) outlives the call.
        let _ = unsafe { f(s, data.as_mut_ptr(), c_len(data.len())) };
    }
}

pub(crate) fn invoke_fd(vt: &VTable, s: *mut us_socket_t, fd: c_int) {
    if let Some(f) = vt.on_fd {
        // SAFETY: slot signature matches the C ABI.
        let _ = unsafe { f(s, fd) };
    }
}

pub(crate) fn invoke_close(vt: &VTable, s: *mut us_socket_t, code: c_int, reason: *mut c_void) {
    if let Some(f) = vt.on_close {
        // SAFETY: slot signature matches; `reason` is an opaque passthrough (C3).
        let _ = unsafe { f(s, code, reason) };
    }
}

pub(crate) fn invoke_connect_error(vt: &VTable, s: *mut us_socket_t, code: c_int) {
    if let Some(f) = vt.on_connect_error {
        // SAFETY: slot signature matches the C ABI.
        let _ = unsafe { f(s, code) };
    }
}

pub(crate) fn invoke_connecting_error(vt: &VTable, cs: *mut ConnectingSocket, code: c_int) {
    if let Some(f) = vt.on_connecting_error {
        // SAFETY: slot signature matches the C ABI.
        let _ = unsafe { f(cs, code) };
    }
}

pub(crate) fn invoke_handshake(
    vt: &VTable,
    s: *mut us_socket_t,
    ok: bool,
    err: us_bun_verify_error_t,
) {
    if let Some(f) = vt.on_handshake {
        // SAFETY: slot signature matches; custom_data is always NULL
        // (docs/cabi.md §2.1).
        unsafe { f(s, ok as c_int, err, core::ptr::null_mut()) };
    }
}

/// Stamps the four `fn(s) -> s` slot invokers.
macro_rules! invoke_unary {
    ($($name:ident => $slot:ident),* $(,)?) => {$(
        pub(crate) fn $name(vt: &VTable, s: *mut us_socket_t) {
            if let Some(f) = vt.$slot {
                // SAFETY: slot signature matches the C ABI.
                let _ = unsafe { f(s) };
            }
        }
    )*};
}

invoke_unary! {
    invoke_writable => on_writable,
    invoke_timeout => on_timeout,
    invoke_long_timeout => on_long_timeout,
    invoke_end => on_end,
}

// ── Protocol v2 (docs/design.md): owner-guarded trampolines ───────────────
// Owner storage: the 8-byte ext word of a static (non-group-vtable) kind
// holds a `*mut P::Owner` carrying ONE strong ref transferred by the attach
// APIs (handle.rs). Attempt sockets of an in-flight connect carry a BORROWED
// copy (connect_state != null); the owned word lives on the ConnectingSocket.

use crate::handle::{AnySocket, NewSocketHandler, SocketRef};
use crate::protocol::{CloseCode2, ConnectFailure, Protocol};

/// Type-erased owner release for the dispatch-side kind registry.
///
/// # Safety
/// `word` must point to a live `O` with an outstanding strong ref (the one
/// being released here).
pub(crate) unsafe fn owner_deref_erased<O>(word: *mut c_void)
where
    O: bun_ptr::RefCounted,
    O::DestructorCtx: Default,
{
    // SAFETY: forwarded caller contract.
    unsafe { <O as bun_ptr::AnyRefCounted>::rc_deref(word.cast::<O>()) };
}

/// Raw ext-word snapshot of a static-kind socket (never the group-vtable
/// inline-area pointer). Invariant: occupied slab slot.
fn owner_word(s: *mut us_socket_t) -> *mut c_void {
    debug_assert!(!crate::dispatch::uses_group_vtable(socket_kind(s)));
    // SAFETY: occupied slab slot (callers validate parity first); raw field
    // read, no reference formed (C17).
    unsafe { (*s).ext }
}

/// Raw `connect_state` snapshot; occupied slab slot (callers resolve the
/// handle / validate parity first). Non-null = live happy-eyeballs attempt.
pub(crate) fn socket_connect_state(s: *mut us_socket_t) -> *mut ConnectingSocket {
    // SAFETY: occupied slab slot; raw field read, no reference formed (C17).
    unsafe { (*s).connect_state }
}

/// Generation-checked [`AnySocket`] handle for a live dispatched socket;
/// SSL flavor follows the kind tag.
pub(crate) fn any_socket(s: *mut us_socket_t) -> AnySocket {
    let r = SocketRef::from_live(NonNull::new(s).expect("dispatch on null socket"));
    if socket_kind(s).is_tls() {
        AnySocket::SocketTls(NewSocketHandler::from(r))
    } else {
        AnySocket::SocketTcp(NewSocketHandler::from(r))
    }
}

/// Release the core-owned ext ref at a socket terminal (on_close /
/// on_connect_error return, silent SEMI_SOCKET close, detach). Exactly-once:
/// the word is nulled before the deref. No-op for v1 kinds (no owner ops),
/// stale slots, null words, and borrowed attempt copies (connect_state set —
/// that ref is owned by the ConnectingSocket and released at ITS terminal).
pub(crate) fn release_owner_ext(s: *mut us_socket_t) {
    if !socket_slot_live(s) {
        return;
    }
    let Some(ops) = crate::dispatch::owner_ops(socket_kind(s)) else {
        return;
    };
    // SAFETY: occupied slab slot; raw field reads/writes, no reference formed.
    let word = unsafe {
        if !(*s).connect_state.is_null() {
            return;
        }
        core::mem::replace(&mut (*s).ext, core::ptr::null_mut())
    };
    if word.is_null() {
        return;
    }
    // SAFETY: `word` was stamped from an `OwnerRef` for this kind (attach
    // invariant) and its strong ref is still outstanding (nulled-once above).
    unsafe { (ops.deref)(word) };
}

/// Connecting-socket variant of [`release_owner_ext`]. Also nulls every live
/// attempt's borrowed ext copy so a later promotion/terminal cannot see a
/// dangling word.
pub(crate) fn release_owner_ext_connecting(cs: *mut ConnectingSocket) {
    if !connecting_slot_live(cs) {
        return;
    }
    let Some(ops) = crate::dispatch::owner_ops(connecting_kind(cs)) else {
        return;
    };
    // SAFETY: occupied slab slot; raw field access only (pending window, C13).
    let word = unsafe {
        let word = core::mem::replace(&mut (*cs).ext, core::ptr::null_mut());
        for attempt in (*cs).attempts {
            if !attempt.is_null() {
                (*attempt).ext = core::ptr::null_mut();
            }
        }
        word
    };
    if word.is_null() {
        return;
    }
    // SAFETY: as in `release_owner_ext`.
    unsafe { (ops.deref)(word) };
}

/// Swap the OWNED ext word of a live in-flight connect (owner attach during
/// happy-eyeballs): stamps `word` on the ConnectingSocket and every live
/// attempt's borrowed copy; returns the previous owned word.
pub(crate) fn swap_owner_ext_connecting(
    cs: *mut ConnectingSocket,
    word: *mut c_void,
) -> *mut c_void {
    // SAFETY: caller resolved a live socket whose connect_state is `cs`, so
    // the slot is occupied; raw field access only (pending window, C13).
    unsafe {
        let old = core::mem::replace(&mut (*cs).ext, word);
        for attempt in (*cs).attempts {
            if !attempt.is_null() {
                (*attempt).ext = word;
            }
        }
        old
    }
}

/// Release an owner word captured BEFORE an adopt re-stamped the kind
/// (owner-swap: the new owner is stamped first, then the old ref is released
/// under the old kind's ops — no window where dispatch sees a stale owner).
pub(crate) fn release_owner_for_kind(word: *mut c_void, kind: SocketKind) {
    let Some(ops) = crate::dispatch::owner_ops(kind) else {
        return;
    };
    if word.is_null() {
        return;
    }
    // SAFETY: `word` was stamped from an `OwnerRef` for `kind` (attach
    // invariant); the caller detached it from the socket, so this is the
    // sole release of that ref.
    unsafe { (ops.deref)(word) };
}

/// Mint a strong [`bun_ptr::RefPtr`] from a live owner borrow. Safe: `&O`
/// proves liveness (`RefPtr::init_ref`'s precondition) and the intrusive
/// count is interior-mutable, so the `&`-derived `*mut` never writes fields.
pub fn owner_ref_of<O: bun_ptr::AnyRefCounted>(o: &O) -> bun_ptr::RefPtr<O> {
    // SAFETY: `o` is a live borrow; init_ref only touches the intrusive count.
    unsafe { bun_ptr::RefPtr::init_ref(core::ptr::from_ref(o).cast_mut()) }
}

/// [`bun_ptr::ThisPtr`] view of a live owner borrow, for legacy
/// dispatch-shaped call sites. Liveness beyond the borrow is the Protocol v2
/// dispatch guard's guarantee (the trampoline holds a ref across the handler).
pub fn this_ptr_of<O>(o: &O) -> bun_ptr::ThisPtr<O> {
    // SAFETY: non-null and live per the borrow.
    unsafe { bun_ptr::ThisPtr::new(core::ptr::from_ref(o).cast_mut()) }
}

/// Consumer-facing SAFE owner access (Protocol v2, docs/design.md):
/// take a transient strong ref on the typed owner of a live socket handle.
/// `None` for stale/detached handles, v1 kinds, owner-type mismatches, and
/// the detached/pre-stamp (null-word) window. The caller must `deref()` (or
/// transfer) the returned ref — `RefPtr` has no `Drop`.
pub fn socket_owner_ref<const SSL: bool, O>(s: &NewSocketHandler<SSL>) -> Option<bun_ptr::RefPtr<O>>
where
    O: bun_ptr::RefCounted<DestructorCtx: Default> + 'static,
{
    let word = match s.socket {
        crate::handle::InternalSocket::Connected(r) => {
            let p = r.resolve()?.as_ptr();
            if !crate::dispatch::owner_registered_as::<O>(socket_kind(p)) {
                return None;
            }
            let cs = socket_connect_state(p);
            if cs.is_null() {
                owner_word(p)
            } else {
                // Live happy-eyeballs attempt: the owned word lives on the
                // ConnectingSocket (the attempt's copy is a borrow).
                // SAFETY: occupied slab slot; raw field read only (C13).
                unsafe { (*cs).ext }
            }
        }
        crate::handle::InternalSocket::Connecting(r) => {
            let cs = r.resolve()?.as_ptr();
            if !crate::dispatch::owner_registered_as::<O>(connecting_kind(cs)) {
                return None;
            }
            // SAFETY: occupied slab slot; raw field read only (C13).
            unsafe { (*cs).ext }
        }
        _ => return None,
    };
    let p = NonNull::new(word.cast::<O>())?;
    // SAFETY: `owner_registered_as` proved the registered owner type is `O`,
    // and the attach invariant says a non-null word is a live `O` carrying an
    // outstanding strong ref; `init_ref` adds the caller's own ref.
    Some(unsafe { bun_ptr::RefPtr::init_ref(p.as_ptr()) })
}

/// Closure form of [`socket_owner_ref`]: borrow the owner for the duration
/// of `f`, ref-guarded so a re-entrant release inside `f` cannot free it.
pub fn with_socket_owner<const SSL: bool, O, R>(
    s: &NewSocketHandler<SSL>,
    f: impl FnOnce(&O) -> R,
) -> Option<R>
where
    O: bun_ptr::RefCounted<DestructorCtx: Default> + 'static,
{
    let guard = socket_owner_ref::<SSL, O>(s)?;
    let out = f(guard.data());
    guard.deref();
    Some(out)
}

pub(crate) struct Trampolines2<P>(core::marker::PhantomData<P>);

impl<P: Protocol> Trampolines2<P> {
    /// The core-held dispatch guard: take a strong owner ref BEFORE the
    /// handler and drop it after — the owner may lose every other ref
    /// mid-callback (re-entrant JS) and still outlives the handler frame.
    /// Null word (detached / pre-stamp window) is a silent no-op.
    fn with_owner(word: *mut c_void, f: impl FnOnce(&P::Owner)) {
        let Some(p) = NonNull::new(word.cast::<P::Owner>()) else {
            return;
        };
        // SAFETY: the attach APIs stamped a live owner with a transferred
        // strong ref; the loop thread is the only accessor.
        let guard = unsafe { bun_ptr::RefPtr::init_ref(p.as_ptr()) };
        f(guard.data());
        // May run the owner's destructor — AFTER the handler returned; if the
        // handler closed the socket, core's deferred-close already ran (C6).
        guard.deref();
    }

    fn dispatch(s: *mut us_socket_t, f: impl FnOnce(&P::Owner, AnySocket)) {
        let sock = any_socket(s);
        Self::with_owner(owner_word(s), |o| f(o, sock));
    }

    pub(crate) extern "C" fn on_open(
        s: *mut us_socket_t,
        is_client: c_int,
        ip: *mut u8,
        ip_len: c_int,
    ) -> *mut us_socket_t {
        // SAFETY: the loop guarantees `ip[0..ip_len]` is valid when non-null.
        let ip_slice = unsafe { ext::c_slice(ip, usize::try_from(ip_len).expect("int cast")) };
        Self::dispatch(s, |o, sock| P::on_open(o, sock, is_client != 0, ip_slice));
        s
    }

    pub(crate) extern "C" fn on_data(
        s: *mut us_socket_t,
        data: *mut u8,
        len: c_int,
    ) -> *mut us_socket_t {
        // SAFETY: the loop guarantees `data[0..len]` is valid (shared
        // recv_buf, writable for in-place unmasking).
        let slice = unsafe { ext::c_slice_mut(data, usize::try_from(len).expect("int cast")) };
        Self::dispatch(s, |o, sock| P::on_data(o, sock, slice));
        s
    }

    pub(crate) extern "C" fn on_fd(s: *mut us_socket_t, fd: c_int) -> *mut us_socket_t {
        // POSIX-only event (SCM_RIGHTS); the `as _` widens for the Windows
        // Fd backing type, where this slot never fires.
        Self::dispatch(s, |o, sock| {
            P::on_fd(o, sock, bun_core::Fd::from_native(fd as _))
        });
        s
    }

    pub(crate) extern "C" fn on_writable(s: *mut us_socket_t) -> *mut us_socket_t {
        Self::dispatch(s, P::on_writable);
        s
    }

    pub(crate) extern "C" fn on_close(
        s: *mut us_socket_t,
        code: c_int,
        _reason: *mut c_void,
    ) -> *mut us_socket_t {
        let (code, errno) = CloseCode2::decode(code);
        Self::dispatch(s, |o, sock| P::on_close(o, sock, code, errno));
        s
    }

    pub(crate) extern "C" fn on_timeout(s: *mut us_socket_t) -> *mut us_socket_t {
        Self::dispatch(s, P::on_timeout);
        s
    }

    pub(crate) extern "C" fn on_long_timeout(s: *mut us_socket_t) -> *mut us_socket_t {
        Self::dispatch(s, P::on_long_timeout);
        s
    }

    pub(crate) extern "C" fn on_end(s: *mut us_socket_t) -> *mut us_socket_t {
        Self::dispatch(s, P::on_end);
        s
    }

    pub(crate) extern "C" fn on_connect_error(
        s: *mut us_socket_t,
        code: c_int,
    ) -> *mut us_socket_t {
        Self::with_owner(owner_word(s), |o| {
            P::on_connect_error(o, ConnectFailure { errno: code })
        });
        s
    }

    pub(crate) extern "C" fn on_connecting_error(
        cs: *mut ConnectingSocket,
        code: c_int,
    ) -> *mut ConnectingSocket {
        // SAFETY: occupied slab slot (dispatch validates parity first); raw
        // field read only (pending window, C13).
        let word = unsafe { (*cs).ext };
        Self::with_owner(word, |o| {
            P::on_connect_error(o, ConnectFailure { errno: code })
        });
        cs
    }

    pub(crate) extern "C" fn on_handshake(
        s: *mut us_socket_t,
        ok: c_int,
        err: us_bun_verify_error_t,
        _user: *mut c_void,
    ) {
        Self::dispatch(s, |o, sock| P::on_handshake(o, sock, ok != 0, err));
    }
}

// ── poll registry: owner-guarded poll dispatch ────────────────────────────────

use crate::loop_::poll_registry::{PollEvents, PollOwnerOps, PollProtocol, PollRef};

/// Monomorphized owner ops for a registered poll — the non-socket sibling of
/// `make2` (same core-held dispatch-guard contract).
pub(crate) fn poll_owner_ops<P: PollProtocol>() -> &'static PollOwnerOps {
    &MakePollOps::<P>::OPS
}

struct MakePollOps<P>(core::marker::PhantomData<P>);

impl<P: PollProtocol> MakePollOps<P> {
    const OPS: PollOwnerOps = PollOwnerOps {
        dispatch: Self::dispatch_erased,
        deref: owner_deref_erased::<P::Owner>,
        teardown: Self::teardown_erased,
    };

    /// # Safety
    /// `word` must point to a live `P::Owner` whose slot-transferred strong
    /// ref is still outstanding (released by the caller afterwards).
    unsafe fn teardown_erased(word: *mut c_void) {
        let Some(p) = NonNull::new(word.cast::<P::Owner>()) else {
            return;
        };
        // SAFETY: forwarded caller contract — the outstanding ref keeps the
        // owner alive for this shared borrow.
        P::on_loop_teardown(unsafe { &*p.as_ptr() });
    }

    /// # Safety
    /// `word` must point to a live `P::Owner` holding the slot-transferred
    /// strong ref (registry invariant — dispatch validated the slot first).
    unsafe fn dispatch_erased(word: *mut c_void, poll: PollRef, events: PollEvents) {
        let Some(p) = NonNull::new(word.cast::<P::Owner>()) else {
            return;
        };
        // SAFETY: forwarded caller contract. The guard ref keeps the owner
        // alive across the handler even if it loses every other ref (C17);
        // its release runs AFTER the handler returned.
        let guard = unsafe { bun_ptr::RefPtr::init_ref(p.as_ptr()) };
        P::on_event(guard.data(), poll, events);
        guard.deref();
    }
}

/// Owner-guarded dispatch of a registered-poll event.
pub(crate) fn dispatch_poll_owner(
    ops: &PollOwnerOps,
    word: *mut c_void,
    poll: PollRef,
    events: PollEvents,
) {
    // SAFETY: registry invariant — `word` was stamped from an `OwnerRef` at
    // register and its strong ref is outstanding (nulled only at unregister,
    // which frees the slot first so dispatch can no longer resolve it).
    unsafe { (ops.dispatch)(word, poll, events) }
}

/// Release the slot-transferred owner ref (unregister / slab-Drop teardown).
/// Null words (already-released) are a no-op.
pub(crate) fn release_poll_owner(ops: &PollOwnerOps, word: *mut c_void) {
    if word.is_null() {
        return;
    }
    // SAFETY: sole release of the register-transferred strong ref — every
    // caller nulls the slot's word before (or while) handing it here.
    unsafe { (ops.deref)(word) }
}

/// Loop-teardown release: invalidate the owner's consumer-side handles (its
/// `PollRef` dangles once the slab unmaps), THEN release the transferred ref.
pub(crate) fn teardown_poll_owner(ops: &PollOwnerOps, word: *mut c_void) {
    if word.is_null() {
        return;
    }
    // SAFETY: teardown caller contract — live owner, ref still outstanding.
    unsafe { (ops.teardown)(word) };
    release_poll_owner(ops, word);
}

/// Produce the `&'static VTable` for a Protocol v2 registration — every slot
/// filled (v2 defaults are no-ops, so a filled slot == v1's skipped None).
pub(crate) const fn make2<P: Protocol>() -> &'static VTable {
    &Make2::<P>::VT
}

struct Make2<P>(core::marker::PhantomData<P>);

impl<P: Protocol> Make2<P> {
    const VT: VTable = VTable {
        on_open: Some(Trampolines2::<P>::on_open),
        on_data: Some(Trampolines2::<P>::on_data),
        on_fd: Some(Trampolines2::<P>::on_fd),
        on_writable: Some(Trampolines2::<P>::on_writable),
        on_close: Some(Trampolines2::<P>::on_close),
        on_timeout: Some(Trampolines2::<P>::on_timeout),
        on_long_timeout: Some(Trampolines2::<P>::on_long_timeout),
        on_end: Some(Trampolines2::<P>::on_end),
        on_connect_error: Some(Trampolines2::<P>::on_connect_error),
        on_connecting_error: Some(Trampolines2::<P>::on_connecting_error),
        on_handshake: Some(Trampolines2::<P>::on_handshake),
    };
}
