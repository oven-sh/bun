//! UpgradedDuplex provides TLS/SSL encryption for Node.js-style duplex streams.
//!
//! This is used when you need to add TLS encryption to streams that are not traditional
//! network sockets. In Node.js, you can have duplex streams that represent arbitrary
//! read/write channels - these could be in-memory streams, custom transport protocols,
//! or any other bidirectional data flow that implements the duplex stream interface.
//!
//! Since these duplex streams don't have native SSL support (they're not actual socket
//! file descriptors),
//!
//! The duplex stream manages the SSL handshake, certificate validation, encryption/decryption,
//! and queues its start and its free on Bun's event loop. It maintains
//! JavaScript callbacks for handling connection events and errors.

use core::cell::{Cell, OnceCell};
use core::ffi::c_void;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JSGlobalObject, JSValue, JsCell, JsResult, host_fn};
use bun_ptr::{RefPtr, ThisPtr};
use bun_uws::ssl_wrapper::{self, SSLWrapper};
use bun_uws::{Transport, us_bun_verify_error_t};

use super::TLSSocket;
use crate::dispatch::fold;
use crate::generated_bindgen::socket_body::js_TLSSocket;
use crate::generated_bindgen::upgraded_duplex::{self as listeners, DuplexChunk};

bun_output::declare_scope!(UpgradedDuplex, visible);

/// Live engines, read by `bun:internal-for-testing` leak tests.
pub(crate) static LIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Self::queue_free)]
pub(crate) struct UpgradedDuplex {
    /// One ref for the open connection and one per entry point on the stack ([`Self::keep_alive`]). At zero the `Close` hop frees `self`.
    ref_count: Cell<u32>,
    handle: bun_uws::TransportHandle,
    /// The connection's ref is still held. Cleared by [`Self::take_connection_ref`].
    connection_ref: Cell<bool>,
    /// The socket that hears this engine's events. `None` once it heard its close or its connect error.
    tls: JsCell<Option<RefPtr<TLSSocket>>>,
    task_event: Cell<EventState>,
    /// A `task_event` hop is in the VM's queue. It holds `self` by pointer, so at most one may exist.
    queued: Cell<bool>,
    /// Taken by the `StartTLS` hop.
    ctx: JsCell<Option<bun_boringssl_sys::OwnedSslCtx>>,
    is_open: Cell<bool>,
    is_client: bool,
    server_verify: ServerVerify,
    /// No uSockets group holds this socket, so the context that upgraded it closes it through this owner when it stops.
    abort_handle: bun_jsc::AbortHandle,
    /// That context.
    context: bun_jsc::ContextId,
    /// Set by `start_tls` and freed with `self`: a `handle_traffic` frame can be on the stack when the connection closes.
    wrapper: OnceCell<WrapperType>,
    /// The owning `JSTLSSocket` wrapper. Its `internalFields` root `origin` and
    /// the three listener thunks; the `JSValue` fields below are read-side
    /// shadows of those slots.
    pub js_wrapper: JSValue,
    pub origin: Cell<JSValue>, // any duplex
    // JSC_BORROW per LIFETIMES.tsv.
    pub global: GlobalRef,
    // JSC_BORROW per LIFETIMES.tsv.
    pub vm: &'static VirtualMachine,
    pub on_data_callback: Cell<JSValue>,
    pub on_end_callback: Cell<JSValue>,
    pub on_close_callback: Cell<JSValue>,
    /// Transport bytes that arrived before the TLS engine existed.
    ///
    /// `upgrade_duplex_to_tls` defers `start_tls` to an event-loop task (so
    /// `on_open` cannot re-enter JS before the caller holds the handle), but the
    /// JS caller attaches its `data` listener as soon as that function returns.
    /// When both ends of a `duplexPair()` are wrapped in-process, the peer's
    /// engine starts first and writes its ClientHello while this side's
    /// `wrapper` is still `None`. Dropping those bytes deadlocks the handshake
    /// forever, so stage them here and replay them from
    /// [`Self::drain_pending`] as soon as the engine is up.
    pub pending_data: JsCell<Vec<u8>>,
    /// The transport closed before the TLS engine existed (same window as
    /// [`Self::pending_data`]). Consumed by the queued `StartTLS` task.
    pub pending_close: Cell<bool>,
    /// [`Self::shutdown`] arrived before the engine existed. [`Self::drain_pending`] replays it.
    pub pending_shutdown: Cell<bool>,
    /// `pause_stream` paused the wrapped stream and `resume_stream` has not run since.
    paused_origin: Cell<bool>,
}

