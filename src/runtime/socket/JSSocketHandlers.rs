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
    /// Allocates the cell. Fields start as `undefined`.
    safe fn Bun__SocketHandlers__create(global: &JSGlobalObject) -> JSValue;
    /// `cell` must come from [`Bun__SocketHandlers__create`]; `index` must be
    /// < `numberOfInternalFields` (asserted in debug C++).
    safe fn Bun__SocketHandlers__getField(cell: JSValue, index: u32) -> JSValue;
    safe fn Bun__SocketHandlers__setField(
        global: &JSGlobalObject,
        cell: JSValue,
        index: u32,
        value: JSValue,
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
    /// Not a callback: the pending `Bun.connect` promise, cleared once settled.
    Promise,
}

/// The socket callbacks a user passed to `Bun.connect` / `Bun.listen` /
/// `socket.reload()`. `JSValue::ZERO` for any the user did not provide.
#[derive(Clone, Copy)]
pub struct Callbacks {
    pub on_open: JSValue,
    pub on_close: JSValue,
    pub on_data: JSValue,
    pub on_writable: JSValue,
    pub on_timeout: JSValue,
    pub on_connect_error: JSValue,
    pub on_end: JSValue,
    pub on_error: JSValue,
    pub on_handshake: JSValue,
    pub on_session: JSValue,
    pub on_keylog: JSValue,
    pub on_server_name: JSValue,
    pub on_alpn_callback: JSValue,
}

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
    pub fn create(global: &JSGlobalObject) -> Self {
        Self(Bun__SocketHandlers__create(global))
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
    }

    /// Replaces every callback. Fields whose `Callbacks` entry is `JSValue::ZERO`
    /// are cleared, so `socket.reload()` also drops callbacks the new options
    /// omit.
    pub fn set_callbacks(self, global: &JSGlobalObject, callbacks: &Callbacks) {
        let Callbacks {
            on_open,
            on_close,
            on_data,
            on_writable,
            on_timeout,
            on_connect_error,
            on_end,
            on_error,
            on_handshake,
            on_session,
            on_keylog,
            on_server_name,
            on_alpn_callback,
        } = *callbacks;
        self.set(global, Field::Open, on_open);
        self.set(global, Field::Close, on_close);
        self.set(global, Field::Data, on_data);
        self.set(global, Field::Writable, on_writable);
        self.set(global, Field::Timeout, on_timeout);
        self.set(global, Field::ConnectError, on_connect_error);
        self.set(global, Field::End, on_end);
        self.set(global, Field::Error, on_error);
        self.set(global, Field::Handshake, on_handshake);
        self.set(global, Field::Session, on_session);
        self.set(global, Field::Keylog, on_keylog);
        self.set(global, Field::ServerName, on_server_name);
        self.set(global, Field::AlpnCallback, on_alpn_callback);
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
