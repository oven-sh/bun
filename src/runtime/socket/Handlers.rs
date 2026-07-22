use core::cell::Cell;
use core::ptr::NonNull;
use std::rc::Rc;

use bun_core::zig_string::Slice as ZigStringSlice;
use bun_jsc::array_buffer::BinaryType;
use bun_jsc::generated::{
    SocketConfig as GeneratedSocketConfig, SocketConfigHandlers as GeneratedSocketConfigHandlers,
};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JSGlobalObject, JSValue, JsResult, Strong};
use bun_sys::Fd;
use bun_uws as uws;

use super::Listener as SocketListener;
use super::SocketMode;
use super::js_socket_handlers::{CALLBACK_COUNT, JSSocketHandlers};
use super::listener::ListenerType;
use super::{SSLConfig, SSLConfigFromJs};

// ─── local shims (upstream-crate gaps) ──────────────────────────────────────
unsafe extern "C" {
    safe fn AsyncContextFrame__withAsyncContextIfNeeded(
        global: &JSGlobalObject,
        callback: JSValue,
    ) -> JSValue;
}

bun_output::declare_scope!(Listener, visible);

/// The callbacks and lifecycle bookkeeping shared by a listener and every
/// socket it accepts, or by one `Bun.connect` socket and its reconnects.
///
/// Held as `Rc<Handlers>` by each owner (the `Listener`, each `NewSocket`, and
/// each in-flight callback [`Scope`]), so a socket that closes while a callback
/// frame still holds it cannot free it out from under that frame.
pub struct Handlers {
    /// The cell holding every callback and the pending connect promise. Read
    /// via the named accessors ([`on_data`](Self::on_data), ...); `reload`
    /// rewrites it in place via [`apply_reload`](Self::apply_reload).
    ///
    /// See [`JSSocketHandlers`] for what keeps it alive; entry points that
    /// build a `Handlers` hold a [`root_cell`](Self::root_cell) handle until
    /// the first JS wrapper stores it.
    cell: JSSocketHandlers,

    pub binary_type: Cell<BinaryType>,

    pub vm: &'static VirtualMachine,
    pub global_object: GlobalRef,
    /// Live sockets plus in-flight callback [`Scope`]s. Drives the listener's
    /// idle release; ownership itself is the `Rc`.
    pub active_connections: Cell<u32>,
    pub mode: SocketMode,
    /// The listener that accepted these sockets, for `mode == Server`.
    ///
    /// Deliberately a nullable raw pointer and not a `BackRef`: a `BackRef`
    /// promises the pointee outlives the holder, and this one does not. Every
    /// accepted socket holds an `Rc<Handlers>` that routinely outlives the
    /// `Listener` (uws defers the close of a force-closed socket past
    /// `Listener::deinit`). What keeps it sound is that `deinit` clears this
    /// field before freeing itself — so reads must go through [`listener`] and
    /// handle `None`.
    ///
    /// [`listener`]: Self::listener
    listener: Cell<Option<NonNull<SocketListener>>>,
}

/// Output of [`Handlers::prepare_reload`]: everything `reload` needs, parsed
/// and validated before any `Handlers` is touched.
pub struct ReloadedHandlers {
    callbacks: [JSValue; CALLBACK_COUNT],
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
    /// The cell, to store in the listener / socket JS wrappers' visited
    /// `handlers` slot so the callbacks stay reachable from every object that
    /// can still invoke them.
    #[inline]
    pub fn cell(&self) -> JSValue {
        self.cell.to_js()
    }

    /// Roots the cell until the returned handle drops. Entry points that
    /// construct a `Handlers` hold one across the window between the cell's
    /// creation and the first JS wrapper that stores it — user JS (option
    /// getters, `SSLConfig` parsing) and JSC allocations run in that window.
    #[inline]
    #[must_use = "the cell is collectable as soon as this drops"]
    pub fn root_cell(&self, global: &JSGlobalObject) -> Strong {
        self.cell.root(global)
    }

    /// Records the listener that accepted these sockets (server mode only), or
    /// clears it as that listener frees itself.
    pub fn set_listener(&self, listener: Option<NonNull<SocketListener>>) {
        debug_assert!(self.mode == SocketMode::Server || listener.is_none());
        self.listener.set(listener);
    }

    /// The accepting listener, or `None` for client-mode handlers and for a
    /// listener already torn down by `Listener::deinit`.
    pub fn listener(&self) -> Option<&SocketListener> {
        // SAFETY: `Listener::listen` stores its `heap::into_raw` allocation root
        // here, and `Listener::deinit` clears it before freeing that allocation
        // (after force-closing every accepted socket), so a `Some` is live. The
        // borrow cannot outlive `&self`, and nothing frees a `Listener` while a
        // caller holds one — `deinit` runs from GC finalize, not from dispatch.
        self.listener.get().map(|l| unsafe { &*l.as_ptr() })
    }