type WrapperType = SSLWrapper<*mut UpgradedDuplex>;

/// Server-side peer-certificate policy for a duplex TLS upgrade, resolved in
/// `UpgradeOptions::server_verify` and applied via `SSLWrapper::set_server_verify`.
/// Ignored for client upgrades.
#[derive(Clone, Copy)]
pub(crate) struct ServerVerify {
    /// `requestCert` — whether to send a CertificateRequest at all.
    pub request_cert: bool,
    /// `rejectUnauthorized` — only meaningful when `request_cert` is set.
    pub reject_unauthorized: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum EventState {
    StartTLS,
    Close,
}

/// Lazily create-and-cache a JS host-function callback in `shadow`, mirrored
/// into the owning `JSTLSSocket` wrapper's internal field (the GC
/// root). All three `get_js_handlers` slots follow the identical
/// `NewFunctionWithData(global, null, 0, fn, self)` → `ensureStillAlive` →
/// `setFunctionData(self)` → store pattern.
#[inline]
fn lazy_js_handler(
    shadow: &Cell<JSValue>,
    js_wrapper: JSValue,
    set_slot: fn(JSValue, &JSGlobalObject, JSValue),
    global: &JSGlobalObject,
    func: host_fn::JSHostFn,
    this_ptr: *mut c_void,
) -> JSValue {
    if !shadow.get().is_empty() {
        return shadow.get();
    }
    let callback = host_fn::new_function_with_data(global, None, 0, func, this_ptr);
    callback.ensure_still_alive();
    host_fn::set_function_data(callback, Some(this_ptr));
    set_slot(js_wrapper, global, callback);
    shadow.set(callback);
    callback
}

impl UpgradedDuplex {
    // SAFETY (all handlers): the SSLWrapper handlers ctx is `self as *mut
    // Self`, live for the wrapper's lifetime.

    #[inline]
    fn wrapper_ref(&self) -> Option<&WrapperType> {
        self.wrapper.get()
    }

    /// Holds a ref on `self` until the returned guard drops.
    ///
    /// `self` must not be freed while a frame of this engine is on the
    /// stack. It frees itself from a task that it queues once the connection
    /// has closed and nothing holds it, and a callback only has to turn the
    /// event loop synchronously for queued tasks to run under that frame
    /// (`expect().resolves` does, and so does `Bun.build` with an async
    /// plugin `setup()`). The close can come from the program, the peer or
    /// the engine. An entry point that dispatches to a handler, to the TLS
    /// engine or to the wrapped stream holds this guard, so the free waits
    /// until the entry point is done.
    fn keep_alive(&self) -> RefPtr<Self> {
        debug_assert!(
            self.ref_count.get() > 0,
            "UpgradedDuplex entered after its last ref was released"
        );
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(std::ptr::from_ref(self).cast_mut()) }
    }

    /// A handler or the wrapped stream runs JS, which can close the socket and turn the event loop before it returns.
    #[inline]
    fn debug_assert_kept_alive(&self) {
        debug_assert!(
            self.ref_count.get() > u32::from(self.connection_ref.get()),
            "UpgradedDuplex dispatch with no keep_alive() on the stack"
        );
    }

    /// `self` as the socket handle its `TLSSocket` holds.
    pub(crate) fn socket(&self) -> bun_uws::SocketTLS {
        bun_uws::SocketTLS::from_transport(&raw const self.handle)
    }

    /// The socket to dispatch an event to. Every dispatch runs under an entry point's [`Self::keep_alive`].
    fn listener(&self) -> Option<ThisPtr<TLSSocket>> {
        self.debug_assert_kept_alive();
        self.tls.get().as_ref().map(RefPtr::this_ptr)
    }

