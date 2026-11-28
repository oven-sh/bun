//! The WebSockets of a server.

use core::cell::{Cell, OnceCell, RefCell};
use core::ffi::{c_int, c_void};
use core::mem::MaybeUninit;
use core::ptr;
use std::borrow::Cow;
use std::rc::Rc;

use bun_core::strings;
use bun_ptr::BackRef;
use bun_websocket::deflate::{Compressor, Decompressor, InflateError, Params};
use bun_websocket::frame::{
    AUTO_PONG_BACKPRESSURE_LIMIT, Flags, MAX_CONTROL_PAYLOAD, WebsocketHeader, write_unmasked_head,
};
use bun_websocket::handshake;
use bun_websocket::reader::{Failure, Message, Reader, control_frames_len, parse_close};
use bun_websocket::topics::{self, SubscriberId, Topics};

use crate::response::Response;
use crate::socket_group::VTable;
use crate::{
    CloseCode, InternalLoopData, Loop, Opcode, Request, SendStatus, SocketGroup, SocketKind,
    UsIoVec, us_socket_t, uws_res,
};

pub const SHARED_COMPRESSOR: i32 = 1;
pub const SHARED_DECOMPRESSOR: i32 = 1 << 8;
pub const DEDICATED_COMPRESSOR_3KB: i32 = 9 << 4 | 1;
const COMPRESSOR_MASK: i32 = 0x00ff;

/// `LoopData::CORK_COPY_MAX`
const LONG_MESSAGE_LEN: usize = 16 * 1024;
const TIMEOUT_REASON: &[u8] = b"WebSocket timed out from inactivity";

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct WebSocketBehavior {
    /// The low byte is the compressor's window bits and memory level, the next one the decompressor's window bits.
    pub compression: i32,
    pub max_payload_length: u32,
    pub idle_timeout: u16,
    pub max_backpressure: u32,
    pub close_on_backpressure_limit: bool,
    pub send_pings_automatically: bool,
    pub auto_pong: bool,
    pub skip_utf8_validation: bool,
    /// `end()` only sends the Close frame, and a protocol error is reported as `ws.ts` reads it.
    pub is_ws_package: bool,
}

impl Default for WebSocketBehavior {
    fn default() -> Self {
        Self {
            compression: 0,
            max_payload_length: u32::MAX,
            idle_timeout: 120,
            max_backpressure: 1024 * 1024,
            close_on_backpressure_limit: false,
            send_pings_automatically: true,
            auto_pong: true,
            skip_utf8_validation: false,
            is_ws_package: false,
        }
    }
}

impl WebSocketBehavior {
    /// Node has no equivalent of the other limits, and `ws.ts` runs its own close timer.
    pub fn for_ws_package(
        max_payload_length: u32,
        auto_pong: bool,
        skip_utf8_validation: bool,
        compression: bool,
    ) -> Self {
        Self {
            compression: if compression {
                SHARED_COMPRESSOR | SHARED_DECOMPRESSOR
            } else {
                0
            },
            max_payload_length: if max_payload_length == 0 {
                u32::MAX
            } else {
                max_payload_length
            },
            idle_timeout: 0,
            max_backpressure: 0,
            close_on_backpressure_limit: false,
            send_pings_automatically: false,
            auto_pong,
            skip_utf8_validation,
            is_ws_package: true,
        }
    }

    fn timeouts(&self) -> Timeouts {
        let answer = match self.idle_timeout {
            _ if self.is_ws_package => 0,
            ..16 => 4,
            16..32 => 8,
            32.. => 16,
        };
        let pings = self.idle_timeout != 0 && self.send_pings_automatically;
        Timeouts {
            idle: (self.idle_timeout).saturating_sub(if pings { answer } else { 0 }),
            answer,
        }
    }
}

/// In seconds.
#[derive(Clone, Copy, Default)]
struct Timeouts {
    idle: u16,
    /// To a Ping, or to the end of the connection.
    answer: u16,
}

/// User-data type stored on a WebSocket.
///
/// Noalias re-entrancy: `on_event` takes `this: *mut Self`,
/// NOT `&mut self`. The handler body re-enters JS (`ws.send()`, `ws.close()`,
/// promise callbacks…); JS can call back into this same socket via the wrapper
/// object's `m_ptr`, re-deriving a `&mut Self` and mutating its fields. A live
/// `noalias` `&mut Self` argument carried through the dispatch frame would
/// alias that re-entrant borrow (Stacked-Borrows UB) and let LLVM dead-store
/// the re-entrant write. Implementors materialise short-lived `&mut *this`
/// reborrows only — none spanning a JS callback.
pub trait WebSocketHandler: Sized + 'static {
    /// # Safety
    /// `this` is the live `*mut Self` from the socket's user-data slot;
    /// JS-thread only.
    unsafe fn on_event(this: *mut Self, ws: AnyWebSocket, event: Event<'_>);
}

