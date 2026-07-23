use core::cell::Cell;
use core::ffi::c_void;
use core::mem;
use core::ptr::NonNull;

use bun_jsc::JsCell;
use bun_uws::{self as uws, AnyWebSocket, WebSocketBehavior};
use bun_uws_sys::web_socket::{WebSocketHandler, WebSocketUpgradeServer, Wrap};
use bun_uws_sys::{Opcode, SendStatus};

use crate::server::WebSocketServerHandler;
use crate::server::jsc::{
    self, AbortSignal, ArrayBuffer, BinaryType, CallFrame, CommonAbortReason, JSGlobalObject,
    JSType, JSValue, JsError, JsRef, JsResult, ZigStringSlice,
};
use crate::server::web_socket_server_context::HandlerFlags;

bun_output::declare_scope!(WebSocketServer, visible);

// No `'a` on a `.classes.ts` m_ctx payload — the JS wrapper outlives any
// stack frame. The handler lives in `ServerConfig.websocket` for the server's
// lifetime, so a raw back-pointer + SAFETY notes is the runtime shape.
//
// R-2: every uws/JS callback into this socket can re-enter
// — `on_open` → `ws.cork(JS)` → `ws.close()` → `on_close` mutates `flags` /
// `this_value` on the SAME `m_ctx`. A `&mut Self` receiver would alias under
// Stacked Borrows. Receivers therefore take `&self`; per-field interior
// mutability (`Cell` for `Copy` flags/signal, `JsCell` for the non-`Copy`
// `JsRef`) carries the writes.
#[bun_jsc::JsClass]
pub struct ServerWebSocket {
    handler: bun_ptr::BackRef<WebSocketServerHandler>,
    this_value: JsCell<JsRef>,
    flags: Cell<Flags>,
    // `AbortSignal` is an opaque C++ type
    // with intrusive WebCore ref-counting (ref/unref) — never `Arc`. The init
    // caller transfers a +1 ref; `finalize`/`on_close` unref it.
    signal: Cell<Option<NonNull<AbortSignal>>>,
}

// We pack the per-socket data into this struct below:
// ssl:1, closed:1, opened:1, binary_type:4, packed_websocket_ptr:57
#[repr(transparent)]
#[derive(Copy, Clone, Default)]
pub struct Flags(u64);

impl Flags {
    const SSL_BIT: u64 = 1 << 0;
    const CLOSED_BIT: u64 = 1 << 1;
    const OPENED_BIT: u64 = 1 << 2;
    const BINARY_TYPE_SHIFT: u32 = 3;
    const BINARY_TYPE_MASK: u64 = 0b1111 << Self::BINARY_TYPE_SHIFT;
    const PTR_SHIFT: u32 = 7;
    const PTR_MASK: u64 = (1u64 << 57) - 1;

    #[inline]
    pub fn ssl(self) -> bool {
        self.0 & Self::SSL_BIT != 0
    }
    #[inline]
    pub fn set_ssl(&mut self, v: bool) {
        if v {
            self.0 |= Self::SSL_BIT;
        } else {
            self.0 &= !Self::SSL_BIT;
        }
    }
    #[inline]
    pub fn closed(self) -> bool {
        self.0 & Self::CLOSED_BIT != 0
    }
    #[inline]
    pub fn set_closed(&mut self, v: bool) {
        if v {
            self.0 |= Self::CLOSED_BIT;
        } else {
            self.0 &= !Self::CLOSED_BIT;
        }
    }
    #[inline]
    pub fn set_opened(&mut self, v: bool) {
        if v {
            self.0 |= Self::OPENED_BIT;
        } else {
            self.0 &= !Self::OPENED_BIT;
        }
    }
    #[inline]
    pub fn binary_type(self) -> BinaryType {
        // Stored value was written via `set_binary_type` from a valid
        // `BinaryType` discriminant (4-bit field, 14 variants).
        match ((self.0 & Self::BINARY_TYPE_MASK) >> Self::BINARY_TYPE_SHIFT) as u8 {
            0 => BinaryType::Buffer,
            1 => BinaryType::ArrayBuffer,
            2 => BinaryType::Uint8Array,
            3 => BinaryType::Uint8ClampedArray,
            4 => BinaryType::Uint16Array,
            5 => BinaryType::Uint32Array,
            6 => BinaryType::Int8Array,
            7 => BinaryType::Int16Array,
            8 => BinaryType::Int32Array,
            9 => BinaryType::Float16Array,
            10 => BinaryType::Float32Array,
            11 => BinaryType::Float64Array,
            12 => BinaryType::BigInt64Array,
            13 => BinaryType::BigUint64Array,
            // 4-bit field; only `set_binary_type` writes it, so 14/15 indicate
            // memory corruption — trap.
            n => unreachable!("invalid BinaryType {n}"),
        }
    }
    #[inline]
    pub fn set_binary_type(&mut self, v: BinaryType) {
        self.0 = (self.0 & !Self::BINARY_TYPE_MASK)
            | (((v as u8 as u64) << Self::BINARY_TYPE_SHIFT) & Self::BINARY_TYPE_MASK);
    }
    #[inline]
    pub fn packed_websocket_ptr(self) -> u64 {
        (self.0 >> Self::PTR_SHIFT) & Self::PTR_MASK
    }
    #[inline]
    pub fn set_packed_websocket_ptr(&mut self, v: u64) {
        self.0 = (self.0 & !(Self::PTR_MASK << Self::PTR_SHIFT))
            | ((v & Self::PTR_MASK) << Self::PTR_SHIFT);
    }

    #[inline]
    fn websocket(self) -> AnyWebSocket {
        // Ensure those other bits are zeroed out
        let ptr = self.packed_websocket_ptr() as usize as *mut uws::RawWebSocket;
        if self.ssl() {
            // SAFETY: packed_websocket_ptr was set from ws.raw() in on_open; non-null while !closed
            AnyWebSocket::Ssl(ptr)
        } else {
            // SAFETY: same as above
            AnyWebSocket::Tcp(ptr)
        }
    }
}

// Codegen: JSServerWebSocket wrapper cached property accessors.
// `js::data_{get,set}_cached` are emitted by `.classes.ts` codegen
// (`generate-classes.ts` → `${T}__data{Get,Set}Cached`).
#[allow(non_snake_case)]
pub mod js {
    // Emits `{data,server}_{get,set}_cached`. Getter maps `JSValue::ZERO` → `None`;
    // setter forwards through the JSC `WriteBarrier<Unknown>` slot.
    ::bun_jsc::codegen_cached_accessors!("ServerWebSocket"; data, server);
}