    fn on_open(this: *mut Self) {
        bun_output::scoped_log!(UpgradedDuplex, "onOpen");
        // SAFETY: see handler note above.
        let this = unsafe { &*this };
        this.is_open.set(true);
        if let Some(tls) = this.listener() {
            fold(TLSSocket::on_open(tls, this.socket()));
        }
    }

    fn on_data(this: *mut Self, decoded_data: &[u8]) {
        bun_output::scoped_log!(UpgradedDuplex, "onData ({})", decoded_data.len());
        // SAFETY: see handler note above.
        let this = unsafe { &*this };
        if let Some(tls) = this.listener() {
            fold(TLSSocket::on_data(tls, this.socket(), decoded_data));
        }
    }

    fn on_handshake(this: *mut Self, handshake_success: bool, ssl_error: us_bun_verify_error_t) {
        bun_output::scoped_log!(UpgradedDuplex, "onHandshake");
        // SAFETY: see handler note above.
        let this = unsafe { &*this };
        if let Some(tls) = this.listener() {
            fold(TLSSocket::on_handshake(
                tls,
                this.socket(),
                handshake_success as i32,
                ssl_error,
            ));
        }
        // Retry writes parked during the handshake, like openssl.c's `ssl_write_wants_read`.
        if handshake_success
            && !this.is_shutdown()
            && let Some(tls) = this.listener()
        {
            fold(TLSSocket::on_writable(tls, this.socket()));
        }
    }

    fn on_close(this: *mut Self) {
        bun_output::scoped_log!(UpgradedDuplex, "onClose");
        // SAFETY: see handler note above.
        unsafe { &*this }.finish_close();
    }

    fn finish_close(&self) {
        let _keep_alive = self.keep_alive();
        // Keep the wrapper (and so its visited `duplex*` slots) reachable
        // across `TLSSocket::on_close`, which downgrades the socket's own strong
        // self-reference and re-enters JS.
        let js_wrapper = self.js_wrapper;
        js_wrapper.ensure_still_alive();

        // Taken first: `on_close` consumes this ref, and a throw from `duplex.end()` below must not reach the closed socket.
        if let Some(tls) = self.tls.replace(None) {
            fold(TLSSocket::on_close(
                tls.into_this_ptr(),
                self.socket(),
                0,
                None,
            ));
        }
        self.release_connection();
        // closes the underlying duplex
        self.call_write_or_end(None, false);
        // Left paused, a net.Socket transport never reads its peer's FIN and stays open.
        if self.paused_origin.get() {
            self.resume_stream();
        }

        // Early teardown (the `Close` hop drops the struct later).
        self.teardown();
        js_wrapper.ensure_still_alive();
    }

    /// `origin[name]()`. A throw goes to `on_error`. False when the call did not complete.
    fn call_origin(&self, name: &str) -> bool {
        self.debug_assert_kept_alive();
        let duplex = self.origin.get();
        if duplex.is_empty() {
            return false;
        }
        let global = self.global;
        let result = match duplex.get(&global, name) {
            Ok(Some(method)) if method.is_callable() => method.call(&global, duplex, &[]),
            Ok(_) => return false,
            Err(err) => Err(err),
        };
        match result {
            Ok(_) => true,
            Err(err) => {
                self.on_error(global.take_error(err));
                false
            }
        }
    }