    pub fn on_open(&self) -> JSValue {
        self.cell.on_open()
    }
    pub fn on_close(&self) -> JSValue {
        self.cell.on_close()
    }
    pub fn on_data(&self) -> JSValue {
        self.cell.on_data()
    }
    pub fn on_writable(&self) -> JSValue {
        self.cell.on_writable()
    }
    pub fn on_timeout(&self) -> JSValue {
        self.cell.on_timeout()
    }
    pub fn on_connect_error(&self) -> JSValue {
        self.cell.on_connect_error()
    }
    pub fn on_end(&self) -> JSValue {
        self.cell.on_end()
    }
    pub fn on_error(&self) -> JSValue {
        self.cell.on_error()
    }
    pub fn on_handshake(&self) -> JSValue {
        self.cell.on_handshake()
    }
    pub fn on_session(&self) -> JSValue {
        self.cell.on_session()
    }
    pub fn on_keylog(&self) -> JSValue {
        self.cell.on_keylog()
    }
    pub fn on_server_name(&self) -> JSValue {
        self.cell.on_server_name()
    }
    pub fn on_alpn_callback(&self) -> JSValue {
        self.cell.on_alpn_callback()
    }

    /// Drops the `open` callback for every holder of this `Handlers` — a client
    /// socket does this after its first TLS handshake so renegotiations do not
    /// fire it again.
    pub fn clear_on_open(&self) {
        self.cell.clear_on_open(&self.global_object);
    }

    /// Wraps each provided callback with the current async context so it
    /// dispatches in the right `AsyncLocalStorage` state. Runs before the cell
    /// exists (create) or before any write to a live cell (reload).
    fn wrap_with_context(
        global_object: &JSGlobalObject,
        callbacks: &[JSValue; CALLBACK_COUNT],
    ) -> [JSValue; CALLBACK_COUNT] {
        callbacks.map(|value| {
            if value.is_empty() {
                JSValue::ZERO
            } else {
                AsyncContextFrame__withAsyncContextIfNeeded(global_object, value)
            }
        })
    }

    /// Stores the pending `Bun.connect` promise in the cell. Rooted by the cell
    /// like the callbacks, so settling it is the only release needed.
    pub fn set_promise(&self, global_object: &JSGlobalObject, promise: JSValue) {
        self.cell.set_promise(global_object, promise);
    }

    /// Takes the pending connect promise, detaching it from the cell.
    pub fn take_promise(&self) -> Option<JSValue> {
        self.cell.take_promise(&self.global_object)
    }

    pub fn mark_active(&self) {
        bun_output::scoped_log!(Listener, "markActive");
        self.active_connections
            .set(self.active_connections.get() + 1);
    }

    /// Bumps `active_connections`, enters the JS event-loop scope, and returns
    /// a [`Scope`] whose exit halves undo both. The scope holds its own `Rc`, so
    /// a socket that closes and drops its reference mid-callback cannot free
    /// the `Handlers` the callback is still reading from.
    #[inline]
    pub fn enter(self: &Rc<Self>) -> Scope {
        self.mark_active();
        self.vm.event_loop_ref().enter();
        Scope {
            handlers: Rc::clone(self),
        }
    }

    // corker: Corker = .{},

