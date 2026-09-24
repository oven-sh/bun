//! Transport-neutral RFC 6455 framing over an extended CONNECT stream.
//!
//! Stream flow control and scheduling remain in the transport response; this
//! module owns only WebSocket message state. Application callbacks receive raw
//! pointers so re-entrant JavaScript cannot alias a live Rust `&mut` borrow.

use core::ffi::c_void;
use core::ptr;

use crate::{Opcode, SendStatus};

/// Compile-time boundary between the shared WebSocket state machine and one
/// multiplexed HTTP stream implementation.
///
/// Implementations must keep response and parser pointers valid until the
/// registered abort callback retires the `WebSocket`, invoke registered
/// callbacks with their original user pointer, invoke parser callbacks only
/// synchronously from a parser operation while the outer call is pinned, and
/// treat cork callbacks as synchronous. Write, timeout, orderly-end, and cancel
/// semantics remain the responsibility of the concrete transport.
pub trait Transport {
    type Response;
    type Parser;

    unsafe fn parser_create(
        response: *mut Self::Response,
        max_payload_length: usize,
        max_backpressure: usize,
        close_on_backpressure_limit: bool,
        compression: u16,
        extension_offer: &[u8],
        user: *mut c_void,
        fragment_handler: unsafe extern "C" fn(
            *mut c_void,
            *const u8,
            usize,
            u32,
            i32,
            bool,
        ) -> bool,
        fail_handler: unsafe extern "C" fn(*mut c_void, i32),
    ) -> *mut Self::Parser;
    unsafe fn parser_consume(parser: *mut Self::Parser, data: *const u8, length: usize);
    unsafe fn parser_destroy(parser: *mut Self::Parser);
    unsafe fn parser_memory_cost(parser: *mut Self::Parser) -> usize;
    unsafe fn parser_subscribe(parser: *mut Self::Parser, topic: *const u8, length: usize) -> bool;
    unsafe fn parser_unsubscribe(
        parser: *mut Self::Parser,
        topic: *const u8,
        length: usize,
    ) -> bool;
    unsafe fn parser_is_subscribed(
        parser: *mut Self::Parser,
        topic: *const u8,
        length: usize,
    ) -> bool;
    unsafe fn parser_publish(
        parser: *mut Self::Parser,
        topic: *const u8,
        topic_length: usize,
        data: *const u8,
        data_length: usize,
        opcode: i32,
        compress: bool,
    ) -> u32;
    unsafe fn parser_get_topics(
        parser: *mut Self::Parser,
        callback: unsafe extern "C" fn(*mut c_void, *const u8, usize),
        user: *mut c_void,
    );
    unsafe fn parser_unsubscribe_all(parser: *mut Self::Parser);
    unsafe fn parser_send(
        parser: *mut Self::Parser,
        data: *const u8,
        length: usize,
        opcode: i32,
        compress: bool,
        fin: bool,
        max_backpressure: usize,
        limit_exceeded: *mut bool,
    ) -> u32;

    unsafe fn response_on_data(
        response: *mut Self::Response,
        handler: unsafe extern "C" fn(*mut Self::Response, *const u8, usize, bool, *mut c_void),
        user: *mut c_void,
    );
    unsafe fn response_on_writable(
        response: *mut Self::Response,
        handler: unsafe extern "C" fn(*mut Self::Response, u64, *mut c_void) -> bool,
        user: *mut c_void,
    );
    unsafe fn response_on_aborted(
        response: *mut Self::Response,
        handler: unsafe extern "C" fn(*mut Self::Response, *mut c_void),
        user: *mut c_void,
    );
    unsafe fn response_on_timeout(
        response: *mut Self::Response,
        handler: unsafe extern "C" fn(*mut Self::Response, *mut c_void),
        user: *mut c_void,
    );
    unsafe fn response_websocket_timeout(response: *mut Self::Response, seconds: u16);
    unsafe fn response_websocket_timeout_config(
        response: *mut Self::Response,
        seconds: u16,
        refresh_on_write: bool,
    );
    unsafe fn response_websocket_timeout_refresh_on_write(
        response: *mut Self::Response,
        enabled: bool,
    );
    unsafe fn response_get_buffered_amount(response: *mut Self::Response) -> u64;
    unsafe fn response_remote_address(
        response: *mut Self::Response,
    ) -> Option<crate::SocketAddress>;
    unsafe fn response_end_stream(response: *mut Self::Response, close_connection: bool);
    unsafe fn response_cancel(response: *mut Self::Response);
    unsafe fn response_cork(
        response: *mut Self::Response,
        user: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void),
    );
}

