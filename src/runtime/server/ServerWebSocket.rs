use core::mem;

use bun_core::Output;
use bun_jsc::{
    self as jsc, ArrayBuffer, BinaryType, CallFrame, JSGlobalObject, JSString, JSUint8Array,
    JSValue, JsRef, JsResult, ZigString,
};
use bun_runtime::server::WebSocketServerContext as WebSocketServer;
use bun_runtime::server::WebSocketServerHandler;
use bun_runtime::webcore::AbortSignal;
use bun_str as strings;
use bun_uws::{self as uws, AnyWebSocket, Opcode, SendStatus, WebSocketBehavior};
use std::sync::Arc;

bun_output::declare_scope!(WebSocketServer, visible);

// TODO(port): `'a` on a `.classes.ts` m_ctx payload is unusual; LIFETIMES.tsv classifies
// `#handler` as BORROW_PARAM → `&'a WebSocketServerHandler`. Phase B may need to revisit
// (raw `*mut` is the likely runtime shape since the handler outlives the JS wrapper).
#[bun_jsc::JsClass]
pub struct ServerWebSocket<'a> {
    handler: &'a WebSocketServerHandler,
    this_value: JsRef,
    flags: Flags,
    signal: Option<Arc<AbortSignal>>,
}

// We pack the per-socket data into this struct below
// Zig: packed struct(u64) { ssl:1, closed:1, opened:1, binary_type:4, packed_websocket_ptr:57 }
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct Flags(u64);

impl Default for Flags {
    fn default() -> Self {
        // ssl=false, closed=false, opened=false, binary_type=.Buffer, packed_websocket_ptr=0
        let mut f = Flags(0);
        f.set_binary_type(BinaryType::Buffer);
        f
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
        let ptr = self.packed_websocket_ptr() as usize;
        if self.ssl() {
            // SAFETY: packed_websocket_ptr was set from ws.raw() in on_open; non-null while !closed
            AnyWebSocket::Ssl(unsafe { &mut *(ptr as *mut uws::WebSocket<true>) })
        } else {
            // SAFETY: same as above
            AnyWebSocket::Tcp(unsafe { &mut *(ptr as *mut uws::WebSocket<false>) })
        }
    }
}

impl<'a> ServerWebSocket<'a> {
    #[inline]
    fn websocket(&self) -> AnyWebSocket {
        self.flags.websocket()
    }

    // pub const js = jsc.Codegen.JSServerWebSocket; — provided by #[bun_jsc::JsClass]
    // toJS / fromJS / fromJSDirect — provided by codegen

    /// Initialize a ServerWebSocket with the given handler, data value, and signal.
    /// The signal will not be ref'd inside the ServerWebSocket init function, but will unref itself when the ServerWebSocket is destroyed.
    pub fn init(
        handler: &'a WebSocketServerHandler,
        data_value: JSValue,
        signal: Option<Arc<AbortSignal>>,
    ) -> *mut ServerWebSocket<'a> {
        let global_object = handler.global_object;
        let this = Box::into_raw(Box::new(ServerWebSocket {
            handler,
            this_value: JsRef::empty(),
            flags: Flags::default(),
            signal,
        }));
        // SAFETY: just allocated; unique
        let this_ref = unsafe { &mut *this };
        // Get a strong ref and downgrade when terminating/close and GC will be able to collect the newly created value
        let this_value = this_ref.to_js(global_object);
        this_ref.this_value = JsRef::init_strong(this_value, global_object);
        Self::js::data_set_cached(this_value, global_object, data_value);
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

        let handler = self.handler;
        let vm = self.handler.vm;
        // PORT NOTE: reshaped for borrowck — handler is &'a, mutate via interior mutability or raw in Phase B
        // TODO(port): handler.active_connections is mutated through a shared ref; needs Cell/Atomic
        handler.active_connections_saturating_add(1);
        let global_object = handler.global_object;
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