    fn call_write_or_end(&self, data: Option<&[u8]>, msg_more: bool) {
        self.debug_assert_kept_alive();
        // No JS duplex to talk to: `teardown` ran, or the owning socket's finalizer abandoned it (`abandon_js_side`).
        let duplex = self.origin.get();
        if duplex.is_empty() {
            return;
        }
        let global = self.global;

        // Teardown-phase bytes (close_notify / the trailing end()) aimed at a
        // duplex whose write side already ended (TLS-inception teardown) only
        // surface a spurious EPIPE - drop them. Ordinary data writes skip the
        // probe so write-after-end still errors like node.
        let teardown = data.is_none() || self.wrapper_ref().is_some_and(|w| w.is_shutdown());
        if teardown {
            // A teardown payload (close_notify) after the transport's readable
            // side ended has no reader behind it: node writes nothing there,
            // and a transport that forwards into an auto-ended net.Socket
            // throws writeAfterFIN (EPIPE). The trailing end() is not a write
            // and still goes through the writableEnded probe below, so a
            // half-open transport sees our FIN.
            if data.is_some() {
                match Self::transport_got_eof(duplex, &global) {
                    Ok(false) => {}
                    Ok(true) => return,
                    Err(err) => {
                        self.on_error(global.take_error(err));
                        return;
                    }
                }
            }
            // Node ends no destroyed stream.
            for property in ["writableEnded", "destroyed"] {
                match duplex.get(&global, property) {
                    Ok(Some(done)) if done.to_boolean() => return,
                    Ok(_) => {}
                    // Best-effort probe: consume the exception and fall through.
                    Err(err) => drop(global.take_exception(err)),
                }
            }
        }

        let name = if msg_more { "write" } else { "end" };
        let write_or_end = match duplex.get(&global, name) {
            Ok(Some(f)) if f.is_callable() => f,
            Ok(_) => return,
            Err(err) => {
                self.on_error(global.take_error(err));
                return;
            }
        };

        if let Some(data) = data {
            let buffer = match bun_jsc::array_buffer::BinaryType::Buffer.to_js(data, &global) {
                Ok(b) => b,
                Err(err) => {
                    self.on_error(global.take_error(err));
                    return;
                }
            };
            buffer.ensure_still_alive();

            if let Err(err) = write_or_end.call(&global, duplex, &[buffer]) {
                self.on_error(global.take_error(err));
            }
        } else {
            if let Err(err) = write_or_end.call(&global, duplex, &[JSValue::NULL]) {
                self.on_error(global.take_error(err));
            }
        }
    }

    /// Not the 'end' event, which a paused transport holds back. No public property tells.
    fn transport_got_eof(duplex: JSValue, global: &JSGlobalObject) -> JsResult<bool> {
        let ended = match duplex.get(global, "_readableState")? {
            Some(state) if state.is_object() => state.get(global, "ended")?,
            _ => None,
        };
        Ok(ended.is_some_and(|ended| ended.to_boolean()))
    }

    fn internal_write(this: *mut Self, encoded_data: &[u8]) -> usize {
        // SAFETY: see handler note above.
        unsafe { &*this }.write_encrypted(encoded_data);
        encoded_data.len()
    }

    fn write_encrypted(&self, encoded_data: &[u8]) {
        // Possible scenarios:
        // Scenario 1: will not write if vm is shutting down (we cannot do anything about it)
        // Scenario 2: will not write if a exception is thrown (will be handled by onError)
        // Scenario 3: will be queued in memory and will be flushed later
        // Scenario 4: no write/end function exists (will be handled by onError)
        self.call_write_or_end(Some(encoded_data), true);
    }

    fn on_internal_receive_data(&self, data: &[u8]) {
        if let Some(w) = self.wrapper_ref() {
            w.receive_data(data);
            return;
        }
        // Engine not up yet - `start_tls` is still queued. Stage the bytes;
        // `drain_pending` feeds them in as soon as the engine is up.
        self.pending_data.with_mut(|p| p.extend_from_slice(data));
    }

    /// Replays the bytes that arrived before the engine existed. [`Self::start_tls`] calls it once the engine is up.
    fn drain_pending(&self) {
        let _keep_alive = self.keep_alive();
        // Nothing to replay, or the engine never came up (the socket died
        // before `StartTLS`). Bail before taking so the bytes are not
        // destroyed by a drain that could not deliver them.
        if self.wrapper_ref().is_none() {
            return;
        }
        if self.pending_data.get().is_empty() {
            self.drain_pending_shutdown();
            return;
        }
        // Taking ownership is load-bearing: a re-entrant `teardown()` clears `pending_data`.
        let staged = self.pending_data.replace(Vec::new());
        if let Some(w) = self.wrapper_ref() {
            w.receive_data(&staged);
        }
        self.drain_pending_shutdown();
    }