pub struct WebSocketBehavior<T: Transport> {
    pub compression: u16,
    /// Idle period before an automatic ping (or close when pings are off).
    pub idle_timeout: u16,
    /// Grace period after an automatic ping and during the close handshake.
    pub ping_timeout: u16,
    pub send_pings_automatically: bool,
    pub reset_idle_timeout_on_send: bool,
    pub max_payload_length: usize,
    pub max_backpressure: usize,
    pub close_on_backpressure_limit: bool,
    pub open: Option<unsafe fn(*mut WebSocket<T>)>,
    pub message: Option<unsafe fn(*mut WebSocket<T>, *const u8, usize, Opcode)>,
    pub drain: Option<unsafe fn(*mut WebSocket<T>)>,
    pub ping: Option<unsafe fn(*mut WebSocket<T>, *const u8, usize)>,
    pub pong: Option<unsafe fn(*mut WebSocket<T>, *const u8, usize)>,
    pub close: Option<unsafe fn(*mut WebSocket<T>, i32, *const u8, usize)>,
}

impl<T: Transport> Copy for WebSocketBehavior<T> {}

impl<T: Transport> Clone for WebSocketBehavior<T> {
    fn clone(&self) -> Self {
        *self
    }
}

pub struct WebSocket<T: Transport> {
    response: *mut T::Response,
    parser: *mut T::Parser,
    user_data: *mut c_void,
    behavior: WebSocketBehavior<T>,
    fragmented: Vec<u8>,
    control: Vec<u8>,
    closing: bool,
    awaiting_pong: bool,
    close_emitted: bool,
    dead: bool,
    active_calls: usize,
    free_pending: bool,
}

impl<T: Transport> Drop for WebSocket<T> {
    fn drop(&mut self) {
        if !self.parser.is_null() {
            // SAFETY: parser was allocated for this WebSocket and is destroyed
            // exactly once when the deferred stream owner is reclaimed.
            unsafe { T::parser_destroy(self.parser) };
            self.parser = ptr::null_mut();
        }
    }
}

/// Keeps the allocation alive while a transport or application callback may
/// synchronously re-enter and retire the underlying stream.
struct CallGuard<T: Transport>(*mut WebSocket<T>);

impl<T: Transport> Drop for CallGuard<T> {
    fn drop(&mut self) {
        // SAFETY: creating a guard increments active_calls. The last guard is
        // the only owner allowed to reclaim an allocation marked free_pending.
        unsafe {
            let ws = &mut *self.0;
            debug_assert!(ws.active_calls != 0);
            ws.active_calls -= 1;
            if ws.active_calls == 0 && ws.free_pending {
                drop(Box::from_raw(self.0));
            }
        }
    }
}

impl<T: Transport> WebSocket<T> {
    /// Prepare an accepted Extended CONNECT stream without exposing it to
    /// application callbacks yet. This lets the caller allocate the JS-facing
    /// ServerWebSocket only after the native stream transition succeeded.
    pub unsafe fn prepare_upgrade(
        response: *mut T::Response,
        behavior: WebSocketBehavior<T>,
        extension_offer: &[u8],
    ) -> Option<*mut Self> {
        let this = Box::into_raw(Box::new(Self {
            response,
            parser: ptr::null_mut(),
            user_data: ptr::null_mut(),
            behavior,
            fragmented: Vec::new(),
            control: Vec::new(),
            closing: false,
            awaiting_pong: false,
            close_emitted: false,
            dead: false,
            active_calls: 0,
            free_pending: false,
        }));
        let parser = unsafe {
            T::parser_create(
                response,
                behavior.max_payload_length,
                behavior.max_backpressure,
                behavior.close_on_backpressure_limit,
                behavior.compression,
                extension_offer,
                this.cast(),
                Self::on_fragment,
                Self::on_parser_fail,
            )
        };
        if parser.is_null() {
            unsafe { T::response_cancel(response) };
            drop(unsafe { Box::from_raw(this) });
            return None;
        }
        unsafe { (*this).parser = parser };
        Some(this)
    }

