//! Typed `&self` callback registration for uWS socket handlers.
//!
//! The uWS callback shape is "store `T` behind the socket's ext word, get the
//! word back in an `extern "C"` callback, cast it to a Rust borrow". The
//! existing [`bun_uws_sys::vtable::Handler`] + [`ExtSlot<T>`] pairing already
//! makes registration and recovery agree on `T`, but its recovery
//! ([`ExtSlot::owner_mut`]) hands the handler `&mut T` — an exclusivity claim
//! the handler bodies do not actually need and that re-entrant uWS dispatch
//! (a handler calling back into uWS on the same socket) can violate.
//!
//! [`SharedHandler`] is the `&T` variant: registration is the [`vtable`] you
//! pass to the socket group, recovery is the one trampoline in
//! `Shared::owner`, and the handler bodies are safe `fn(&self, ...)` methods.
//! Mutation goes through the owner's interior-mutability cells.
//!
//! The single `unsafe` for this callback shape is `Shared::owner`.

use core::ffi::{c_int, c_void};
use core::marker::PhantomData;

use bun_uws_sys::socket_group::VTable;
use bun_uws_sys::thunk::ExtSlot;
use bun_uws_sys::vtable::Handler;
use bun_uws_sys::{ConnectingSocket, us_bun_verify_error_t, us_socket_t};

/// A uWS socket handler whose callbacks receive `&self` recovered from the
/// socket's [`ExtSlot<Self>`] ext word.
///
/// Set the `HAS_ON_*` const for each callback you implement; the vtable slot
/// for every other callback is left null so uWS never dispatches it (the
/// default bodies are `unreachable!()`).
///
/// Each callback may also fire before the owner has been stamped into the
/// freshly-`calloc`'d ext slot (the connect/accept window); the dispatch
/// adapter skips the handler call in that case, matching the existing
/// `ExtSlot::owner_mut` consumers.
///
/// A handler body must not free its own allocation mid-call (e.g. by dropping
/// the last refcount on itself) — the `&self` receiver is live for the whole
/// callback. Owners that can die during dispatch must keep using the
/// raw-pointer handler family instead.
pub trait SharedHandler: Sized + 'static {
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

    fn on_open(&self, _s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        unreachable!()
    }
    fn on_data(&self, _s: *mut us_socket_t, _data: &[u8]) {
        unreachable!()
    }
    fn on_fd(&self, _s: *mut us_socket_t, _fd: c_int) {
        unreachable!()
    }
    fn on_writable(&self, _s: *mut us_socket_t) {
        unreachable!()
    }
    fn on_close(&self, _s: *mut us_socket_t, _code: i32, _reason: Option<*mut c_void>) {
        unreachable!()
    }
    fn on_timeout(&self, _s: *mut us_socket_t) {
        unreachable!()
    }
    fn on_long_timeout(&self, _s: *mut us_socket_t) {
        unreachable!()
    }
    fn on_end(&self, _s: *mut us_socket_t) {
        unreachable!()
    }
    fn on_connect_error(&self, _s: *mut us_socket_t, _code: i32) {
        unreachable!()
    }
    /// Fired while the socket is still a `us_connecting_socket_t` (DNS /
    /// happy-eyeballs failure before any concrete socket exists).
    fn on_connecting_error(&self, _c: *mut ConnectingSocket, _code: i32) {
        unreachable!()
    }
    fn on_handshake(&self, _s: *mut us_socket_t, _ok: bool, _err: us_bun_verify_error_t) {
        unreachable!()
    }
}

/// Dispatch adapter: implements the `_sys` [`Handler`] for any
/// [`SharedHandler`], pinning `Ext = ExtSlot<H>` so the socket-group vtable's
/// trampolines recover exactly `&H`.
///
/// The pairing is carried by the type parameter: the `Ext` associated type of
/// `Shared<H>` is `ExtSlot<H>`, so its dispatch methods cannot be handed the
/// ext slot of a socket registered for a different owner type:
///
/// ```compile_fail
/// use bun_uws::shared_handler::{Shared, SharedHandler};
///
/// struct A;
/// impl SharedHandler for A {}
/// struct B;
/// impl SharedHandler for B {}
///
/// fn wrong(ext: &mut bun_uws_sys::thunk::ExtSlot<B>) {
///     // error[E0308]: expected `ExtSlot<A>`, found `ExtSlot<B>`
///     <Shared<A> as bun_uws_sys::vtable::Handler>::on_data(ext, core::ptr::null_mut(), &[]);
/// }
/// ```
pub struct Shared<H>(PhantomData<H>);