/// RFC 6455 §5.5: control frame payloads are at most 125 bytes.
const MAX_CONTROL_FRAME_PAYLOAD: usize = 125;

fn throw_control_frame_too_large(global: &JSGlobalObject, len: usize) -> JsError {
    let err = global.create_range_error_instance(format_args!(
        "The data size must not be greater than {} bytes. Received {} bytes.",
        MAX_CONTROL_FRAME_PAYLOAD, len,
    ));
    global.throw_value(err)
}

/// Maps a uWS `SendStatus` to the JS-visible number contract shared by every
/// `ServerWebSocket` send-ish method (Backpressure → -1, Success → byte_len,
/// Dropped → 0) and emits the matching `WebSocketServer` debug log.
///
/// `len` is the **byte** length actually written — callers holding an
/// `ArrayBuffer` view must pass `buffer.slice().len()`, not the typed-array
/// element count. `suffix` is `"bytes"` or `"bytes string"`.
#[inline]
pub(super) fn send_status_to_js(
    status: SendStatus,
    len: usize,
    op: &'static str,
    suffix: &'static str,
) -> JSValue {
    match status {
        SendStatus::Backpressure => {
            bun_output::scoped_log!(
                WebSocketServer,
                "{}() backpressure ({} {})",
                op,
                len,
                suffix
            );
            JSValue::js_number(-1.0)
        }
        SendStatus::Success => {
            bun_output::scoped_log!(WebSocketServer, "{}() success ({} {})", op, len, suffix);
            JSValue::js_number(len as f64)
        }
        SendStatus::Dropped => {
            bun_output::scoped_log!(WebSocketServer, "{}() dropped ({} {})", op, len, suffix);
            JSValue::js_number(0.0)
        }
    }
}

impl ServerWebSocket {
    #[inline]
    fn websocket(&self) -> AnyWebSocket {
        self.flags.get().websocket()
    }

