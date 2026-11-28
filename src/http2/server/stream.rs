use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::ptr;
use std::rc::Rc;

use bun_core::fmt::{ItoaBuf, itoa};
use bun_hpack::Indexing;
use bun_http_types::h2::{ErrorCode, FrameType};
use bun_http1::queue::Queue;

use super::connection::{Connection, Pin};
use super::output::{END_STREAM, Fields};
use super::{Host, INITIAL_STREAM_WINDOW, WIDE_STREAM_WINDOW};

bitflags::bitflags! {
    /// With the values of an HTTP/1 response.
    #[repr(transparent)]
    #[derive(Clone, Copy)]
    pub struct State: u8 {
        const STATUS_CALLED = 1;
        const WRITE_CALLED = 2;
        const END_CALLED = 4;
        const RESPONSE_PENDING = 8;
        const WROTE_CONTENT_LENGTH = 32;
        const WROTE_DATE = 64;
    }
}

/// Gets how much of the body was sent. False if it has more to send.
pub type OnWritable<H> = fn(&Rc<Stream<H>>, u64, *mut c_void) -> bool;
pub type OnEvent<H> = fn(&Rc<Stream<H>>, *mut c_void);
pub type OnData<H> = fn(&Rc<Stream<H>>, &[u8], bool, *mut c_void);

/// That of the server.
pub(super) const DEFAULT_TIMEOUT: u8 = 255;

/// RFC 9113 §8.2.2
fn is_connection_specific(name: &[u8], value: &[u8]) -> bool {
    let is = |other: &[u8]| name.eq_ignore_ascii_case(other);
    match name.len() {
        2 => is(b"te") && !value.eq_ignore_ascii_case(b"trailers"),
        7 => is(b"upgrade"),
        10 => is(b"connection") || is(b"keep-alive"),
        16 => is(b"proxy-connection"),
        17 => is(b"transfer-encoding"),
        _ => false,
    }
}

/// A request and its response. It lasts until `on_aborted` has run, which is never under a call on it.
pub struct Stream<H: Host> {
    connection: Rc<Connection<H>>,
    pub(super) id: u32,
    pub(super) send_window: Cell<i32>,
    receive_window: Cell<u32>,
    /// Bytes that no WINDOW_UPDATE has given back.
    unacknowledged: Cell<u32>,
    content_length: Option<u64>,
    received: Cell<u64>,

    pub(super) is_remote_closed: Cell<bool>,
    is_end_delivered: Cell<bool>,
    is_paused: Cell<bool>,
    /// It is in `Connection::waiting`.
    pub(super) is_waiting: Cell<bool>,
    /// It is not in `Connection::streams` any more, and only `on_aborted` can still run.
    pub(super) is_retired: Cell<bool>,
    /// In seconds. 0 is none.
    pub(super) timeout: Cell<u8>,
    timeout_after_pause: Cell<u8>,

    user_data: Cell<*mut c_void>,
    writable_user_data: Cell<*mut c_void>,
    on_writable: Cell<Option<OnWritable<H>>>,
    on_aborted: Cell<Option<OnEvent<H>>>,
    on_timeout: Cell<Option<OnEvent<H>>>,
    on_data: Cell<Option<OnData<H>>>,

    pub state: Cell<State>,
    fields: RefCell<Fields>,
    unsent: RefCell<Queue>,
    ends_after_unsent: Cell<bool>,
    sent: Cell<u64>,
}

impl<H: Host> Stream<H> {
    pub(super) fn new(
        connection: Rc<Connection<H>>,
        id: u32,
        send_window: i32,
        content_length: Option<u64>,
        is_remote_closed: bool,
    ) -> Rc<Self> {
        Rc::new(Self {
            connection,
            id,
            send_window: Cell::new(send_window),
            receive_window: Cell::new(INITIAL_STREAM_WINDOW),
            unacknowledged: Cell::new(0),
            content_length,
            received: Cell::new(0),
            is_remote_closed: Cell::new(is_remote_closed),
            is_end_delivered: Cell::new(false),
            is_paused: Cell::new(false),
            is_waiting: Cell::new(false),
            is_retired: Cell::new(false),
            timeout: Cell::new(DEFAULT_TIMEOUT),
            timeout_after_pause: Cell::new(DEFAULT_TIMEOUT),
            user_data: Cell::new(ptr::null_mut()),
            writable_user_data: Cell::new(ptr::null_mut()),
            on_writable: Cell::new(None),
            on_aborted: Cell::new(None),
            on_timeout: Cell::new(None),
            on_data: Cell::new(None),
            state: Cell::new(State::RESPONSE_PENDING),
            fields: RefCell::default(),
            unsent: RefCell::default(),
            ends_after_unsent: Cell::new(false),
            sent: Cell::new(0),
        })
    }