    /// Attach the application object and publish the prepared stream. Once
    /// this returns true, ownership lasts until the response's deferred
    /// `onAborted` notification.
    ///
    /// # Safety
    /// `this` must come from `prepare_upgrade`, and `user_data` must remain
    /// valid until the close callback retires the ServerWebSocket.
    pub unsafe fn activate(this: *mut Self, user_data: *mut c_void) -> bool {
        let Some(guard) = Self::pin(this) else {
            return false;
        };
        if unsafe { (*this).dead || (*this).parser.is_null() } {
            return false;
        }
        unsafe { (*this).user_data = user_data };
        let response = unsafe { (*this).response };
        if response.is_null() {
            return false;
        }
        unsafe {
            T::response_on_data(response, Self::on_data, this.cast());
            T::response_on_writable(response, Self::on_writable, this.cast());
            T::response_on_aborted(response, Self::on_aborted, this.cast());
            T::response_on_timeout(response, Self::on_timeout, this.cast());
            T::response_websocket_timeout_config(response, (*this).behavior.idle_timeout, true);
        }
        if let Some(open) = unsafe { (*this).behavior.open } {
            unsafe { open(this) };
        }
        drop(guard);
        // Once the callbacks are installed, the upgrade was accepted even if
        // `open` synchronously closes this stream or stops the server. This
        // matches HTTP/1: server.upgrade() must not fall through and attempt
        // to write a second HTTP response after user code closes the socket.
        true
    }

    #[inline]
    pub fn user_data(this: *mut Self) -> *mut c_void {
        if this.is_null() {
            return ptr::null_mut();
        }
        // SAFETY: callers only hold this pointer while the stream is live.
        unsafe { (*this).user_data }
    }

    pub fn memory_cost(this: *mut Self) -> usize {
        if this.is_null() {
            return 0;
        }
        // SAFETY: live stream handle.
        let this = unsafe { &*this };
        core::mem::size_of::<Self>()
            + this.fragmented.capacity()
            + this.control.capacity()
            + unsafe { T::parser_memory_cost(this.parser) }
    }

    /// Feed bytes already received on the Extended CONNECT stream before the
    /// JavaScript upgrade decision completed.
    ///
    /// # Safety
    /// `this` must be a live stream WebSocket handle and `data` must remain valid
    /// for this synchronous call.
    pub unsafe fn consume(this: *mut Self, data: &[u8]) {
        let Some(_guard) = Self::pin(this) else {
            return;
        };
        let parser = unsafe { (*this).parser };
        if parser.is_null() || unsafe { (*this).dead || (*this).closing } {
            return;
        }
        unsafe { T::parser_consume(parser, data.as_ptr(), data.len()) };
    }

    pub fn buffered_amount(this: *mut Self) -> usize {
        let Some(response) = Self::response(this) else {
            return 0;
        };
        unsafe { T::response_get_buffered_amount(response) as usize }
    }

    pub fn remote_address(this: *mut Self) -> Option<crate::SocketAddress> {
        Self::response(this).and_then(|response| unsafe { T::response_remote_address(response) })
    }