    /// R-2 helper: read-modify-write the packed `Cell<Flags>` through `&self`.
    /// `Flags` is a `Copy` `u64` so the load/store pair is the same codegen as
    /// the old `&mut self` field write.
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut flags = self.flags.get();
        f(&mut flags);
        self.flags.set(flags);
    }

    /// The handler lives in `ServerConfig.websocket` for the server's lifetime;
    /// non-null while any `ServerWebSocket` exists. All `ServerWebSocket` state
    /// is interior-mutable (`Cell`/`JsCell`), so the borrow tied to `&self`
    /// does not conflict with flag mutation.
    #[inline]
    fn handler(&self) -> &WebSocketServerHandler {
        self.handler.get()
    }

    // ──────────────────────────────────────────────────────────────────────
    // Shared helpers for the publish*/send* family.
    //
    // These collapse duplicated per-method blocks while remaining
    // byte-identical in observable behaviour — including the `args_len > 1`
    // guard on `compress` even when compress is args[2] (long-standing
    // user-visible behavior; do not "fix").
    //
    // A unified `publish_prologue` covering the full callframe header was
    // considered and rejected: publishText omits the empty-topic check and
    // reuses "publish" in its min-args message (both user-visible), so a single
    // prologue would either change user-visible errors or carry per-caller
    // bool flags — net more code than three small orthogonal helpers.
    // ──────────────────────────────────────────────────────────────────────

    /// `(app, ssl, publish_to_self)` from the handler, or `None` when the
    /// server has been torn down (`handler.app == None`). The "publish() closed"
    /// log + `0` return is the caller's responsibility (it varies in nothing,
    /// but keeping it inline preserves the per-method `scoped_log!` callsite).
    #[inline]
    fn publish_ctx(&self) -> Option<(*mut c_void, bool, bool)> {
        let handler = self.handler();
        let app = handler.app?;
        let flags = handler.flags;
        Some((
            app,
            flags.contains(HandlerFlags::SSL),
            flags.contains(HandlerFlags::PUBLISH_TO_SELF),
        ))
    }

    /// Shared `compress` argument validation for publish*/send*. Preserves the
    /// `args.len > 1` guard verbatim (even where compress is `args[2]`).
    #[inline]
    fn parse_compress_arg(
        global_this: &JSGlobalObject,
        fn_name: &'static str,
        compress_value: JSValue,
        args_len: usize,
    ) -> JsResult<bool> {
        if !compress_value.is_boolean()
            && !compress_value.is_undefined()
            && !compress_value.is_empty()
        {
            return Err(
                global_this.throw(format_args!("{fn_name} expects compress to be a boolean"))
            );
        }
        Ok(args_len > 1 && compress_value.to_boolean())
    }

    /// Route a publish through either the per-socket uWS handle (when
    /// `!publish_to_self && !closed`) or the app-wide broadcast, then map the
    /// aggregated `SendStatus` to the JS number contract shared with `send()`.
    #[inline]
    fn do_publish(
        &self,
        ssl: bool,
        app: *mut c_void,
        publish_to_self: bool,
        topic: &[u8],
        buffer: &[u8],
        opcode: Opcode,
        compress: bool,
    ) -> JSValue {
        let status = if !publish_to_self && !self.is_closed() {
            self.websocket().publish(topic, buffer, opcode, compress)
        } else {
            AnyWebSocket::publish_with_options(ssl, app, topic, buffer, opcode, compress)
        };
        send_status_to_js(status, buffer.len(), "publish", "bytes")
    }

    /// Shared body for `subscribe` / `unsubscribe` / `isSubscribed`: identical
    /// arg-count guard, closed short-circuit, string-type guard, UTF-8 slice,
    /// non-empty guard, then dispatch to the uWS topic op. Only the JS-visible
    /// name, the closed-socket return value, and the terminal op differ.
    #[inline]
    fn topic_dispatch(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        fn_name: &'static str,
        closed_ret: JSValue,
        op: impl FnOnce(AnyWebSocket, &[u8]) -> bool,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<1>();
        if args.len < 1 {
            return Err(global_this.throw(format_args!("{fn_name} requires at least 1 argument")));
        }

        if self.is_closed() {
            return Ok(closed_ret);
        }

        if !args.ptr[0].is_string() {
            return Err(global_this.throw_invalid_argument_type_value(
                b"topic",
                b"string",
                args.ptr[0],
            ));
        }

        let topic = args.ptr[0].to_slice(global_this)?;

        if topic.slice().is_empty() {
            return Err(
                global_this.throw(format_args!("{fn_name} requires a non-empty topic name"))
            );
        }

        Ok(JSValue::from(op(self.websocket(), topic.slice())))
    }

    // pub const js = jsc.Codegen.JSServerWebSocket; — provided by #[bun_jsc::JsClass]
    // toJS / fromJS / fromJSDirect — provided by codegen (see `to_js_ptr` / `JsClass` impl)

    /// Initialize a ServerWebSocket with the given handler, data value, and signal.
    /// The signal will not be ref'd inside the ServerWebSocket init function, but will unref itself when the ServerWebSocket is destroyed.
    pub fn init(
        handler: &WebSocketServerHandler,
        data_value: JSValue,
        signal: Option<NonNull<AbortSignal>>,
    ) -> *mut ServerWebSocket {
        let global_object = handler.global_object();
        let this = bun_core::heap::into_raw(Box::new(ServerWebSocket {
            handler: bun_ptr::BackRef::new(handler),
            this_value: JsCell::new(JsRef::empty()),
            flags: Cell::new(Flags::default()),
            signal: Cell::new(signal),
        }));
        // Get a strong ref and downgrade when terminating/close and GC will be able to collect the newly created value
        // SAFETY: `this` was just `heap::alloc`'d; ownership transfers to the
        // C++ JS wrapper (freed via `ServerWebSocketClass__finalize` → `finalize`).
        let this_value = unsafe { ServerWebSocket::to_js_ptr(this, global_object) };
        // SAFETY: just allocated; the JS wrapper holds the box but does not
        // touch the Rust fields concurrently (single JS thread). R-2: shared
        // borrow + `JsCell::set` — no `&mut Self` formed.
        let this_ref = unsafe { &*this };
        this_ref
            .this_value
            .set(JsRef::init_strong(this_value, global_object));
        js::data_set_cached(this_value, global_object, data_value);
        // Both callers route through `on_upgrade`'s `handler.server.is_none()`
        // refusal, so this is normally `Some`; keep the `and_then` as
        // defense-in-depth (option getters between that guard and here can
        // re-enter JS and `stop(true)`, and `js_value_for_dispatch` still
        // returns `None` on `Finalized`).
        if let Some(server_js) = handler.server.and_then(|s| s.js_value_for_dispatch()) {
            js::server_set_cached(this_value, global_object, server_js);
        }
        this
    }

    pub fn memory_cost(&self) -> usize {
        if self.flags.get().closed() {
            return mem::size_of::<ServerWebSocket>();
        }
        self.websocket().memory_cost() + mem::size_of::<ServerWebSocket>()
    }

    /// R-2 (noalias re-entrancy): `&self`, NOT `&mut self`. `ws.cork(...)`
    /// re-enters JS which can `ws.close()` / `ws.send()` on this same socket
    /// via the JS wrapper's `m_ptr`, flipping `flags.closed`. All state lives
    /// behind `Cell`/`JsCell`, so the re-entrant frame's writes are visible
    /// here without aliasing a `noalias` borrow. `handler`/`vm`/`global_object`
    /// are detached `&'a` borrows of the server config (a separate allocation),
    /// so they may legally span the call.
    pub fn on_open(&self, ws: AnyWebSocket) {
        bun_output::scoped_log!(WebSocketServer, "OnOpen");
        self.update_flags(|f| {
            f.set_packed_websocket_ptr(ws.raw() as usize as u64);
            f.set_closed(false);
            f.set_ssl(matches!(ws, AnyWebSocket::Ssl(_)));
        });

        let handler = self.handler();
        let vm = handler.vm();
        // Live-socket accounting lives on the server (`Cell`), reached
        // through the type-erased backref so the shared `&Handler` suffices.
        let server = handler.server;
        if let Some(server) = server {
            server.on_websocket_opened();
        }
        let global_object = handler.global_object();
        let on_open_handler = handler.on_open;
        let on_error = handler.on_error;
        if vm.is_shutting_down() {
            bun_output::scoped_log!(WebSocketServer, "onOpen called after script execution");
            ws.close();
            return;
        }

        self.update_flags(|f| f.set_opened(false));

        if on_open_handler.is_empty_or_undefined_or_null() {
            return;
        }

        let this_value = self
            .this_value
            .get()
            .try_get()
            .unwrap_or(JSValue::UNDEFINED);
        let args = [this_value];

        let _loop_guard = vm.enter_event_loop_scope();

        let mut corker = Corker {
            args: &args,
            global_object,
            this_value: JSValue::ZERO,
            callback: on_open_handler,
            result: JSValue::ZERO,
        };
        ws.cork(&mut corker, Corker::run);
        let result = corker.result;
        self.update_flags(|f| f.set_opened(true));
        if let Some(err_value) = result.to_error() {
            bun_output::scoped_log!(WebSocketServer, "onOpen exception");

            let mut closed_here = false;
            if !self.flags.get().closed() {
                self.update_flags(|f| f.set_closed(true));
                // we un-gracefully close the connection if there was an exception
                // we don't want any event handlers to fire after this for anything other than error()
                // https://github.com/oven-sh/bun/issues/1480
                // (`close()` re-enters `on_close`, which skips its own
                // accounting because the closed flag is already set.)
                self.websocket().close();
                closed_here = true;
                this_value.unprotect();
            }

            handler.run_error_callback(on_error, vm, global_object, err_value);
            if closed_here {
                if let Some(server) = server {
                    // May run the idle pass; no `&Handler` borrow is live here.
                    server.on_websocket_closed();
                }
            }
        }
    }

    /// `&self` for the same noalias-reentry reason as `on_open` (R-2).
    pub fn on_message(&self, ws: AnyWebSocket, message: &[u8], opcode: Opcode) {
        bun_output::scoped_log!(
            WebSocketServer,
            "onMessage({}): {}",
            opcode.0,
            bstr::BStr::new(message)
        );
        let on_message_handler = self.handler().on_message;
        let on_error = self.handler().on_error;
        if on_message_handler.is_empty_or_undefined_or_null() {
            return;
        }
        let global_object = self.handler().global_object();
        // This is the start of a task.
        let vm = self.handler().vm();
        if vm.is_shutting_down() {
            bun_output::scoped_log!(WebSocketServer, "onMessage called after script execution");
            ws.close();
            return;
        }

        let _loop_guard = vm.enter_event_loop_scope();

        let arguments = [
            self.this_value
                .get()
                .try_get()
                .unwrap_or(JSValue::UNDEFINED),
            match opcode {
                Opcode::Text => jsc::bun_string_jsc::create_utf8_for_js(global_object, message)
                    .unwrap_or(JSValue::ZERO), // TODO: properly propagate exception upwards
                Opcode::Binary => self
                    .binary_to_js(global_object, message)
                    .unwrap_or(JSValue::ZERO), // TODO: properly propagate exception upwards
                _ => unreachable!(),
            },
        ];

        let mut corker = Corker {
            args: &arguments,
            global_object,
            this_value: JSValue::ZERO,
            callback: on_message_handler,
            result: JSValue::ZERO,
        };

        ws.cork(&mut corker, Corker::run);
        let result = corker.result;

        if result.is_empty_or_undefined_or_null() {
            return;
        }

        if let Some(err_value) = result.to_error() {
            self.handler()
                .run_error_callback(on_error, vm, global_object, err_value);
            return;
        }

        if let Some(promise) = result.as_any_promise() {
            match promise.status() {
                jsc::js_promise::Status::Rejected => {
                    // Value discarded; the side
                    // effect (JSC__JSPromise__result) conditionally sets
                    // `isHandledFlag` so this doesn't surface as an
                    // unhandledRejection.
                    let _ = promise.result(global_object.vm());
                    return;
                }
                _ => {}
            }
        }
    }

    #[inline]
    pub fn is_closed(&self) -> bool {
        self.flags.get().closed()
    }

    /// `&self` for the same noalias-reentry reason as `on_open` (R-2).
    pub fn on_drain(&self, _ws: AnyWebSocket) {
        bun_output::scoped_log!(WebSocketServer, "onDrain");
        let handler = self.handler();
        let vm = handler.vm();
        if self.is_closed() || vm.is_shutting_down() {
            return;
        }

        let on_drain = handler.on_drain;
        let on_error = handler.on_error;
        if !on_drain.is_empty() {
            let global_object = handler.global_object();

            let args = [self
                .this_value
                .get()
                .try_get()
                .unwrap_or(JSValue::UNDEFINED)];
            let mut corker = Corker {
                args: &args,
                global_object,
                this_value: JSValue::ZERO,
                callback: on_drain,
                result: JSValue::ZERO,
            };
            let _loop_guard = vm.enter_event_loop_scope();
            self.websocket().cork(&mut corker, Corker::run);
            let result = corker.result;

            if let Some(err_value) = result.to_error() {
                handler.run_error_callback(on_error, vm, global_object, err_value);
            }
        }
    }

    fn binary_to_js(&self, global_this: &JSGlobalObject, data: &[u8]) -> JsResult<JSValue> {
        match self.flags.get().binary_type() {
            BinaryType::Buffer => ArrayBuffer::create_buffer(global_this, data),
            BinaryType::Uint8Array => {
                ArrayBuffer::create::<{ JSType::Uint8Array }>(global_this, data)
            }
            _ => ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global_this, data),
        }
    }

    /// `&self` for the same noalias-reentry reason as `on_open` (R-2).
    pub fn on_ping(&self, _ws: AnyWebSocket, data: &[u8]) {
        bun_output::scoped_log!(WebSocketServer, "onPing: {}", bstr::BStr::new(data));
        let handler = self.handler();
        let cb = handler.on_ping;
        let on_error = handler.on_error;
        let vm = handler.vm();
        if cb.is_empty_or_undefined_or_null() || vm.is_shutting_down() {
            return;
        }
        let global_this = handler.global_object();

        // This is the start of a task.
        let _loop_guard = vm.enter_event_loop_scope();

        let args = [
            self.this_value
                .get()
                .try_get()
                .unwrap_or(JSValue::UNDEFINED),
            self.binary_to_js(global_this, data)
                .unwrap_or(JSValue::ZERO), // TODO: properly propagate exception upwards
        ];
        if let Err(e) = cb.call(global_this, JSValue::UNDEFINED, &args) {
            let err = global_this.take_exception(e);
            bun_output::scoped_log!(WebSocketServer, "onPing error");
            handler.run_error_callback(on_error, vm, global_this, err);
        }
    }

    /// `&self` for the same noalias-reentry reason as `on_open` (R-2).
    pub fn on_pong(&self, _ws: AnyWebSocket, data: &[u8]) {
        bun_output::scoped_log!(WebSocketServer, "onPong: {}", bstr::BStr::new(data));
        let handler = self.handler();
        let cb = handler.on_pong;
        let on_error = handler.on_error;
        if cb.is_empty_or_undefined_or_null() {
            return;
        }

        let global_this = handler.global_object();
        let vm = handler.vm();

        if vm.is_shutting_down() {
            return;
        }

        // This is the start of a task.
        let _loop_guard = vm.enter_event_loop_scope();

        let args = [
            self.this_value
                .get()
                .try_get()
                .unwrap_or(JSValue::UNDEFINED),
            self.binary_to_js(global_this, data)
                .unwrap_or(JSValue::ZERO), // TODO: properly propagate exception upwards
        ];
        if let Err(e) = cb.call(global_this, JSValue::UNDEFINED, &args) {
            let err = global_this.take_exception(e);
            bun_output::scoped_log!(WebSocketServer, "onPong error");
            handler.run_error_callback(on_error, vm, global_this, err);
        }
    }

    /// `&self` for the same noalias-reentry reason as `on_open` (R-2).
    /// Re-entrant `ws.close()` from the close handler routes through the same
    /// `Cell<Flags>` / `JsCell<JsRef>`, so no `noalias` view is invalidated.
    pub fn on_close(&self, _ws: AnyWebSocket, code: i32, message: &[u8]) {
        bun_output::scoped_log!(WebSocketServer, "onClose");
        // TODO: Can this called inside finalize?
        let handler = self.handler();
        // Copy the erased server handle out now: the guard below runs after
        // every `handler` borrow has expired, and `on_websocket_closed` may
        // form `&mut NewServer` (which owns the handler storage) to run the
        // idle pass when this was the last live socket.
        let server = handler.server;
        let was_closed = self.is_closed();
        self.update_flags(|f| f.set_closed(true));
        // Whoever set the closed flag owns the decrement; close()/terminate()
        // and on_open's error path each decrement themselves when they flip it.
        scopeguard::defer! {
            if !was_closed {
                if let Some(server) = server {
                    server.on_websocket_closed();
                }
            }
        }
        let signal = self.signal.take();

        // Downgrade + signal
        // cleanup runs at fn exit. `this_value` is not mutated between here and
        // the deferred `downgrade()`, so hoisting these reads is sound.
        let was_not_empty = self.this_value.get().is_not_empty();
        let cached_this = self
            .this_value
            .get()
            .try_get()
            .unwrap_or(JSValue::UNDEFINED);
        let this_value_cell: &JsCell<JsRef> = &self.this_value;
        let global_object_ref = handler.global_object;
        let _cleanup = scopeguard::guard(signal, move |sig| {
            if let Some(sig) = sig {
                // `sig` was stored with a +1 ref by the upgrade caller; it
                // stays live until this paired `unref()`, so the transient
                // `BackRef` (pointee-outlives-holder) is sound for both calls.
                let sig = bun_ptr::BackRef::from(sig);
                sig.pending_activity_unref();
                sig.unref();
            }
            if was_not_empty {
                // Drop the server-wrapper traced edge: once closed, this socket
                // no longer needs to pin the server (and its handler slots).
                js::server_set_cached(cached_this, global_object_ref.get(), JSValue::ZERO);
                // R-2: closure-scoped `&mut JsRef` via `JsCell::with_mut` —
                // no raw `*mut` projection needed.
                this_value_cell.with_mut(|v| v.downgrade());
            }
        });

        let vm = handler.vm();
        if vm.is_shutting_down() {
            return;
        }

        // on_open's error branch closes the socket, landing here with the
        // termination from its handler still pending. Both branches below
        // enter JS, which trips assertNoException().
        if handler.global_object().has_exception() {
            return;
        }

        // Copy to a stack local before `sig.signal()` re-enters JS: a GC
        // between the test and the `.call(...)` could otherwise collect it.
        let on_close_handler = handler.on_close;
        let on_error = handler.on_error;
        if !on_close_handler.is_empty_or_undefined_or_null() {
            let global_object = handler.global_object();

            let _loop_guard = vm.enter_event_loop_scope();

            if let Some(sig) = signal {
                // `sig` is held alive by the +1 ref released in `_cleanup`;
                // BackRef invariant (pointee outlives the temporary) holds.
                let sig = bun_ptr::BackRef::from(sig);
                if !sig.aborted() {
                    sig.signal(handler.global_object(), CommonAbortReason::ConnectionClosed);
                }
            }

            let message_js = match jsc::bun_string_jsc::create_utf8_for_js(global_object, message) {
                Ok(v) => v,
                Err(e) => {
                    let err = global_object.take_exception(e);
                    bun_output::scoped_log!(
                        WebSocketServer,
                        "onClose error (message) {}",
                        was_not_empty
                    );
                    handler.run_error_callback(on_error, vm, global_object, err);
                    return;
                }
            };

            let call_args = [cached_this, JSValue::js_number(code as f64), message_js];
            if let Err(e) = on_close_handler.call(global_object, JSValue::UNDEFINED, &call_args) {
                let err = global_object.take_exception(e);
                bun_output::scoped_log!(WebSocketServer, "onClose error {}", was_not_empty);
                handler.run_error_callback(on_error, vm, global_object, err);
                return;
            }
        } else if let Some(sig) = signal {
            let _loop_guard = vm.enter_event_loop_scope();

            // `sig` is held alive by the +1 ref released in `_cleanup`;
            // BackRef invariant (pointee outlives the temporary) holds.
            let sig = bun_ptr::BackRef::from(sig);
            if !sig.aborted() {
                sig.signal(handler.global_object(), CommonAbortReason::ConnectionClosed);
            }
        }
    }

    pub fn behavior<ServerType, const SSL: bool>(opts: &WebSocketBehavior) -> WebSocketBehavior
    where
        ServerType: WebSocketUpgradeServer<SSL>,
    {
        Wrap::<ServerType, Self, SSL>::apply(opts)
    }

    // No `#[bun_jsc::host_fn]` here — the constructor extern shim is
    // emitted by `generated_classes.rs`, which calls `<Self>::constructor`
    // directly.
    pub fn constructor(
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<*mut ServerWebSocket> {
        Err(global_object.throw(format_args!("Cannot construct ServerWebSocket")))
    }

    // Codegen's `host_fn_finalize` calls this via `|b| ServerWebSocket::finalize(b)`
    // and requires `fn finalize(self: Box<Self>)`; clippy::boxed_local is a
    // false positive on that contract.
    #[allow(clippy::boxed_local)]
    pub fn finalize(self: Box<Self>) {
        bun_output::scoped_log!(WebSocketServer, "finalize");
        self.this_value.with_mut(|v| v.finalize());
        if let Some(signal) = self.signal.take() {
            // `signal` was stored with a +1 ref by the upgrade caller; it
            // stays live until this paired `unref()`, so the transient
            // `BackRef` (pointee-outlives-holder) is sound for both calls —
            // same pattern as `on_close()`'s `_cleanup` guard.
            let sig = bun_ptr::BackRef::from(signal);
            sig.pending_activity_unref();
            sig.unref();
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn publish(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<4>();
        if args.len < 1 {
            bun_output::scoped_log!(WebSocketServer, "publish()");
            return Err(global_this.throw(format_args!("publish requires at least 1 argument")));
        }

        let Some((app, ssl, publish_to_self)) = self.publish_ctx() else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0.0));
        };

        let topic_value = args.ptr[0];
        let message_value = args.ptr[1];
        let compress_value = args.ptr[2];

        if topic_value.is_empty_or_undefined_or_null() || !topic_value.is_string() {
            bun_output::scoped_log!(WebSocketServer, "publish() topic invalid");
            return Err(global_this.throw(format_args!("publish requires a topic string")));
        }

        let topic_slice = topic_value.to_slice(global_this)?;
        if topic_slice.slice().is_empty() {
            return Err(global_this.throw(format_args!("publish requires a non-empty topic")));
        }

        let compress = Self::parse_compress_arg(global_this, "publish", compress_value, args.len)?;

        if message_value.is_empty_or_undefined_or_null() {
            return Err(global_this.throw(format_args!("publish requires a non-empty message")));
        }

        if let Some(array_buffer) = message_value.as_array_buffer(global_this) {
            let buffer = array_buffer.slice();
            return Ok(self.do_publish(
                ssl,
                app,
                publish_to_self,
                topic_slice.slice(),
                buffer,
                Opcode::Binary,
                compress,
            ));
        }

        {
            let js_string = message_value.to_js_string(global_this)?;
            let view = js_string.view(global_this);
            let slice = view.to_slice();

            let ret = self.do_publish(
                ssl,
                app,
                publish_to_self,
                topic_slice.slice(),
                slice.slice(),
                Opcode::Text,
                compress,
            );
            js_string.ensure_still_alive();
            Ok(ret)
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn publish_text(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<4>();

        if args.len < 1 {
            bun_output::scoped_log!(WebSocketServer, "publish()");
            return Err(global_this.throw(format_args!("publish requires at least 1 argument")));
        }

        let Some((app, ssl, publish_to_self)) = self.publish_ctx() else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0.0));
        };

        let topic_value = args.ptr[0];
        let message_value = args.ptr[1];
        let compress_value = args.ptr[2];

        if topic_value.is_empty_or_undefined_or_null() || !topic_value.is_string() {
            bun_output::scoped_log!(WebSocketServer, "publish() topic invalid");
            return Err(global_this.throw(format_args!("publishText requires a topic string")));
        }

        let topic_slice = topic_value.to_slice(global_this)?;

        let compress =
            Self::parse_compress_arg(global_this, "publishText", compress_value, args.len)?;

        if message_value.is_empty_or_undefined_or_null() || !message_value.is_string() {
            return Err(global_this.throw(format_args!("publishText requires a non-empty message")));
        }

        let js_string = message_value.to_js_string(global_this)?;
        let view = js_string.view(global_this);
        let slice = view.to_slice();

        let ret = self.do_publish(
            ssl,
            app,
            publish_to_self,
            topic_slice.slice(),
            slice.slice(),
            Opcode::Text,
            compress,
        );
        js_string.ensure_still_alive();
        Ok(ret)
    }

    #[bun_jsc::host_fn(method)]
    pub fn publish_binary(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<4>();

        if args.len < 1 {
            bun_output::scoped_log!(WebSocketServer, "publishBinary()");
            return Err(
                global_this.throw(format_args!("publishBinary requires at least 1 argument"))
            );
        }

        let Some((app, ssl, publish_to_self)) = self.publish_ctx() else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0.0));
        };
        let topic_value = args.ptr[0];
        let message_value = args.ptr[1];
        let compress_value = args.ptr[2];

        if topic_value.is_empty_or_undefined_or_null() || !topic_value.is_string() {
            bun_output::scoped_log!(WebSocketServer, "publishBinary() topic invalid");
            return Err(global_this.throw(format_args!("publishBinary requires a topic string")));
        }

        let topic_slice = topic_value.to_slice(global_this)?;
        if topic_slice.slice().is_empty() {
            return Err(global_this.throw(format_args!("publishBinary requires a non-empty topic")));
        }

        let compress =
            Self::parse_compress_arg(global_this, "publishBinary", compress_value, args.len)?;

        if message_value.is_empty_or_undefined_or_null() {
            return Err(
                global_this.throw(format_args!("publishBinary requires a non-empty message"))
            );
        }

        let Some(array_buffer) = message_value.as_array_buffer(global_this) else {
            return Err(global_this.throw(format_args!("publishBinary expects an ArrayBufferView")));
        };

        Ok(self.do_publish(
            ssl,
            app,
            publish_to_self,
            topic_slice.slice(),
            array_buffer.slice(),
            Opcode::Binary,
            compress,
        ))
    }

    // `passThis: true` in server.classes.ts — wrapper is emitted by
    // generated_classes.rs (ServerWebSocketPrototype__cork) and passes
    // `js_this_value` as a 4th arg, which `#[host_fn(method)]` does not model.
    pub fn cork(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<1>();

        if args.len < 1 {
            return Err(global_this.throw_not_enough_arguments("cork", 1, 0));
        }

        let callback = args.ptr[0];
        if callback.is_empty_or_undefined_or_null() || !callback.is_callable() {
            return Err(global_this.throw_invalid_argument_type_value(
                b"cork",
                b"callback",
                callback,
            ));
        }

        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut corker = Corker {
            args: &[this_value],
            global_object: global_this,
            this_value,
            callback,
            result: JSValue::ZERO,
        };
        self.websocket().cork(&mut corker, Corker::run);

        let result = corker.result;

        if result.is_any_error() {
            return Err(global_this.throw_value(result));
        }

        Ok(result)
    }

    #[bun_jsc::host_fn(method)]
    pub fn send(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();

        if args.len < 1 {
            bun_output::scoped_log!(WebSocketServer, "send()");
            return Err(global_this.throw(format_args!("send requires at least 1 argument")));
        }

        if self.is_closed() {
            bun_output::scoped_log!(WebSocketServer, "send() closed");
            return Ok(JSValue::js_number(0.0));
        }

        let message_value = args.ptr[0];
        let compress_value = args.ptr[1];

        let compress = Self::parse_compress_arg(global_this, "send", compress_value, args.len)?;

        if message_value.is_empty_or_undefined_or_null() {
            return Err(global_this.throw(format_args!("send requires a non-empty message")));
        }

        if let Some(buffer) = message_value.as_array_buffer(global_this) {
            let slice = buffer.slice();
            return Ok(send_status_to_js(
                self.websocket().send(slice, Opcode::Binary, compress, true),
                slice.len(),
                "send",
                "bytes",
            ));
        }

        {
            let js_string = message_value.to_js_string(global_this)?;
            let view = js_string.view(global_this);
            let slice = view.to_slice();

            let buffer = slice.slice();
            let ret = send_status_to_js(
                self.websocket().send(buffer, Opcode::Text, compress, true),
                buffer.len(),
                "send",
                "bytes string",
            );
            js_string.ensure_still_alive();
            Ok(ret)
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn send_text(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();

        if args.len < 1 {
            bun_output::scoped_log!(WebSocketServer, "sendText()");
            return Err(global_this.throw(format_args!("sendText requires at least 1 argument")));
        }

        if self.is_closed() {
            bun_output::scoped_log!(WebSocketServer, "sendText() closed");
            return Ok(JSValue::js_number(0.0));
        }

        let message_value = args.ptr[0];
        let compress_value = args.ptr[1];

        let compress = Self::parse_compress_arg(global_this, "sendText", compress_value, args.len)?;

        if message_value.is_empty_or_undefined_or_null() || !message_value.is_string() {
            return Err(global_this.throw(format_args!("sendText expects a string")));
        }

        let js_string = message_value.to_js_string(global_this)?;
        let view = js_string.view(global_this);
        let slice = view.to_slice();

        let buffer = slice.slice();
        let ret = send_status_to_js(
            self.websocket().send(buffer, Opcode::Text, compress, true),
            buffer.len(),
            "sendText",
            "bytes string",
        );
        js_string.ensure_still_alive();
        Ok(ret)
    }

    #[bun_jsc::host_fn(method)]
    pub fn send_binary(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();

        if args.len < 1 {
            bun_output::scoped_log!(WebSocketServer, "sendBinary()");
            return Err(global_this.throw(format_args!("sendBinary requires at least 1 argument")));
        }

        if self.is_closed() {
            bun_output::scoped_log!(WebSocketServer, "sendBinary() closed");
            return Ok(JSValue::js_number(0.0));
        }

        let message_value = args.ptr[0];
        let compress_value = args.ptr[1];

        let compress =
            Self::parse_compress_arg(global_this, "sendBinary", compress_value, args.len)?;

        let Some(buffer) = message_value.as_array_buffer(global_this) else {
            return Err(global_this.throw(format_args!("sendBinary requires an ArrayBufferView")));
        };

        let slice = buffer.slice();
        Ok(send_status_to_js(
            self.websocket().send(slice, Opcode::Binary, compress, true),
            slice.len(),
            "sendBinary",
            "bytes",
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub fn ping(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.send_ping(global_this, callframe, "ping", Opcode::Ping)
    }

    #[bun_jsc::host_fn(method)]
    pub fn pong(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.send_ping(global_this, callframe, "pong", Opcode::Pong)
    }

    #[inline]
    fn send_ping(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        name: &'static str,
        opcode: Opcode,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();

        if self.is_closed() {
            return Ok(JSValue::js_number(0.0));
        }

        if args.len > 0 {
            let value = args.ptr[0];
            if !value.is_empty_or_undefined_or_null() {
                if let Some(data) = value.as_array_buffer(global_this) {
                    let buffer = data.slice();
                    if buffer.len() > MAX_CONTROL_FRAME_PAYLOAD {
                        return Err(throw_control_frame_too_large(global_this, buffer.len()));
                    }
                    return Ok(send_status_to_js(
                        self.websocket().send(buffer, opcode, false, true),
                        buffer.len(),
                        name,
                        "bytes",
                    ));
                } else if value.is_string() {
                    // SAFETY: to_js_string returns a non-null *mut JSString on the Ok path.
                    let string_value = value.to_js_string(global_this)?.to_slice(global_this);
                    let buffer = string_value.slice();
                    if buffer.len() > MAX_CONTROL_FRAME_PAYLOAD {
                        return Err(throw_control_frame_too_large(global_this, buffer.len()));
                    }
                    return Ok(send_status_to_js(
                        self.websocket().send(buffer, opcode, false, true),
                        buffer.len(),
                        name,
                        "bytes",
                    ));
                } else {
                    return Err(global_this
                        .throw(format_args!("{} requires a string or BufferSource", name)));
                }
            }
        }

        Ok(send_status_to_js(
            self.websocket().send(&[], opcode, false, true),
            0,
            name,
            "bytes",
        ))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_data(&self, _global_this: &JSGlobalObject) -> JSValue {
        bun_output::scoped_log!(WebSocketServer, "getData()");
        if let Some(this_value) = self.this_value.get().try_get() {
            return js::data_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_data(&self, global_object: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        bun_output::scoped_log!(WebSocketServer, "setData()");
        if let Some(this_value) = self.this_value.get().try_get() {
            js::data_set_cached(this_value, global_object, value);
        }
        Ok(true)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_ready_state(&self, _global_this: &JSGlobalObject) -> JSValue {
        bun_output::scoped_log!(WebSocketServer, "getReadyState()");

        if self.is_closed() {
            return JSValue::js_number(3.0);
        }

        JSValue::js_number(1.0)
    }

    // `passThis: true` — wrapper emitted by generated_classes.rs.
    // R-2: `&self` — `websocket().end()` synchronously dispatches `on_close`
    // on this same `m_ctx`; a `&mut self` here would alias.
    pub fn close(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        // Since close() can lead to the close() callback being called, let's always ensure the `this` value is up to date.
        _this_value: JSValue,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();
        bun_output::scoped_log!(WebSocketServer, "close()");

        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        let code: i32 = 'brk: {
            if args.ptr[0].is_empty() || args.ptr[0].is_undefined() {
                // default exception code
                break 'brk 1000;
            }

            if !args.ptr[0].is_number() {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "close requires a numeric code or undefined"
                )));
            }

            break 'brk args.ptr[0].coerce_to_i32(global_this)?;
        };

        let message_value: ZigStringSlice = 'brk: {
            if args.ptr[1].is_empty() || args.ptr[1].is_undefined() {
                break 'brk ZigStringSlice::empty();
            }
            break 'brk args.ptr[1].to_slice_or_null(global_this)?;
        };

        // `to_slice_or_null` can run user `toString()`, which may re-entrantly
        // `ws.close()` and already decrement the count; re-check the guard.
        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        // Copy the server backref BEFORE end(): on_close re-enters and the
        // user's close handler may call stop(true), which clears handler.server.
        let server = self.handler().server;
        self.update_flags(|f| f.set_closed(true));
        self.websocket().end(code, message_value.slice());
        // on_close re-entered with was_closed=true so it skipped the
        // accounting; balance the count here.
        if let Some(server) = server {
            server.on_websocket_closed();
        }
        Ok(JSValue::UNDEFINED)
    }

    // `passThis: true` — wrapper emitted by generated_classes.rs.
    // R-2: `&self` — `websocket().close()` synchronously dispatches `on_close`.
    pub fn terminate(
        &self,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
        _this_value: JSValue,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(WebSocketServer, "terminate()");

        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        // Copy the server backref BEFORE close(): on_close re-enters and the
        // user's close handler may call stop(true), which clears handler.server.
        let server = self.handler().server;
        self.update_flags(|f| f.set_closed(true));
        self.websocket().close();
        // on_close re-entered with was_closed=true so it skipped the
        // accounting; balance the count here.
        if let Some(server) = server {
            server.on_websocket_closed();
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_binary_type(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        bun_output::scoped_log!(WebSocketServer, "getBinaryType()");

        Ok(match self.flags.get().binary_type() {
            BinaryType::Uint8Array => global_this.common_strings().uint8array(),
            BinaryType::Buffer => global_this.common_strings().nodebuffer(),
            BinaryType::ArrayBuffer => global_this.common_strings().arraybuffer(),
            _ => panic!("Invalid binary type"),
        })
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_binary_type(&self, global_this: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        bun_output::scoped_log!(WebSocketServer, "setBinaryType()");

        match BinaryType::from_js_value(global_this, value)? {
            Some(val @ (BinaryType::ArrayBuffer | BinaryType::Buffer | BinaryType::Uint8Array)) => {
                self.update_flags(|f| f.set_binary_type(val));
                Ok(true)
            }
            // some other value which we don't support
            _ => Err(global_this.throw(format_args!(
                "binaryType must be either \"uint8array\" or \"arraybuffer\" or \"nodebuffer\"",
            ))),
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_buffered_amount(
        &self,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(WebSocketServer, "getBufferedAmount()");

        if self.is_closed() {
            return Ok(JSValue::js_number(0.0));
        }

        Ok(JSValue::js_number(
            self.websocket().get_buffered_amount() as f64
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub fn subscribe(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.topic_dispatch(
            global_this,
            callframe,
            "subscribe",
            JSValue::TRUE,
            AnyWebSocket::subscribe,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn unsubscribe(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.topic_dispatch(
            global_this,
            callframe,
            "unsubscribe",
            JSValue::TRUE,
            AnyWebSocket::unsubscribe,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn is_subscribed(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.topic_dispatch(
            global_this,
            callframe,
            "isSubscribed",
            JSValue::FALSE,
            AnyWebSocket::is_subscribed,
        )
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_subscriptions(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if self.is_closed() {
            return JSValue::create_empty_array(global_this, 0);
        }

        // Get the JSValue directly from C++
        Ok(
            crate::socket::uws_jsc::any_web_socket_get_topics_as_js_array(
                self.websocket(),
                global_this,
            ),
        )
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_remote_address(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut buf = [0u8; 64];
        let mut text_buf = [0u8; 512];

        let address_bytes = self.websocket().get_remote_address(&mut buf);
        // `format_ip` strips trailing `:port` and `[..]`. Use `SocketAddr{V4,V6}` so
        // `format_ip`'s strip logic sees the expected `addr:port` / `[addr]:port`
        // shape — passing a bare `IpAddr` would corrupt IPv6 (no brackets/port,
        // so the rfind(':') strip eats the last hextet).
        let address: std::net::SocketAddr = match address_bytes.len() {
            4 => std::net::SocketAddrV4::new(
                std::net::Ipv4Addr::from(<[u8; 4]>::try_from(&address_bytes[0..4]).unwrap()),
                0,
            )
            .into(),
            16 => std::net::SocketAddrV6::new(
                std::net::Ipv6Addr::from(<[u8; 16]>::try_from(&address_bytes[0..16]).unwrap()),
                0,
                0,
                0,
            )
            .into(),
            _ => return Ok(JSValue::UNDEFINED),
        };
        let text = bun_core::fmt::format_ip(&address, &mut text_buf).expect("unreachable");
        bun_jsc::bun_string_jsc::create_utf8_for_js(global_this, text)
    }
}

// Delegate straight to the inherent methods above.
impl WebSocketHandler for ServerWebSocket {
    // R-2: trait keeps `*mut Self` (FFI userdata round-trip needs raw write
    // provenance); the single `&*this` reborrow here is the ONE audited unsafe
    // boundary. Inherent `on_*` take `&self`, so the re-entrant JS dispatch
    // never stacks a `noalias` `&mut ServerWebSocket`.
    #[inline(always)]
    unsafe fn on_open(this: *mut Self, ws: AnyWebSocket) {
        // SAFETY: per trait contract — `this` is the live user-data slot.
        unsafe { &*this }.on_open(ws)
    }
    #[inline(always)]
    unsafe fn on_message(this: *mut Self, ws: AnyWebSocket, message: &[u8], opcode: Opcode) {
        // SAFETY: per trait contract.
        unsafe { &*this }.on_message(ws, message, opcode)
    }
    #[inline(always)]
    unsafe fn on_drain(this: *mut Self, ws: AnyWebSocket) {
        // SAFETY: per trait contract.
        unsafe { &*this }.on_drain(ws)
    }
    #[inline(always)]
    unsafe fn on_ping(this: *mut Self, ws: AnyWebSocket, message: &[u8]) {
        // SAFETY: per trait contract.
        unsafe { &*this }.on_ping(ws, message)
    }
    #[inline(always)]
    unsafe fn on_pong(this: *mut Self, ws: AnyWebSocket, message: &[u8]) {
        // SAFETY: per trait contract.
        unsafe { &*this }.on_pong(ws, message)
    }
    #[inline(always)]
    unsafe fn on_close(this: *mut Self, ws: AnyWebSocket, code: i32, message: &[u8]) {
        // SAFETY: per trait contract.
        unsafe { &*this }.on_close(ws, code, message)
    }
}

struct Corker<'a> {
    args: &'a [JSValue],
    global_object: &'a JSGlobalObject,
    this_value: JSValue,
    callback: JSValue,
    result: JSValue,
}

impl<'a> Corker<'a> {
    pub(crate) fn run(&mut self) {
        let this_value = self.this_value;
        self.result = match self.callback.call(
            self.global_object,
            if this_value.is_empty() {
                JSValue::UNDEFINED
            } else {
                this_value
            },
            self.args,
        ) {
            Ok(v) => v,
            Err(err) => self.global_object.take_exception(err),
        };
    }
}