    /// `None` once it has closed.
    pub fn socket(&self) -> Option<H::Socket> {
        self.connection.socket()
    }

    pub fn state(&self) -> State {
        self.state.get()
    }

    pub fn mark(&self, state: State) {
        self.state.set(self.state() | state);
    }

    /// False if it was marked before.
    fn mark_once(&self, state: State) -> bool {
        !self.state.replace(self.state() | state).contains(state)
    }

    pub fn is_retired(&self) -> bool {
        self.is_retired.get()
    }

    pub fn has_request_body_ended(&self) -> bool {
        self.is_remote_closed.get() || self.content_length == Some(0)
    }

    pub fn buffered_amount(&self) -> usize {
        self.unsent.borrow().len()
    }

    pub fn set_on_writable(&self, handler: Option<OnWritable<H>>, user_data: *mut c_void) {
        self.on_writable.set(handler);
        self.writable_user_data.set(user_data);
    }

    pub fn set_on_aborted(&self, handler: Option<OnEvent<H>>, user_data: *mut c_void) {
        self.on_aborted.set(handler);
        self.set_user_data(handler.is_some(), user_data);
    }

    pub fn set_on_timeout(&self, handler: Option<OnEvent<H>>, user_data: *mut c_void) {
        self.on_timeout.set(handler);
        self.set_user_data(handler.is_some(), user_data);
    }

    pub fn set_on_data(&self, handler: Option<OnData<H>>, user_data: *mut c_void) {
        self.on_data.set(handler);
        self.set_user_data(handler.is_some(), user_data);
    }

    fn set_user_data(&self, has_handler: bool, user_data: *mut c_void) {
        if has_handler {
            self.user_data.set(user_data);
        }
    }

    pub fn write_status(&self, status: &[u8]) {
        if self.mark_once(State::STATUS_CALLED) {
            let mut fields = self.connection.server.take_fields();
            fields.push(b":status", status.first_chunk().unwrap_or(b"200"));
            self.fields.replace(fields);
        }
    }

    pub fn write_header(&self, name: &[u8], value: &[u8]) {
        self.write_status(b"200");
        if !is_connection_specific(name, value) {
            (self.fields.borrow_mut().push(name, value)).make_ascii_lowercase();
        }
    }

    pub fn write_header_int(&self, name: &[u8], value: u64) {
        self.write_header(name, itoa(&mut ItoaBuf::new(), value));
    }

    pub fn write_date(&self) {
        if self.mark_once(State::WROTE_DATE) {
            self.write_status(b"200");
            (self.fields.borrow_mut()).push(b"date", &self.connection.server.host.date());
        }
    }

    pub fn write_continue(&self) {
        if !self.is_retired() {
            let mut fields = self.connection.server.take_fields();
            fields.push(b":status", b"100");
            self.send_fields(fields, Indexing::Without, false);
            self.connection.flush_later();
        }
    }

    fn send_fields(&self, fields: Fields, indexing: Indexing, ends_stream: bool) {
        (self.connection.output()).header_block(self.id, &fields, indexing, ends_stream);
        self.connection.server.return_fields(fields);
    }

    fn send_head(&self, ends_stream: bool) {
        self.send_fields(self.fields.take(), Indexing::Allowed, ends_stream);
        self.connection.output().has_stream_bytes = true;
        self.mark(State::WRITE_CALLED);
    }

    pub fn flush_headers(&self) {
        if !self.is_retired() && !self.state().contains(State::WRITE_CALLED) {
            self.write_status(b"200");
            self.write_date();
            self.send_head(false);
            self.connection.flush_later();
        }
    }

    fn send_data(&self, body: &[u8], ends_stream: bool) -> usize {
        let window = self.send_window.get();
        let sent = (self.connection.output()).data(self.id, window, body, ends_stream);
        self.send_window.set(window - sent as i32);
        self.sent.update(|before| before + sent as u64);
        sent
    }

    fn send_end(&self) {
        (self.connection.output()).frame(FrameType::HTTP_FRAME_DATA, END_STREAM, self.id, b"");
    }