    /// After the staged input: a server answers a staged ClientHello before the end().
    fn drain_pending_shutdown(&self) {
        if self.pending_shutdown.replace(false) {
            self.shutdown();
        }
    }

    /// A throw from the wrapped stream, or bytes it delivered in a form TLS can't read.
    fn on_error(&self, err_value: JSValue) {
        if self.is_open.get() {
            if let Some(tls) = self.listener() {
                fold(tls.handle_error(err_value));
                return;
            }
        } else if let Some(tls) = self.tls.replace(None) {
            return self.fail_connect(tls);
        }
        // The socket has closed: uncaught, like what a transport method throws in node.
        let vm = self.vm;
        let _ = vm
            .as_mut()
            .uncaught_exception(vm.global(), err_value, false);
    }

    /// Reports ECONNREFUSED to a socket that never opened. The still-queued `StartTLS` hop then finds no socket to open.
    fn fail_connect(&self, tls: RefPtr<TLSSocket>) {
        self.debug_assert_kept_alive();
        // Neuter the listener thunks while the wrapper is still strongly held.
        self.teardown();
        // `tls.socket` is this engine, so `handle_connect_error` consumes the ref `tls` held.
        fold(TLSSocket::handle_connect_error(
            tls.into_this_ptr(),
            bun_sys::SystemErrno::ECONNREFUSED,
        ));
    }

    /// The connection is over. Returns true the first time: the caller then releases the connection's ref.
    fn take_connection_ref(&self) -> bool {
        if !self.connection_ref.replace(false) {
            return false;
        }
        // Nothing is left for the owning context to close, and its hook would take a ref.
        self.abort_handle.leave();
        true
    }

    /// The transport closed, or `StartTLS` could not start it.
    fn release_connection(&self) {
        if self.take_connection_ref() {
            // SAFETY: `self` is live and the ref released is the connection's.
            unsafe { Self::deref(std::ptr::from_ref(self).cast_mut()) };
        }
    }

    /// The last ref is usually an entry point's guard, which drops while that entry point's `&self` is live: a hop frees `this`.
    fn queue_free(this: *mut Self) {
        // SAFETY: the count just reached zero; `this` is live until that hop runs.
        let this = unsafe { ThisPtr::new(this) };
        debug_assert!(
            !this.queued.get(),
            "UpgradedDuplex released its last ref with a hop still queued"
        );
        this.enqueue(EventState::Close);
    }

    fn enqueue(&self, event: EventState) {
        self.task_event.set(event);
        // An entry that is already in the queue runs the updated `task_event`.
        if !self.queued.replace(true) {
            self.vm
                .event_loop_mut()
                .enqueue_task(bun_jsc::Task::init(std::ptr::from_ref(self).cast_mut()));
        }
    }

    /// Takes `ThisPtr<Self>` because the `Close` hop frees `this`.
    pub(crate) fn run_event(this: ThisPtr<Self>) {
        this.queued.set(false);
        match this.task_event.get() {
            EventState::StartTLS => this.start_tls(),
            // SAFETY: the last ref queued this hop, and no borrow of `*this` is live.
            EventState::Close => drop(unsafe { bun_core::heap::take(this.as_ptr()) }),
        }
    }

    /// Deferred from [`Self::upgrade`], so that `on_open` can't re-enter JS before the caller holds the handle.
    fn start_tls(&self) {
        let _keep_alive = self.keep_alive();
        // A pre-open error took the socket, and no engine exists whose close would release the connection's ref.
        if self.tls.get().is_none() {
            return self.release_connection();
        }
        // The transport closed while this hop was queued: an engine started now could never handshake.
        if self.pending_close.replace(false) {
            return self.finish_close();
        }
        let handlers = self.wrapper_handlers();
        let ctx = self.ctx.take().expect("StartTLS ran twice");
        let w = self
            .wrapper
            .get_or_init(|| WrapperType::init_with_ctx(ctx, self.is_client, handlers));
        w.set_server_verify(
            self.server_verify.request_cert,
            self.server_verify.reject_unauthorized,
        );
        w.start();
        self.drain_pending();
    }