        let loop_ = vm.event_loop();
        loop_.enter();
        let _exit = scopeguard::guard((), |_| loop_.exit());

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
            opcode as u8,
            bstr::BStr::new(message)
        );
        let on_message_handler = self.handler.on_message;
        if on_message_handler.is_empty_or_undefined_or_null() {
            return;
        }
        let global_object = self.handler.global_object;
        // This is the start of a task.
        let vm = self.handler.vm;
        if vm.is_shutting_down() {
            bun_output::scoped_log!(WebSocketServer, "onMessage called after script execution");
            ws.close();
            return;
        }

        let loop_ = vm.event_loop();
        loop_.enter();
        let _exit = scopeguard::guard((), |_| loop_.exit());

        let arguments = [
            self.this_value.try_get().unwrap_or(JSValue::UNDEFINED),
            match opcode {
                Opcode::Text => bun_str::String::create_utf8_for_js(global_object, message)
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
            self.handler.run_error_callback(vm, global_object, err_value);
            return;
        }

        if let Some(promise) = result.as_any_promise() {
            match promise.status() {
                jsc::PromiseStatus::Rejected => {
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

        let handler = self.handler;
        let vm = handler.vm;
        if self.is_closed() || vm.is_shutting_down() {
            return;
        }

        if !handler.on_drain.is_empty() {
            let global_object = handler.global_object;

            let args = [self.this_value.try_get().unwrap_or(JSValue::UNDEFINED)];
            let mut corker = Corker {
                args: &args,
                global_object,
                this_value: JSValue::ZERO,
                callback: handler.on_drain,
                result: JSValue::ZERO,
            };
            let loop_ = vm.event_loop();
            loop_.enter();
            let _exit = scopeguard::guard((), |_| loop_.exit());
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
            BinaryType::Uint8Array => ArrayBuffer::create(global_this, data, BinaryType::Uint8Array),
            _ => ArrayBuffer::create(global_this, data, BinaryType::ArrayBuffer),
        }
    }

    pub fn on_ping(&mut self, _ws: AnyWebSocket, data: &[u8]) {
        bun_output::scoped_log!(WebSocketServer, "onPing: {}", bstr::BStr::new(data));

        let handler = self.handler;
        let cb = handler.on_ping;
        let vm = handler.vm;
        if cb.is_empty_or_undefined_or_null() || vm.is_shutting_down() {
            return;
        }
        let global_this = handler.global_object;

        // This is the start of a task.
        let loop_ = vm.event_loop();
        loop_.enter();
        let _exit = scopeguard::guard((), |_| loop_.exit());

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

        let handler = self.handler;
        let cb = handler.on_pong;
        if cb.is_empty_or_undefined_or_null() {
            return;
        }

        let global_this = handler.global_object;
        let vm = handler.vm;

        if vm.is_shutting_down() {
            return;
        }

        // This is the start of a task.
        let loop_ = vm.event_loop();
        loop_.enter();
        let _exit = scopeguard::guard((), |_| loop_.exit());

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
        let handler = self.handler;
        let was_closed = self.is_closed();
        self.flags.set_closed(true);
        let _dec = scopeguard::guard((), |_| {
            if !was_closed {
                handler.active_connections_saturating_sub(1);
            }
        });
        let signal = self.signal.take();

        // PORT NOTE: reshaped for borrowck — Zig defer block; downgrade + signal cleanup runs at fn exit
        let this_value_ptr: *mut JsRef = &mut self.this_value;
        let _cleanup = scopeguard::guard(signal.clone(), move |sig| {
            if let Some(sig) = sig {
                sig.pending_activity_unref();
                // Arc drop = unref()
                drop(sig);
            }
            // SAFETY: self outlives this guard (stack-scoped within method body)
            let tv = unsafe { &mut *this_value_ptr };
            if tv.is_not_empty() {
                tv.downgrade();
            }
        });

        let vm = handler.vm;
        if vm.is_shutting_down() {
            return;
        }

        if !handler.on_close.is_empty_or_undefined_or_null() {
            let global_object = handler.global_object;
            let loop_ = vm.event_loop();

            loop_.enter();
            let _exit = scopeguard::guard((), |_| loop_.exit());

            if let Some(sig) = &signal {
                if !sig.aborted() {
                    sig.signal(handler.global_object, jsc::AbortReason::ConnectionClosed);
                }
            }

            let message_js = match bun_str::String::create_utf8_for_js(global_object, message) {
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
                JSValue::js_number(code),
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
        } else if let Some(sig) = &signal {
            let loop_ = vm.event_loop();

            loop_.enter();
            let _exit = scopeguard::guard((), |_| loop_.exit());

            if !sig.aborted() {
                sig.signal(handler.global_object, jsc::AbortReason::ConnectionClosed);
            }
        }
    }

    pub fn behavior<ServerType, const SSL: bool>(opts: WebSocketBehavior) -> WebSocketBehavior {
        uws::WebSocketBehaviorWrap::<ServerType, Self, SSL>::apply(opts)
    }

    #[bun_jsc::host_fn]
    pub fn constructor(
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<*mut ServerWebSocket<'a>> {
        global_object.throw("Cannot construct ServerWebSocket")
    }

    pub fn finalize(this: *mut Self) {
        bun_output::scoped_log!(WebSocketServer, "finalize");
        // SAFETY: called once by JSC finalizer on the mutator thread; `this` is the m_ctx payload
        let this_ref = unsafe { &mut *this };
        this_ref.this_value.finalize();
        if let Some(signal) = this_ref.signal.take() {
            signal.pending_activity_unref();
            // Arc drop = unref()
            drop(signal);
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
        let args = callframe.arguments_old(4);
        if args.len() < 1 {
            bun_output::scoped_log!(WebSocketServer, "publish()");
            return global_this.throw("publish requires at least 1 argument");
        }

        let Some(app) = self.handler.app else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0));
        };
        let flags = self.handler.flags;
        let ssl = flags.ssl;
        let publish_to_self = flags.publish_to_self;

        let topic_value = args.ptr(0);
        let message_value = args.ptr(1);
        let compress_value = args.ptr(2);

        if topic_value.is_empty_or_undefined_or_null() || !topic_value.is_string() {
            bun_output::scoped_log!(WebSocketServer, "publish() topic invalid");
            return global_this.throw("publish requires a topic string");
        }

        let topic_slice = topic_value.to_slice(global_this)?;
        if topic_slice.len() == 0 {
            return global_this.throw("publish requires a non-empty topic");
        }

        if !compress_value.is_boolean() && !compress_value.is_undefined() && !compress_value.is_empty()
        {
            return global_this.throw("publish expects compress to be a boolean");
        }

        let compress = args.len() > 1 && compress_value.to_boolean();

        if message_value.is_empty_or_undefined_or_null() {
            return global_this.throw("publish requires a non-empty message");
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
                    i32::try_from(buffer.len() as u32 & 0x7FFF_FFFF).unwrap()
                } else {
                    0i32
                },
            ));
        }

        {
            let js_string = message_value.to_js_string(global_this)?;
            let view = js_string.view(global_this);
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
                    i32::try_from(buffer.len() as u32 & 0x7FFF_FFFF).unwrap()
                } else {
                    0i32
                },
            );
            js_string.ensure_still_alive();
            Ok(ret)
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn publish_text(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old(4);

        if args.len() < 1 {
            bun_output::scoped_log!(WebSocketServer, "publish()");
            return global_this.throw("publish requires at least 1 argument");
        }

        let Some(app) = self.handler.app else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0));
        };
        let flags = self.handler.flags;
        let ssl = flags.ssl;
        let publish_to_self = flags.publish_to_self;

        let topic_value = args.ptr(0);
        let message_value = args.ptr(1);
        let compress_value = args.ptr(2);

        if topic_value.is_empty_or_undefined_or_null() || !topic_value.is_string() {
            bun_output::scoped_log!(WebSocketServer, "publish() topic invalid");
            return global_this.throw("publishText requires a topic string");
        }

        let topic_slice = topic_value.to_slice(global_this)?;

        if !compress_value.is_boolean() && !compress_value.is_undefined() && !compress_value.is_empty()
        {
            return global_this.throw("publishText expects compress to be a boolean");
        }

        let compress = args.len() > 1 && compress_value.to_boolean();

        if message_value.is_empty_or_undefined_or_null() || !message_value.is_string() {
            return global_this.throw("publishText requires a non-empty message");
        }

        let js_string = message_value.to_js_string(global_this)?;
        let view = js_string.view(global_this);
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
                i32::try_from(buffer.len() as u32 & 0x7FFF_FFFF).unwrap()
            } else {
                0i32
            },
        );
        js_string.ensure_still_alive();
        Ok(ret)
    }

    #[bun_jsc::host_fn(method)]
    pub fn publish_binary(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old(4);

        if args.len() < 1 {
            bun_output::scoped_log!(WebSocketServer, "publishBinary()");
            return global_this.throw("publishBinary requires at least 1 argument");
        }

        let Some(app) = self.handler.app else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0));
        };
        let flags = self.handler.flags;
        let ssl = flags.ssl;
        let publish_to_self = flags.publish_to_self;
        let topic_value = args.ptr(0);
        let message_value = args.ptr(1);
        let compress_value = args.ptr(2);

        if topic_value.is_empty_or_undefined_or_null() || !topic_value.is_string() {
            bun_output::scoped_log!(WebSocketServer, "publishBinary() topic invalid");
            return global_this.throw("publishBinary requires a topic string");
        }

        let topic_slice = topic_value.to_slice(global_this)?;
        if topic_slice.len() == 0 {
            return global_this.throw("publishBinary requires a non-empty topic");
        }

        if !compress_value.is_boolean() && !compress_value.is_undefined() && !compress_value.is_empty()
        {
            return global_this.throw("publishBinary expects compress to be a boolean");
        }

        let compress = args.len() > 1 && compress_value.to_boolean();

        if message_value.is_empty_or_undefined_or_null() {
            return global_this.throw("publishBinary requires a non-empty message");
        }

        let Some(array_buffer) = message_value.as_array_buffer(global_this) else {
            return global_this.throw("publishBinary expects an ArrayBufferView");
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
                i32::try_from(buffer.len() as u32 & 0x7FFF_FFFF).unwrap()
            } else {
                0i32
            },
        ))
    }

    pub fn publish_binary_without_type_checks(
        &mut self,
        global_this: &JSGlobalObject,
        topic_str: &JSString,
        array: &JSUint8Array,
    ) -> JsResult<JSValue> {
        let Some(app) = self.handler.app else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0));
        };
        let flags = self.handler.flags;
        let ssl = flags.ssl;
        let publish_to_self = flags.publish_to_self;

        let topic_slice = topic_str.to_slice(global_this);
        if topic_slice.len() == 0 {
            return global_this.throw("publishBinary requires a non-empty topic");
        }

        let compress = true;

        let buffer = array.slice();
        if buffer.is_empty() {
            return Ok(JSValue::js_number(0));
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
                i32::try_from(buffer.len() as u32 & 0x7FFF_FFFF).unwrap()
            } else {
                0i32
            },
        ))
    }

    pub fn publish_text_without_type_checks(
        &mut self,
        global_this: &JSGlobalObject,
        topic_str: &JSString,
        str: &JSString,
    ) -> JsResult<JSValue> {
        let Some(app) = self.handler.app else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0));
        };
        let flags = self.handler.flags;
        let ssl = flags.ssl;
        let publish_to_self = flags.publish_to_self;

        let topic_slice = topic_str.to_slice(global_this);
        if topic_slice.len() == 0 {
            return global_this.throw("publishBinary requires a non-empty topic");
        }

        let compress = true;

        let slice = str.to_slice(global_this);
        let buffer = slice.slice();

        if buffer.is_empty() {
            return Ok(JSValue::js_number(0));
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
                i32::try_from(buffer.len() as u32 & 0x7FFF_FFFF).unwrap()
            } else {
                0i32
            },
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub fn cork(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old(1);

        if args.len() < 1 {
            return global_this.throw_not_enough_arguments("cork", 1, 0);
        }

        let callback = args.ptr(0);
        if callback.is_empty_or_undefined_or_null() || !callback.is_callable() {
            return global_this.throw_invalid_argument_type_value("cork", "callback", callback);
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
            return global_this.throw_value(result);
        }

        Ok(result)
    }

    #[bun_jsc::host_fn(method)]
    pub fn send(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old(2);

        if args.len() < 1 {
            bun_output::scoped_log!(WebSocketServer, "send()");
            return global_this.throw("send requires at least 1 argument");
        }

        if self.is_closed() {
            bun_output::scoped_log!(WebSocketServer, "send() closed");
            return Ok(JSValue::js_number(0));
        }

        let message_value = args.ptr(0);
        let compress_value = args.ptr(1);

        if !compress_value.is_boolean() && !compress_value.is_undefined() && !compress_value.is_empty()
        {
            return global_this.throw("send expects compress to be a boolean");
        }

        let compress = args.len() > 1 && compress_value.to_boolean();

        if message_value.is_empty_or_undefined_or_null() {
            return global_this.throw("send requires a non-empty message");
        }

        if let Some(buffer) = message_value.as_array_buffer(global_this) {
            return Ok(match self
                .websocket()
                .send(buffer.slice(), Opcode::Binary, compress, true)
            {
                SendStatus::Backpressure => {
                    bun_output::scoped_log!(WebSocketServer, "send() backpressure ({} bytes)", buffer.len());
                    JSValue::js_number(-1)
                }
                SendStatus::Success => {
                    bun_output::scoped_log!(WebSocketServer, "send() success ({} bytes)", buffer.len());
                    JSValue::js_number(buffer.slice().len())
                }
                SendStatus::Dropped => {
                    bun_output::scoped_log!(WebSocketServer, "send() dropped ({} bytes)", buffer.len());
                    JSValue::js_number(0)
                }
            });
        }

        {
            let js_string = message_value.to_js_string(global_this)?;
            let view = js_string.view(global_this);
            let slice = view.to_slice();

            let buffer = slice.slice();
            let ret = match self.websocket().send(buffer, Opcode::Text, compress, true) {
                SendStatus::Backpressure => {
                    bun_output::scoped_log!(
                        WebSocketServer,
                        "send() backpressure ({} bytes string)",
                        buffer.len()
                    );
                    JSValue::js_number(-1)
                }
                SendStatus::Success => {
                    bun_output::scoped_log!(
                        WebSocketServer,
                        "send() success ({} bytes string)",
                        buffer.len()
                    );
                    JSValue::js_number(buffer.len())
                }
                SendStatus::Dropped => {
                    bun_output::scoped_log!(
                        WebSocketServer,
                        "send() dropped ({} bytes string)",
                        buffer.len()
                    );
                    JSValue::js_number(0)
                }
            };
            js_string.ensure_still_alive();
            Ok(ret)
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn send_text(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old(2);

        if args.len() < 1 {
            bun_output::scoped_log!(WebSocketServer, "sendText()");
            return global_this.throw("sendText requires at least 1 argument");
        }

        if self.is_closed() {
            bun_output::scoped_log!(WebSocketServer, "sendText() closed");
            return Ok(JSValue::js_number(0));
        }

        let message_value = args.ptr(0);
        let compress_value = args.ptr(1);

        if !compress_value.is_boolean() && !compress_value.is_undefined() && !compress_value.is_empty()
        {
            return global_this.throw("sendText expects compress to be a boolean");
        }

        let compress = args.len() > 1 && compress_value.to_boolean();

        if message_value.is_empty_or_undefined_or_null() || !message_value.is_string() {
            return global_this.throw("sendText expects a string");
        }

        let js_string = message_value.to_js_string(global_this)?;
        let view = js_string.view(global_this);
        let slice = view.to_slice();

        let buffer = slice.slice();
        let ret = match self.websocket().send(buffer, Opcode::Text, compress, true) {
            SendStatus::Backpressure => {
                bun_output::scoped_log!(
                    WebSocketServer,
                    "sendText() backpressure ({} bytes string)",
                    buffer.len()
                );
                JSValue::js_number(-1)
            }
            SendStatus::Success => {
                bun_output::scoped_log!(
                    WebSocketServer,
                    "sendText() success ({} bytes string)",
                    buffer.len()
                );
                JSValue::js_number(buffer.len())
            }
            SendStatus::Dropped => {
                bun_output::scoped_log!(
                    WebSocketServer,
                    "sendText() dropped ({} bytes string)",
                    buffer.len()
                );
                JSValue::js_number(0)
            }
        };
        js_string.ensure_still_alive();
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
            return JSValue::js_number(0);
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
                JSValue::js_number(-1)
            }
            SendStatus::Success => {
                bun_output::scoped_log!(
                    WebSocketServer,
                    "sendText() success ({} bytes string)",
                    buffer.len()
                );
                JSValue::js_number(buffer.len())
            }
            SendStatus::Dropped => {
                bun_output::scoped_log!(
                    WebSocketServer,
                    "sendText() dropped ({} bytes string)",
                    buffer.len()
                );
                JSValue::js_number(0)
            }
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn send_binary(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old(2);

        if args.len() < 1 {
            bun_output::scoped_log!(WebSocketServer, "sendBinary()");
            return global_this.throw("sendBinary requires at least 1 argument");
        }

        if self.is_closed() {
            bun_output::scoped_log!(WebSocketServer, "sendBinary() closed");
            return Ok(JSValue::js_number(0));
        }

        let message_value = args.ptr(0);
        let compress_value = args.ptr(1);

        if !compress_value.is_boolean() && !compress_value.is_undefined() && !compress_value.is_empty()
        {
            return global_this.throw("sendBinary expects compress to be a boolean");
        }

        let compress = args.len() > 1 && compress_value.to_boolean();

        let Some(buffer) = message_value.as_array_buffer(global_this) else {
            return global_this.throw("sendBinary requires an ArrayBufferView");
        };

        Ok(match self
            .websocket()
            .send(buffer.slice(), Opcode::Binary, compress, true)
        {
            SendStatus::Backpressure => {
                bun_output::scoped_log!(WebSocketServer, "sendBinary() backpressure ({} bytes)", buffer.len());
                JSValue::js_number(-1)
            }
            SendStatus::Success => {
                bun_output::scoped_log!(WebSocketServer, "sendBinary() success ({} bytes)", buffer.len());
                JSValue::js_number(buffer.slice().len())
            }
            SendStatus::Dropped => {
                bun_output::scoped_log!(WebSocketServer, "sendBinary() dropped ({} bytes)", buffer.len());
                JSValue::js_number(0)
            }
        })
    }

    pub fn send_binary_without_type_checks(
        &mut self,
        _global_this: &JSGlobalObject,
        array_buffer: &JSUint8Array,
        compress: bool,
    ) -> JSValue {
        if self.is_closed() {
            bun_output::scoped_log!(WebSocketServer, "sendBinary() closed");
            return JSValue::js_number(0);
        }

        let buffer = array_buffer.slice();

        match self.websocket().send(buffer, Opcode::Binary, compress, true) {
            SendStatus::Backpressure => {
                bun_output::scoped_log!(WebSocketServer, "sendBinary() backpressure ({} bytes)", buffer.len());
                JSValue::js_number(-1)
            }
            SendStatus::Success => {
                bun_output::scoped_log!(WebSocketServer, "sendBinary() success ({} bytes)", buffer.len());
                JSValue::js_number(buffer.len())
            }
            SendStatus::Dropped => {
                bun_output::scoped_log!(WebSocketServer, "sendBinary() dropped ({} bytes)", buffer.len());
                JSValue::js_number(0)
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
        let args = callframe.arguments_old(2);

        if self.is_closed() {
            return Ok(JSValue::js_number(0));
        }

        if args.len() > 0 {
            let value = args.ptr(0);
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
                            JSValue::js_number(-1)
                        }
                        SendStatus::Success => {
                            bun_output::scoped_log!(
                                WebSocketServer,
                                "{}() success ({} bytes)",
                                name,
                                buffer.len()
                            );
                            JSValue::js_number(buffer.len())
                        }
                        SendStatus::Dropped => {
                            bun_output::scoped_log!(
                                WebSocketServer,
                                "{}() dropped ({} bytes)",
                                name,
                                buffer.len()
                            );
                            JSValue::js_number(0)
                        }
                    });
                } else if value.is_string() {
                    let string_value = value.to_js_string(global_this)?.to_slice(global_this);
                    let buffer = string_value.slice();

                    return Ok(match self.websocket().send(buffer, opcode, false, true) {
                        SendStatus::Backpressure => {
                            bun_output::scoped_log!(
                                WebSocketServer,
                                "{}() backpressure ({} bytes)",
                                name,
                                buffer.len()
                            );
                            JSValue::js_number(-1)
                        }
                        SendStatus::Success => {
                            bun_output::scoped_log!(
                                WebSocketServer,
                                "{}() success ({} bytes)",
                                name,
                                buffer.len()
                            );
                            JSValue::js_number(buffer.len())
                        }
                        SendStatus::Dropped => {
                            bun_output::scoped_log!(
                                WebSocketServer,
                                "{}() dropped ({} bytes)",
                                name,
                                buffer.len()
                            );
                            JSValue::js_number(0)
                        }
                    });
                } else {
                    return global_this
                        .throw_pretty(format_args!("{} requires a string or BufferSource", name));
                }
            }
        }

        Ok(match self.websocket().send(&[], opcode, false, true) {
            SendStatus::Backpressure => {
                bun_output::scoped_log!(WebSocketServer, "{}() backpressure ({} bytes)", name, 0);
                JSValue::js_number(-1)
            }
            SendStatus::Success => {
                bun_output::scoped_log!(WebSocketServer, "{}() success ({} bytes)", name, 0);
                JSValue::js_number(0)
            }
            SendStatus::Dropped => {
                bun_output::scoped_log!(WebSocketServer, "{}() dropped ({} bytes)", name, 0);
                JSValue::js_number(0)
            }
        })
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_data(&self, _global_this: &JSGlobalObject) -> JSValue {
        bun_output::scoped_log!(WebSocketServer, "getData()");
        if let Some(this_value) = self.this_value.try_get() {
            return Self::js::data_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_data(&mut self, global_object: &JSGlobalObject, value: JSValue) {
        bun_output::scoped_log!(WebSocketServer, "setData()");
        if let Some(this_value) = self.this_value.try_get() {
            Self::js::data_set_cached(this_value, global_object, value);
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_ready_state(&self, _global_this: &JSGlobalObject) -> JSValue {
        bun_output::scoped_log!(WebSocketServer, "getReadyState()");

        if self.is_closed() {
            return JSValue::js_number(3);
        }

        JSValue::js_number(1)
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        // Since close() can lead to the close() callback being called, let's always ensure the `this` value is up to date.
        _this_value: JSValue,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old(2);
        bun_output::scoped_log!(WebSocketServer, "close()");

        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        let code: i32 = 'brk: {
            if args.ptr(0).is_empty() || args.ptr(0).is_undefined() {
                // default exception code
                break 'brk 1000;
            }

            if !args.ptr(0).is_number() {
                return global_this
                    .throw_invalid_arguments("close requires a numeric code or undefined");
            }

            break 'brk args.ptr(0).coerce_i32(global_this)?;
        };

        let message_value: ZigString::Slice = 'brk: {
            if args.ptr(1).is_empty() || args.ptr(1).is_undefined() {
                break 'brk ZigString::Slice::empty();
            }
            break 'brk args.ptr(1).to_slice_or_null(global_this)?;
        };

        self.flags.set_closed(true);
        self.websocket().end(code, message_value.slice());
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
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
    ) -> JsResult<()> {
        bun_output::scoped_log!(WebSocketServer, "setBinaryType()");

        let btype = BinaryType::from_js_value(global_this, value)?;
        match btype.unwrap_or(
            // some other value which we don't support
            BinaryType::Float64Array,
        ) {
            val @ (BinaryType::ArrayBuffer | BinaryType::Buffer | BinaryType::Uint8Array) => {
                self.flags.set_binary_type(val);
                Ok(())
            }
            _ => global_this
                .throw("binaryType must be either \"uint8array\" or \"arraybuffer\" or \"nodebuffer\""),
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_buffered_amount(
        &mut self,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(WebSocketServer, "getBufferedAmount()");

        if self.is_closed() {
            return Ok(JSValue::js_number(0));
        }

        Ok(JSValue::js_number(self.websocket().get_buffered_amount()))
    }

    #[bun_jsc::host_fn(method)]
    pub fn subscribe(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old(1);
        if args.len() < 1 {
            return global_this.throw("subscribe requires at least 1 argument");
        }

        if self.is_closed() {
            return Ok(JSValue::TRUE);
        }

        if !args.ptr(0).is_string() {
            return global_this.throw_invalid_argument_type_value("topic", "string", args.ptr(0));
        }

        let topic = args.ptr(0).to_slice(global_this)?;

        if topic.len() == 0 {
            return global_this.throw("subscribe requires a non-empty topic name");
        }

        Ok(JSValue::from(self.websocket().subscribe(topic.slice())))
    }

    #[bun_jsc::host_fn(method)]
    pub fn unsubscribe(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old(1);
        if args.len() < 1 {
            return global_this.throw("unsubscribe requires at least 1 argument");
        }

        if self.is_closed() {
            return Ok(JSValue::TRUE);
        }

        if !args.ptr(0).is_string() {
            return global_this.throw_invalid_argument_type_value("topic", "string", args.ptr(0));
        }

        let topic = args.ptr(0).to_slice(global_this)?;

        if topic.len() == 0 {
            return global_this.throw("unsubscribe requires a non-empty topic name");
        }

        Ok(JSValue::from(self.websocket().unsubscribe(topic.slice())))
    }

    #[bun_jsc::host_fn(method)]
    pub fn is_subscribed(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old(1);
        if args.len() < 1 {
            return global_this.throw("isSubscribed requires at least 1 argument");
        }

        if self.is_closed() {
            return Ok(JSValue::FALSE);
        }

        if !args.ptr(0).is_string() {
            return global_this.throw_invalid_argument_type_value("topic", "string", args.ptr(0));
        }

        let topic = args.ptr(0).to_slice(global_this)?;

        if topic.len() == 0 {
            return global_this.throw("isSubscribed requires a non-empty topic name");
        }

        Ok(JSValue::from(self.websocket().is_subscribed(topic.slice())))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_subscriptions(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if self.is_closed() {
            return JSValue::create_empty_array(global_this, 0);
        }

        // Get the JSValue directly from C++
        Ok(self.websocket().get_topics_as_js_array(global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_remote_address(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut buf = [0u8; 64];
        let mut text_buf = [0u8; 512];

        let address_bytes = self.websocket().get_remote_address(&mut buf);
        // TODO(port): std.net.Address — using bun_core::fmt::format_ip which accepts raw 4/16-byte address
        let text = match address_bytes.len() {
            4 => bun_core::fmt::format_ip_v4(
                <[u8; 4]>::try_from(&address_bytes[0..4]).unwrap(),
                0,
                &mut text_buf,
            ),
            16 => bun_core::fmt::format_ip_v6(
                <[u8; 16]>::try_from(&address_bytes[0..16]).unwrap(),
                0,
                0,
                0,
                &mut text_buf,
            ),
            _ => return Ok(JSValue::UNDEFINED),
        }
        .expect("unreachable");
        bun_str::String::create_utf8_for_js(global_this, text)
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
//   todos:      3
//   notes:      `&'a WebSocketServerHandler` on m_ctx payload + handler.active_connections mutation through &; on_close defer reshaped via scopeguard with raw ptr; std.net.Address replaced with bun_core::fmt::format_ip_{v4,v6}
// ──────────────────────────────────────────────────────────────────────────