    pub fn resolve_promise(&self, value: JSValue) -> JsResult<()> {
        let vm = self.vm;
        if vm.is_shutting_down() {
            return Ok(());
        }

        let Some(promise) = self.take_promise() else {
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

        let Some(promise) = self.take_promise() else {
            return Ok(false);
        };
        let Some(any_promise) = promise.as_any_promise() else {
            return Ok(false);
        };
        any_promise.reject(&self.global_object, value)?;
        Ok(true)
    }

    /// Drops one `active_connections` reference. Returns true once none are
    /// left and this is not a listener's `Handlers` — the socket's cue to drop
    /// its own `Rc` so a later dispatch sees no handlers rather than a stale
    /// callback table. Freeing is the `Rc`'s job, not this function's.
    pub fn mark_inactive(&self) -> bool {
        bun_output::scoped_log!(Listener, "markInactive");
        let remaining = self.active_connections.get() - 1;
        self.active_connections.set(remaining);
        if remaining != 0 {
            return false;
        }
        if self.mode != SocketMode::Server {
            return true;
        }
        // Nothing to release once the process is exiting, and the listener's
        // JS wrapper may already be gone.
        if self.vm.is_shutting_down() {
            return false;
        }
        // Let the listener's JS wrapper be GC'd once the last connection is
        // closed and it's not listening anymore. The listener's poll_ref is
        // released in do_stop; accepted sockets manage their own.
        if let Some(listener) = self.listener() {
            if matches!(listener.listener.get(), ListenerType::None) {
                listener.this_value.with_mut(|r| r.downgrade());
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
        // Termination raised inside the preceding callback.call() cannot be
        // cleared; entering JS again trips executeCallImpl's assertNoException.
        if global_object.has_exception() {
            return false;
        }
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
        mode: SocketMode,
    ) -> JsResult<Rc<Handlers>> {
        let generated = GeneratedSocketConfigHandlers::from_js(global_object, opts)?;
        Self::from_generated(global_object, &generated, mode)
    }

    pub fn from_generated(
        global_object: &JSGlobalObject,
        generated: &GeneratedSocketConfigHandlers,
        mode: SocketMode,
    ) -> JsResult<Rc<Handlers>> {
        let callbacks = Self::validate_callbacks(global_object, generated)?;
        let wrapped = Self::wrap_with_context(global_object, &callbacks);

        // Everything fallible is done; the cell is infallible, so a constructed
        // `Handlers` is always fully initialized.
        Ok(Rc::new(Handlers {
            cell: JSSocketHandlers::create(global_object, &wrapped),
            binary_type: Cell::new(binary_type_from_generated(generated.binary_type)),
            // SAFETY: `bun_vm()` never returns null for a Bun-owned global; the
            // VM outlives every `Handlers` (process-lifetime singleton).
            vm: global_object.bun_vm(),
            global_object: GlobalRef::from(global_object),
            active_connections: Cell::new(0),
            mode,
            listener: Cell::new(None),
        }))
    }

    /// Validates the user-supplied callbacks without constructing or storing
    /// anything. Callbacks the user did not provide come back as
    /// `JSValue::ZERO`. Array order matches `Bun::JSSocketHandlers::Field`.
    fn validate_callbacks(
        global_object: &JSGlobalObject,
        generated: &GeneratedSocketConfigHandlers,
    ) -> JsResult<[JSValue; CALLBACK_COUNT]> {
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
    /// and every live socket sharing it pick them up in place. Runs no user JS.
    pub fn apply_reload(&self, global_object: &JSGlobalObject, reloaded: &ReloadedHandlers) {
        let wrapped = Self::wrap_with_context(global_object, &reloaded.callbacks);
        self.cell.set_callbacks(global_object, &wrapped);
        self.binary_type.set(reloaded.binary_type);
    }
}

/// One in-flight dispatch into JS. Holds an `Rc` so the callbacks it is about
/// to invoke outlive a `close()` from inside them.
pub struct Scope {
    pub handlers: Rc<Handlers>,
}

impl Scope {
    /// The event-loop `exit()` half, balancing the `enter()` in
    /// [`Handlers::enter`]. Split from the `active_connections` bookkeeping
    /// because draining microtasks here can synchronously reconnect or
    /// `upgradeTLS` the socket, so the caller must observe the resulting
    /// `handlers` state before deciding whether to decrement.
    pub fn exit_event_loop(&self) {
        self.handlers.vm.event_loop_ref().exit();
    }

    /// The `active_connections` half: decrements and, on reaching zero,
    /// releases the listener (server mode). Returns true when the socket
    /// should drop its own `Rc` — see [`Handlers::mark_inactive`].
    ///
    /// Consumes `self`: a `Scope` is single-use (one `enter` ↔ one exit).
    pub fn mark_inactive(self) -> bool {
        self.handlers.mark_inactive()
    }
}

use bun_jsc::generated::SocketConfigHandlersBinaryType as GeneratedBinaryType;

pub struct SocketConfig {
    pub hostname_or_unix: ZigStringSlice,
    pub port: Option<u16>,
    pub fd: Option<Fd>,
    pub ssl: Option<SSLConfig>,
    pub handlers: Rc<Handlers>,
    pub default_data: JSValue,
    pub exclusive: bool,
    pub allow_half_open: bool,
    pub reuse_port: bool,
    pub ipv6_only: bool,
}

impl SocketConfig {
    // Full teardown is handled by Drop (all owned fields impl Drop).

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
        vm: &'static VirtualMachine,
        global: &JSGlobalObject,
        generated: &GeneratedSocketConfig,
        mode: SocketMode,
    ) -> JsResult<SocketConfig> {
        let mut result: SocketConfig = 'blk: {
            let ssl: Option<SSLConfig> = match &generated.tls {
                GeneratedTls::None => None,
                GeneratedTls::Boolean(b) => {
                    if *b {
                        Some(super::tls_true_defaults(vm))
                    } else {
                        None
                    }
                }
                GeneratedTls::Object(ssl) => SSLConfig::from_generated(vm, global, ssl)?,
            };
            break 'blk SocketConfig {
                hostname_or_unix: ZigStringSlice::empty(),
                port: None,
                fd: generated.fd.map(Fd::from_uv),
                ssl,
                handlers: Handlers::from_generated(global, &generated.handlers, mode)?,
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
        mode: SocketMode,
    ) -> JsResult<SocketConfig> {
        let generated = GeneratedSocketConfig::from_js(global_object, opts)?;
        Self::from_generated(vm, global_object, &generated, mode)
    }
}

use bun_jsc::generated::SocketConfigTls as GeneratedTls;