    pub fn cork<C>(this: *mut Self, ctx: &mut C, callback: fn(&mut C)) {
        let Some(_guard) = Self::pin(this) else {
            return callback(ctx);
        };
        // Do not materialize `&mut Response` here. The cork callback enters
        // JavaScript synchronously and can call `ws.send()` / `ws.close()` on
        // this same stream, which must be free to derive a fresh transport
        // handle without aliasing an exclusive Rust reference held by the
        // outer frame. This mirrors the established raw-pointer H1 WS cork
        // path; `_guard` pins the stream allocation across re-entrancy.
        let response = unsafe {
            if (*this).dead {
                ptr::null_mut()
            } else {
                (*this).response
            }
        };
        if response.is_null() {
            return callback(ctx);
        }
        type CorkContext<C> = (*mut C, fn(&mut C));
        extern "C" fn run<C>(user: *mut c_void) {
            // SAFETY: cork is synchronous, so the stack tuple and its context
            // pointer both remain live until this callback returns.
            let cork = unsafe { &*user.cast::<CorkContext<C>>() };
            (cork.1)(unsafe { &mut *cork.0 });
        }
        let mut cork = (ptr::from_mut(ctx), callback);
        // SAFETY: response is the live opaque handle pinned by `_guard`; C++
        // invokes `run` synchronously and does not retain the stack pointer.
        unsafe { T::response_cork(response, (&raw mut cork).cast(), run::<C>) };
    }

    pub fn send(
        this: *mut Self,
        message: &[u8],
        opcode: Opcode,
        _compress: bool,
        fin: bool,
    ) -> SendStatus {
        let Some(_guard) = Self::pin(this) else {
            return SendStatus::Dropped;
        };
        // Extract all state before calling into the transport; no borrow spans
        // an operation that can eventually re-enter application code.
        let (dead, closing, max_backpressure, close_on_limit) = unsafe {
            let ws = &*this;
            (
                ws.dead,
                ws.closing,
                ws.behavior.max_backpressure,
                ws.behavior.close_on_backpressure_limit,
            )
        };
        if dead || (closing && opcode.0 != 8) || !matches!(opcode.0, 0 | 1 | 2 | 8 | 9 | 10) {
            return SendStatus::Dropped;
        }

        if Self::response(this).is_none() {
            return SendStatus::Dropped;
        }
        let parser = unsafe { (*this).parser };
        if parser.is_null() {
            return SendStatus::Dropped;
        }
        let mut limit_exceeded = false;
        // Reserve room for the one mandatory Close response even when normal
        // application data has reached its configured limit. `closing`
        // prevents a second Close frame, so the bounded 127-byte allowance
        // cannot accumulate. A zero limit retains Bun's unlimited setting.
        let limit = if opcode.0 == 8 && max_backpressure != 0 {
            max_backpressure.saturating_add(127)
        } else {
            max_backpressure
        };
        let status = unsafe {
            T::parser_send(
                parser,
                message.as_ptr(),
                message.len(),
                opcode.0,
                _compress,
                fin,
                limit,
                &raw mut limit_exceeded,
            )
        };
        if limit_exceeded && close_on_limit {
            Self::close(this);
        }
        let status = match status {
            0 => SendStatus::Backpressure,
            1 => SendStatus::Success,
            _ => SendStatus::Dropped,
        };
        if status == SendStatus::Success
            && !closing
            && unsafe { (*this).behavior.reset_idle_timeout_on_send }
        {
            unsafe { (*this).awaiting_pong = false };
            if let Some(response) = Self::response(this) {
                unsafe {
                    T::response_websocket_timeout_config(
                        response,
                        (*this).behavior.idle_timeout,
                        true,
                    )
                };
            }
        }
        status
    }

    pub fn subscribe(this: *mut Self, topic: &[u8]) -> bool {
        let Some(_guard) = Self::pin(this) else {
            return false;
        };
        let parser = unsafe { (*this).parser };
        !parser.is_null() && unsafe { T::parser_subscribe(parser, topic.as_ptr(), topic.len()) }
    }

    pub fn unsubscribe(this: *mut Self, topic: &[u8]) -> bool {
        let Some(_guard) = Self::pin(this) else {
            return false;
        };
        let parser = unsafe { (*this).parser };
        !parser.is_null() && unsafe { T::parser_unsubscribe(parser, topic.as_ptr(), topic.len()) }
    }

