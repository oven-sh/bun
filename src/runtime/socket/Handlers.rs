use core::cell::Cell;

use bun_core::zig_string::Slice as ZigStringSlice;
use bun_jsc::array_buffer::BinaryType;
use bun_jsc::generated::{
    SocketConfig as GeneratedSocketConfig, SocketConfigHandlers as GeneratedSocketConfigHandlers,
};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JSGlobalObject, JSValue, JsCell, JsResult, StrongOptional as Strong};
use bun_sys::Fd;
use bun_uws as uws;

use super::Listener as SocketListener;
use super::SocketMode;
use super::listener::ListenerType;
use super::{SSLConfig, SSLConfigFromJs};

// ─── local shims (upstream-crate gaps) ──────────────────────────────────────
unsafe extern "C" {
    safe fn AsyncContextFrame__withAsyncContextIfNeeded(
        global: &JSGlobalObject,
        callback: JSValue,
    ) -> JSValue;
    /// Allocates the GC-visited `Bun::JSSocketHandlers` internal-fields cell
    /// (`src/jsc/bindings/JSSocketHandlers.cpp`). Fields start as `undefined`.
    safe fn Bun__SocketHandlers__create(global: &JSGlobalObject) -> JSValue;
    /// `cell` must be a value returned by [`Bun__SocketHandlers__create`];
    /// `index` must be < [`CALLBACK_FIELD_COUNT`] (asserted in debug C++).
    safe fn Bun__SocketHandlers__getField(cell: JSValue, index: u32) -> JSValue;
    safe fn Bun__SocketHandlers__setField(
        global: &JSGlobalObject,
        cell: JSValue,
        index: u32,
        value: JSValue,
    );
}

bun_output::declare_scope!(Listener, visible);

pub struct Handlers {
    /// The `JSSocketHandlers` internal-fields cell
    /// (`src/jsc/bindings/JSSocketHandlers.cpp`) holding every callback as a
    /// GC-visited field, shared by the listener and all of its sockets. Read
    /// via the named accessors ([`on_data`](Self::on_data), ...); written by
    /// [`store_callbacks`](Self::store_callbacks), which `reload` also uses to
    /// update live sockets in place.
    cell: JSValue,
    /// Roots [`cell`](Self::cell) for this struct's lifetime. The listener /
    /// socket JS wrappers also hold the cell in a visited slot, but they may
    /// not exist yet (outgoing connect before `open`, upgraded duplex, named
    /// pipe), so the native owner keeps one RAII handle of its own.
    cell_root: Strong,

    pub binary_type: BinaryType,

    pub vm: &'static VirtualMachine,
    pub global_object: GlobalRef,
    /// `Cell` so [`mark_active`](Self::mark_active) /
    /// [`mark_inactive`](Self::mark_inactive) can mutate through the
    /// `BackRef<Handlers>` every socket holds (see `NewSocket::get_handlers`)
    /// without an `unsafe { &mut * }` reborrow per call site.
    pub active_connections: Cell<u32>,
    pub mode: SocketMode,
    /// `JsCell` so [`resolve_promise`](Self::resolve_promise) /
    /// [`reject_promise`](Self::reject_promise) can `try_swap()` through a
    /// shared `&Handlers` (BackRef Deref). Single-JS-thread; the inner
    /// `Strong` is never borrowed across a reentrant call.
    pub promise: JsCell<Strong>, // Strong.Optional → bun_jsc::Strong (Drop deallocates the slot)
}

/// Index of a callback in the `JSSocketHandlers` cell. The discriminants are
/// ABI shared with `Bun::JSSocketHandlers::Field` in
/// `src/jsc/bindings/JSSocketHandlers.h`.
#[repr(u32)]
#[derive(Clone, Copy)]
pub enum CallbackField {
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
}

pub const CALLBACK_FIELD_COUNT: usize = 13;