    /// Returns how much was sent, as `Err` if there is something to wait for. The rest is kept.
    pub fn write(self: &Rc<Self>, chunk: &[u8]) -> Result<usize, usize> {
        if self.is_retired() {
            return Err(0);
        }
        self.flush_headers();
        let has_unsent = self.buffered_amount() != 0;
        let sent = if has_unsent {
            0
        } else {
            self.send_data(chunk, false)
        };
        let must_wait = has_unsent || sent < chunk.len();
        if must_wait {
            (self.unsent.borrow_mut()).append(chunk.get(sent..).unwrap_or_default());
            self.wait();
        }
        self.connection.flush_later();
        if must_wait { Err(sent) } else { Ok(sent) }
    }

    pub fn end(self: &Rc<Self>, body: &[u8]) {
        self.end_with(body, body.len() as u64, true);
    }

    pub(super) fn end_with_status(self: &Rc<Self>, status: &[u8]) {
        self.write_status(status);
        self.end(b"");
    }

    /// False if `on_writable` has to go on.
    pub fn try_end(self: &Rc<Self>, body: &[u8], total_len: u64) -> bool {
        self.end_with(body, total_len, false)
    }

    fn end_with(self: &Rc<Self>, body: &[u8], total_len: u64, keeps_rest: bool) -> bool {
        if self.is_retired() {
            return keeps_rest;
        }
        if !self.state().contains(State::WRITE_CALLED) {
            self.write_status(b"200");
            self.write_date();
            if self.mark_once(State::WROTE_CONTENT_LENGTH) {
                let mut digits = ItoaBuf::new();
                (self.fields.borrow_mut()).push(b"content-length", itoa(&mut digits, total_len));
            }
            let ends_stream = body.is_empty() && self.sent.get() >= total_len;
            self.send_head(ends_stream);
            if ends_stream {
                self.finish();
                return true;
            }
        }

        let mut rest = body;
        if self.buffered_amount() == 0 {
            let ends_stream = self.sent.get() + body.len() as u64 >= total_len;
            rest = (body.get(self.send_data(body, ends_stream)..)).unwrap_or_default();
            if ends_stream && rest.is_empty() {
                self.finish();
                return true;
            }
        }
        if keeps_rest {
            self.unsent.borrow_mut().append(rest);
            self.ends_after_unsent.set(true);
        }
        self.wait();
        self.connection.flush_later();
        false
    }

    pub fn end_without_body(self: &Rc<Self>) {
        if self.is_retired() {
            return;
        }
        if !self.state().contains(State::WRITE_CALLED) {
            self.write_status(b"200");
            self.write_date();
            self.send_head(true);
        } else if self.buffered_amount() != 0 {
            self.ends_after_unsent.set(true);
            self.wait();
            self.mark_done();
            return self.connection.flush_later();
        } else {
            self.send_end();
        }
        self.finish();
    }

    /// After the chunks of `write`.
    pub fn end_stream(self: &Rc<Self>) {
        if self.is_retired() {
            return;
        }
        self.flush_headers();
        if self.buffered_amount() != 0 {
            self.ends_after_unsent.set(true);
            self.wait();
        } else {
            self.send_end();
            self.finish();
        }
    }

    /// After END_STREAM.
    fn finish(self: &Rc<Self>) {
        self.mark_done();
        if !self.is_remote_closed.get() {
            // RFC 9113 §8.1: the peer can stop sending the body.
            (self.connection.output()).rst_stream(self.id, ErrorCode::NO_ERROR);
        }
        self.retire(false);
    }

    /// `on_aborted` stays: it tells the holder when the stream goes.
    fn mark_done(&self) {
        self.on_data.set(None);
        (self.state).update(|state| (state | State::END_CALLED) - State::RESPONSE_PENDING);
    }

    /// For when a response fails after it has begun.
    pub fn abort(self: &Rc<Self>) {
        if !self.is_retired() {
            (self.connection.output()).rst_stream(self.id, ErrorCode::INTERNAL_ERROR);
            self.retire(false);
        }
    }

    pub fn pause(&self) {
        if !self.is_paused.replace(true) {
            self.timeout_after_pause.set(self.timeout.replace(0));
            self.connection.update_idle_timeout();
        }
    }

    pub fn resume(&self) {
        if !self.is_paused.replace(false) {
            return;
        }
        self.timeout.set(self.timeout_after_pause.get());
        self.connection.update_idle_timeout();
        if !self.is_retired() && !self.is_remote_closed.get() && self.unacknowledged.get() != 0 {
            (self.connection.output()).window_update(self.id, self.unacknowledged.take());
            self.connection.flush_later();
        }
    }