    pub fn is_subscribed(this: *mut Self, topic: &[u8]) -> bool {
        let Some(_guard) = Self::pin(this) else {
            return false;
        };
        let parser = unsafe { (*this).parser };
        !parser.is_null() && unsafe { T::parser_is_subscribed(parser, topic.as_ptr(), topic.len()) }
    }

    pub fn publish(
        this: *mut Self,
        topic: &[u8],
        message: &[u8],
        opcode: Opcode,
        compress: bool,
    ) -> SendStatus {
        let Some(_guard) = Self::pin(this) else {
            return SendStatus::Dropped;
        };
        let parser = unsafe { (*this).parser };
        if parser.is_null() {
            return SendStatus::Dropped;
        }
        match unsafe {
            T::parser_publish(
                parser,
                topic.as_ptr(),
                topic.len(),
                message.as_ptr(),
                message.len(),
                opcode.0,
                compress,
            )
        } {
            0 => SendStatus::Backpressure,
            1 => SendStatus::Success,
            _ => SendStatus::Dropped,
        }
    }

    pub fn topics(this: *mut Self) -> Vec<Vec<u8>> {
        let Some(_guard) = Self::pin(this) else {
            return Vec::new();
        };
        let parser = unsafe { (*this).parser };
        if parser.is_null() {
            return Vec::new();
        }
        let mut topics = Vec::new();
        unsafe extern "C" fn collect(user: *mut c_void, data: *const u8, length: usize) {
            if user.is_null() || (data.is_null() && length != 0) {
                return;
            }
            // SAFETY: the C++ iterator invokes this synchronously and the
            // pointer is valid for the callback duration.
            let out = unsafe { &mut *user.cast::<Vec<Vec<u8>>>() };
            let bytes = unsafe { core::slice::from_raw_parts(data, length) };
            out.push(bytes.to_vec());
        }
        unsafe { T::parser_get_topics(parser, collect, (&raw mut topics).cast()) };
        topics
    }

    pub fn end(this: *mut Self, code: i32, message: &[u8]) {
        let Some(_guard) = Self::pin(this) else {
            return;
        };
        let should_end = unsafe {
            let ws = &mut *this;
            if ws.dead || ws.closing {
                false
            } else {
                ws.closing = true;
                true
            }
        };
        if !should_end {
            return;
        }
        if let Some(response) = Self::response(this) {
            unsafe { T::response_websocket_timeout_refresh_on_write(response, false) };
        }
        let wire_message = &message[..message.len().min(123)];
        let mut payload = Vec::with_capacity(wire_message.len() + 2);
        if code != 0 && code != 1005 && code != 1006 {
            payload.extend_from_slice(&(code as u16).to_be_bytes());
            payload.extend_from_slice(wire_message);
        }
        let _ = Self::send_frame_while_closing(this, &payload, Opcode(8));
        Self::emit_close(this, code, message);
        if let Some(response) = Self::response(this) {
            unsafe { T::response_end_stream(response, false) };
            unsafe { T::response_websocket_timeout(response, (*this).behavior.ping_timeout) };
        }
    }

    pub fn close(this: *mut Self) {
        let Some(_guard) = Self::pin(this) else {
            return;
        };
        let should_close = unsafe {
            let ws = &mut *this;
            if ws.dead || ws.closing {
                false
            } else {
                ws.closing = true;
                true
            }
        };
        if !should_close {
            return;
        }
        // terminate() is a logical close immediately, even though the stream
        // response allocation and its onAborted callback are retired on a
        // deferred sweep. Match H1 by leaving TopicTree synchronously.
        let parser = unsafe { (*this).parser };
        if !parser.is_null() {
            unsafe { T::parser_unsubscribe_all(parser) };
        }
        if let Some(response) = Self::response(this) {
            unsafe { T::response_websocket_timeout_refresh_on_write(response, false) };
            unsafe { T::response_cancel(response) };
        }
    }

    fn send_frame_while_closing(this: *mut Self, payload: &[u8], opcode: Opcode) -> SendStatus {
        // Temporarily permit the close frame through `send`'s closing gate.
        Self::send(this, payload, opcode, false, true)
    }