/// Validated callback values in [`CallbackField`] order; `JSValue::ZERO` for
/// callbacks the user did not provide.
type ValidatedCallbacks = [JSValue; CALLBACK_FIELD_COUNT];

/// Output of [`Handlers::prepare_reload`]: everything `reload` needs, parsed
/// and validated before any `Handlers` is touched.
pub struct ReloadedHandlers {
    callbacks: ValidatedCallbacks,
    pub binary_type: BinaryType,
}

fn binary_type_from_generated(binary_type: GeneratedBinaryType) -> BinaryType {
    match binary_type {
        GeneratedBinaryType::Arraybuffer => BinaryType::ArrayBuffer,
        GeneratedBinaryType::Buffer => BinaryType::Buffer,
        GeneratedBinaryType::Uint8array => BinaryType::Uint8Array,
    }
}

impl Handlers {
    /// The `JSSocketHandlers` cell. Also stored into the listener / socket JS
    /// wrappers' visited `handlers` slot so the callbacks stay reachable from
    /// every object that can still invoke them.
    #[inline]
    pub fn cell(&self) -> JSValue {
        self.cell
    }

    /// Reads one callback out of the cell. Unset callbacks (stored as
    /// `undefined`) read back as `JSValue::ZERO` so call sites keep their
    /// `is_empty()` checks.
    #[inline]
    fn callback(&self, field: CallbackField) -> JSValue {
        let value = Bun__SocketHandlers__getField(self.cell, field as u32);
        if value.is_undefined() {
            JSValue::ZERO
        } else {
            value
        }
    }

    pub fn on_open(&self) -> JSValue {
        self.callback(CallbackField::Open)
    }
    pub fn on_close(&self) -> JSValue {
        self.callback(CallbackField::Close)
    }
    pub fn on_data(&self) -> JSValue {
        self.callback(CallbackField::Data)
    }
    pub fn on_writable(&self) -> JSValue {
        self.callback(CallbackField::Writable)
    }
    pub fn on_timeout(&self) -> JSValue {
        self.callback(CallbackField::Timeout)
    }
    pub fn on_connect_error(&self) -> JSValue {
        self.callback(CallbackField::ConnectError)
    }
    pub fn on_end(&self) -> JSValue {
        self.callback(CallbackField::End)
    }
    pub fn on_error(&self) -> JSValue {
        self.callback(CallbackField::Error)
    }
    pub fn on_handshake(&self) -> JSValue {
        self.callback(CallbackField::Handshake)
    }
    pub fn on_session(&self) -> JSValue {
        self.callback(CallbackField::Session)
    }
    pub fn on_keylog(&self) -> JSValue {
        self.callback(CallbackField::Keylog)
    }
    pub fn on_server_name(&self) -> JSValue {
        self.callback(CallbackField::ServerName)
    }
    pub fn on_alpn_callback(&self) -> JSValue {
        self.callback(CallbackField::AlpnCallback)
    }

    /// Clears one callback in place for every holder of this `Handlers`
    /// (e.g. a client socket clears `open` after its first TLS handshake so
    /// renegotiations do not fire it again).
    pub fn clear_callback(&self, field: CallbackField) {
        Bun__SocketHandlers__setField(
            &self.global_object,
            self.cell,
            field as u32,
            JSValue::UNDEFINED,
        );
    }

    /// Writes `values` into the cell, wrapping each provided callback with the
    /// current async context. Unset entries clear their field, so `reload`
    /// also drops callbacks the new options omit.
    fn store_callbacks(&self, global_object: &JSGlobalObject, values: &ValidatedCallbacks) {
        for (index, value) in values.iter().enumerate() {
            let stored = if value.is_empty() {
                JSValue::UNDEFINED
            } else {
                AsyncContextFrame__withAsyncContextIfNeeded(global_object, *value)
            };
            Bun__SocketHandlers__setField(global_object, self.cell, index as u32, stored);
        }
    }