    /// Makes `tls` a TLS socket over the JS stream `origin`. Returns the engine, which frees itself after the close.
    pub(crate) fn upgrade(
        global: &JSGlobalObject,
        context: &bun_jsc::ScriptExecutionContext,
        origin: JSValue,
        tls: RefPtr<TLSSocket>,
        js_wrapper: JSValue,
        ctx: bun_boringssl_sys::OwnedSslCtx,
        is_client: bool,
        server_verify: ServerVerify,
    ) -> ThisPtr<Self> {
        js_TLSSocket::duplex_origin_set_cached(js_wrapper, global, origin);
        let this = bun_core::heap::into_raw(Box::new(UpgradedDuplex {
            ref_count: Cell::new(1),
            handle: Default::default(),
            connection_ref: Cell::new(true),
            tls: JsCell::new(Some(tls)),
            task_event: Cell::new(EventState::StartTLS),
            queued: Cell::new(false),
            ctx: JsCell::new(Some(ctx)),
            is_open: Cell::new(false),
            is_client,
            server_verify,
            abort_handle: bun_jsc::AbortHandle::for_owner::<Self>(),
            context: context.id(),
            vm: global.bun_vm(),
            js_wrapper,
            origin: Cell::new(origin),
            global: GlobalRef::from(global),
            wrapper: OnceCell::new(),
            on_data_callback: Cell::new(JSValue::ZERO),
            on_end_callback: Cell::new(JSValue::ZERO),
            on_close_callback: Cell::new(JSValue::ZERO),
            pending_data: JsCell::new(Vec::new()),
            pending_close: Cell::new(false),
            pending_shutdown: Cell::new(false),
            paused_origin: Cell::new(false),
        }));
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        // SAFETY: nothing frees `this` before the hop queued below runs.
        let engine = unsafe { ThisPtr::new(this) };
        engine.handle.set(this);
        if let Some(tls) = engine.tls.get() {
            tls.ref_();
            tls.socket.set(engine.socket());
            // No poll ref: the stream's events drive this engine, so like node's TLSWrap over a JS stream it doesn't hold the loop open.
            tls.mark_active();
        }
        // SAFETY: fully initialised and heap-pinned; dropping the handle disarms it.
        unsafe { bun_jsc::AbortHandle::arm_owner(this, context) };
        engine.enqueue(EventState::StartTLS);
        engine
    }

    pub(crate) fn get_js_handlers(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let array = JSValue::create_empty_array(global, 3)?;
        array.ensure_still_alive();

        let this_ptr = std::ptr::from_ref(self).cast_mut().cast::<c_void>();
        let js_wrapper = self.js_wrapper;
        array.put_index(
            global,
            0,
            lazy_js_handler(
                &self.on_data_callback,
                js_wrapper,
                js_TLSSocket::duplex_on_data_set_cached,
                global,
                listeners::Bun__UpgradedDuplex__onReceivedData,
                this_ptr,
            ),
        )?;
        array.put_index(
            global,
            1,
            lazy_js_handler(
                &self.on_end_callback,
                js_wrapper,
                js_TLSSocket::duplex_on_end_set_cached,
                global,
                listeners::Bun__UpgradedDuplex__onEnd,
                this_ptr,
            ),
        )?;
        array.put_index(
            global,
            2,
            lazy_js_handler(
                &self.on_close_callback,
                js_wrapper,
                js_TLSSocket::duplex_on_close_set_cached,
                global,
                listeners::Bun__UpgradedDuplex__onCloseJS,
                this_ptr,
            ),
        )?;

        Ok(array)
    }

    fn wrapper_handlers(&self) -> ssl_wrapper::Handlers<*mut UpgradedDuplex> {
        ssl_wrapper::Handlers {
            ctx: std::ptr::from_ref(self).cast_mut(),
            on_open: Self::on_open,
            on_handshake: Self::on_handshake,
            on_data: Self::on_data,
            on_close: Self::on_close,
            write: Self::internal_write,
        }
    }