impl<H: SharedHandler> Shared<H> {
    /// The uWS callback-shape trampoline: recover `&H` from the ext slot the
    /// socket was registered with, or `None` for the calloc'd-but-not-yet-
    /// stamped window during connect/accept.
    ///
    /// The returned borrow is tied to the ext borrow, which the `_sys`
    /// trampoline layer bounds to the duration of the C callback.
    #[inline(always)]
    fn owner<'a>(ext: &'a ExtSlot<H>) -> Option<&'a H> {
        // SAFETY: type-pairing proof. `ext` is the `ExtSlot<H>` the
        // `vtable::Trampolines<Shared<H>>` layer materialised from the ext
        // storage of a socket whose group was built from `vtable::<H>()` —
        // `Handler::Ext = ExtSlot<H>` is what sized and typed that storage, so
        // the word it holds is either `None` (calloc zero) or the `NonNull<H>`
        // the owner stamped at registration. The pointee outlives the socket
        // (it owns it), and a *shared* borrow is formed, so concurrent `&H`
        // from re-entrant dispatch on the same socket cannot conflict; `H`
        // mutation goes through interior-mutability cells.
        ext.get().map(|p| unsafe { p.as_ref() })
    }
}

impl<H: SharedHandler> Handler for Shared<H> {
    type Ext = ExtSlot<H>;

    const HAS_ON_OPEN: bool = H::HAS_ON_OPEN;
    const HAS_ON_DATA: bool = H::HAS_ON_DATA;
    const HAS_ON_FD: bool = H::HAS_ON_FD;
    const HAS_ON_WRITABLE: bool = H::HAS_ON_WRITABLE;
    const HAS_ON_CLOSE: bool = H::HAS_ON_CLOSE;
    const HAS_ON_TIMEOUT: bool = H::HAS_ON_TIMEOUT;
    const HAS_ON_LONG_TIMEOUT: bool = H::HAS_ON_LONG_TIMEOUT;
    const HAS_ON_END: bool = H::HAS_ON_END;
    const HAS_ON_CONNECT_ERROR: bool = H::HAS_ON_CONNECT_ERROR;
    const HAS_ON_CONNECTING_ERROR: bool = H::HAS_ON_CONNECTING_ERROR;
    const HAS_ON_HANDSHAKE: bool = H::HAS_ON_HANDSHAKE;

    fn on_open(ext: &mut Self::Ext, s: *mut us_socket_t, is_client: bool, ip: &[u8]) {
        if let Some(h) = Self::owner(ext) {
            h.on_open(s, is_client, ip);
        }
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        if let Some(h) = Self::owner(ext) {
            h.on_data(s, data);
        }
    }
    fn on_fd(ext: &mut Self::Ext, s: *mut us_socket_t, fd: c_int) {
        if let Some(h) = Self::owner(ext) {
            h.on_fd(s, fd);
        }
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        if let Some(h) = Self::owner(ext) {
            h.on_writable(s);
        }
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        if let Some(h) = Self::owner(ext) {
            h.on_close(s, code, reason);
        }
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        if let Some(h) = Self::owner(ext) {
            h.on_timeout(s);
        }
    }
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        if let Some(h) = Self::owner(ext) {
            h.on_long_timeout(s);
        }
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        if let Some(h) = Self::owner(ext) {
            h.on_end(s);
        }
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        if let Some(h) = Self::owner(ext) {
            h.on_connect_error(s, code);
        }
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        // The connecting-socket callback carries no pre-recovered ext; read
        // the same `ExtSlot<H>` word off the connecting socket's ext storage
        // (sized for it by the same registration) and recover `&H` through
        // the one trampoline above.
        if let Some(h) = Self::owner(ConnectingSocket::opaque_mut(c).ext::<ExtSlot<H>>()) {
            h.on_connecting_error(c, code);
        }
    }
    fn on_handshake(
        ext: &mut Self::Ext,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        if let Some(h) = Self::owner(ext) {
            h.on_handshake(s, ok, err);
        }
    }
}

/// The registration half of the pairing: a `&'static VTable` whose entries
/// are the `extern "C"` trampolines for `Shared<H>`. Install it on a socket
/// group whose ext storage is sized for `ExtSlot<H>` and stamped with the
/// owning `NonNull<H>`; every callback then recovers `&H` through
/// `Shared::owner`.
pub fn vtable<H: SharedHandler>() -> &'static VTable {
    bun_uws_sys::vtable::make::<Shared<H>>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::cell::Cell;

    /// Example adoption: a handler with interior-mutability state and `&self`
    /// callback bodies. Only the callbacks it declares get a vtable slot.
    struct Sample {
        bytes: Cell<usize>,
    }

    impl SharedHandler for Sample {
        const HAS_ON_DATA: bool = true;
        const HAS_ON_CLOSE: bool = true;

        fn on_data(&self, _s: *mut us_socket_t, data: &[u8]) {
            self.bytes.set(self.bytes.get() + data.len());
        }
        fn on_close(&self, _s: *mut us_socket_t, _code: i32, _reason: Option<*mut c_void>) {}
    }

    #[test]
    fn vtable_populates_only_declared_slots() {
        let vt = vtable::<Sample>();
        assert!(vt.on_data.is_some());
        assert!(vt.on_close.is_some());
        assert!(vt.on_open.is_none());
        assert!(vt.on_writable.is_none());
        assert!(vt.on_timeout.is_none());
        assert!(vt.on_long_timeout.is_none());
        assert!(vt.on_end.is_none());
        assert!(vt.on_connect_error.is_none());
        assert!(vt.on_connecting_error.is_none());
        assert!(vt.on_handshake.is_none());
        assert!(vt.on_fd.is_none());
    }
}