/// Server type that handles the HTTP→WS upgrade.
pub trait WebSocketUpgradeServer<const SSL: bool>: Sized + 'static {
    /// # Safety
    /// `this` is the raw user-data pointer passed to `App::ws()` at registration
    /// time, cast to `*mut Self`. **Its actual pointee type is discriminated by
    /// `id`** — `Bun.serve` registers `*mut UserRoute` for `id == 1` and
    /// `*mut Self` for `id == 0` (see `runtime/server/mod.rs`). Implementers
    /// MUST dispatch on `id` *before* dereferencing `this`; the trampoline
    /// deliberately forwards the raw pointer (no `&mut Self` is ever
    /// materialized) so that the wrong-typed reference is never created when
    /// `id != 0`.
    unsafe fn on_websocket_upgrade(
        this: *mut Self,
        res: &mut Response<SSL>,
        req: &mut Request,
        context: &WebSocketUpgradeContext,
        id: usize,
    );
}

pub(crate) extern "C" fn on_upgrade<Server: WebSocketUpgradeServer<SSL>, const SSL: bool>(
    server: *mut c_void,
    res: *mut uws_res,
    req: &mut Request,
    context: *const c_void,
    id: usize,
) {
    if prepare_upgrade(req) {
        // SAFETY: `App::<SSL>::ws` registered `server` and `context`, which lasts as long as the
        // app, and uWS passes a response of that app.
        unsafe {
            Server::on_websocket_upgrade(server.cast(), &mut *res.cast(), req, &*context.cast(), id)
        }
    }
}

/// False if the request is for the next route.
fn prepare_upgrade(req: &mut Request) -> bool {
    if req.header(b"sec-websocket-key").unwrap_or_default().len() != 24 {
        req.set_yield(true);
        return false;
    }
    if handshake::has_broken_compression(req.header(b"user-agent").unwrap_or_default()) {
        req.parsed().clear_field(b"sec-websocket-extensions");
    }
    true
}

