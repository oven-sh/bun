//! Rust view of `Bun::JSSocketHandlers` (`src/jsc/bindings/JSSocketHandlers.cpp`):
//! a GC-visited internal-fields cell holding a socket context's JS callbacks
//! and its pending `Bun.connect` promise.
//!
//! The cell is what keeps those values alive. It is stored in the visited
//! `handlers` slot of the listener's JS wrapper and of every socket's wrapper,
//! so the callbacks live exactly as long as something that can still invoke
//! them — no `gcProtect` bookkeeping to unbalance.

use bun_jsc::{JSGlobalObject, JSValue, Strong};

unsafe extern "C" {
    /// Allocates the cell with the callback fields populated barrier-free
    /// (the cell is not yet GC-visible); the promise field starts `undefined`.
    safe fn Bun__SocketHandlers__create(
        global: &JSGlobalObject,
        callbacks: *const JSValue,
    ) -> JSValue;
    /// `cell` must come from [`Bun__SocketHandlers__create`]; `index` must be
    /// < `numberOfInternalFields` (asserted in debug C++).
    safe fn Bun__SocketHandlers__getField(cell: JSValue, index: u32) -> JSValue;
    safe fn Bun__SocketHandlers__setField(
        global: &JSGlobalObject,
        cell: JSValue,
        index: u32,
        value: JSValue,
    );
    /// Overwrites all callback fields on a live cell with one trailing
    /// write barrier.
    safe fn Bun__SocketHandlers__setCallbacks(
        global: &JSGlobalObject,
        cell: JSValue,
        callbacks: *const JSValue,
    );
}

/// A field of the cell. Discriminants are ABI shared with
/// `Bun::JSSocketHandlers::Field` in `src/jsc/bindings/JSSocketHandlers.h`.
/// An implementation detail of this module: callers name fields through the
/// accessors below.
#[repr(u32)]
#[derive(Clone, Copy)]
enum Field {
    Open = 0,
    Close,
    Data,
    Writable,
    Timeout,
    ConnectError,
    End,
    Error,
    Handshake,
    Session,
    Keylog,
    ServerName,
    AlpnCallback,
    OcspRequest,
    OcspResponse,
    /// Not a callback: the pending `Bun.connect` promise, cleared once settled.
    Promise,
}

/// Number of callback fields (everything before `Promise`). Matches
/// `Bun::JSSocketHandlers::numberOfCallbacks`.
pub const CALLBACK_COUNT: usize = Field::Promise as usize;

/// A `Bun::JSSocketHandlers` cell.
///
/// Unrooted: a `JSSocketHandlers` is only valid while some JS wrapper holds it
/// in a visited slot, or while a [`root`](Self::root) handle is alive. It is
/// `Copy` because it is just the cell's `JSValue`.
#[derive(Clone, Copy)]
pub struct JSSocketHandlers(JSValue);

/// Defines a getter per callback field.
macro_rules! callback_getters {
    ($($name:ident => $field:ident),* $(,)?) => {
        $(
            /// The callback, or `JSValue::ZERO` if unset.
            #[inline]
            pub fn $name(self) -> JSValue {
                self.get(Field::$field)
            }
        )*
    };
}

impl JSSocketHandlers {
    /// Allocates the cell with `callbacks` stored via the barrier-free
    /// early-init path. `JSValue::ZERO` entries are stored as `undefined`.
    pub fn create(global: &JSGlobalObject, callbacks: &[JSValue; CALLBACK_COUNT]) -> Self {
        Self(Bun__SocketHandlers__create(global, callbacks.as_ptr()))
    }

    /// The cell as a `JSValue`, to store in a wrapper's visited slot.
    #[inline]
    pub fn to_js(self) -> JSValue {
        self.0
    }

    /// Roots the cell until the returned handle drops. Callers hold one across
    /// the window between creating the cell and the first JS wrapper that
    /// stores it in a visited slot: option getters run user JS in that window,
    /// and the only copy of the cell lives in a heap-allocated `Handlers`, which
    /// the GC does not scan. Conservative stack scanning happens to cover the
    /// current call shapes, which is why nothing observably breaks without this
    /// — that is not a guarantee the compiler owes us.
    #[inline]
    #[must_use = "the cell is collectable as soon as this drops"]
    pub fn root(self, global: &JSGlobalObject) -> Strong {
        Strong::create(self.0, global)
    }

    callback_getters! {
        on_open => Open,
        on_close => Close,
        on_data => Data,
        on_writable => Writable,
        on_timeout => Timeout,
        on_connect_error => ConnectError,
        on_end => End,
        on_error => Error,
        on_handshake => Handshake,
        on_session => Session,
        on_keylog => Keylog,
        on_server_name => ServerName,
        on_alpn_callback => AlpnCallback,
        on_ocsp_request => OcspRequest,
        on_ocsp_response => OcspResponse,
    }

    /// Replaces every callback on a live cell. `JSValue::ZERO` entries clear
    /// the field, so `socket.reload()` also drops callbacks the new options
    /// omit. One write barrier for the whole batch.
    pub fn set_callbacks(self, global: &JSGlobalObject, callbacks: &[JSValue; CALLBACK_COUNT]) {
        Bun__SocketHandlers__setCallbacks(global, self.0, callbacks.as_ptr());
    }

    /// Drops the `open` callback: a client socket clears it after its first TLS
    /// handshake so renegotiations do not fire it again.
    #[inline]
    pub fn clear_on_open(self, global: &JSGlobalObject) {
        self.set(global, Field::Open, JSValue::ZERO);
    }

    /// Stores the pending `Bun.connect` promise.
    #[inline]
    pub fn set_promise(self, global: &JSGlobalObject, promise: JSValue) {
        self.set(global, Field::Promise, promise);
    }

    /// Takes the pending connect promise and detaches it from the cell, so a
    /// settled promise — which resolves to the socket's JS wrapper, the object
    /// holding this very cell — is not kept alive by the connection it
    /// completed.
    pub fn take_promise(self, global: &JSGlobalObject) -> Option<JSValue> {
        let promise = self.get(Field::Promise);
        if promise.is_empty() {
            return None;
        }
        self.set(global, Field::Promise, JSValue::ZERO);
        Some(promise)
    }

    /// Reads a field. Unset fields (stored as `undefined`) read back as
    /// `JSValue::ZERO` so call sites keep their `is_empty()` checks.
    #[inline]
    fn get(self, field: Field) -> JSValue {
        let value = Bun__SocketHandlers__getField(self.0, field as u32);
        if value.is_undefined() {
            JSValue::ZERO
        } else {
            value
        }
    }

    /// Writes a field. `JSValue::ZERO` clears it.
    #[inline]
    fn set(self, global: &JSGlobalObject, field: Field, value: JSValue) {
        let value = if value.is_empty() {
            JSValue::UNDEFINED
        } else {
            value
        };
        Bun__SocketHandlers__setField(global, self.0, field as u32, value);
    }
}