    /// Runs when the connection closes or fails to open, and again in `Drop`. Idempotent.
    fn teardown(&self) {
        bun_output::scoped_log!(UpgradedDuplex, "deinit");
        if let Some(w) = self.wrapper_ref() {
            w.deinit();
        }

        // A late event of `origin` finds no function data instead of a freed `*mut Self`.
        self.origin.set(JSValue::ZERO);
        for cb in [
            &self.on_data_callback,
            &self.on_end_callback,
            &self.on_close_callback,
        ] {
            let value = cb.get();
            if !value.is_empty() {
                host_fn::set_function_data(value, None);
                cb.set(JSValue::ZERO);
            }
        }
        self.pending_data.set(Vec::new());
        self.pending_close.set(false);
        self.pending_shutdown.set(false);
    }
}

impl Transport for UpgradedDuplex {
    /// See `is_shutdown` for the not-yet-started case.
    fn is_closed(&self) -> bool {
        self.wrapper_ref().is_some_and(|w| w.is_closed())
    }

    /// `None` means `start_tls` has not run yet, not shut down.
    fn is_shutdown(&self) -> bool {
        self.wrapper_ref().is_some_and(|w| w.is_shutdown())
    }

    fn write(&self, data: &[u8]) -> (i32, i32) {
        bun_output::scoped_log!(UpgradedDuplex, "write (len: {})", data.len());
        let _keep_alive = self.keep_alive();
        let written = self
            .wrapper_ref()
            .map_or(0, |w| w.write_data(data).unwrap_or(0));
        (i32::try_from(written).expect("int cast"), 0)
    }

    fn raw_write(&self, encoded_data: &[u8]) -> i32 {
        let _keep_alive = self.keep_alive();
        self.write_encrypted(encoded_data);
        i32::try_from(encoded_data.len()).expect("int cast")
    }

    /// Half-close like `us_internal_ssl_shutdown`: close_notify (none mid-handshake), then end().
    fn shutdown(&self) {
        let _keep_alive = self.keep_alive();
        let Some(w) = self.wrapper_ref() else {
            self.pending_shutdown.set(true);
            return;
        };
        let _ = w.shutdown(false);
        self.call_write_or_end(None, false);
    }

    fn close(&self) {
        let _keep_alive = self.keep_alive();
        let Some(w) = self.wrapper_ref() else {
            // `start_tls` is still queued: no SSL, and no close callback yet.
            self.pending_close.set(true);
            return;
        };
        let _ = w.shutdown(true);
    }

    /// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/js_stream_socket.js#L117-L125
    fn pause_stream(&self) -> bool {
        let _keep_alive = self.keep_alive();
        // Like a connecting fd: `on_open` forgets the owner's pause, so nothing would resume this one.
        let paused = self.wrapper_ref().is_some() && self.call_origin("pause");
        self.paused_origin.set(self.paused_origin.get() || paused);
        paused
    }

    fn resume_stream(&self) -> bool {
        let _keep_alive = self.keep_alive();
        self.paused_origin.set(false);
        self.call_origin("resume")
    }

    fn shutdown_read(&self) {
        if let Some(w) = self.wrapper_ref() {
            w.shutdown_read();
        }
    }

    fn flush(&self) {
        let _keep_alive = self.keep_alive();
        if let Some(w) = self.wrapper_ref() {
            w.flush();
        }
    }

    fn ssl(&self) -> Option<*mut bun_boringssl_sys::SSL> {
        self.wrapper_ref()
            .and_then(|w| w.ssl.get())
            .map(|p| p.as_ptr())
    }

    /// The JS duplex may be dead too, so the SSL shutdown that follows writes no close_notify and ends nothing.
    fn abandon_js_side(&self) {
        self.origin.set(JSValue::ZERO);
    }

    fn write_runs_js(&self) -> bool {
        true
    }
}

impl Drop for UpgradedDuplex {
    fn drop(&mut self) {
        debug_assert_eq!(self.ref_count.get(), 0);
        LIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        self.teardown();
    }
}

// `close` may re-enter (`on_close`) and queue the free of `this`.
bun_jsc::impl_abort_handle_owner!(UpgradedDuplex, abort_handle, |this, _cause| {
    // SAFETY: trait contract: `this` is live (armed, so `Drop` has not run).
    unsafe { &*this }.close()
});

