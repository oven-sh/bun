use core::cell::Cell;
use core::mem::offset_of;

use bun_core::zig_string::Slice as ZigStringSlice;
use bun_jsc::array_buffer::BinaryType;
use bun_jsc::generated::{
    SocketConfig as GeneratedSocketConfig, SocketConfigHandlers as GeneratedSocketConfigHandlers,
};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    CallFrame, GlobalRef, JSGlobalObject, JSValue, JsCell, JsResult, StrongOptional as Strong,
};
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
}

/// `bun_jsc::AnyPromise` (the lib.rs stub enum) lacks `resolve`/`reject`; the
/// full impl lives in the gated `bun_jsc::any_promise::AnyPromise`. Shim by
/// dispatching to the underlying `JSPromise` (`JSInternalPromise` subclasses
/// `JSPromise` in C++, so the pointer cast is sound).
trait AnyPromiseExt {
    fn resolve(self, global: &JSGlobalObject, value: JSValue) -> JsResult<()>;
    fn reject(self, global: &JSGlobalObject, value: JSValue) -> JsResult<()>;
}
impl AnyPromiseExt for bun_jsc::AnyPromise {
    fn resolve(self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        let p: *mut bun_jsc::JSPromise = match self {
            bun_jsc::AnyPromise::Normal(p) => p,
            bun_jsc::AnyPromise::Internal(p) => p.cast::<bun_jsc::JSPromise>(),
        };
        // `JSPromise` is an `opaque_ffi!` ZST handle — `opaque_mut` is the
        // const-asserted safe `*mut → &mut` accessor (variants hold a live
        // JSC heap cell from `as_any_promise`).
        Ok(bun_jsc::JSPromise::opaque_mut(p).resolve(global, value)?)
    }
    fn reject(self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        let p: *mut bun_jsc::JSPromise = match self {
            bun_jsc::AnyPromise::Normal(p) => p,
            bun_jsc::AnyPromise::Internal(p) => p.cast::<bun_jsc::JSPromise>(),
        };
        // See `resolve` — `opaque_mut` is the safe ZST-handle accessor.
        Ok(bun_jsc::JSPromise::opaque_mut(p).reject(global, Ok(value))?)
    }
}

bun_output::declare_scope!(Listener, visible);

pub struct Handlers {
    pub on_open: JSValue,
    pub on_close: JSValue,
    pub on_data: JSValue,
    pub on_writable: JSValue,
    pub on_timeout: JSValue,
    pub on_connect_error: JSValue,
    pub on_end: JSValue,
    pub on_error: JSValue,
    pub on_handshake: JSValue,

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

    #[cfg(debug_assertions)]
    // TODO(port): Environment.ci_assert → using debug_assertions as the closest analogue
    pub protection_count: u32,
}

// PORT NOTE: bare JSValue fields are heap-stored here, but Zig keeps them alive via
// JSC protect()/unprotect() (GC roots), not stack scanning — so this is sound.

/// Expands `$body` once per callback field with `$f` bound to the field ident.
/// Mirrors Zig `inline for (callback_fields) |field| { @field(x, field) ... }`.
macro_rules! for_each_callback_field {
    ($self:expr, |$f:ident| $body:block) => {{
        {
            let $f = &mut $self.on_open;
            $body
        }
        {
            let $f = &mut $self.on_close;
            $body
        }
        {
            let $f = &mut $self.on_data;
            $body
        }
        {
            let $f = &mut $self.on_writable;
            $body
        }
        {
            let $f = &mut $self.on_timeout;
            $body
        }
        {
            let $f = &mut $self.on_connect_error;
            $body
        }
        {
            let $f = &mut $self.on_end;
            $body
        }
        {
            let $f = &mut $self.on_error;
            $body
        }
        {
            let $f = &mut $self.on_handshake;
            $body
        }
    }};
}

impl Handlers {
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

    // TODO(port): bun.JSTerminated!void — mapping to JsResult<()> (JsError::Terminated covers it)
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