    pub fn mark_active(&self) {
        bun_output::scoped_log!(Listener, "markActive");
        self.active_connections
            .set(self.active_connections.get() + 1);
    }

    /// Bumps `active_connections`, enters the JS event-loop scope, and returns
    /// a `Scope` whose `exit()` undoes both.
    ///
    /// Takes `*mut Self` (not `&mut self`) because the matching
    /// [`Scope::exit`] → [`Handlers::mark_inactive`] may **free this
    /// allocation** (client mode, last ref). Storing a `&'a mut Handlers` in
    /// `Scope` would leave a dangling reference after that free; a raw pointer
    /// may dangle so long as it is not dereferenced.
    ///
    /// # Safety
    /// `this` must point to a live `Handlers`. JS-thread only.
    pub unsafe fn enter(this: *mut Self) -> Scope {
        {
            // SAFETY: caller contract — `this` is live; shared reborrow scoped
            // to this block (no protector spans the later free in `exit`).
            let h = unsafe { &*this };
            h.mark_active();
            h.vm.event_loop_ref().enter();
        }
        Scope { handlers: this }
    }

    /// Safe wrapper over [`enter`](Self::enter) for callers that already hold
    /// a [`BackRef<Handlers>`](bun_ptr::BackRef) (i.e. every
    /// `NewSocket::get_handlers()` site). The back-reference invariant
    /// guarantees the pointee is live at call time, discharging `enter`'s
    /// only precondition; JS-thread affinity is the same structural guarantee
    /// every `BackRef<Handlers>` user already relies on (uws dispatch).
    #[inline]
    pub fn enter_ref(h: bun_ptr::BackRef<Self>) -> Scope {
        // SAFETY: BackRef invariant — pointee live and at a stable address
        // for the holder's lifetime, so `h.as_ptr()` is dereferenceable now.
        unsafe { Self::enter(h.as_ptr()) }
    }

    // corker: Corker = .{},

    pub fn resolve_promise(&self, value: JSValue) -> JsResult<()> {
        let vm = self.vm;
        if vm.is_shutting_down() {
            return Ok(());
        }

        let Some(promise) = self.promise.with_mut(|p| p.try_swap()) else {
            return Ok(());
        };
        let Some(any_promise) = promise.as_any_promise() else {
            return Ok(());
        };
        any_promise.resolve(&self.global_object, value)?;
        Ok(())
    }

    pub fn reject_promise(&self, value: JSValue) -> JsResult<bool> {
        let vm = self.vm;
        if vm.is_shutting_down() {
            return Ok(true);
        }

        let Some(promise) = self.promise.with_mut(|p| p.try_swap()) else {
            return Ok(false);
        };
        let Some(any_promise) = promise.as_any_promise() else {
            return Ok(false);
        };
        any_promise.reject(&self.global_object, value)?;
        Ok(true)
    }

