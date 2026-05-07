use core::mem;
use core::ptr::NonNull;

use bun_uws::{self as uws, AnyWebSocket, WebSocketBehavior};
use bun_uws_sys::web_socket::{WebSocketHandler, WebSocketUpgradeServer, Wrap};
use bun_uws_sys::{Opcode, SendStatus};

use bun_jsc::event_loop::EventLoop;

use crate::server::jsc::{
    self, AbortSignal, ArrayBuffer, BinaryType, CallFrame, CommonAbortReason, JSGlobalObject,
    JSString, JSType, JSUint8Array, JSValue, JsRef, JsResult, ZigStringSlice,
};
use crate::server::web_socket_server_context::HandlerFlags;
use crate::server::WebSocketServerHandler;

bun_output::declare_scope!(WebSocketServer, visible);

// PORT NOTE: `'a` on a `.classes.ts` m_ctx payload is wrong — the JS wrapper
// outlives any stack frame. LIFETIMES.tsv says BORROW_PARAM but the handler
// lives in `ServerConfig.websocket` for the server's lifetime. Raw `*const` +
// SAFETY notes is the runtime shape.
#[bun_jsc::JsClass]
pub struct ServerWebSocket {
    handler: *const WebSocketServerHandler,
    this_value: JsRef,
    flags: Flags,
    // PORT NOTE (§Pointers): `?*bun.webcore.AbortSignal` is an opaque C++ type
    // with intrusive WebCore ref-counting (ref/unref) — never `Arc`. The init
    // caller transfers a +1 ref; `finalize`/`on_close` unref it.
    signal: Option<NonNull<AbortSignal>>,
}

// We pack the per-socket data into this struct below
// Zig: packed struct(u64) { ssl:1, closed:1, opened:1, binary_type:4, packed_websocket_ptr:57 }
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct Flags(u64);