    // TODO(port): bun.JSTerminated!bool — mapping to JsResult<bool>
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
        // SAFETY: caller contract — `this` is live on entry. Shared reborrow
        // scoped to this block so no `&Handlers` protector spans the
        // `heap::take` in the client branch below.
        let (remaining, mode) = {
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
                    listen_socket.strong_self.with_mut(|s| s.deinit());
                    // PORT NOTE: Zig `strong_self.deinit()` → StrongOptional::deinit; field stays valid (empty)
                }
            } else {
                // Client-mode Handlers is heap-allocated per-connection
                // (Listener::connect_inner via `heap::alloc`). Zig does
                // `this.deinit(); vm.allocator.destroy(this);` here — match
                // that: free in place so callers that only hold a `*mut`
                // (and thus can't `drop(Box)`) don't leak the allocation or
                // its `protect()`ed JSValues. Caller must still null its
                // field when this returns true.
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
        let on_error = self.on_error;

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
        // PORT NOTE: `defer generated.deinit()` — Drop handles it
        Self::from_generated(global_object, &generated, is_server)
    }

    pub fn from_generated(
        global_object: &JSGlobalObject,
        generated: &GeneratedSocketConfigHandlers,
        is_server: bool,
    ) -> JsResult<Handlers> {
        let mut result = Handlers {
            on_open: JSValue::ZERO,
            on_close: JSValue::ZERO,
            on_data: JSValue::ZERO,
            on_writable: JSValue::ZERO,
            on_timeout: JSValue::ZERO,
            on_connect_error: JSValue::ZERO,
            on_end: JSValue::ZERO,
            on_error: JSValue::ZERO,
            on_handshake: JSValue::ZERO,
            binary_type: match generated.binary_type {
                GeneratedBinaryType::Arraybuffer => BinaryType::ArrayBuffer,
                GeneratedBinaryType::Buffer => BinaryType::Buffer,
                GeneratedBinaryType::Uint8array => BinaryType::Uint8Array,
            },
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
            #[cfg(debug_assertions)]
            protection_count: 0,
        };

        // inline for (callback_fields) |field| { ... @field(generated, field) ... }
        macro_rules! assign_callback {
            ($field:ident, $name:literal) => {{
                let value = generated.$field;
                if value.is_undefined_or_null() {
                } else if !value.is_callable() {
                    return Err(global_object.throw_invalid_arguments(format_args!(
                        "Expected \"{}\" callback to be a function",
                        $name
                    )));
                } else {
                    result.$field = value;
                }
            }};
        }
        assign_callback!(on_open, "onOpen");
        assign_callback!(on_close, "onClose");
        assign_callback!(on_data, "onData");
        assign_callback!(on_writable, "onWritable");
        assign_callback!(on_timeout, "onTimeout");
        assign_callback!(on_connect_error, "onConnectError");
        assign_callback!(on_end, "onEnd");
        assign_callback!(on_error, "onError");
        assign_callback!(on_handshake, "onHandshake");

        if result.on_data.is_empty() && result.on_writable.is_empty() {
            return Err(global_object.throw_invalid_arguments(format_args!(
                "Expected at least \"data\" or \"drain\" callback"
            )));
        }
        result.with_async_context_if_needed(global_object);
        result.protect();
        Ok(result)
    }

    fn unprotect(&mut self) {
        if self.vm.is_shutting_down() {
            return;
        }

        #[cfg(debug_assertions)]
        {
            debug_assert!(self.protection_count > 0);
            self.protection_count -= 1;
        }
        self.on_open.unprotect();
        self.on_close.unprotect();
        self.on_data.unprotect();
        self.on_writable.unprotect();
        self.on_timeout.unprotect();
        self.on_connect_error.unprotect();
        self.on_end.unprotect();
        self.on_error.unprotect();
        self.on_handshake.unprotect();
    }

    fn with_async_context_if_needed(&mut self, global_object: &JSGlobalObject) {
        for_each_callback_field!(self, |f| {
            if !f.is_empty() {
                // SAFETY: FFI — `global_object` is a live JSGlobalObject*, `*f` is a
                // protect()-rooted callable JSValue; returns the (possibly wrapped) value.
                *f = AsyncContextFrame__withAsyncContextIfNeeded(global_object, *f);
            }
        });
    }

    fn protect(&mut self) {
        #[cfg(debug_assertions)]
        {
            self.protection_count += 1;
        }
        self.on_open.protect();
        self.on_close.protect();
        self.on_data.protect();
        self.on_writable.protect();
        self.on_timeout.protect();
        self.on_connect_error.protect();
        self.on_end.protect();
        self.on_error.protect();
        self.on_handshake.protect();
    }
}