    /// Returns true when the client-mode allocation has been destroyed so the
    /// caller can null any `*Handlers` it still holds (the socket's `handlers`
    /// field). Without that, a subsequent `connectInner` reusing the same native
    /// socket as `prev` would `deinit`/`destroy` the freed pointer.
    ///
    /// Takes `*mut Self` (not `&mut self`) because under Stacked Borrows a
    /// `&mut self` argument carries a *protector* for the duration of the
    /// call: deallocating the allocation it points into while that protector
    /// is live is UB. A raw `*mut` carries no protector, and the short-lived
    /// reborrows below all end before the `heap::take`.
    ///
    /// # Safety
    /// - `this` must point to a live `Handlers`.
    /// - Server mode: `this` must address the embedded `Listener.handlers`
    ///   field with whole-`Listener` provenance (for `from_field_ptr!`).
    /// - Client mode: `this` must be the `heap::alloc` allocation root.
    /// - After this returns `true`, `this` is dangling — caller must not
    ///   dereference it and must null any stored copy.
    pub unsafe fn mark_inactive(this: *mut Self) -> bool {
        bun_output::scoped_log!(Listener, "markInactive");
        let (remaining, mode) = {
            // SAFETY: caller contract — `this` is live on entry. Shared reborrow
            // scoped to this block so no `&Handlers` protector spans the
            // `heap::take` in the client branch below.
            let h = unsafe { &*this };
            let remaining = h.active_connections.get() - 1;
            h.active_connections.set(remaining);
            (remaining, h.mode)
        };
        if remaining == 0 {
            if mode == SocketMode::Server {
                // SAFETY: server-mode caller contract — `this` addresses the
                // `handlers` field of a `Listener` with whole-`Listener`
                // provenance. R-2: `Listener.handlers` is `JsCell<Handlers>`
                // (`#[repr(transparent)]`), so the field offset equals the
                // inner `Handlers` address; `from_field_ptr!` arithmetic is
                // unchanged. Deref as shared (`&*`) — celled fields below
                // take `&self`.
                let listen_socket: &SocketListener =
                    unsafe { &*bun_core::from_field_ptr!(SocketListener, handlers, this) };
                // allow it to be GC'd once the last connection is closed and it's not listening anymore
                if matches!(listen_socket.listener.get(), ListenerType::None) {
                    listen_socket
                        .poll_ref
                        .with_mut(|p| p.unref(bun_io::js_vm_ctx()));
                    // `deinit` empties the Strong slot in place; the field stays valid.
                    listen_socket.strong_self.with_mut(|s| s.deinit());
                }
            } else {
                // Client-mode Handlers is heap-allocated per-connection
                // (Listener::connect_inner via `heap::alloc`).
                // Free in place so callers that only hold a `*mut`
                // (and thus can't `drop(Box)`) don't leak the allocation or
                // the cell root it owns. Caller must still null its field
                // when this returns true.
                // SAFETY: client-mode caller contract — `this` is the
                // `heap::alloc` allocation root; no live `&`/`&mut` borrow
                // of it remains (all reborrows above have ended).
                drop(unsafe { bun_core::heap::take(this) });
                return true;
            }
        }
        false
    }

    pub fn call_error_handler(&self, this_value: JSValue, args: &[JSValue; 2]) -> bool {
        let vm = self.vm;
        if vm.is_shutting_down() {
            return false;
        }

        let global_object = self.global_object;
        let on_error = self.on_error();

        if on_error.is_empty() {
            // SAFETY: `bun_vm()` is non-null for a Bun-owned global; single JS thread.
            let _ =
                global_object
                    .bun_vm()
                    .as_mut()
                    .uncaught_exception(&global_object, args[1], false);
            return false;
        }

        if let Err(e) = on_error.call(&global_object, this_value, args) {
            global_object.report_active_exception_as_unhandled(e);
        }

        true
    }

    pub fn from_js(
        global_object: &JSGlobalObject,
        opts: JSValue,
        is_server: bool,
    ) -> JsResult<Handlers> {
        let generated = GeneratedSocketConfigHandlers::from_js(global_object, opts)?;
        Self::from_generated(global_object, &generated, is_server)
    }

    pub fn from_generated(
        global_object: &JSGlobalObject,
        generated: &GeneratedSocketConfigHandlers,
        is_server: bool,
    ) -> JsResult<Handlers> {
        let callbacks = Self::validate_callbacks(global_object, generated)?;

        // Everything fallible is done; the cell and its root are infallible,
        // so a constructed `Handlers` is always fully initialized.
        let cell = Bun__SocketHandlers__create(global_object);
        let mut cell_root = Strong::empty();
        cell_root.set(global_object, cell);

        let result = Handlers {
            cell,
            cell_root,
            binary_type: binary_type_from_generated(generated.binary_type),
            // SAFETY: `bun_vm()` never returns null for a Bun-owned global; the
            // VM outlives every `Handlers` (process-lifetime singleton).
            vm: global_object.bun_vm(),
            global_object: GlobalRef::from(global_object),
            active_connections: Cell::new(0),
            mode: if is_server {
                SocketMode::Server
            } else {
                SocketMode::Client
            },
            promise: JsCell::new(Strong::empty()),
        };
        result.store_callbacks(global_object, &callbacks);
        Ok(result)
    }