impl Default for Flags {
    fn default() -> Self {
        // ssl=false, closed=false, opened=false, binary_type=.Buffer (discriminant 0), packed_websocket_ptr=0
        Flags(0)
    }
}

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
    pub fn opened(self) -> bool {
        self.0 & Self::OPENED_BIT != 0
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
        // SAFETY: stored value was written via set_binary_type from a valid BinaryType discriminant
        unsafe {
            mem::transmute::<u8, BinaryType>(
                ((self.0 & Self::BINARY_TYPE_MASK) >> Self::BINARY_TYPE_SHIFT) as u8,
            )
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
    // Emits `data_{get,set}_cached`. Getter maps `JSValue::ZERO` → `None`;
    // setter forwards through the JSC `WriteBarrier<Unknown>` slot.
    ::bun_jsc::codegen_cached_accessors!("ServerWebSocket"; data);
}

unsafe extern "C" {
    fn ServerWebSocket__create(
        global: *mut JSGlobalObject,
        ptr: *mut ServerWebSocket,
    ) -> JSValue;
}

impl ServerWebSocket {
    #[inline]
    fn websocket(&self) -> AnyWebSocket {
        self.flags.websocket()
    }

    /// Deref the raw handler pointer. The handler lives in `ServerConfig.websocket`
    /// for the server's lifetime; non-null while any `ServerWebSocket` exists.
    /// PORT NOTE: returns an unbounded (`'a`) borrow detached from `&self` so
    /// callers can interleave `&mut self` (flags mutation) with handler reads —
    /// the Zig original aliased freely through `*Handler`.
    #[inline]
    fn handler<'a>(&self) -> &'a WebSocketServerHandler {
        let p = self.handler;
        // SAFETY: see PORT NOTE on the `handler` field — outlives this socket.
        unsafe { &*p }
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
        let this = Box::into_raw(Box::new(ServerWebSocket {
            handler: handler as *const WebSocketServerHandler,
            this_value: JsRef::empty(),
            flags: Flags::default(),
            signal,
        }));
        // Get a strong ref and downgrade when terminating/close and GC will be able to collect the newly created value
        // SAFETY: `this` was just `Box::into_raw`'d; ownership transfers to the
        // C++ JS wrapper (freed via `ServerWebSocketClass__finalize` → `finalize`).
        let this_value = unsafe { ServerWebSocket::to_js_ptr(this, global_object) };
        // SAFETY: just allocated; unique. The JS wrapper holds the box but does
        // not touch the Rust fields concurrently (single JS thread).
        let this_ref = unsafe { &mut *this };
        this_ref.this_value = JsRef::init_strong(this_value, global_object);
        js::data_set_cached(this_value, global_object, data_value);
        this
    }

    pub fn memory_cost(&self) -> usize {
        if self.flags.closed() {
            return mem::size_of::<ServerWebSocket>();
        }
        self.websocket().memory_cost() + mem::size_of::<ServerWebSocket>()
    }

    pub fn on_open(&mut self, ws: AnyWebSocket) {
        bun_output::scoped_log!(WebSocketServer, "OnOpen");

        self.flags.set_packed_websocket_ptr(ws.raw() as usize as u64);
        self.flags.set_closed(false);
        self.flags.set_ssl(matches!(ws, AnyWebSocket::Ssl(_)));

        let handler = self.handler();
        let vm = handler.vm();
        // PORT NOTE: reshaped for borrowck — handler is &'a, mutate via interior helper
        handler.active_connections_saturating_add(1);
        let global_object = handler.global_object();
        let on_open_handler = handler.on_open;
        if vm.is_shutting_down() {
            bun_output::scoped_log!(WebSocketServer, "onOpen called after script execution");
            ws.close();
            return;
        }

        self.flags.set_opened(false);

        if on_open_handler.is_empty_or_undefined_or_null() {
            return;
        }

        let this_value = self.this_value.try_get().unwrap_or(JSValue::UNDEFINED);
        let args = [this_value];

        // SAFETY: event_loop() returns a live raw ptr owned by the VM.
        let _loop_guard = unsafe { EventLoop::enter_scope(vm.event_loop()) };

        let mut corker = Corker {
            args: &args,
            global_object,
            this_value: JSValue::ZERO,
            callback: on_open_handler,
            result: JSValue::ZERO,
        };
        ws.cork(&mut corker, Corker::run);
        let result = corker.result;
        self.flags.set_opened(true);
        if let Some(err_value) = result.to_error() {
            bun_output::scoped_log!(WebSocketServer, "onOpen exception");

            if !self.flags.closed() {
                self.flags.set_closed(true);
                // we un-gracefully close the connection if there was an exception
                // we don't want any event handlers to fire after this for anything other than error()
                // https://github.com/oven-sh/bun/issues/1480
                self.websocket().close();
                handler.active_connections_saturating_sub(1);
                this_value.unprotect();
            }

            handler.run_error_callback(vm, global_object, err_value);
        }
    }

    pub fn on_message(&mut self, ws: AnyWebSocket, message: &[u8], opcode: Opcode) {
        bun_output::scoped_log!(
            WebSocketServer,
            "onMessage({}): {}",
            opcode.0,
            bstr::BStr::new(message)
        );
        let on_message_handler = self.handler().on_message;
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

        // SAFETY: event_loop() returns a live raw ptr owned by the VM.
        let _loop_guard = unsafe { EventLoop::enter_scope(vm.event_loop()) };

        let arguments = [
            self.this_value.try_get().unwrap_or(JSValue::UNDEFINED),
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
            self.handler().run_error_callback(vm, global_object, err_value);
            return;
        }

        if let Some(promise) = result.as_any_promise() {
            match promise.status() {
                jsc::js_promise::Status::Rejected => {
                    // Zig: `_ = promise.result(vm)` — value discarded; the side
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
        self.flags.closed()
    }

    pub fn on_drain(&mut self, _ws: AnyWebSocket) {
        bun_output::scoped_log!(WebSocketServer, "onDrain");

        let handler = self.handler();
        let vm = handler.vm();
        if self.is_closed() || vm.is_shutting_down() {
            return;
        }

        if !handler.on_drain.is_empty() {
            let global_object = handler.global_object();

            let args = [self.this_value.try_get().unwrap_or(JSValue::UNDEFINED)];
            let mut corker = Corker {
                args: &args,
                global_object,
                this_value: JSValue::ZERO,
                callback: handler.on_drain,
                result: JSValue::ZERO,
            };
            // SAFETY: event_loop() returns a live raw ptr owned by the VM.
            let _loop_guard = unsafe { EventLoop::enter_scope(vm.event_loop()) };
            self.websocket().cork(&mut corker, Corker::run);
            let result = corker.result;

            if let Some(err_value) = result.to_error() {
                handler.run_error_callback(vm, global_object, err_value);
            }
        }
    }

    fn binary_to_js(&self, global_this: &JSGlobalObject, data: &[u8]) -> JsResult<JSValue> {
        match self.flags.binary_type() {
            BinaryType::Buffer => ArrayBuffer::create_buffer(global_this, data),
            BinaryType::Uint8Array => ArrayBuffer::create::<{ JSType::Uint8Array }>(global_this, data),
            _ => ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global_this, data),
        }
    }

    pub fn on_ping(&mut self, _ws: AnyWebSocket, data: &[u8]) {
        bun_output::scoped_log!(WebSocketServer, "onPing: {}", bstr::BStr::new(data));

        let handler = self.handler();
        let cb = handler.on_ping;
        let vm = handler.vm();
        if cb.is_empty_or_undefined_or_null() || vm.is_shutting_down() {
            return;
        }
        let global_this = handler.global_object();

        // This is the start of a task.
        // SAFETY: event_loop() returns a live raw ptr owned by the VM.
        let _loop_guard = unsafe { EventLoop::enter_scope(vm.event_loop()) };

        let args = [
            self.this_value.try_get().unwrap_or(JSValue::UNDEFINED),
            self.binary_to_js(global_this, data).unwrap_or(JSValue::ZERO), // TODO: properly propagate exception upwards
        ];
        if let Err(e) = cb.call(global_this, JSValue::UNDEFINED, &args) {
            let err = global_this.take_exception(e);
            bun_output::scoped_log!(WebSocketServer, "onPing error");
            handler.run_error_callback(vm, global_this, err);
        }
    }

    pub fn on_pong(&mut self, _ws: AnyWebSocket, data: &[u8]) {
        bun_output::scoped_log!(WebSocketServer, "onPong: {}", bstr::BStr::new(data));

        let handler = self.handler();
        let cb = handler.on_pong;
        if cb.is_empty_or_undefined_or_null() {
            return;
        }

        let global_this = handler.global_object();
        let vm = handler.vm();

        if vm.is_shutting_down() {
            return;
        }

        // This is the start of a task.
        // SAFETY: event_loop() returns a live raw ptr owned by the VM.
        let _loop_guard = unsafe { EventLoop::enter_scope(vm.event_loop()) };

        let args = [
            self.this_value.try_get().unwrap_or(JSValue::UNDEFINED),
            self.binary_to_js(global_this, data).unwrap_or(JSValue::ZERO), // TODO: properly propagate exception upwards
        ];
        if let Err(e) = cb.call(global_this, JSValue::UNDEFINED, &args) {
            let err = global_this.take_exception(e);
            bun_output::scoped_log!(WebSocketServer, "onPong error");
            handler.run_error_callback(vm, global_this, err);
        }
    }

    pub fn on_close(&mut self, _ws: AnyWebSocket, code: i32, message: &[u8]) {
        bun_output::scoped_log!(WebSocketServer, "onClose");
        // TODO: Can this called inside finalize?
        let handler = self.handler();
        let was_closed = self.is_closed();
        self.flags.set_closed(true);
        scopeguard::defer! {
            if !was_closed {
                handler.active_connections_saturating_sub(1);
            }
        }
        let signal = self.signal.take();

        // PORT NOTE: reshaped for borrowck — Zig defer block; downgrade + signal cleanup runs at fn exit
        let this_value_ptr: *mut JsRef = &mut self.this_value;
        let _cleanup = scopeguard::guard(signal, move |sig| {
            if let Some(sig) = sig {
                // SAFETY: `sig` was stored with a +1 ref by the upgrade caller;
                // it stays live until this paired unref.
                unsafe {
                    sig.as_ref().pending_activity_unref();
                    sig.as_ref().unref();
                }
            }
            // SAFETY: self outlives this guard (stack-scoped within method body)
            let tv = unsafe { &mut *this_value_ptr };
            if tv.is_not_empty() {
                tv.downgrade();
            }
        });

        let vm = handler.vm();
        if vm.is_shutting_down() {
            return;
        }

        if !handler.on_close.is_empty_or_undefined_or_null() {
            let global_object = handler.global_object();

            // SAFETY: event_loop() returns a live raw ptr owned by the VM.
            let _loop_guard = unsafe { EventLoop::enter_scope(vm.event_loop()) };

            if let Some(sig) = signal {
                // SAFETY: `sig` is held alive by the +1 ref released in `_cleanup`.
                let sig = unsafe { sig.as_ref() };
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
                        self.this_value.is_not_empty()
                    );
                    handler.run_error_callback(vm, global_object, err);
                    return;
                }
            };

            let call_args = [
                self.this_value.try_get().unwrap_or(JSValue::UNDEFINED),
                JSValue::js_number(code as f64),
                message_js,
            ];
            if let Err(e) = handler
                .on_close
                .call(global_object, JSValue::UNDEFINED, &call_args)
            {
                let err = global_object.take_exception(e);
                bun_output::scoped_log!(
                    WebSocketServer,
                    "onClose error {}",
                    self.this_value.is_not_empty()
                );
                handler.run_error_callback(vm, global_object, err);
                return;
            }
        } else if let Some(sig) = signal {
            // SAFETY: event_loop() returns a live raw ptr owned by the VM.
            let _loop_guard = unsafe { EventLoop::enter_scope(vm.event_loop()) };

            // SAFETY: `sig` is held alive by the +1 ref released in `_cleanup`.
            let sig = unsafe { sig.as_ref() };
            if !sig.aborted() {
                sig.signal(handler.global_object(), CommonAbortReason::ConnectionClosed);
            }
        }
    }

    pub fn behavior<ServerType, const SSL: bool>(opts: WebSocketBehavior) -> WebSocketBehavior
    where
        ServerType: WebSocketUpgradeServer<SSL>,
    {
        Wrap::<ServerType, Self, SSL>::apply(opts)
    }

    // PORT NOTE: no `#[bun_jsc::host_fn]` here — the constructor extern shim is
    // emitted by `generated_classes.rs`, which calls `<Self>::constructor`
    // directly.
    pub fn constructor(
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<*mut ServerWebSocket> {
        Err(global_object.throw(format_args!("Cannot construct ServerWebSocket")))
    }

    pub fn finalize(this: *mut Self) {
        bun_output::scoped_log!(WebSocketServer, "finalize");
        // SAFETY: called once by JSC finalizer on the mutator thread; `this` is the m_ctx payload
        let this_ref = unsafe { &mut *this };
        this_ref.this_value.finalize();
        if let Some(signal) = this_ref.signal.take() {
            // SAFETY: `signal` was stored with a +1 ref by the upgrade caller;
            // it stays live until this paired unref.
            unsafe {
                signal.as_ref().pending_activity_unref();
                signal.as_ref().unref();
            }
        }
        // SAFETY: allocated via Box::into_raw in `init`
        drop(unsafe { Box::from_raw(this) });
    }

    #[bun_jsc::host_fn(method)]
    pub fn publish(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<4>();
        if args.len < 1 {
            bun_output::scoped_log!(WebSocketServer, "publish()");
            return Err(global_this.throw(format_args!("publish requires at least 1 argument")));
        }

        let Some(app) = self.handler().app else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0.0));
        };
        let flags = self.handler().flags;
        let ssl = flags.contains(HandlerFlags::SSL);
        let publish_to_self = flags.contains(HandlerFlags::PUBLISH_TO_SELF);

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

        if !compress_value.is_boolean() && !compress_value.is_undefined() && !compress_value.is_empty()
        {
            return Err(global_this.throw(format_args!("publish expects compress to be a boolean")));
        }

        let compress = args.len > 1 && compress_value.to_boolean();

        if message_value.is_empty_or_undefined_or_null() {
            return Err(global_this.throw(format_args!("publish requires a non-empty message")));
        }

        if let Some(array_buffer) = message_value.as_array_buffer(global_this) {
            let buffer = array_buffer.slice();

            let result = if !publish_to_self && !self.is_closed() {
                self.websocket()
                    .publish(topic_slice.slice(), buffer, Opcode::Binary, compress)
            } else {
                AnyWebSocket::publish_with_options(
                    ssl,
                    app,
                    topic_slice.slice(),
                    buffer,
                    Opcode::Binary,
                    compress,
                )
            };

            return Ok(JSValue::js_number(
                // if 0, return 0
                // else return number of bytes sent
                if result {
                    (buffer.len() as u32 & 0x7FFF_FFFF) as f64
                } else {
                    0.0
                },
            ));
        }

        {
            let js_string = message_value.to_js_string(global_this)?;
            // SAFETY: to_js_string returns a non-null *mut JSString on Ok.
            let view = unsafe { &*js_string }.view(global_this);
            let slice = view.to_slice();

            let buffer = slice.slice();

            let result = if !publish_to_self && !self.is_closed() {
                self.websocket()
                    .publish(topic_slice.slice(), buffer, Opcode::Text, compress)
            } else {
                AnyWebSocket::publish_with_options(
                    ssl,
                    app,
                    topic_slice.slice(),
                    buffer,
                    Opcode::Text,
                    compress,
                )
            };

            let ret = JSValue::js_number(
                // if 0, return 0
                // else return number of bytes sent
                if result {
                    (buffer.len() as u32 & 0x7FFF_FFFF) as f64
                } else {
                    0.0
                },
            );
            unsafe { &*js_string }.ensure_still_alive();
            Ok(ret)
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn publish_text(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<4>();

        if args.len < 1 {
            bun_output::scoped_log!(WebSocketServer, "publish()");
            return Err(global_this.throw(format_args!("publish requires at least 1 argument")));
        }

        let Some(app) = self.handler().app else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0.0));
        };
        let flags = self.handler().flags;
        let ssl = flags.contains(HandlerFlags::SSL);
        let publish_to_self = flags.contains(HandlerFlags::PUBLISH_TO_SELF);

        let topic_value = args.ptr[0];
        let message_value = args.ptr[1];
        let compress_value = args.ptr[2];

        if topic_value.is_empty_or_undefined_or_null() || !topic_value.is_string() {
            bun_output::scoped_log!(WebSocketServer, "publish() topic invalid");
            return Err(global_this.throw(format_args!("publishText requires a topic string")));
        }

        let topic_slice = topic_value.to_slice(global_this)?;

        if !compress_value.is_boolean() && !compress_value.is_undefined() && !compress_value.is_empty()
        {
            return Err(global_this.throw(format_args!("publishText expects compress to be a boolean")));
        }

        let compress = args.len > 1 && compress_value.to_boolean();

        if message_value.is_empty_or_undefined_or_null() || !message_value.is_string() {
            return Err(global_this.throw(format_args!("publishText requires a non-empty message")));
        }

        let js_string = message_value.to_js_string(global_this)?;
        // SAFETY: to_js_string returns a non-null *mut JSString on Ok.
        let view = unsafe { &*js_string }.view(global_this);
        let slice = view.to_slice();

        let buffer = slice.slice();

        let result = if !publish_to_self && !self.is_closed() {
            self.websocket()
                .publish(topic_slice.slice(), buffer, Opcode::Text, compress)
        } else {
            AnyWebSocket::publish_with_options(
                ssl,
                app,
                topic_slice.slice(),
                buffer,
                Opcode::Text,
                compress,
            )
        };

        let ret = JSValue::js_number(
            // if 0, return 0
            // else return number of bytes sent
            if result {
                (buffer.len() as u32 & 0x7FFF_FFFF) as f64
            } else {
                0.0
            },
        );
        unsafe { &*js_string }.ensure_still_alive();
        Ok(ret)
    }

    #[bun_jsc::host_fn(method)]
    pub fn publish_binary(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<4>();

        if args.len < 1 {
            bun_output::scoped_log!(WebSocketServer, "publishBinary()");
            return Err(global_this.throw(format_args!("publishBinary requires at least 1 argument")));
        }

        let Some(app) = self.handler().app else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0.0));
        };
        let flags = self.handler().flags;
        let ssl = flags.contains(HandlerFlags::SSL);
        let publish_to_self = flags.contains(HandlerFlags::PUBLISH_TO_SELF);
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

        if !compress_value.is_boolean() && !compress_value.is_undefined() && !compress_value.is_empty()
        {
            return Err(global_this.throw(format_args!("publishBinary expects compress to be a boolean")));
        }

        let compress = args.len > 1 && compress_value.to_boolean();

        if message_value.is_empty_or_undefined_or_null() {
            return Err(global_this.throw(format_args!("publishBinary requires a non-empty message")));
        }

        let Some(array_buffer) = message_value.as_array_buffer(global_this) else {
            return Err(global_this.throw(format_args!("publishBinary expects an ArrayBufferView")));
        };
        let buffer = array_buffer.slice();

        let result = if !publish_to_self && !self.is_closed() {
            self.websocket()
                .publish(topic_slice.slice(), buffer, Opcode::Binary, compress)
        } else {
            AnyWebSocket::publish_with_options(
                ssl,
                app,
                topic_slice.slice(),
                buffer,
                Opcode::Binary,
                compress,
            )
        };

        Ok(JSValue::js_number(
            // if 0, return 0
            // else return number of bytes sent
            if result {
                (buffer.len() as u32 & 0x7FFF_FFFF) as f64
            } else {
                0.0
            },
        ))
    }

    pub fn publish_binary_without_type_checks(
        &mut self,
        global_this: &JSGlobalObject,
        topic_str: &JSString,
        array: &mut JSUint8Array,
    ) -> JsResult<JSValue> {
        let handler = self.handler();
        let Some(app) = handler.app else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0.0));
        };
        let flags = handler.flags;
        let ssl = flags.contains(HandlerFlags::SSL);
        let publish_to_self = flags.contains(HandlerFlags::PUBLISH_TO_SELF);

        let topic_slice = topic_str.to_slice(global_this);
        if topic_slice.slice().is_empty() {
            return Err(global_this.throw(format_args!("publishBinary requires a non-empty topic")));
        }

        let compress = true;

        let buffer = array.slice();
        if buffer.is_empty() {
            return Ok(JSValue::js_number(0.0));
        }

        let result = if !publish_to_self && !self.is_closed() {
            self.websocket()
                .publish(topic_slice.slice(), buffer, Opcode::Binary, compress)
        } else {
            AnyWebSocket::publish_with_options(
                ssl,
                app,
                topic_slice.slice(),
                buffer,
                Opcode::Binary,
                compress,
            )
        };

        Ok(JSValue::js_number(
            // if 0, return 0
            // else return number of bytes sent
            if result {
                (buffer.len() as u32 & 0x7FFF_FFFF) as f64
            } else {
                0.0
            },
        ))
    }

    pub fn publish_text_without_type_checks(
        &mut self,
        global_this: &JSGlobalObject,
        topic_str: &JSString,
        str: &JSString,
    ) -> JsResult<JSValue> {
        let handler = self.handler();
        let Some(app) = handler.app else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0.0));
        };
        let flags = handler.flags;
        let ssl = flags.contains(HandlerFlags::SSL);
        let publish_to_self = flags.contains(HandlerFlags::PUBLISH_TO_SELF);

        let topic_slice = topic_str.to_slice(global_this);
        if topic_slice.slice().is_empty() {
            return Err(global_this.throw(format_args!("publishBinary requires a non-empty topic")));
        }

        let compress = true;

        let slice = str.to_slice(global_this);
        let buffer = slice.slice();

        if buffer.is_empty() {
            return Ok(JSValue::js_number(0.0));
        }

        let result = if !publish_to_self && !self.is_closed() {
            self.websocket()
                .publish(topic_slice.slice(), buffer, Opcode::Text, compress)
        } else {
            AnyWebSocket::publish_with_options(
                ssl,
                app,
                topic_slice.slice(),
                buffer,
                Opcode::Text,
                compress,
            )
        };

        Ok(JSValue::js_number(
            // if 0, return 0
            // else return number of bytes sent
            if result {
                (buffer.len() as u32 & 0x7FFF_FFFF) as f64
            } else {
                0.0
            },
        ))
    }

    // `passThis: true` in server.classes.ts — wrapper is emitted by
    // generated_classes.rs (ServerWebSocketPrototype__cork) and passes
    // `js_this_value` as a 4th arg, which `#[host_fn(method)]` does not model.
    pub fn cork(
        &mut self,
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
            return Err(global_this.throw_invalid_argument_type_value(b"cork", b"callback", callback));
        }

        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut corker = Corker {
            args: &[],
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
    pub fn send(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
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

        if !compress_value.is_boolean() && !compress_value.is_undefined() && !compress_value.is_empty()
        {
            return Err(global_this.throw(format_args!("send expects compress to be a boolean")));
        }

        let compress = args.len > 1 && compress_value.to_boolean();

        if message_value.is_empty_or_undefined_or_null() {
            return Err(global_this.throw(format_args!("send requires a non-empty message")));
        }

        if let Some(buffer) = message_value.as_array_buffer(global_this) {
            return Ok(match self
                .websocket()
                .send(buffer.slice(), Opcode::Binary, compress, true)
            {
                SendStatus::Backpressure => {
                    bun_output::scoped_log!(WebSocketServer, "send() backpressure ({} bytes)", buffer.len);
                    JSValue::js_number(-1.0)
                }
                SendStatus::Success => {
                    bun_output::scoped_log!(WebSocketServer, "send() success ({} bytes)", buffer.len);
                    JSValue::js_number(buffer.slice().len() as f64)
                }
                SendStatus::Dropped => {
                    bun_output::scoped_log!(WebSocketServer, "send() dropped ({} bytes)", buffer.len);
                    JSValue::js_number(0.0)
                }
            });
        }

        {
            let js_string = message_value.to_js_string(global_this)?;
            // SAFETY: to_js_string returns a non-null *mut JSString on Ok.
            let view = unsafe { &*js_string }.view(global_this);
            let slice = view.to_slice();

            let buffer = slice.slice();
            let ret = match self.websocket().send(buffer, Opcode::Text, compress, true) {
                SendStatus::Backpressure => {
                    bun_output::scoped_log!(
                        WebSocketServer,
                        "send() backpressure ({} bytes string)",
                        buffer.len()
                    );
                    JSValue::js_number(-1.0)
                }
                SendStatus::Success => {
                    bun_output::scoped_log!(
                        WebSocketServer,
                        "send() success ({} bytes string)",
                        buffer.len()
                    );
                    JSValue::js_number(buffer.len() as f64)
                }
                SendStatus::Dropped => {
                    bun_output::scoped_log!(
                        WebSocketServer,
                        "send() dropped ({} bytes string)",
                        buffer.len()
                    );
                    JSValue::js_number(0.0)
                }
            };
            unsafe { &*js_string }.ensure_still_alive();
            Ok(ret)
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn send_text(
        &mut self,
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

        if !compress_value.is_boolean() && !compress_value.is_undefined() && !compress_value.is_empty()
        {
            return Err(global_this.throw(format_args!("sendText expects compress to be a boolean")));
        }

        let compress = args.len > 1 && compress_value.to_boolean();

        if message_value.is_empty_or_undefined_or_null() || !message_value.is_string() {
            return Err(global_this.throw(format_args!("sendText expects a string")));
        }

        let js_string = message_value.to_js_string(global_this)?;
        // SAFETY: to_js_string returns a non-null *mut JSString on Ok.
        let view = unsafe { &*js_string }.view(global_this);
        let slice = view.to_slice();

        let buffer = slice.slice();
        let ret = match self.websocket().send(buffer, Opcode::Text, compress, true) {
            SendStatus::Backpressure => {
                bun_output::scoped_log!(
                    WebSocketServer,
                    "sendText() backpressure ({} bytes string)",
                    buffer.len()
                );
                JSValue::js_number(-1.0)
            }
            SendStatus::Success => {
                bun_output::scoped_log!(
                    WebSocketServer,
                    "sendText() success ({} bytes string)",
                    buffer.len()
                );
                JSValue::js_number(buffer.len() as f64)
            }
            SendStatus::Dropped => {
                bun_output::scoped_log!(
                    WebSocketServer,
                    "sendText() dropped ({} bytes string)",
                    buffer.len()
                );
                JSValue::js_number(0.0)
            }
        };
        unsafe { &*js_string }.ensure_still_alive();
        Ok(ret)
    }

    pub fn send_text_without_type_checks(
        &mut self,
        global_this: &JSGlobalObject,
        message_str: &JSString,
        compress: bool,
    ) -> JSValue {
        if self.is_closed() {
            bun_output::scoped_log!(WebSocketServer, "sendText() closed");
            return JSValue::js_number(0.0);
        }

        let string_slice = message_str.to_slice(global_this);

        let buffer = string_slice.slice();
        match self.websocket().send(buffer, Opcode::Text, compress, true) {
            SendStatus::Backpressure => {
                bun_output::scoped_log!(
                    WebSocketServer,
                    "sendText() backpressure ({} bytes string)",
                    buffer.len()
                );
                JSValue::js_number(-1.0)
            }
            SendStatus::Success => {
                bun_output::scoped_log!(
                    WebSocketServer,
                    "sendText() success ({} bytes string)",
                    buffer.len()
                );
                JSValue::js_number(buffer.len() as f64)
            }
            SendStatus::Dropped => {
                bun_output::scoped_log!(
                    WebSocketServer,
                    "sendText() dropped ({} bytes string)",
                    buffer.len()
                );
                JSValue::js_number(0.0)
            }
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn send_binary(
        &mut self,
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

        if !compress_value.is_boolean() && !compress_value.is_undefined() && !compress_value.is_empty()
        {
            return Err(global_this.throw(format_args!("sendBinary expects compress to be a boolean")));
        }

        let compress = args.len > 1 && compress_value.to_boolean();

        let Some(buffer) = message_value.as_array_buffer(global_this) else {
            return Err(global_this.throw(format_args!("sendBinary requires an ArrayBufferView")));
        };

        Ok(match self
            .websocket()
            .send(buffer.slice(), Opcode::Binary, compress, true)
        {
            SendStatus::Backpressure => {
                bun_output::scoped_log!(WebSocketServer, "sendBinary() backpressure ({} bytes)", buffer.len);
                JSValue::js_number(-1.0)
            }
            SendStatus::Success => {
                bun_output::scoped_log!(WebSocketServer, "sendBinary() success ({} bytes)", buffer.len);
                JSValue::js_number(buffer.slice().len() as f64)
            }
            SendStatus::Dropped => {
                bun_output::scoped_log!(WebSocketServer, "sendBinary() dropped ({} bytes)", buffer.len);
                JSValue::js_number(0.0)
            }
        })
    }

    pub fn send_binary_without_type_checks(
        &mut self,
        _global_this: &JSGlobalObject,
        array_buffer: &mut JSUint8Array,
        compress: bool,
    ) -> JSValue {
        if self.is_closed() {
            bun_output::scoped_log!(WebSocketServer, "sendBinary() closed");
            return JSValue::js_number(0.0);
        }

        let buffer = array_buffer.slice();

        match self.websocket().send(buffer, Opcode::Binary, compress, true) {
            SendStatus::Backpressure => {
                bun_output::scoped_log!(WebSocketServer, "sendBinary() backpressure ({} bytes)", buffer.len());
                JSValue::js_number(-1.0)
            }
            SendStatus::Success => {
                bun_output::scoped_log!(WebSocketServer, "sendBinary() success ({} bytes)", buffer.len());
                JSValue::js_number(buffer.len() as f64)
            }
            SendStatus::Dropped => {
                bun_output::scoped_log!(WebSocketServer, "sendBinary() dropped ({} bytes)", buffer.len());
                JSValue::js_number(0.0)
            }
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn ping(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.send_ping(global_this, callframe, "ping", Opcode::Ping)
    }

    #[bun_jsc::host_fn(method)]
    pub fn pong(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.send_ping(global_this, callframe, "pong", Opcode::Pong)
    }

    // PERF(port): was comptime monomorphization (name + opcode) — profile in Phase B
    #[inline]
    fn send_ping(
        &mut self,
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

                    return Ok(match self.websocket().send(buffer, opcode, false, true) {
                        SendStatus::Backpressure => {
                            bun_output::scoped_log!(
                                WebSocketServer,
                                "{}() backpressure ({} bytes)",
                                name,
                                buffer.len()
                            );
                            JSValue::js_number(-1.0)
                        }
                        SendStatus::Success => {
                            bun_output::scoped_log!(
                                WebSocketServer,
                                "{}() success ({} bytes)",
                                name,
                                buffer.len()
                            );
                            JSValue::js_number(buffer.len() as f64)
                        }
                        SendStatus::Dropped => {
                            bun_output::scoped_log!(
                                WebSocketServer,
                                "{}() dropped ({} bytes)",
                                name,
                                buffer.len()
                            );
                            JSValue::js_number(0.0)
                        }
                    });
                } else if value.is_string() {
                    // SAFETY: to_js_string returns a non-null *mut JSString on the Ok path.
                    let string_value =
                        unsafe { &*value.to_js_string(global_this)? }.to_slice(global_this);
                    let buffer = string_value.slice();

                    return Ok(match self.websocket().send(buffer, opcode, false, true) {
                        SendStatus::Backpressure => {
                            bun_output::scoped_log!(
                                WebSocketServer,
                                "{}() backpressure ({} bytes)",
                                name,
                                buffer.len()
                            );
                            JSValue::js_number(-1.0)
                        }
                        SendStatus::Success => {
                            bun_output::scoped_log!(
                                WebSocketServer,
                                "{}() success ({} bytes)",
                                name,
                                buffer.len()
                            );
                            JSValue::js_number(buffer.len() as f64)
                        }
                        SendStatus::Dropped => {
                            bun_output::scoped_log!(
                                WebSocketServer,
                                "{}() dropped ({} bytes)",
                                name,
                                buffer.len()
                            );
                            JSValue::js_number(0.0)
                        }
                    });
                } else {
                    return Err(global_this
                        .throw(format_args!("{} requires a string or BufferSource", name)));
                }
            }
        }

        Ok(match self.websocket().send(&[], opcode, false, true) {
            SendStatus::Backpressure => {
                bun_output::scoped_log!(WebSocketServer, "{}() backpressure ({} bytes)", name, 0);
                JSValue::js_number(-1.0)
            }
            SendStatus::Success => {
                bun_output::scoped_log!(WebSocketServer, "{}() success ({} bytes)", name, 0);
                JSValue::js_number(0.0)
            }
            SendStatus::Dropped => {
                bun_output::scoped_log!(WebSocketServer, "{}() dropped ({} bytes)", name, 0);
                JSValue::js_number(0.0)
            }
        })
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_data(&self, _global_this: &JSGlobalObject) -> JSValue {
        bun_output::scoped_log!(WebSocketServer, "getData()");
        if let Some(this_value) = self.this_value.try_get() {
            return js::data_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_data(&mut self, global_object: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        bun_output::scoped_log!(WebSocketServer, "setData()");
        if let Some(this_value) = self.this_value.try_get() {
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
    pub fn close(
        &mut self,
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
                return Err(global_this
                    .throw_invalid_arguments(format_args!("close requires a numeric code or undefined")));
            }

            break 'brk args.ptr[0].coerce_to_i32(global_this)?;
        };

        let message_value: ZigStringSlice = 'brk: {
            if args.ptr[1].is_empty() || args.ptr[1].is_undefined() {
                break 'brk ZigStringSlice::empty();
            }
            break 'brk args.ptr[1].to_slice_or_null(global_this)?;
        };

        self.flags.set_closed(true);
        self.websocket().end(code, message_value.slice());
        Ok(JSValue::UNDEFINED)
    }

    // `passThis: true` — wrapper emitted by generated_classes.rs.
    pub fn terminate(
        &mut self,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
        _this_value: JSValue,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(WebSocketServer, "terminate()");

        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        self.flags.set_closed(true);
        self.websocket().close();

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_binary_type(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        bun_output::scoped_log!(WebSocketServer, "getBinaryType()");

        Ok(match self.flags.binary_type() {
            BinaryType::Uint8Array => global_this.common_strings().uint8array(),
            BinaryType::Buffer => global_this.common_strings().nodebuffer(),
            BinaryType::ArrayBuffer => global_this.common_strings().arraybuffer(),
            _ => panic!("Invalid binary type"),
        })
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_binary_type(
        &mut self,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        bun_output::scoped_log!(WebSocketServer, "setBinaryType()");

        use bun_jsc::array_buffer::BinaryType as FullBinaryType;
        let btype = FullBinaryType::from_js_value(global_this, value)?;
        let val = match btype {
            Some(FullBinaryType::ArrayBuffer) => BinaryType::ArrayBuffer,
            Some(FullBinaryType::Buffer) => BinaryType::Buffer,
            Some(FullBinaryType::Uint8Array) => BinaryType::Uint8Array,
            // some other value which we don't support
            _ => {
                return Err(global_this.throw(format_args!(
                    "binaryType must be either \"uint8array\" or \"arraybuffer\" or \"nodebuffer\"",
                )));
            }
        };
        self.flags.set_binary_type(val);
        Ok(true)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_buffered_amount(
        &mut self,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(WebSocketServer, "getBufferedAmount()");

        if self.is_closed() {
            return Ok(JSValue::js_number(0.0));
        }

        Ok(JSValue::js_number(self.websocket().get_buffered_amount() as f64))
    }

    #[bun_jsc::host_fn(method)]
    pub fn subscribe(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<1>();
        if args.len < 1 {
            return Err(global_this.throw(format_args!("subscribe requires at least 1 argument")));
        }

        if self.is_closed() {
            return Ok(JSValue::TRUE);
        }

        if !args.ptr[0].is_string() {
            return Err(global_this.throw_invalid_argument_type_value(b"topic", b"string", args.ptr[0]));
        }

        let topic = args.ptr[0].to_slice(global_this)?;

        if topic.slice().is_empty() {
            return Err(global_this.throw(format_args!("subscribe requires a non-empty topic name")));
        }

        Ok(JSValue::from(self.websocket().subscribe(topic.slice())))
    }

    #[bun_jsc::host_fn(method)]
    pub fn unsubscribe(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<1>();
        if args.len < 1 {
            return Err(global_this.throw(format_args!("unsubscribe requires at least 1 argument")));
        }

        if self.is_closed() {
            return Ok(JSValue::TRUE);
        }

        if !args.ptr[0].is_string() {
            return Err(global_this.throw_invalid_argument_type_value(b"topic", b"string", args.ptr[0]));
        }

        let topic = args.ptr[0].to_slice(global_this)?;

        if topic.slice().is_empty() {
            return Err(global_this.throw(format_args!("unsubscribe requires a non-empty topic name")));
        }

        Ok(JSValue::from(self.websocket().unsubscribe(topic.slice())))
    }

    #[bun_jsc::host_fn(method)]
    pub fn is_subscribed(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<1>();
        if args.len < 1 {
            return Err(global_this.throw(format_args!("isSubscribed requires at least 1 argument")));
        }

        if self.is_closed() {
            return Ok(JSValue::FALSE);
        }

        if !args.ptr[0].is_string() {
            return Err(global_this.throw_invalid_argument_type_value(b"topic", b"string", args.ptr[0]));
        }

        let topic = args.ptr[0].to_slice(global_this)?;

        if topic.slice().is_empty() {
            return Err(global_this.throw(format_args!("isSubscribed requires a non-empty topic name")));
        }

        Ok(JSValue::from(self.websocket().is_subscribed(topic.slice())))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_subscriptions(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if self.is_closed() {
            return JSValue::create_empty_array(global_this, 0);
        }

        // Get the JSValue directly from C++
        Ok(crate::socket::uws_jsc::any_web_socket_get_topics_as_js_array(
            self.websocket(),
            global_this,
        ))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_remote_address(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut buf = [0u8; 64];
        let mut text_buf = [0u8; 512];

        let address_bytes = self.websocket().get_remote_address(&mut buf);
        // Zig: `std.net.Address.initIp{4,6}(.., 0)` → `bun.fmt.formatIp` (strips
        // trailing `:port` and `[..]`). Mirror with `SocketAddr{V4,V6}` so
        // `format_ip`'s strip logic sees the same `addr:port` / `[addr]:port`
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

// Zig: `WebSocketBehavior.Wrap(ServerType, @This(), ssl)` duck-types `@This()`
// for `onOpen`/`onMessage`/etc. via `@hasDecl`. Rust needs an explicit trait
// impl; delegate straight to the inherent methods above.
impl WebSocketHandler for ServerWebSocket {
    #[inline(always)]
    fn on_open(&mut self, ws: AnyWebSocket) {
        ServerWebSocket::on_open(self, ws)
    }
    #[inline(always)]
    fn on_message(&mut self, ws: AnyWebSocket, message: &[u8], opcode: Opcode) {
        ServerWebSocket::on_message(self, ws, message, opcode)
    }
    #[inline(always)]
    fn on_drain(&mut self, ws: AnyWebSocket) {
        ServerWebSocket::on_drain(self, ws)
    }
    #[inline(always)]
    fn on_ping(&mut self, ws: AnyWebSocket, message: &[u8]) {
        ServerWebSocket::on_ping(self, ws, message)
    }
    #[inline(always)]
    fn on_pong(&mut self, ws: AnyWebSocket, message: &[u8]) {
        ServerWebSocket::on_pong(self, ws, message)
    }
    #[inline(always)]
    fn on_close(&mut self, ws: AnyWebSocket, code: i32, message: &[u8]) {
        ServerWebSocket::on_close(self, ws, code, message)
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
    pub fn run(&mut self) {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/ServerWebSocket.zig (1298 lines)
//   confidence: medium
//   notes:      handler kept as `*const` (server-lifetime) + active_connections
//               mutated through &; on_close defer reshaped via scopeguard with
//               raw ptr; signal: ?*AbortSignal kept as NonNull (intrusive C++
//               refcount, never Arc); std.net.Address → std::net::SocketAddr +
//               bun_core::fmt::format_ip
// ──────────────────────────────────────────────────────────────────────────