impl bun_event_loop::Taskable for UpgradedDuplex {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::UpgradedDuplex;
    /// The one queued hop will not run. A `StartTLS` that never ran made no engine, so no close detached the socket.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; the single queue entry for `this`.
        let engine = unsafe { ThisPtr::new(this) };
        engine.queued.set(false);
        if let Some(tls) = engine.tls.replace(None) {
            // Neuter the listener thunks while the wrapper is still strongly held.
            engine.teardown();
            // Consumes our ref and detaches the socket, so its finalizer finds nothing to reach into. `Err` is left for the release dispatcher's fold.
            let _ = TLSSocket::on_close(tls.into_this_ptr(), engine.socket(), 0, None);
        }
        // Not `release_connection`: at zero that queues the hop this call stands in for.
        if engine.take_connection_ref() {
            engine.ref_count.set(engine.ref_count.get() - 1);
        }
        // An entry point on the stack still holds it: the release of that ref queues the free.
        if engine.ref_count.get() == 0 {
            // SAFETY: fn contract; nothing holds `this` and no borrow of it is live.
            drop(unsafe { bun_core::heap::take(this) });
        }
    }
    /// The hop continues the script that upgraded the stream: once that context has stopped, `StartTLS` must not run.
    unsafe fn context(this: *const Self) -> bun_event_loop::ContextId {
        // SAFETY: fn contract: the queued engine.
        unsafe { (*this).context }
    }
}

// SAFETY (all three listeners): the function data is the `*mut UpgradedDuplex`
// installed by `get_js_handlers`; `teardown` clears it before the storage is
// freed, so a non-null data pointer is live for the call.

pub(crate) fn on_received_data<'a>(
    cx: &mut JsScope<'a>,
    callee: JsLocal<'a>,
    data: DuplexChunk<'a>,
) {
    bun_output::scoped_log!(UpgradedDuplex, "onReceivedData");

    if let Some(self_ptr) = host_fn::get_function_data(callee.to_js()) {
        // SAFETY: see the note above.
        let this = unsafe { &*self_ptr.cast::<UpgradedDuplex>() };
        let _keep_alive = this.keep_alive();
        if !this.origin.get().is_empty() {
            match data {
                DuplexChunk::None => {}
                // The bytes are copied before a handler of the socket runs.
                DuplexChunk::Bytes(buffer) => buffer.with_bytes(&cx.heap, |payload| {
                    this.on_internal_receive_data(payload);
                }),
                DuplexChunk::Other(_) => {
                    // node.js errors in this case with the same error, lets keep it consistent
                    let error_value = cx
                        .global()
                        .err(
                            bun_jsc::ErrorCode::STREAM_WRAP,
                            format_args!("Stream has StringDecoder set or is in objectMode"),
                        )
                        .to_js();
                    error_value.ensure_still_alive();
                    this.on_error(error_value);
                }
            }
        }
    }
}

pub(crate) fn on_end(_: &mut JsScope<'_>, callee: JsLocal<'_>) {
    bun_output::scoped_log!(UpgradedDuplex, "onEnd");

    if let Some(self_ptr) = host_fn::get_function_data(callee.to_js()) {
        // SAFETY: see the note above.
        let this = unsafe { &*self_ptr.cast::<UpgradedDuplex>() };
        let _keep_alive = this.keep_alive();

        // Like node's JSStreamSocket. Ahead of staged bytes too: no handshake can complete after it.
        if let Some(tls) = this.listener() {
            fold(TLSSocket::on_end(tls, this.socket()));
        }
    }
}

pub(crate) fn on_close_js(_: &mut JsScope<'_>, callee: JsLocal<'_>) {
    bun_output::scoped_log!(UpgradedDuplex, "onCloseJS");

    if let Some(self_ptr) = host_fn::get_function_data(callee.to_js()) {
        // SAFETY: see the note above.
        let this = unsafe { &*self_ptr.cast::<UpgradedDuplex>() };
        // flush pending data
        this.close();
    }
}