    fn response(this: *mut Self) -> Option<*mut T::Response> {
        if this.is_null() {
            return None;
        }
        // SAFETY: the response owns this WebSocket and outlives it.
        let ptr = unsafe { (*this).response };
        if ptr.is_null() || unsafe { (*this).dead } {
            None
        } else {
            Some(ptr)
        }
    }

    fn pin(this: *mut Self) -> Option<CallGuard<T>> {
        if this.is_null() {
            return None;
        }
        // SAFETY: public operations are reachable only through the live
        // ServerWebSocket handle or an installed transport callback. A
        // pending free cannot complete while an earlier guard is active.
        unsafe {
            let ws = &mut *this;
            ws.active_calls = ws.active_calls.checked_add(1)?;
        }
        Some(CallGuard(this))
    }

    fn emit_close(this: *mut Self, code: i32, message: &[u8]) {
        let (callback, parser) = unsafe {
            let ws = &mut *this;
            if ws.close_emitted {
                return;
            }
            ws.close_emitted = true;
            (ws.behavior.close, ws.parser)
        };
        // Match H1: a closing socket leaves the topic tree before its close
        // callback runs. This keeps subscriberCount(), ws.subscriptions, and
        // publications accurate throughout the close-grace period.
        if !parser.is_null() {
            unsafe { T::parser_unsubscribe_all(parser) };
        }
        if let Some(callback) = callback {
            unsafe { callback(this, code, message.as_ptr(), message.len()) };
        }
    }

    fn fail(this: *mut Self, code: i32) {
        Self::end(this, code, &[]);
    }

    unsafe extern "C" fn on_data(
        _response: *mut T::Response,
        data: *const u8,
        length: usize,
        fin: bool,
        user: *mut c_void,
    ) {
        let this = user.cast::<Self>();
        let Some(_guard) = Self::pin(this) else {
            return;
        };
        if length != 0 || fin {
            unsafe { (*this).awaiting_pong = false };
            if !unsafe { (*this).closing } {
                if let Some(response) = Self::response(this) {
                    unsafe {
                        T::response_websocket_timeout_config(
                            response,
                            (*this).behavior.idle_timeout,
                            true,
                        )
                    };
                }
            }
        }
        let parser = unsafe { (*this).parser };
        if length != 0 && !unsafe { (*this).closing } && !parser.is_null() {
            // SAFETY: the transport callback supplies data[..length] for this call;
            // the parser copies it into its padded mutable scratch buffer.
            unsafe { T::parser_consume(parser, data, length) };
        }

        if fin && !unsafe { (*this).close_emitted } {
            Self::emit_close(this, 1006, &[]);
            if let Some(response) = Self::response(this) {
                unsafe { T::response_end_stream(response, false) };
            }
        }
    }

    unsafe extern "C" fn on_parser_fail(user: *mut c_void, code: i32) {
        let this = user.cast::<Self>();
        if !this.is_null() {
            Self::fail(this, code);
        }
    }

    unsafe extern "C" fn on_fragment(
        user: *mut c_void,
        data: *const u8,
        length: usize,
        remaining: u32,
        opcode: i32,
        fin: bool,
    ) -> bool {
        let this = user.cast::<Self>();
        if this.is_null() || unsafe { (*this).dead || (*this).closing } {
            return true;
        }
        // SAFETY: the parser's padded scratch buffer stays live for this
        // synchronous callback.
        let payload = unsafe { core::slice::from_raw_parts(data, length) };
        match opcode {
            1 | 2 => Self::handle_data_fragment(this, payload, remaining, Opcode(opcode), fin),
            8 | 9 | 10 => Self::handle_control_fragment(this, payload, remaining, opcode),
            _ => Self::fail(this, 1002),
        }
        unsafe { (*this).dead || (*this).closing }
    }