    /// For when the handler begins to read the body.
    pub fn widen_receive_window(&self) {
        if self.is_retired()
            || self.is_remote_closed.get()
            || self.receive_window.replace(WIDE_STREAM_WINDOW) == WIDE_STREAM_WINDOW
        {
            return;
        }
        let increment = WIDE_STREAM_WINDOW - INITIAL_STREAM_WINDOW + self.unacknowledged.take();
        self.connection.output().window_update(self.id, increment);
        self.connection.flush_later();
    }

    pub fn cork(self: &Rc<Self>, f: impl FnOnce()) {
        let connection = Pin::new(&self.connection);
        f();
        connection.uncork();
    }

    pub fn set_timeout(&self, seconds: u8) {
        if self.is_retired() {
            return;
        }
        let seconds = seconds.min(DEFAULT_TIMEOUT - 1);
        if self.is_paused.get() {
            self.timeout_after_pause.set(seconds);
        } else {
            self.timeout.set(seconds);
            self.connection.update_idle_timeout();
        }
    }

    pub fn reset_timeout(&self) {
        if !self.is_retired() {
            self.connection.restart_idle_timeout();
        }
    }

    pub(super) fn wait(self: &Rc<Self>) {
        if !self.is_retired() && !self.is_waiting.replace(true) {
            self.connection.waiting.borrow_mut().push(Rc::clone(self));
        }
    }

    pub(super) fn has_more_to_send(&self) -> bool {
        self.buffered_amount() != 0 || self.on_writable.get().is_some()
    }

    /// False if it has to wait again.
    pub(super) fn send_more(self: &Rc<Self>) -> bool {
        if self.buffered_amount() != 0 {
            let unsent = &mut *self.unsent.borrow_mut();
            let sent = self.send_data(unsent.as_slice(), self.ends_after_unsent.get());
            unsent.erase(sent);
            if !unsent.is_empty() {
                return false;
            }
        }
        if self.ends_after_unsent.get() {
            self.finish();
            return true;
        }
        (self.on_writable.get())
            .is_none_or(|handler| handler(self, self.sent.get(), self.writable_user_data.get()))
    }

    pub(super) fn retire(self: &Rc<Self>, is_aborted: bool) {
        if self.is_retired.replace(true) {
            return;
        }
        let connection = &self.connection;
        let take_from = |streams: &RefCell<Vec<Rc<Self>>>| {
            let streams = &mut *streams.borrow_mut();
            let index = streams.iter().rposition(|other| Rc::ptr_eq(self, other));
            index.map(|index| streams.remove(index))
        };
        let retired = take_from(&connection.streams);
        if self.is_waiting.take() {
            take_from(&connection.waiting);
        }
        if is_aborted {
            self.emit_aborted();
        }
        connection.retired.borrow_mut().extend(retired);
        connection.flush_later();
        if self.timeout.get() != DEFAULT_TIMEOUT {
            connection.update_idle_timeout();
        }
    }

    pub(super) fn emit_aborted(self: &Rc<Self>) {
        if let Some(handler) = self.on_aborted.take() {
            handler(self, self.user_data.get());
        }
    }

    pub(super) fn emit_timeout(self: &Rc<Self>) {
        if !self.is_retired()
            && let Some(handler) = self.on_timeout.get()
        {
            handler(self, self.user_data.get());
        }
    }

    /// `frame_len` has the padding too.
    pub(super) fn receive(
        self: &Rc<Self>,
        body: &[u8],
        frame_len: u32,
        is_last: bool,
    ) -> Result<(), ErrorCode> {
        let unacknowledged = self.unacknowledged.get();
        let window = self.receive_window.get();
        if frame_len > window - unacknowledged {
            return Err(ErrorCode::FLOW_CONTROL_ERROR);
        }
        let received = self.received.get() + body.len() as u64;
        self.received.set(received);
        if (self.content_length).is_some_and(|len| received > len || is_last && received != len) {
            return Err(ErrorCode::PROTOCOL_ERROR);
        }
        if is_last {
            self.is_remote_closed.set(true);
            self.deliver_end(body);
            return Ok(());
        }
        self.unacknowledged.set(unacknowledged + frame_len);
        if window == WIDE_STREAM_WINDOW
            && !self.is_paused.get()
            && self.unacknowledged.get() >= window / 2
        {
            (self.connection.output()).window_update(self.id, self.unacknowledged.take());
        }
        if let Some(handler) = self.on_data.get() {
            handler(self, body, false, self.user_data.get());
        }
        Ok(())
    }

    pub(super) fn deliver_end(self: &Rc<Self>, body: &[u8]) {
        if let Some(handler) = self.on_data.get()
            && !self.is_retired()
            && !self.is_end_delivered.replace(true)
        {
            handler(self, body, true, self.user_data.get());
        }
    }
}