    /// Validates the user-supplied callbacks without constructing or storing
    /// anything. Callbacks the user did not provide come back as
    /// `JSValue::ZERO`.
    fn validate_callbacks(
        global_object: &JSGlobalObject,
        generated: &GeneratedSocketConfigHandlers,
    ) -> JsResult<ValidatedCallbacks> {
        macro_rules! validated_callback {
            ($field:ident, $name:literal) => {{
                let value = generated.$field;
                if value.is_undefined_or_null() {
                    JSValue::ZERO
                } else if !value.is_callable() {
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "Expected \"{}\" callback to be a function",
                        $name
                    )));
                } else {
                    value
                }
            }};
        }
        let on_open = validated_callback!(on_open, "onOpen");
        let on_close = validated_callback!(on_close, "onClose");
        let on_data = validated_callback!(on_data, "onData");
        let on_writable = validated_callback!(on_writable, "onWritable");
        let on_timeout = validated_callback!(on_timeout, "onTimeout");
        let on_connect_error = validated_callback!(on_connect_error, "onConnectError");
        let on_end = validated_callback!(on_end, "onEnd");
        let on_error = validated_callback!(on_error, "onError");
        let on_handshake = validated_callback!(on_handshake, "onHandshake");
        let on_session = validated_callback!(on_session, "onSession");
        let on_keylog = validated_callback!(on_keylog, "onKeylog");
        let on_server_name = validated_callback!(on_server_name, "onServerName");
        let on_alpn_callback = validated_callback!(on_alpn_callback, "onALPNCallback");

        if on_data.is_empty() && on_writable.is_empty() {
            return Err(global_object.throw_invalid_arguments(format_args!(
                "Expected at least \"data\" or \"drain\" callback"
            )));
        }

        // [`CallbackField`] order.
        Ok([
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
        ])
    }

    /// Parses and validates `opts` for `reload` without touching any
    /// `Handlers`: the option getters run user JS that can close a socket and
    /// free or repoint its `Handlers`, so callers must re-check liveness
    /// before [`apply_reload`](Self::apply_reload). On error nothing is
    /// modified.
    pub fn prepare_reload(
        global_object: &JSGlobalObject,
        opts: JSValue,
    ) -> JsResult<ReloadedHandlers> {
        let generated = GeneratedSocketConfigHandlers::from_js(global_object, opts)?;
        let callbacks = Self::validate_callbacks(global_object, &generated)?;
        Ok(ReloadedHandlers {
            callbacks,
            binary_type: binary_type_from_generated(generated.binary_type),
        })
    }

    /// Writes the validated callbacks into the existing cell, so the listener
    /// and every live socket sharing it pick them up in place. Runs no user
    /// JS. The caller applies [`ReloadedHandlers::binary_type`] itself with
    /// whatever mutable access it has to this `Handlers`.
    pub fn apply_reload(&self, global_object: &JSGlobalObject, reloaded: &ReloadedHandlers) {
        self.store_callbacks(global_object, &reloaded.callbacks);
    }
}

impl Drop for Handlers {
    fn drop(&mut self) {
        if self.vm.is_shutting_down() {
            // `~VM` may have already torn down the HandleSet that
            // `Strong::drop` writes back into; the slots are bulk-freed by the
            // VM destructor, so leaking them here is correct.
            let _ = core::mem::ManuallyDrop::new(core::mem::replace(
                &mut self.cell_root,
                Strong::empty(),
            ));
            let _ = core::mem::ManuallyDrop::new(self.promise.replace(Strong::empty()));
        }
    }
}