    fn handle_data_fragment(
        this: *mut Self,
        payload: &[u8],
        remaining: u32,
        opcode: Opcode,
        fin: bool,
    ) {
        let max_payload = unsafe { (*this).behavior.max_payload_length };
        let buffered = unsafe { (*this).fragmented.len() };
        let Some(aggregate) = buffered.checked_add(payload.len()) else {
            return Self::fail(this, 1009);
        };
        let Some(expected) = aggregate.checked_add(remaining as usize) else {
            return Self::fail(this, 1009);
        };
        if expected > max_payload {
            return Self::fail(this, 1009);
        }

        if remaining == 0 && fin && unsafe { (*this).fragmented.is_empty() } {
            if opcode == Opcode::Text && core::str::from_utf8(payload).is_err() {
                return Self::fail(this, 1007);
            }
            if let Some(callback) = unsafe { (*this).behavior.message } {
                unsafe { callback(this, payload.as_ptr(), payload.len(), opcode) };
            }
            return;
        }

        unsafe {
            let fragmented = &mut (*this).fragmented;
            fragmented.reserve(expected - buffered);
            fragmented.extend_from_slice(payload);
        }
        if remaining != 0 || !fin {
            return;
        }
        let message = core::mem::take(unsafe { &mut (*this).fragmented });
        if opcode == Opcode::Text && core::str::from_utf8(&message).is_err() {
            return Self::fail(this, 1007);
        }
        if let Some(callback) = unsafe { (*this).behavior.message } {
            unsafe { callback(this, message.as_ptr(), message.len(), opcode) };
        }
        // The application callback may synchronously re-enter this WebSocket.
        // Reuse the completed allocation only if no nested fragment is pending.
        if !unsafe { (*this).dead || (*this).closing } {
            recycle_buffer(unsafe { &mut (*this).fragmented }, message);
        }
    }

    fn handle_control_fragment(this: *mut Self, payload: &[u8], remaining: u32, opcode: i32) {
        if remaining == 0 && unsafe { (*this).control.is_empty() } {
            return Self::handle_control(this, payload, opcode);
        }
        unsafe { (*this).control.extend_from_slice(payload) };
        if remaining != 0 {
            return;
        }
        let payload = core::mem::take(unsafe { &mut (*this).control });
        Self::handle_control(this, &payload, opcode);
    }

    fn handle_control(this: *mut Self, payload: &[u8], opcode: i32) {
        match opcode {
            8 => match parse_close(payload) {
                Ok((code, message)) => {
                    if !unsafe { (*this).closing } {
                        unsafe { (*this).closing = true };
                        if let Some(response) = Self::response(this) {
                            unsafe {
                                T::response_websocket_timeout_refresh_on_write(response, false)
                            };
                        }
                        let _ = Self::send_frame_while_closing(this, payload, Opcode(8));
                    }
                    Self::emit_close(this, code, message);
                    if let Some(response) = Self::response(this) {
                        unsafe { T::response_end_stream(response, false) };
                        unsafe {
                            T::response_websocket_timeout(response, (*this).behavior.ping_timeout)
                        };
                    }
                }
                Err(code) => Self::fail(this, code),
            },
            9 => {
                let pong = Self::send(this, payload, Opcode::Pong, false, true);
                // A peer can continue sending Pings while withholding its
                // outbound window. Do not retain unbounded Pong responses or
                // silently keep an RFC-noncompliant tunnel after dropping the
                // newest one: reset only this stream on resource exhaustion.
                if pong == SendStatus::Dropped {
                    return Self::close(this);
                }
                if unsafe { (*this).dead || (*this).closing } {
                    return;
                }
                if let Some(callback) = unsafe { (*this).behavior.ping } {
                    unsafe { callback(this, payload.as_ptr(), payload.len()) };
                }
            }
            10 => {
                if let Some(callback) = unsafe { (*this).behavior.pong } {
                    unsafe { callback(this, payload.as_ptr(), payload.len()) };
                }
            }
            _ => Self::fail(this, 1002),
        }
    }