#[derive(Clone, Copy)]
pub enum Event<'a> {
    Open,
    Message(&'a [u8], Opcode),
    Drain,
    Ping(&'a [u8]),
    Pong(&'a [u8]),
    Close(i32, &'a [u8]),
}

fn emit<T: WebSocketHandler>(ws: AnyWebSocket, event: Event<'_>) {
    let this = ws.state().user_data.cast::<T>();
    // SAFETY: the upgrade was given a `T`, which lasts until `Close`, the last event.
    unsafe { T::on_event(this, ws, event) }
}

/// What an app has for its WebSockets.
#[derive(Default)]
pub struct WebSockets {
    /// An upgrade in flight points to one, so none goes before the app.
    contexts: RefCell<Vec<Rc<WebSocketUpgradeContext>>>,
    topics: RefCell<Topics<AnyWebSocket>>,
    shared: OnceCell<&'static SharedDeflate>,
}

impl Drop for WebSockets {
    fn drop(&mut self) {
        if !self.contexts.get_mut().is_empty() {
            c::uws_loop_remove_tick_handler(ptr::from_mut(self).cast());
        }
    }
}

impl WebSockets {
    /// The one with that key or, without a key, that behavior. It keeps the `T` of the first call.
    pub fn context<T: WebSocketHandler>(
        &self,
        key: *const c_void,
        behavior: WebSocketBehavior,
    ) -> BackRef<WebSocketUpgradeContext> {
        self.find_or_add_context(key, behavior, emit::<T>)
    }

    fn find_or_add_context(
        &self,
        key: *const c_void,
        behavior: WebSocketBehavior,
        emit: fn(AnyWebSocket, Event<'_>),
    ) -> BackRef<WebSocketUpgradeContext> {
        extern "C" fn drain(this: *const c_void) {
            // SAFETY: `drop` removes the handler.
            let this = unsafe { &*this.cast::<WebSockets>() };
            this.topics.borrow_mut().drain_all();
        }

        let mut contexts = self.contexts.borrow_mut();
        if contexts.is_empty() {
            c::uws_loop_add_tick_handler(ptr::from_ref(self).cast(), drain);
        }
        let index = contexts.iter().position(|context| {
            context.key == key && (!key.is_null() || context.behavior.get() == behavior)
        });
        let index = index.unwrap_or_else(|| {
            let context = Rc::new(WebSocketUpgradeContext {
                group: SocketGroup::default(),
                loop_data: &Loop::get().internal_loop_data,
                key,
                emit,
                behavior: Cell::new(behavior),
                timeouts: Cell::default(),
                app: BackRef::new(self),
            });
            let owner = Rc::as_ptr(&context).cast_mut().cast();
            context.group.init(Loop::get(), Some(&VTABLE), owner);
            contexts.push(context);
            contexts.len() - 1
        });
        let context = &*contexts[index];
        context.behavior.set(behavior);
        context.timeouts.set(behavior.timeouts());
        if behavior.compression != 0 {
            // Not when the first message arrives, which may be with no memory left.
            self.shared();
        }
        BackRef::new(context)
    }

    fn shared(&self) -> &SharedDeflate {
        // SAFETY: the loop owns it, and outlives its sockets.
        (self.shared).get_or_init(|| unsafe { &*c::uws_loop_shared_deflate().cast() })
    }

    pub fn num_subscribers(&self, topic: &[u8]) -> u32 {
        let topics = self.topics.borrow();
        topics
            .find(topic)
            .map_or(0, |topic| topics.subscribers(topic).len() as u32)
    }

    /// The worst status among the receivers.
    pub fn publish(
        &self,
        topic: &[u8],
        message: &[u8],
        opcode: Opcode,
        compress: bool,
    ) -> SendStatus {
        self.publish_from(None, topic, message, opcode, compress)
    }

    fn publish_from(
        &self,
        sender: Option<SubscriberId>,
        topic: &[u8],
        message: &[u8],
        opcode: Opcode,
        compress: bool,
    ) -> SendStatus {
        let mut topics = self.topics.borrow_mut();
        let Some(topic) = topics.find(topic) else {
            return SendStatus::Dropped;
        };
        if message.len() < LONG_MESSAGE_LEN {
            if !topics.publish(topic, sender, message, opcode, compress) {
                return SendStatus::Dropped;
            }
            return (topics.subscribers(topic).iter())
                .filter(|&&subscriber| Some(subscriber) != sender)
                .map(|&subscriber| topics.receiver(subscriber))
                .filter(|ws| ws.get_buffered_amount() != 0)
                .fold(SendStatus::Success, |worst, ws| worst.max(ws.send_status()));
        }
        let mut worst = None;
        for index in (0..topics.subscribers(topic).len()).rev() {
            let subscriber = topics.subscribers(topic)[index];
            if Some(subscriber) == sender {
                continue;
            }
            let ws = topics.receiver(subscriber);
            worst = worst.max(Some(if ws.drops_message() {
                SendStatus::Dropped
            } else {
                topics.drain(subscriber);
                ws.write_message(message, opcode, compress, true)
            }));
        }
        worst.unwrap_or(SendStatus::Dropped)
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__WebSockets__close(this: &WebSockets) {
    for index in 0.. {
        let Some(context) = this.contexts.borrow().get(index).cloned() else {
            break;
        };
        // A close handler can close the others.
        let mut sockets = Vec::new();
        let mut socket = context.group.head_sockets.get();
        while !socket.is_null() {
            sockets.push(AnyWebSocket(socket));
            socket = c::uws_socket_next(us_socket_t::opaque_mut(socket));
        }
        context.loop_data.keeping_closed_sockets(|| {
            for ws in sockets {
                if !ws.socket().is_closed() {
                    ws.end(1001, b"Server closed");
                }
            }
        });
        context.group.close_all();
    }
}

/// The sockets that have the same handler and behavior.
pub struct WebSocketUpgradeContext {
    group: SocketGroup,
    loop_data: &'static InternalLoopData,
    key: *const c_void,
    emit: fn(AnyWebSocket, Event<'_>),
    behavior: Cell<WebSocketBehavior>,
    timeouts: Cell<Timeouts>,
    app: BackRef<WebSockets>,
}

impl<const SSL: bool> Response<SSL> {
    pub fn upgrade(
        &mut self,
        data: *mut c_void,
        sec_web_socket_key: &[u8],
        sec_web_socket_protocol: &[u8],
        sec_web_socket_extensions: &[u8],
        ctx: &WebSocketUpgradeContext,
    ) -> bool {
        if !self.can_upgrade() {
            return false;
        }
        // The 101 and what the open handler sends go out in one write.
        c::uws_socket_cork(self.socket());

        let mut key = [0; 24];
        let key_len = sec_web_socket_key.len().min(key.len());
        key[..key_len].copy_from_slice(&sec_web_socket_key[..key_len]);
        self.write_status(b"101 Switching Protocols");
        self.write_header(b"Upgrade", b"websocket");
        self.write_header(b"Connection", b"Upgrade");
        self.write_header(
            b"Sec-WebSocket-Accept",
            &handshake::compute_accept_value(&key),
        );
        if !sec_web_socket_protocol.is_empty() {
            let first = strings::split_once_char(sec_web_socket_protocol, b',');
            self.write_header(
                b"Sec-WebSocket-Protocol",
                first.map_or(sec_web_socket_protocol, |(first, _)| first),
            );
        }

        let compression = ctx.behavior.get().compression;
        let mut deflate_params = None;
        if compression != 0
            && let Some((params, response)) = handshake::negotiate_compression(
                sec_web_socket_extensions,
                ((compression & COMPRESSOR_MASK) >> 4) as u8,
                match compression & !COMPRESSOR_MASK {
                    SHARED_DECOMPRESSOR => 0,
                    dedicated => (dedicated >> 8) as u8,
                },
            )
        {
            self.write_header(b"Sec-WebSocket-Extensions", &response);
            deflate_params = Some(params);
        }
        self.write_mark();
        c::uws_socket_write(self.socket(), &UsIoVec::new(b"\r\n"));
        // TLS refused the 101. The next writable event closes the connection.
        if !self.can_upgrade() {
            return false;
        }
        self.become_web_socket(data, deflate_params, ctx);
        true
    }

    /// The complete response head, for a caller that negotiates by itself. False if TLS refused it.
    pub(crate) fn write_handshake(&mut self, handshake: &[u8]) -> bool {
        if !self.can_upgrade() {
            return false;
        }
        c::uws_socket_cork(self.socket());
        c::uws_socket_write(self.socket(), &UsIoVec::new(handshake));
        self.can_upgrade()
    }

    fn socket(&mut self) -> &mut us_socket_t {
        us_socket_t::opaque_mut(ptr::from_mut(self).cast())
    }

    pub(crate) fn become_web_socket(
        &mut self,
        user_data: *mut c_void,
        deflate_params: Option<Params>,
        ctx: &WebSocketUpgradeContext,
    ) {
        assert!(self.can_upgrade());
        let state = State::new(user_data, deflate_params, ctx.behavior.get().compression);
        let ws = AnyWebSocket(self.socket());
        let kind = if SSL {
            SocketKind::UwsWsTls
        } else {
            SocketKind::UwsWs
        };
        // SAFETY: an open HTTP socket. The first call vacates the room for the state, and the second hands the socket to `VTABLE`.
        unsafe {
            c::uws_res_destroy_for_upgrade(SSL.into(), ws.0);
            ws.state_ptr().write(state);
            c::uws_res_adopt_into(SSL.into(), ws.0, &ctx.group, kind as u8);
        }
        ws.set_timeout(ctx.timeouts.get().idle);
        (ctx.loop_data).keeping_closed_sockets(|| ws.emit(Event::Open));
        c::uws_socket_uncork(ws.socket());
    }
}

/// For all the servers of a loop.
struct SharedDeflate {
    compressor: RefCell<Compressor>,
    decompressor: RefCell<Decompressor>,
    compressed: RefCell<Vec<u8>>,
    decompressed: Cell<Vec<u8>>,
}

#[unsafe(no_mangle)]
extern "C" fn Bun__SharedDeflate__create() -> Box<SharedDeflate> {
    Box::new(SharedDeflate {
        compressor: RefCell::new(Compressor::shared()),
        decompressor: RefCell::new(Decompressor::shared()),
        compressed: RefCell::default(),
        decompressed: Cell::default(),
    })
}

#[unsafe(no_mangle)]
extern "C" fn Bun__SharedDeflate__destroy(_: Box<SharedDeflate>) {}

/// Behind `UpgradedSocketData` (HttpResponse.h). Never dropped: `on_close` empties it, under calls that still read it.
struct State {
    user_data: *mut c_void,
    reader: RefCell<Reader>,
    compressor: RefCell<Option<Compressor>>,
    decompressor: RefCell<Option<Decompressor>>,
    subscriber: Cell<Option<SubscriberId>>,
    phase: Cell<Phase>,
    /// A socket of the `ws` package reads on until the peer's Close frame.
    is_close_frame_sent: Cell<bool>,
    has_timed_out: Cell<bool>,
    /// A send reported backpressure, and no drain event has seen an empty buffer since.
    needs_drain_event: Cell<bool>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Open,
    /// More frames were read than the one that a handler has.
    OpenWithUnreadFrames,
    ShuttingDown,
}

impl State {
    fn new(user_data: *mut c_void, deflate_params: Option<Params>, compression: i32) -> Self {
        let is_smallest = compression & COMPRESSOR_MASK == DEDICATED_COMPRESSOR_3KB;
        Self {
            user_data,
            reader: RefCell::new(Reader::new(deflate_params.is_some())),
            compressor: RefCell::new(
                deflate_params.and_then(|params| Compressor::dedicated(params, is_smallest)),
            ),
            decompressor: RefCell::new(deflate_params.and_then(Decompressor::dedicated)),
            subscriber: Cell::new(None),
            phase: Cell::new(Phase::Open),
            is_close_frame_sent: Cell::new(false),
            has_timed_out: Cell::new(false),
            needs_drain_event: Cell::new(false),
        }
    }

    fn is_shutting_down(&self) -> bool {
        self.phase.get() == Phase::ShuttingDown
    }
}

const STATE_OFFSET: usize = 64;
const _: () = assert!(size_of::<State>() <= 128 && align_of::<State>() <= 8);

#[derive(Clone, Copy)]
pub struct AnyWebSocket(*mut us_socket_t);

impl AnyWebSocket {
    /// # Safety
    /// `socket` is from [`Self::us_socket`], and the close handler has not returned.
    pub unsafe fn from_us_socket(socket: *mut us_socket_t) -> Self {
        Self(socket)
    }

    pub fn us_socket(self) -> *mut us_socket_t {
        self.0
    }

    fn socket<'a>(self) -> &'a mut us_socket_t {
        us_socket_t::opaque_mut(self.0)
    }

    fn state_ptr(self) -> *mut State {
        self.socket().ext_ptr().wrapping_add(STATE_OFFSET).cast()
    }

    fn state<'a>(self) -> &'a State {
        // SAFETY: written by the upgrade. No tick under a handler frees a socket that its caller uses again.
        unsafe { &*self.state_ptr() }
    }

    fn context<'a>(self) -> &'a WebSocketUpgradeContext {
        // SAFETY: the owner of its group, which lasts as long as the app.
        unsafe { &*self.socket().group().owner() }
    }

    fn behavior(self) -> WebSocketBehavior {
        self.context().behavior.get()
    }

    fn topics<'a>(self) -> &'a RefCell<Topics<Self>> {
        &self.context().app.get().topics
    }

    fn emit(self, event: Event<'_>) {
        (self.context().emit)(self, event);
    }

    fn set_timeout(self, seconds: u16) {
        self.socket().set_timeout(seconds.into());
    }

    fn restart_idle_timeout(self) {
        self.set_timeout(self.context().timeouts.get().idle);
        self.state().has_timed_out.set(false);
    }

    pub fn memory_cost(self) -> usize {
        c::uws_socket_buffer_capacity(self.socket())
    }

    pub fn get_buffered_amount(self) -> usize {
        c::uws_socket_buffered_amount(self.socket())
    }

    pub fn get_remote_address(self, buf: &mut [u8]) -> Option<&[u8]> {
        self.socket().remote_address(buf).ok()
    }

    /// Run `f` while the socket is corked.
    pub fn cork<R>(self, f: impl FnOnce() -> R) -> R {
        if c::uws_socket_is_corked(self.socket()) {
            return f();
        }
        c::uws_socket_cork(self.socket());
        let result = self.context().loop_data.keeping_closed_sockets(f);
        c::uws_socket_uncork(self.socket());
        result
    }

    /// Stops reading from the socket and suspends its idle timeout.
    pub fn pause(self) {
        if !self.has_stopped_reading() {
            self.socket().pause();
            self.set_timeout(0);
        }
    }

    pub fn resume(self) {
        if self.is_paused() {
            self.socket().resume();
            if !self.socket().is_closed() {
                self.restart_idle_timeout();
            }
        }
    }

    pub fn is_paused(self) -> bool {
        c::uws_socket_is_paused(self.socket())
    }

    fn has_stopped_reading(self) -> bool {
        self.socket().is_closed() || self.state().is_shutting_down()
    }

    /// What `send` would return now.
    fn send_status(self) -> SendStatus {
        let limit = self.behavior().max_backpressure as usize;
        match self.get_buffered_amount() {
            0 => SendStatus::Success,
            buffered if limit != 0 && limit < buffered => SendStatus::Dropped,
            _ => SendStatus::Backpressure,
        }
    }

    fn drops_message(self) -> bool {
        let drops = self.send_status() == SendStatus::Dropped;
        if drops && self.behavior().close_on_backpressure_limit {
            self.socket().shutdown_read();
        }
        drops
    }

    pub fn send(self, message: &[u8], opcode: Opcode, compress: bool, fin: bool) -> SendStatus {
        if self.drops_message() {
            return SendStatus::Dropped;
        }
        if let Some(subscriber) = self.state().subscriber.get() {
            self.topics().borrow_mut().drain(subscriber);
        } else if message.len() >= LONG_MESSAGE_LEN
            && !compress
            && self.socket().kind() == SocketKind::UwsWs
            && self.get_buffered_amount() == 0
            && !c::uws_socket_has_corked_bytes(self.socket())
        {
            return self.write_frame_directly(message, opcode, fin);
        }
        self.write_message(message, opcode, compress, fin)
    }

    fn write_message(
        self,
        message: &[u8],
        opcode: Opcode,
        compress: bool,
        fin: bool,
    ) -> SendStatus {
        if compress && fin {
            self.write_compressed(message, opcode)
        } else {
            self.write_frame(
                message,
                opcode,
                if fin { Flags::Final } else { Flags::None },
            )
        }
    }

    #[inline(never)]
    fn write_compressed(self, message: &[u8], opcode: Opcode) -> SendStatus {
        let state = self.state();
        if message.is_empty()
            || !matches!(opcode, Opcode::Text | Opcode::Binary)
            || !state.reader.borrow().allows_compression()
            || self.behavior().compression & COMPRESSOR_MASK == 0
        {
            return self.write_frame(message, opcode, Flags::Final);
        }
        let shared = self.context().app.get().shared();
        let out = &mut *shared.compressed.borrow_mut();
        let is_compressed = match &mut *state.compressor.borrow_mut() {
            Some(compressor) => compressor.compress(message, out),
            None => shared.compressor.borrow_mut().compress(message, out),
        };
        if is_compressed {
            self.write_frame(out, opcode, Flags::FinalCompressed)
        } else {
            self.write_frame(message, opcode, Flags::Final)
        }
    }

    fn write_frame(self, payload: &[u8], opcode: Opcode, flags: Flags) -> SendStatus {
        let len = WebsocketHeader::frame_size(payload.len(), false);
        let mut attribute = 0;
        let buffer = c::uws_socket_send_buffer(self.socket(), len, &mut attribute);
        // SAFETY: room for `len` bytes, until the next call on a socket.
        let buffer = unsafe { core::slice::from_raw_parts_mut(buffer, len) };
        let (_, rest) = write_unmasked_head(buffer, opcode, payload.len(), flags);
        rest.write_copy_of_slice(payload);
        self.after_write(match attribute {
            c::NEEDS_DRAIN => self.write(b""),
            c::NEEDS_UNCORK => c::uws_socket_uncork(self.socket()),
            _ => false,
        })
    }

    fn write_frame_directly(self, payload: &[u8], opcode: Opcode, fin: bool) -> SendStatus {
        let mut head = [MaybeUninit::uninit(); 10];
        let flags = if fin { Flags::Final } else { Flags::None };
        let (head, _) = write_unmasked_head(&mut head, opcode, payload.len(), flags);
        let at_once = payload.len().min(c_int::MAX as usize - head.len());
        let written = self.socket().write2(head, &payload[..at_once]) as usize;
        let has_backpressure = written != head.len() + payload.len();
        if has_backpressure {
            for rest in [
                &head[written.min(head.len())..],
                &payload[written.saturating_sub(head.len())..],
            ] {
                c::uws_socket_buffer(self.socket(), &UsIoVec::new(rest));
            }
            c::uws_socket_uncork_without_sending(self.socket());
        }
        self.after_write(has_backpressure)
    }

    fn after_write(self, has_backpressure: bool) -> SendStatus {
        if has_backpressure {
            self.state().needs_drain_event.set(true);
            return SendStatus::Backpressure;
        }
        if !self.behavior().is_ws_package && !self.is_paused() {
            self.restart_idle_timeout();
        }
        SendStatus::Success
    }

    /// After what is buffered. True if something still is.
    fn write(self, bytes: &[u8]) -> bool {
        c::uws_socket_write(self.socket(), &UsIoVec::new(bytes))
    }

    /// Without a closing handshake.
    pub fn close(self) {
        if self.has_stopped_reading() {
            return;
        }
        self.drain_topics();
        c::uws_socket_uncork(self.socket());
        // Callers rely on the close handler having run.
        self.socket().close(CloseCode::fast_shutdown);
        if !self.socket().is_closed() {
            self.socket().close(CloseCode::failure);
        }
    }

    pub fn end(self, code: i32, message: &[u8]) {
        if self.behavior().is_ws_package {
            self.send_close_frame(code, message);
        } else {
            self.conclude(code, message);
        }
    }

    fn conclude(self, code: i32, message: &[u8]) {
        if self.shut_down(code, message) {
            self.emit(Event::Close(code, message));
        }
    }

    /// Only the first call sends it.
    fn send_close_frame(self, code: i32, message: &[u8]) {
        if !self.state().is_close_frame_sent.replace(true) {
            self.drain_topics();
            self.leave_topics();
            let mut payload = [0; MAX_CONTROL_PAYLOAD];
            let message = &message[..message.len().min(MAX_CONTROL_PAYLOAD - 2)];
            payload[..2].copy_from_slice(&(code as u16).to_be_bytes());
            payload[2..][..message.len()].copy_from_slice(message);
            let len = match code as u16 {
                0 | 1005 | 1006 => 0,
                _ => 2 + message.len(),
            };
            self.write_frame(&payload[..len], Opcode::Close, Flags::Final);
        }
        c::uws_socket_uncork(self.socket());
    }

    /// The Close frame, then the FIN. False if that has begun before.
    fn shut_down(self, code: i32, message: &[u8]) -> bool {
        if self.state().phase.replace(Phase::ShuttingDown) == Phase::ShuttingDown {
            return false;
        }
        self.send_close_frame(code, message);
        if self.get_buffered_amount() == 0 {
            self.socket().shutdown();
        }
        self.set_timeout(self.context().timeouts.get().answer);
        // To see the peer's FIN.
        self.socket().resume();
        true
    }

    fn fail(self, failure: Failure) {
        let (code, reason) = failure.close();
        let reason = if self.behavior().is_ws_package {
            b""
        } else {
            reason
        };
        if self.shut_down(code.into(), reason) {
            self.emit_failure(failure);
        }
    }

    fn emit_failure(self, failure: Failure) {
        if !self.behavior().is_ws_package {
            return self.emit(Event::Close(1006, failure.close().1));
        }
        let (kind, number) = failure.for_ws_package();
        let mut digits = bun_core::fmt::ItoaBuf::new();
        let digits = number.map(|number| bun_core::fmt::itoa(&mut digits, number));
        self.emit(Event::Close(-kind, digits.unwrap_or_default()));
    }

    /// Closes the connection with 1011 after failing to allocate a copy of an incoming message. It must not allocate either.
    pub fn fail_out_of_memory(self) {
        if self.state().is_shutting_down() {
            return;
        }
        self.leave_topics();
        if self.get_buffered_amount() == 0 {
            return self.fail(Failure::OutOfMemory);
        }
        // A Close frame would grow the buffer.
        self.state().phase.set(Phase::ShuttingDown);
        self.emit_failure(Failure::OutOfMemory);
        self.socket().close(CloseCode::failure);
    }

    pub fn subscribe(self, topic: &[u8]) -> bool {
        let mut topics = self.topics().borrow_mut();
        let slot = &self.state().subscriber;
        let subscriber = slot.get().unwrap_or_else(|| topics.add_subscriber(self));
        slot.set(Some(subscriber));
        topics.subscribe(subscriber, topic);
        true
    }

    pub fn unsubscribe(self, topic: &[u8]) -> bool {
        let Some(subscriber) = self.state().subscriber.get() else {
            return false;
        };
        let mut topics = self.topics().borrow_mut();
        let was_subscribed = topics.unsubscribe(subscriber, topic);
        if topics.names(subscriber).len() == 0 {
            topics.drain(subscriber);
            topics.remove_subscriber(subscriber);
            self.state().subscriber.set(None);
        }
        was_subscribed
    }

    pub fn is_subscribed(self, topic: &[u8]) -> bool {
        let subscriber = self.state().subscriber.get();
        subscriber.is_some_and(|subscriber| self.topics().borrow().is_subscribed(subscriber, topic))
    }

    /// `f` must leave the subscriptions of the app as they are.
    pub fn subscriptions<R>(
        self,
        f: impl FnOnce(&mut dyn ExactSizeIterator<Item = &[u8]>) -> R,
    ) -> R {
        match self.state().subscriber.get() {
            Some(subscriber) => f(&mut self.topics().borrow().names(subscriber)),
            None => f(&mut core::iter::empty()),
        }
    }

    /// To all but this one.
    pub fn publish(
        self,
        topic: &[u8],
        message: &[u8],
        opcode: Opcode,
        compress: bool,
    ) -> SendStatus {
        let sender = self.state().subscriber.get();
        let app = self.context().app;
        app.publish_from(sender, topic, message, opcode, compress)
    }

    fn drain_topics(self) {
        if let Some(subscriber) = self.state().subscriber.get() {
            self.topics().borrow_mut().drain(subscriber);
        }
    }

    fn leave_topics(self) {
        if let Some(subscriber) = self.state().subscriber.take() {
            self.topics().borrow_mut().remove_subscriber(subscriber);
        }
    }

    fn read(self, mut input: &mut [u8]) -> Result<(), Failure> {
        let reader = &self.state().reader;
        let mut room = [MaybeUninit::uninit(); MAX_CONTROL_PAYLOAD];
        while !input.is_empty() {
            let max_len = self.behavior().max_payload_length;
            let message = (reader.borrow_mut()).read_frame(&mut input, max_len, &mut room);
            self.state().phase.set(if input.is_empty() {
                Phase::Open
            } else {
                Phase::OpenWithUnreadFrames
            });
            let Some(message) = message? else {
                continue;
            };
            self.handle(&message)?;
            if self.has_stopped_reading() {
                reader.borrow_mut().release();
                break;
            }
            if let Cow::Owned(buffer) = message.payload {
                reader.borrow_mut().reuse(buffer);
            }
        }
        Ok(())
    }

    fn handle(self, message: &Message<'_>) -> Result<(), Failure> {
        let payload = &*message.payload;
        match message.opcode {
            Opcode::Close => {
                let (code, reason) = parse_close(payload, !self.behavior().skip_utf8_validation)?;
                self.conclude(code.into(), reason);
            }
            Opcode::Ping => {
                if self.behavior().auto_pong
                    && !self.state().is_close_frame_sent.get()
                    && self.get_buffered_amount() <= AUTO_PONG_BACKPRESSURE_LIMIT
                {
                    self.send(payload, Opcode::Pong, false, true);
                }
                self.emit(Event::Ping(payload));
            }
            Opcode::Pong => self.emit(Event::Pong(payload)),
            opcode if message.is_compressed => {
                let shared = self.context().app.get().shared();
                let max_len = self.behavior().max_payload_length as usize;
                let mut out = shared.decompressed.take();
                let result = match &mut *self.state().decompressor.borrow_mut() {
                    Some(decompressor) => decompressor.decompress(payload, &mut out, max_len),
                    None => {
                        (shared.decompressor.borrow_mut()).decompress(payload, &mut out, max_len)
                    }
                };
                let result = match result {
                    Ok(()) => self.emit_message(&out, opcode),
                    Err(InflateError::Corrupt) => Err(Failure::CompressedData),
                    Err(InflateError::TooLarge) => Err(Failure::MessageTooBig),
                    Err(InflateError::OutOfMemory) => return Err(Failure::OutOfMemory),
                };
                shared.decompressed.set(out);
                result?;
            }
            opcode => self.emit_message(payload, opcode)?,
        }
        Ok(())
    }

    fn emit_message(self, message: &[u8], opcode: Opcode) -> Result<(), Failure> {
        if opcode == Opcode::Text
            && !self.behavior().skip_utf8_validation
            && !strings::is_valid_utf8(message)
        {
            return Err(Failure::Text);
        }
        self.emit(Event::Message(message, opcode));
        Ok(())
    }
}

impl topics::Receiver for AnyWebSocket {
    fn receive<'a>(self, messages: impl Iterator<Item = &'a topics::Message>) {
        self.cork(|| {
            for message in messages.take_while(|_| !self.drops_message()) {
                self.write_message(&message.payload, message.opcode, message.compress, true);
            }
        });
    }
}

static VTABLE: VTable = VTable {
    on_open: None,
    on_data: Some(on_data),
    on_fd: None,
    on_writable: Some(on_writable),
    on_close: Some(on_close),
    on_timeout: Some(on_timeout),
    on_long_timeout: None,
    on_end: Some(on_end),
    on_connect_error: None,
    on_connecting_error: None,
    on_handshake: None,
};

extern "C" fn on_data(socket: *mut us_socket_t, data: *mut u8, len: c_int) -> *mut us_socket_t {
    let ws = AnyWebSocket(socket);
    let state = ws.state();
    // SAFETY: the loop lends what it read for the call.
    let data = unsafe { core::slice::from_raw_parts_mut(data, len as usize) };
    match state.phase.get() {
        Phase::Open => {}
        Phase::OpenWithUnreadFrames => return on_data_before_unread_frames(ws, data),
        Phase::ShuttingDown => return socket,
    }
    // The rest of a TLS read arrives after a pause too.
    if !ws.is_paused() {
        ws.set_timeout(ws.context().timeouts.get().idle);
    }
    state.has_timed_out.set(false);

    c::uws_socket_cork(ws.socket());
    if let Err(failure) = ws.read(data) {
        state.reader.borrow_mut().release();
        match failure {
            Failure::OutOfMemory => ws.fail_out_of_memory(),
            _ => ws.fail(failure),
        }
    }
    c::uws_socket_uncork(ws.socket());
    socket
}

/// A handler runs the event loop. Only control frames may overtake the others.
#[cold]
fn on_data_before_unread_frames(ws: AnyWebSocket, data: &mut [u8]) -> *mut us_socket_t {
    let (control_frames, rest) = data.split_at_mut(control_frames_len(data));
    let failure = (rest.first()).map(|byte| Failure::Interleaved(Opcode::from_raw(byte & 0xf)));
    ws.state().phase.set(Phase::Open);
    on_data(
        ws.0,
        control_frames.as_mut_ptr(),
        control_frames.len() as c_int,
    );
    if !ws.has_stopped_reading() {
        ws.state().phase.set(Phase::OpenWithUnreadFrames);
        if let Some(failure) = failure {
            ws.fail(failure);
        }
    }
    ws.0
}

extern "C" fn on_writable(socket: *mut us_socket_t) -> *mut us_socket_t {
    let ws = AnyWebSocket(socket);
    if ws.socket().is_shutdown() {
        return socket;
    }
    let state = ws.state();
    let before = ws.get_buffered_amount();
    ws.write(b"");
    let after = ws.get_buffered_amount();

    if before == 0 || before > after {
        if state.is_shutting_down() {
            ws.set_timeout(ws.context().timeouts.get().answer);
        } else if !ws.is_paused() {
            ws.restart_idle_timeout();
        }
    }
    if state.is_shutting_down() {
        if after == 0 {
            ws.socket().shutdown();
        }
    } else if before > after || (before == 0 && state.needs_drain_event.get()) {
        // An empty buffer is not enough: `pause` and `resume` poll for writable too.
        state.needs_drain_event.set(after != 0);
        ws.emit(Event::Drain);
    }
    socket
}

extern "C" fn on_close(
    socket: *mut us_socket_t,
    _: c_int,
    reason: *mut c_void,
) -> *mut us_socket_t {
    let ws = AnyWebSocket(socket);
    let state = ws.state();
    c::uws_socket_on_upgraded_close(ws.socket());
    if !state.is_shutting_down() {
        ws.leave_topics();
        let reason = if reason.is_null() {
            b""
        } else {
            TIMEOUT_REASON
        };
        ws.emit(Event::Close(1006, reason));
    }
    ws.leave_topics();
    state.reader.borrow_mut().release();
    state.compressor.take();
    state.decompressor.take();
    c::uws_socket_clear_buffer(ws.socket());
    socket
}

extern "C" fn on_timeout(socket: *mut us_socket_t) -> *mut us_socket_t {
    let ws = AnyWebSocket(socket);
    let state = ws.state();
    if ws.behavior().send_pings_automatically
        && !state.is_shutting_down()
        && !state.has_timed_out.replace(true)
    {
        ws.set_timeout(ws.context().timeouts.get().answer);
        ws.write(b"\x89\x00");
    } else {
        // With a reason, TLS does not wait to send what it holds.
        let reason = TIMEOUT_REASON.as_ptr().cast_mut().cast();
        ws.socket()
            .close_with_reason(CloseCode::fast_shutdown, reason);
    }
    socket
}

extern "C" fn on_end(socket: *mut us_socket_t) -> *mut us_socket_t {
    let ws = AnyWebSocket(socket);
    c::uws_socket_uncork_without_sending(ws.socket());
    ws.socket().close(CloseCode::normal);
    socket
}

mod c {
    use super::*;

    /// `uWS::SendBufferAttribute`
    pub(super) const NEEDS_DRAIN: c_int = 1;
    pub(super) const NEEDS_UNCORK: c_int = 2;

    unsafe extern "C" {
        pub(super) safe fn uws_loop_add_tick_handler(
            key: *const c_void,
            handler: extern "C" fn(*const c_void),
        );
        pub(super) safe fn uws_loop_remove_tick_handler(key: *const c_void);
        pub(super) safe fn uws_loop_shared_deflate() -> *const c_void;
        pub(super) fn uws_res_destroy_for_upgrade(ssl: c_int, socket: *mut us_socket_t);
        pub(super) fn uws_res_adopt_into(
            ssl: c_int,
            socket: *mut us_socket_t,
            group: &SocketGroup,
            kind: u8,
        );
        pub(super) safe fn uws_socket_on_upgraded_close(socket: &mut us_socket_t);
        pub(super) safe fn uws_socket_next(socket: &mut us_socket_t) -> *mut us_socket_t;
        pub(super) safe fn uws_socket_is_paused(socket: &mut us_socket_t) -> bool;
        pub(super) safe fn uws_socket_cork(socket: &mut us_socket_t);
        pub(super) safe fn uws_socket_uncork(socket: &mut us_socket_t) -> bool;
        pub(super) safe fn uws_socket_uncork_without_sending(socket: &mut us_socket_t);
        pub(super) safe fn uws_socket_is_corked(socket: &mut us_socket_t) -> bool;
        pub(super) safe fn uws_socket_has_corked_bytes(socket: &mut us_socket_t) -> bool;
        pub(super) safe fn uws_socket_send_buffer(
            socket: &mut us_socket_t,
            len: usize,
            attribute: &mut c_int,
        ) -> *mut MaybeUninit<u8>;
        pub(super) safe fn uws_socket_write(socket: &mut us_socket_t, bytes: &UsIoVec<'_>) -> bool;
        pub(super) safe fn uws_socket_buffer(socket: &mut us_socket_t, bytes: &UsIoVec<'_>);
        pub(super) safe fn uws_socket_buffered_amount(socket: &mut us_socket_t) -> usize;
        pub(super) safe fn uws_socket_buffer_capacity(socket: &mut us_socket_t) -> usize;
        pub(super) safe fn uws_socket_clear_buffer(socket: &mut us_socket_t);
    }
}