/// Holds a raw `*mut Handlers` (not `&mut`) because [`Scope::exit`] may free
/// the backing allocation (client mode, last ref). A `&mut` field would dangle
/// after that — UB even if never dereferenced. A raw pointer may dangle.
pub struct Scope {
    pub handlers: *mut Handlers,
}

impl Scope {
    /// The event-loop `exit()` half, balancing the `enter()` in
    /// [`Handlers::enter`]. Split from the `active_connections` bookkeeping
    /// because draining microtasks here can synchronously reconnect or
    /// `upgradeTLS` the socket, so the caller must observe the resulting
    /// `handlers` state before deciding whether to decrement/free. Must be
    /// followed by exactly one [`mark_inactive`](Self::mark_inactive), or by
    /// dropping the scope when a new owner took over the handlers.
    pub fn exit_event_loop(&self) {
        // SAFETY: no decrement has run yet, so `handlers` is still live (caller
        // contract of `Handlers::enter`). `event_loop_ref()` returns a non-null
        // self-pointer into the VM; single JS thread, no aliasing `&mut
        // EventLoop` outlives this call.
        unsafe { (*self.handlers).vm }.event_loop_ref().exit();
    }

    /// The `active_connections` half: decrements and, on reaching zero, frees
    /// the client-mode allocation (or releases the listener, server mode).
    /// Returns true if the client-mode allocation was destroyed; callers that
    /// also hold the pointer in a socket field must then null it.
    ///
    /// Consumes `self`: a `Scope` is single-use (one `enter` ↔ one exit), and
    /// after a `true` return `self.handlers` is dangling.
    pub fn mark_inactive(self) -> bool {
        // SAFETY: `handlers` satisfies `mark_inactive`'s contract by
        // construction in `Handlers::enter` (caller passed the
        // server-embedded / client-heap-root pointer).
        unsafe { Handlers::mark_inactive(self.handlers) }
    }

    /// Event-loop exit + `mark_inactive` in one step, for callers that cannot
    /// observe an intervening handlers transfer. Returns true if destroyed.
    pub fn exit(self) -> bool {
        self.exit_event_loop();
        self.mark_inactive()
    }
}

use bun_jsc::generated::SocketConfigHandlersBinaryType as GeneratedBinaryType;

pub struct SocketConfig {
    pub hostname_or_unix: ZigStringSlice,
    pub port: Option<u16>,
    pub fd: Option<Fd>,
    pub ssl: Option<SSLConfig>,
    pub handlers: Handlers,
    pub default_data: JSValue,
    pub exclusive: bool,
    pub allow_half_open: bool,
    pub reuse_port: bool,
    pub ipv6_only: bool,
}

impl SocketConfig {
    // Full teardown is handled by Drop (all owned fields impl Drop).
    // `deinit_excluding_handlers` preserves `handlers` at the same address so
    // outstanding `*Handlers` stay valid.

    /// Deinitializes everything except `handlers`.
    pub fn deinit_excluding_handlers(&mut self) {
        // Drops the owned non-handlers fields in place; `handlers` is left
        // untouched so pointers into it remain valid.
        self.hostname_or_unix = ZigStringSlice::empty();
        self.ssl = None;
        // other scalar fields need no cleanup
    }

    pub fn socket_flags(&self) -> i32 {
        let mut flags: i32 = if self.exclusive {
            uws::LIBUS_LISTEN_EXCLUSIVE_PORT
        } else if self.reuse_port {
            uws::LIBUS_LISTEN_REUSE_PORT | uws::LIBUS_LISTEN_REUSE_ADDR
        } else {
            uws::LIBUS_LISTEN_DEFAULT
        };

        if self.allow_half_open {
            flags |= uws::LIBUS_SOCKET_ALLOW_HALF_OPEN;
        }
        if self.ipv6_only {
            flags |= uws::LIBUS_SOCKET_IPV6_ONLY;
        }

        flags
    }