    unsafe extern "C" fn on_writable(
        _response: *mut T::Response,
        _offset: u64,
        user: *mut c_void,
    ) -> bool {
        let this = user.cast::<Self>();
        let Some(_guard) = Self::pin(this) else {
            return true;
        };
        if unsafe { (*this).dead } {
            return true;
        }
        let cb = unsafe { (*this).behavior.drain };
        if let Some(cb) = cb {
            unsafe { cb(this) };
        }
        true
    }

    unsafe extern "C" fn on_timeout(_response: *mut T::Response, user: *mut c_void) {
        let this = user.cast::<Self>();
        let Some(_guard) = Self::pin(this) else {
            return;
        };
        let (dead, closing, awaiting_pong, send_pings) = unsafe {
            let ws = &*this;
            (
                ws.dead,
                ws.closing,
                ws.awaiting_pong,
                ws.behavior.send_pings_automatically,
            )
        };
        if dead {
            return;
        }
        if closing || awaiting_pong || !send_pings {
            return Self::close(this);
        }

        if let Some(response) = Self::response(this) {
            unsafe { T::response_websocket_timeout_refresh_on_write(response, false) };
        }
        if Self::send(this, &[], Opcode::Ping, false, true) == SendStatus::Dropped {
            return Self::close(this);
        }
        unsafe { (*this).awaiting_pong = true };
        // Match uWebSockets: the configured timeout is split into the normal
        // idle period and a shorter grace period after the automatic ping.
        if let Some(response) = Self::response(this) {
            unsafe {
                T::response_websocket_timeout_config(response, (*this).behavior.ping_timeout, false)
            };
        }
    }

    unsafe extern "C" fn on_aborted(_response: *mut T::Response, user: *mut c_void) {
        let this = user.cast::<Self>();
        let Some(_guard) = Self::pin(this) else {
            return;
        };
        unsafe {
            if !(*this).parser.is_null() {
                T::parser_unsubscribe_all((*this).parser);
            }
            (*this).dead = true;
            (*this).response = ptr::null_mut();
            (*this).free_pending = true;
        }
        if !unsafe { (*this).close_emitted } {
            Self::emit_close(this, 1006, &[]);
        }
        // `_guard` reclaims the allocation after this callback and any outer
        // re-entrant operation have both unwound.
    }
}

fn recycle_buffer(slot: &mut Vec<u8>, mut completed: Vec<u8>) {
    completed.clear();
    if slot.is_empty() && completed.capacity() > slot.capacity() {
        core::mem::swap(slot, &mut completed);
    }
}

fn parse_close(payload: &[u8]) -> Result<(i32, &[u8]), i32> {
    if payload.is_empty() {
        return Ok((1005, &[]));
    }
    if payload.len() == 1 {
        return Err(1002);
    }
    let code = u16::from_be_bytes([payload[0], payload[1]]);
    if code < 1000
        || code > 4999
        || (1004..=1006).contains(&code)
        || code == 1015
        || (1016..3000).contains(&code)
    {
        return Err(1002);
    }
    let message = &payload[2..];
    if core::str::from_utf8(message).is_err() {
        return Err(1007);
    }
    Ok((i32::from(code), message))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_close_payload() {
        assert_eq!(parse_close(&1000u16.to_be_bytes()), Ok((1000, &[][..])));
        assert_eq!(parse_close(&1005u16.to_be_bytes()), Err(1002));
        assert_eq!(parse_close(&[0x03]), Err(1002));
    }

    #[test]
    fn recycles_completed_fragment_allocation_without_overwriting_reentrant_data() {
        let mut slot = Vec::new();
        let mut completed = Vec::with_capacity(1024);
        completed.extend_from_slice(b"complete");
        recycle_buffer(&mut slot, completed);
        assert_eq!(slot.len(), 0);
        assert!(slot.capacity() >= 1024);

        slot.extend_from_slice(b"nested fragment");
        let mut nested_completion = Vec::with_capacity(2048);
        nested_completion.extend_from_slice(b"nested completion");
        recycle_buffer(&mut slot, nested_completion);
        assert_eq!(slot, b"nested fragment");
        assert!(slot.capacity() < 2048);
    }
}