impl Drop for Handlers {
    fn drop(&mut self) {
        // Zig deinit: unprotect() + promise.deinit() + this.* = undefined
        self.unprotect();
        // `promise: Strong` drops itself.
    }
}

/// Holds a raw `*mut Handlers` (not `&mut`) because [`Scope::exit`] may free
/// the backing allocation (client mode, last ref). A `&mut` field would dangle
/// after that — UB even if never dereferenced. A raw pointer may dangle.
pub struct Scope {
    pub handlers: *mut Handlers,
}

impl Scope {
    /// Returns true if `handlers` was destroyed (client mode, last ref).
    /// Callers that also hold the pointer in a socket field must null it.
    ///
    /// Consumes `self`: a `Scope` is single-use (one `enter` ↔ one `exit`),
    /// and after a `true` return `self.handlers` is dangling, so no further
    /// method may touch it.
    pub fn exit(self) -> bool {
        // SAFETY: `handlers` is live until `mark_inactive` below (caller
        // contract of `Handlers::enter`). `event_loop()` returns a non-null
        // self-pointer into the VM; single JS thread, no aliasing
        // `&mut EventLoop` outlives this call.
        unsafe { (*self.handlers).vm }.event_loop_ref().exit();
        // SAFETY: `handlers` satisfies `mark_inactive`'s contract by
        // construction in `Handlers::enter` (caller passed the
        // server-embedded / client-heap-root pointer).
        unsafe { Handlers::mark_inactive(self.handlers) }
    }
}

// TODO(port): GeneratedBinaryType is the enum in jsc.generated.SocketConfigHandlers.binary_type
use bun_jsc::generated::SocketConfigHandlersBinaryType as GeneratedBinaryType;

/// `handlers` is always `protect`ed in this struct.
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
    // PORT NOTE: Zig `deinit()` → Drop is automatic (all owned fields impl Drop).
    // Zig `deinitExcludingHandlers()` preserves `handlers` at the same address so
    // outstanding `*Handlers` stay valid. Kept as explicit method.

    /// Deinitializes everything except `handlers`.
    pub fn deinit_excluding_handlers(&mut self) {
        // TODO(port): in Zig this writes `undefined` to all non-handlers fields after
        // freeing them, then restores `handlers`. In Rust we drop the owned non-handlers
        // fields in place; `handlers` is left untouched so pointers into it remain valid.
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
        vm: &'static VirtualMachine,
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
            // PORT NOTE: `errdefer bun.memory.deinit(&ssl)` — ssl drops on `?`
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
        // PORT NOTE: `errdefer result.deinit()` — result drops on `?` (Handlers::Drop unprotects)

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
                // PORT NOTE: reshaped for borrowck — drop borrow of slice before reassigning
                result.hostname_or_unix = ZigStringSlice::init_owned(without_prefix);
            }
        } else if let Some(hostname) = generated.hostname.get() {
            if hostname.length() == 0 {
                return Err(global
                    .throw_invalid_arguments(format_args!("Expected a non-empty \"hostname\"")));
            }
            result.hostname_or_unix = hostname.to_utf8();
            let slice = result.hostname_or_unix.slice();
            result.port = Some(match generated.port {
                Some(p) => p,
                None => match bun_url::URL::parse(slice).get_port() {
                    // TODO(port): bun.URL.parse — confirm crate path
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
        // PORT NOTE: `defer generated.deinit()` — Drop handles it
        Self::from_generated(vm, global_object, &generated, is_server)
    }
}

// TODO(port): GeneratedTls is the union(enum) at jsc.generated.SocketConfig.tls
use bun_jsc::generated::SocketConfigTls as GeneratedTls;

// ported from: src/runtime/socket/Handlers.zig