    pub fn from_generated(
        _vm: &'static VirtualMachine,
        global: &JSGlobalObject,
        generated: &GeneratedSocketConfig,
        is_server: bool,
    ) -> JsResult<SocketConfig> {
        let mut result: SocketConfig = 'blk: {
            let ssl: Option<SSLConfig> = match &generated.tls {
                GeneratedTls::None => None,
                GeneratedTls::Boolean(b) => {
                    if *b {
                        Some(SSLConfig::zero())
                    } else {
                        None
                    }
                }
                GeneratedTls::Object(ssl) => {
                    // SAFETY: `bun_vm()` is non-null for a Bun-owned global; single
                    // JS thread, no aliasing `&mut VirtualMachine` outlives this call.
                    let vm_mut = global.bun_vm().as_mut();
                    SSLConfig::from_generated(vm_mut, global, ssl)?
                }
            };
            break 'blk SocketConfig {
                hostname_or_unix: ZigStringSlice::empty(),
                port: None,
                fd: generated.fd.map(Fd::from_uv),
                ssl,
                handlers: Handlers::from_generated(global, &generated.handlers, is_server)?,
                default_data: if generated.data.is_undefined() {
                    JSValue::ZERO
                } else {
                    generated.data
                },
                exclusive: false,
                allow_half_open: false,
                reuse_port: false,
                ipv6_only: false,
            };
        };
        // On any `?` below, `result` drops and releases what it owns — no
        // manual error-path cleanup needed.

        if result.fd.is_some() {
            // If a user passes a file descriptor then prefer it over hostname or unix
        } else if let Some(unix) = generated.unix_.get() {
            if unix.length() == 0 {
                return Err(global
                    .throw_invalid_arguments(format_args!("Expected a non-empty \"unix\" path")));
            }
            result.hostname_or_unix = unix.to_utf8();
            let slice = result.hostname_or_unix.slice();
            if slice.starts_with(b"file://")
                || slice.starts_with(b"unix://")
                || slice.starts_with(b"sock://")
            {
                let without_prefix = slice[7..].to_vec();
                result.hostname_or_unix = ZigStringSlice::init_owned(without_prefix);
            }
        } else if let Some(hostname) = generated.hostname.get() {
            if hostname.length() == 0 {
                return Err(global
                    .throw_invalid_arguments(format_args!("Expected a non-empty \"hostname\"")));
            }
            result.hostname_or_unix = hostname.to_utf8();
            let slice = result.hostname_or_unix.slice();
            if slice.contains(&0) {
                return Err(global.throw_invalid_arguments(format_args!(
                    "\"hostname\" must not contain null bytes"
                )));
            }
            result.port = Some(match generated.port {
                Some(p) => p,
                None => match bun_url::URL::parse(slice).get_port() {
                    Some(p) => p,
                    None => {
                        return Err(
                            global.throw_invalid_arguments(format_args!("Missing \"port\""))
                        );
                    }
                },
            });
            result.exclusive = generated.exclusive;
            result.allow_half_open = generated.allow_half_open;
            result.reuse_port = generated.reuse_port;
            result.ipv6_only = generated.ipv6_only;
        } else {
            return Err(global.throw_invalid_arguments(format_args!(
                "Expected either \"hostname\" or \"unix\""
            )));
        }
        Ok(result)
    }

    pub fn from_js(
        vm: &'static VirtualMachine,
        opts: JSValue,
        global_object: &JSGlobalObject,
        is_server: bool,
    ) -> JsResult<SocketConfig> {
        let generated = GeneratedSocketConfig::from_js(global_object, opts)?;
        Self::from_generated(vm, global_object, &generated, is_server)
    }
}

use bun_jsc::generated::SocketConfigTls as GeneratedTls;
