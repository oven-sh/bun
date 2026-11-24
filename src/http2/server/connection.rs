use core::cell::{Cell, RefCell, RefMut};
use core::ops::Deref;
use std::rc::Rc;
use std::time::Instant;

use bun_hpack::Decoder;
use bun_http_types::h2::{
    CLIENT_PREFACE, DEFAULT_MAX_FRAME_SIZE, DEFAULT_WINDOW_SIZE, ErrorCode, FrameHeader, FrameType,
    MAX_STREAM_ID, MAX_WINDOW_SIZE, SettingsType,
};
use bun_http1::queue::Queue;

use super::output::{ACK, END_HEADERS, END_STREAM, Output, RecentStreams};
use super::request::DecodeBuffer;
use super::stream::{DEFAULT_TIMEOUT, Stream};
use super::{
    CONNECTION_WINDOW, HIGH_WATER_MARK, Host, INITIAL_STREAM_WINDOW, MAX_CONCURRENT_STREAMS,
    MAX_FRAME_SIZE, Request, Server, Socket,
};

const PADDED: u8 = 0x8;
const PRIORITY: u8 = 0x20;

/// Each INITIAL_WINDOW_SIZE walks the open streams.
const MAX_SETTINGS_PER_FRAME: usize = 32;
const MAX_CONTINUATION_FRAMES: u8 = 32;
/// Against a peer that makes us answer and never reads (CVE-2019-9512, CVE-2019-9515).
const MAX_QUEUED_CONTROL: usize = 1 << 20;
/// Against a peer that opens and resets streams (CVE-2023-44487).
const RESET_BURST: f64 = 1000.0;
const RESETS_PER_SECOND: f64 = 33.0;

/// `Err` ends the connection.
type Result<T = ()> = core::result::Result<T, ErrorCode>;

fn check(is_valid: bool, otherwise: ErrorCode) -> Result {
    if is_valid { Ok(()) } else { Err(otherwise) }
}

fn read_u31(bytes: [u8; 4]) -> u32 {
    u32::from_be_bytes(bytes) & MAX_STREAM_ID
}

#[derive(Clone, Copy)]
struct HeadersFrame {
    stream: u32,
    ends_stream: bool,
    depends_on_itself: bool,
}

struct PartialHeaderBlock {
    frame: HeadersFrame,
    bytes: Vec<u8>,
    continuation_frames: u8,
}

pub struct Connection<H: Host> {
    pub(super) server: Rc<Server<H>>,
    /// `None` once it has closed.
    socket: Cell<Option<H::Socket>>,
    pins: Cell<u32>,
    /// A call under a pin has left something to send.
    is_flush_due: Cell<bool>,
    idle_timeout: Cell<u32>,
    output: RefCell<Output>,

    decoder: RefCell<Decoder>,
    partial_frame: RefCell<Queue>,
    partial_header_block: RefCell<Option<PartialHeaderBlock>>,
    missing_preface: Cell<&'static [u8]>,
    has_received_settings: Cell<bool>,
    /// A frame of this read has moved a stream.
    has_progressed: Cell<bool>,
    initial_send_window: Cell<i32>,
    unacknowledged: Cell<u32>,
    last_stream: Cell<u32>,
    last_processed_stream: Cell<u32>,
    has_sent_goaway: Cell<bool>,
    has_received_goaway: Cell<bool>,
    reset_tokens: Cell<f64>,
    reset_tokens_time: Cell<Instant>,
    reset_by_peer: RefCell<RecentStreams>,

    pub(super) streams: RefCell<Vec<Rc<Stream<H>>>>,
    /// For a window, or for room in the queue.
    pub(super) waiting: RefCell<Vec<Rc<Stream<H>>>>,
    /// An allocation for `waiting` to swap with.
    spare: Cell<Vec<Rc<Stream<H>>>>,
    pub(super) retired: RefCell<Vec<Rc<Stream<H>>>>,
}

/// Held by what calls a handler, and until `Server::drain`. No stream goes under another one.
pub(super) struct Pin<H: Host>(Rc<Connection<H>>);

impl<H: Host> Pin<H> {
    pub(super) fn new(connection: &Rc<Connection<H>>) -> Self {
        connection.pins.update(|pins| pins + 1);
        Self(Rc::clone(connection))
    }

    fn is_outermost(&self) -> bool {
        self.pins.get() == 1
    }

    #[inline(never)]
    pub(super) fn uncork(self) {
        if self.is_outermost() && !self.is_closed() {
            Rc::clone(&self.server).drain_later(self);
        }
    }

    pub(super) fn drain(self) {
        // Else the event of the socket sends all at once when it ends.
        if !self.is_closed() && self.is_outermost() {
            self.borrow_shared_queue();
            self.end_event();
        }
    }

    fn end_event(&self) {
        self.flush();
        while self.output().queue.is_empty() && self.can_serve_waiting() {
            self.serve_waiting();
            if self.output().queue.is_empty() {
                break;
            }
            self.flush();
        }
        self.return_shared_queue();
        self.is_flush_due.set(false);
        while self.is_outermost() && !self.is_closed() {
            let Some(stream) = self.retired.borrow_mut().pop() else {
                break;
            };
            stream.emit_aborted();
        }
        if self.has_sent_goaway.get() || self.has_received_goaway.get() {
            if self.streams.borrow().is_empty() && self.output().queue.is_empty() {
                self.close();
            }
        } else if self.is_flush_due.get()
            && let Some(socket) = self.socket()
        {
            socket.request_writable();
        }
    }
}

impl<H: Host> Drop for Pin<H> {
    fn drop(&mut self) {
        self.pins.update(|pins| pins - 1);
        if self.pins.get() == 0 && self.is_closed() {
            // They hold the connection.
            self.retired.take();
        }
    }
}

impl<H: Host> Deref for Pin<H> {
    type Target = Rc<Connection<H>>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<H: Host> Connection<H> {
    /// `preface_len` bytes have arrived. `on_data` or `flush` follows.
    pub fn new(server: Rc<Server<H>>, socket: H::Socket, preface_len: usize) -> Rc<Self> {
        let mut output = Output::new();
        let mut settings = [[0; 6]; 4];
        for (setting, (id, value)) in settings.iter_mut().zip([
            (
                SettingsType::SETTINGS_MAX_CONCURRENT_STREAMS,
                MAX_CONCURRENT_STREAMS as u32,
            ),
            (
                SettingsType::SETTINGS_INITIAL_WINDOW_SIZE,
                INITIAL_STREAM_WINDOW,
            ),
            (SettingsType::SETTINGS_MAX_FRAME_SIZE, MAX_FRAME_SIZE),
            (
                SettingsType::SETTINGS_MAX_HEADER_LIST_SIZE,
                server.max_header_list_size() as u32,
            ),
        ]) {
            setting[..2].copy_from_slice(&id.0.to_be_bytes());
            setting[2..].copy_from_slice(&value.to_be_bytes());
        }
        output.frame(
            FrameType::HTTP_FRAME_SETTINGS,
            0,
            0,
            settings.as_flattened(),
        );
        output.window_update(0, CONNECTION_WINDOW - DEFAULT_WINDOW_SIZE);
        socket.set_timeout(server.idle_timeout);

        Rc::new(Self {
            socket: Cell::new(Some(socket)),
            pins: Cell::new(0),
            is_flush_due: Cell::new(false),
            idle_timeout: Cell::new(server.idle_timeout),
            output: RefCell::new(output),
            decoder: RefCell::new(Decoder::new()),
            partial_frame: RefCell::default(),
            partial_header_block: RefCell::new(None),
            missing_preface: Cell::new(CLIENT_PREFACE.get(preface_len..).unwrap_or_default()),
            has_received_settings: Cell::new(false),
            has_progressed: Cell::new(false),
            initial_send_window: Cell::new(DEFAULT_WINDOW_SIZE as i32),
            unacknowledged: Cell::new(0),
            last_stream: Cell::new(0),
            last_processed_stream: Cell::new(0),
            has_sent_goaway: Cell::new(false),
            has_received_goaway: Cell::new(false),
            reset_tokens: Cell::new(RESET_BURST),
            reset_tokens_time: Cell::new(server.host.now()),
            reset_by_peer: RefCell::default(),
            streams: RefCell::default(),
            waiting: RefCell::default(),
            spare: Cell::default(),
            retired: RefCell::default(),
            server,
        })
    }

    pub(super) fn socket(&self) -> Option<H::Socket> {
        self.socket.get()
    }

    fn is_closed(&self) -> bool {
        self.socket().is_none()
    }

    fn close(&self) {
        if let Some(socket) = self.socket() {
            socket.close();
        }
    }

    pub(super) fn output(&self) -> RefMut<'_, Output> {
        self.output.borrow_mut()
    }

    pub fn on_data(self: &Rc<Self>, data: &[u8]) {
        let this = Pin::new(self);
        this.borrow_shared_queue();
        if let Err(code) = this.read(data) {
            this.go_away(code);
            if let Some(socket) = this.socket() {
                socket.shutdown();
                socket.close();
            }
        }
        this.end_event();
    }

    pub fn on_writable(self: &Rc<Self>) {
        let this = Pin::new(self);
        this.flush();
        this.borrow_shared_queue();
        this.serve_waiting();
        this.end_event();
    }

    pub fn on_close(self: &Rc<Self>) {
        let this = Pin::new(self);
        this.socket.set(None);
        this.return_shared_queue();
        this.waiting.take();
        let mut streams = this.retired.take();
        for stream in this.streams.take() {
            stream.is_retired.set(true);
            streams.push(stream);
        }
        for stream in &streams {
            stream.emit_aborted();
        }
        this.retired.replace(streams);
    }

    pub fn on_timeout(self: &Rc<Self>) {
        let this = Pin::new(self);
        let streams = this.streams.borrow().clone();
        for stream in &streams {
            stream.emit_timeout();
        }
        this.go_away(ErrorCode::NO_ERROR);
        this.close();
    }

    pub fn on_end(&self) {
        self.flush();
        self.close();
    }

    /// Aborts the streams.
    pub fn close_all(connections: impl Iterator<Item = Rc<Self>>) {
        for connection in pin_all(connections) {
            connection.go_away(ErrorCode::NO_ERROR);
            connection.close();
        }
    }

    /// Returns how many it has closed. With `close_when_idle` the others follow after their last stream.
    pub fn close_idle(connections: impl Iterator<Item = Rc<Self>>, close_when_idle: bool) -> usize {
        let mut closed = 0;
        for connection in pin_all(connections) {
            let is_idle = connection.streams.borrow().is_empty();
            if !connection.is_closed() && (is_idle || close_when_idle) {
                connection.go_away(ErrorCode::NO_ERROR);
                if is_idle {
                    connection.close();
                    closed += 1;
                }
            }
        }
        closed
    }

    fn go_away(&self, code: ErrorCode) {
        if !self.has_sent_goaway.replace(true) {
            let payload = [self.last_processed_stream.get(), code.0].map(u32::to_be_bytes);
            (self.output()).frame(FrameType::HTTP_FRAME_GOAWAY, 0, 0, payload.as_flattened());
        }
        self.flush();
    }

    pub fn flush(&self) {
        self.write(&mut self.output());
    }

    fn write(&self, output: &mut Output) {
        let mut has_written = false;
        while !output.queue.is_empty()
            && let Some(socket) = self.socket()
        {
            let written = socket.write(output.queue.as_slice());
            if written == 0 {
                break;
            }
            output.wrote(written);
            has_written = true;
        }
        // The answer to a PING does not keep a stalled connection alive.
        if has_written && output.has_stream_bytes {
            self.restart_idle_timeout();
        }
        if output.queue.is_empty() {
            output.has_stream_bytes = false;
        }
    }

    /// When the event of the socket ends or, outside of one, in `Server::drain`.
    pub(super) fn flush_later(self: &Rc<Self>) {
        if self.pins.get() != 0 {
            self.is_flush_due.set(true);
        } else if !self.is_closed() {
            self.server.drain_later(Pin::new(self));
        }
    }

    fn borrow_shared_queue(&self) {
        let output = &mut *self.output();
        if output.queue.is_empty() && !self.server.is_shared_queue_lent.replace(true) {
            core::mem::swap(
                &mut output.queue,
                &mut self.server.shared_queue.borrow_mut(),
            );
            output.is_queue_shared = true;
        }
    }

    fn return_shared_queue(&self) {
        let output = &mut *self.output();
        if !output.is_queue_shared {
            return;
        }
        if !output.queue.is_empty() {
            // The peer may have read by now, which saves the copy.
            self.write(output);
        }
        output.is_queue_shared = false;
        let shared = &mut *self.server.shared_queue.borrow_mut();
        core::mem::swap(&mut output.queue, shared);
        self.server.is_shared_queue_lent.set(false);
        if !shared.is_empty() {
            if !self.is_closed() {
                output.queue.append(shared.as_slice());
            }
            shared.consume(shared.len());
        }
        if shared.capacity() > 4 * HIGH_WATER_MARK {
            *shared = Queue::default();
        }
    }

    pub(super) fn restart_idle_timeout(&self) {
        if let Some(socket) = self.socket() {
            socket.set_timeout(self.idle_timeout.get());
        }
    }

    /// To the most permissive of the open streams.
    pub(super) fn update_idle_timeout(&self) {
        let default = self.server.idle_timeout;
        let streams = self.streams.borrow();
        let timeouts = streams.iter().map(|stream| match stream.timeout.get() {
            DEFAULT_TIMEOUT => default,
            seconds => seconds.into(),
        });
        let longest = timeouts.max_by_key(|seconds| seconds.wrapping_sub(1));
        self.idle_timeout.set(longest.unwrap_or(default));
        self.restart_idle_timeout();
    }

    fn can_serve_waiting(&self) -> bool {
        !self.waiting.borrow().is_empty() && self.output().can_send_data()
    }

    /// Each gets a slice, so that a long body does not starve the others.
    fn serve_waiting(&self) {
        let mut streams = self.waiting.replace(self.spare.take());
        for stream in &streams {
            stream.is_waiting.set(false);
        }
        let outer_slice = {
            let output = &mut *self.output();
            let slice = output.room_below_high_water_mark() / streams.len().max(1);
            let slice = slice.max(output.max_frame_size as usize);
            core::mem::replace(&mut output.slice, slice)
        };
        let mut unserved = streams.as_slice();
        while let [stream, rest @ ..] = unserved
            && self.output().can_send_data()
        {
            unserved = rest;
            if stream.is_retired() || stream.is_waiting.get() {
                continue;
            }
            if stream.send_window.get() <= 0 || !stream.send_more() {
                stream.wait();
            }
        }
        // Those that had no turn go first.
        streams.drain(..streams.len() - unserved.len());
        streams.retain(|stream| !stream.is_retired() && !stream.is_waiting.replace(true));
        let waiting = &mut *self.waiting.borrow_mut();
        streams.append(waiting);
        core::mem::swap(waiting, &mut streams);
        self.spare.set(streams);
        self.output().slice = outer_slice;
    }

    fn find_stream(&self, id: u32) -> Option<Rc<Stream<H>>> {
        // The newest are the busy ones.
        let streams = self.streams.borrow();
        streams.iter().rfind(|stream| stream.id == id).cloned()
    }

    fn open_stream(
        self: &Rc<Self>,
        frame: HeadersFrame,
        content_length: Option<u64>,
    ) -> Rc<Stream<H>> {
        let stream = Stream::new(
            Rc::clone(self),
            frame.stream,
            self.initial_send_window.get(),
            content_length,
            frame.ends_stream,
        );
        self.streams.borrow_mut().push(Rc::clone(&stream));
        stream
    }

    /// RFC 9113 §5.1: it is not idle, and not one for the server to open.
    fn check_was_opened(&self, id: u32) -> Result {
        let was_opened = id % 2 == 1 && id <= self.last_stream.get();
        check(was_opened, ErrorCode::PROTOCOL_ERROR)
    }

    /// For a frame on a closed stream, which is no error of the connection if it can have raced a reset.
    fn check_was_reset(&self, id: u32, otherwise: ErrorCode) -> Result {
        let output = &mut *self.output();
        if self.reset_by_peer.borrow().contains(id) {
            output.rst_stream(id, ErrorCode::STREAM_CLOSED);
            return Ok(());
        }
        check(output.reset_streams.contains(id), otherwise)
    }

    fn reset_stream(&self, stream: &Rc<Stream<H>>, code: ErrorCode) -> Result {
        self.output().rst_stream(stream.id, code);
        self.abort_stream(stream)
    }

    fn abort_stream(&self, stream: &Rc<Stream<H>>) -> Result {
        stream.retire(true);
        let now = self.server.host.now();
        let seconds = (now - self.reset_tokens_time.replace(now)).as_secs_f64();
        let tokens = RESET_BURST.min(self.reset_tokens.get() + seconds * RESETS_PER_SECOND);
        self.reset_tokens.set(tokens - 1.0);
        check(tokens >= 1.0, ErrorCode::ENHANCE_YOUR_CALM)
    }

    fn read(self: &Rc<Self>, mut data: &[u8]) -> Result {
        let missing = self.missing_preface.get();
        if !missing.is_empty() {
            let (expected, missing) = missing.split_at(missing.len().min(data.len()));
            data = (data.strip_prefix(expected)).ok_or(ErrorCode::PROTOCOL_ERROR)?;
            self.missing_preface.set(missing);
        }

        if self.partial_frame.borrow().is_empty() {
            let rest = self.read_frames(data)?;
            if !rest.is_empty() {
                self.partial_frame.borrow_mut().append(rest);
            }
        } else {
            let mut joined = self.partial_frame.take();
            joined.append(data);
            let unread = self.read_frames(joined.as_slice())?.len();
            if unread != 0 {
                joined.consume(joined.len() - unread);
                self.partial_frame.replace(joined);
            }
        }

        // A peer that holds streams open cannot keep the connection alive with PINGs.
        if self.has_progressed.take() || self.streams.borrow().is_empty() {
            self.restart_idle_timeout();
        }
        Ok(())
    }

    /// Returns the start of a frame.
    fn read_frames<'a>(self: &Rc<Self>, mut data: &'a [u8]) -> Result<&'a [u8]> {
        while let Some((header, rest)) = data.split_first_chunk() {
            if self.is_closed() {
                return Ok(b"");
            }
            let header = FrameHeader::decode(header);
            check(header.length <= MAX_FRAME_SIZE, ErrorCode::FRAME_SIZE_ERROR)?;
            let Some((payload, rest)) = rest.split_at_checked(header.length as usize) else {
                break;
            };
            data = rest;
            self.handle_frame(header, payload)?;
        }
        Ok(data)
    }

    fn handle_frame(self: &Rc<Self>, header: FrameHeader, payload: &[u8]) -> Result {
        const DATA: u8 = FrameType::HTTP_FRAME_DATA as u8;
        const HEADERS: u8 = FrameType::HTTP_FRAME_HEADERS as u8;
        const PRIORITY: u8 = FrameType::HTTP_FRAME_PRIORITY as u8;
        const RST_STREAM: u8 = FrameType::HTTP_FRAME_RST_STREAM as u8;
        const SETTINGS: u8 = FrameType::HTTP_FRAME_SETTINGS as u8;
        const PUSH_PROMISE: u8 = FrameType::HTTP_FRAME_PUSH_PROMISE as u8;
        const PING: u8 = FrameType::HTTP_FRAME_PING as u8;
        const GOAWAY: u8 = FrameType::HTTP_FRAME_GOAWAY as u8;
        const WINDOW_UPDATE: u8 = FrameType::HTTP_FRAME_WINDOW_UPDATE as u8;
        const CONTINUATION: u8 = FrameType::HTTP_FRAME_CONTINUATION as u8;

        let (kind, flags) = (header.type_, header.flags);
        let id = header.stream_identifier & MAX_STREAM_ID;
        check(
            self.has_received_settings.get() || kind == SETTINGS,
            ErrorCode::PROTOCOL_ERROR,
        )?;
        check(
            self.output().queued_control <= MAX_QUEUED_CONTROL,
            ErrorCode::ENHANCE_YOUR_CALM,
        )?;
        if let Some(block) = &*self.partial_header_block.borrow() {
            check(
                kind == CONTINUATION && id == block.frame.stream,
                ErrorCode::PROTOCOL_ERROR,
            )?;
        }

        match kind {
            DATA => self.handle_data(id, flags, payload),
            HEADERS => self.handle_headers(id, flags, payload),
            CONTINUATION => self.handle_continuation(flags, payload),
            PRIORITY => {
                check(id != 0, ErrorCode::PROTOCOL_ERROR)?;
                let &[a, b, c, d, _] = payload else {
                    return Err(ErrorCode::FRAME_SIZE_ERROR);
                };
                if read_u31([a, b, c, d]) != id {
                    return Ok(());
                }
                if let Some(stream) = self.find_stream(id) {
                    return self.reset_stream(&stream, ErrorCode::PROTOCOL_ERROR);
                }
                self.output().rst_stream(id, ErrorCode::PROTOCOL_ERROR);
                Ok(())
            }
            RST_STREAM => {
                self.check_was_opened(id)?;
                check(payload.len() == 4, ErrorCode::FRAME_SIZE_ERROR)?;
                self.reset_by_peer.borrow_mut().add(id);
                (self.find_stream(id)).map_or(Ok(()), |stream| self.abort_stream(&stream))
            }
            SETTINGS => {
                check(id == 0, ErrorCode::PROTOCOL_ERROR)?;
                self.handle_settings(flags, payload)
            }
            PUSH_PROMISE => Err(ErrorCode::PROTOCOL_ERROR),
            PING => {
                check(id == 0, ErrorCode::PROTOCOL_ERROR)?;
                check(payload.len() == 8, ErrorCode::FRAME_SIZE_ERROR)?;
                if flags & ACK == 0 {
                    (self.output()).control_frame(FrameType::HTTP_FRAME_PING, ACK, 0, payload);
                }
                Ok(())
            }
            GOAWAY => {
                check(id == 0, ErrorCode::PROTOCOL_ERROR)?;
                check(payload.len() >= 8, ErrorCode::FRAME_SIZE_ERROR)?;
                self.has_received_goaway.set(true);
                Ok(())
            }
            WINDOW_UPDATE => {
                let increment = payload.try_into().map(read_u31);
                self.handle_window_update(id, increment.map_err(|_| ErrorCode::FRAME_SIZE_ERROR)?)
            }
            _ => Ok(()),
        }
    }

    fn handle_settings(&self, flags: u8, payload: &[u8]) -> Result {
        if flags & ACK != 0 {
            return check(payload.is_empty(), ErrorCode::FRAME_SIZE_ERROR);
        }
        let (settings, []) = payload.as_chunks() else {
            return Err(ErrorCode::FRAME_SIZE_ERROR);
        };
        check(
            settings.len() <= MAX_SETTINGS_PER_FRAME,
            ErrorCode::ENHANCE_YOUR_CALM,
        )?;
        for &[a, b, c, d, e, f] in settings {
            let value = u32::from_be_bytes([c, d, e, f]);
            match SettingsType(u16::from_be_bytes([a, b])) {
                SettingsType::SETTINGS_HEADER_TABLE_SIZE => {
                    self.output().encoder.set_max_table_size(value);
                }
                SettingsType::SETTINGS_ENABLE_PUSH => check(value <= 1, ErrorCode::PROTOCOL_ERROR)?,
                SettingsType::SETTINGS_INITIAL_WINDOW_SIZE => {
                    let window = i32::try_from(value).map_err(|_| ErrorCode::FLOW_CONTROL_ERROR)?;
                    let delta = window - self.initial_send_window.replace(window);
                    for stream in &*self.streams.borrow() {
                        let window = stream.send_window.get().checked_add(delta);
                        (stream.send_window).set(window.ok_or(ErrorCode::FLOW_CONTROL_ERROR)?);
                        if delta > 0 {
                            stream.wait();
                        }
                    }
                }
                SettingsType::SETTINGS_MAX_FRAME_SIZE => {
                    let range = DEFAULT_MAX_FRAME_SIZE..=bun_http_types::h2::MAX_FRAME_SIZE;
                    check(range.contains(&value), ErrorCode::PROTOCOL_ERROR)?;
                    self.output().max_frame_size = value;
                }
                _ => {}
            }
        }
        self.has_received_settings.set(true);
        (self.output()).control_frame(FrameType::HTTP_FRAME_SETTINGS, ACK, 0, b"");
        Ok(())
    }

    fn handle_window_update(&self, id: u32, increment: u32) -> Result {
        if id == 0 {
            check(increment != 0, ErrorCode::PROTOCOL_ERROR)?;
            let output = &mut *self.output();
            let window = output.window + i64::from(increment);
            check(
                window <= MAX_WINDOW_SIZE.into(),
                ErrorCode::FLOW_CONTROL_ERROR,
            )?;
            if output.window <= 0 {
                self.has_progressed.set(true);
            }
            output.window = window;
            return Ok(());
        }

        let grow = |window: i32| match window.checked_add_unsigned(increment) {
            _ if increment == 0 => Err(ErrorCode::PROTOCOL_ERROR),
            grown => grown.ok_or(ErrorCode::FLOW_CONTROL_ERROR),
        };
        let Some(stream) = self.find_stream(id) else {
            self.check_was_opened(id)?;
            if let Err(code) = grow(self.initial_send_window.get()) {
                self.output().rst_stream(id, code);
            }
            return Ok(());
        };
        let window = match grow(stream.send_window.get()) {
            Ok(window) => window,
            Err(code) => return self.reset_stream(&stream, code),
        };
        if stream.send_window.replace(window) <= 0 && window > 0 {
            self.has_progressed.set(true);
        }
        // Served once per read, however many updates it has.
        if stream.has_more_to_send() {
            stream.wait();
        }
        Ok(())
    }

    fn handle_data(&self, id: u32, flags: u8, payload: &[u8]) -> Result {
        check(id != 0, ErrorCode::PROTOCOL_ERROR)?;
        let frame_len = payload.len() as u32;
        let unacknowledged = self.unacknowledged.get() + frame_len;
        self.unacknowledged.set(unacknowledged);
        if unacknowledged >= CONNECTION_WINDOW / 4 {
            (self.output()).window_update(0, self.unacknowledged.take());
        }
        let body = match payload {
            _ if flags & PADDED == 0 => Some(payload),
            [padding, rest @ ..] => strip_padding(rest, *padding),
            [] => None,
        };
        let body = body.ok_or(ErrorCode::PROTOCOL_ERROR)?;

        let Some(stream) = self.find_stream(id) else {
            self.check_was_opened(id)?;
            return self.check_was_reset(id, ErrorCode::STREAM_CLOSED);
        };
        if stream.is_remote_closed.get() {
            return self.reset_stream(&stream, ErrorCode::STREAM_CLOSED);
        }
        let is_last = flags & END_STREAM != 0;
        if is_last || !body.is_empty() {
            self.has_progressed.set(true);
        }
        (stream.receive(body, frame_len, is_last)).or_else(|code| self.reset_stream(&stream, code))
    }

    fn handle_headers(self: &Rc<Self>, id: u32, flags: u8, mut payload: &[u8]) -> Result {
        check(id % 2 == 1, ErrorCode::PROTOCOL_ERROR)?;
        let mut padding = 0;
        if flags & PADDED != 0 {
            padding = *(payload.split_off_first()).ok_or(ErrorCode::FRAME_SIZE_ERROR)?;
        }
        let mut depends_on_itself = false;
        if flags & PRIORITY != 0 {
            let [a, b, c, d, _, rest @ ..] = payload else {
                return Err(ErrorCode::PROTOCOL_ERROR);
            };
            depends_on_itself = read_u31([*a, *b, *c, *d]) == id;
            payload = rest;
        }
        let fragment = strip_padding(payload, padding).ok_or(ErrorCode::PROTOCOL_ERROR)?;
        let frame = HeadersFrame {
            stream: id,
            ends_stream: flags & END_STREAM != 0,
            depends_on_itself,
        };
        if flags & END_HEADERS != 0 {
            return self.handle_header_block(frame, fragment);
        }
        self.partial_header_block.replace(Some(PartialHeaderBlock {
            frame,
            bytes: fragment.to_vec(),
            continuation_frames: 0,
        }));
        Ok(())
    }

    fn handle_continuation(self: &Rc<Self>, flags: u8, payload: &[u8]) -> Result {
        let mut block = (self.partial_header_block.take()).ok_or(ErrorCode::PROTOCOL_ERROR)?;
        block.continuation_frames += 1;
        check(
            block.continuation_frames <= MAX_CONTINUATION_FRAMES
                && block.bytes.len() + payload.len() <= self.server.max_header_block_size(),
            ErrorCode::ENHANCE_YOUR_CALM,
        )?;
        block.bytes.extend_from_slice(payload);
        if flags & END_HEADERS != 0 {
            return self.handle_header_block(block.frame, &block.bytes);
        }
        self.partial_header_block.replace(Some(block));
        Ok(())
    }

    fn handle_header_block(self: &Rc<Self>, frame: HeadersFrame, block: &[u8]) -> Result {
        let id = frame.stream;
        let existing = self.find_stream(id);
        let server = &*self.server;
        let limits = (
            server.max_header_list_size(),
            server.max_header_block_size(),
        );

        // A handler that runs the event loop still has the one of the server.
        let (mut shared, mut own) = (server.decode_buffer.try_borrow_mut(), None);
        let buffer =
            (shared.as_deref_mut()).unwrap_or_else(|_| own.insert(DecodeBuffer::default()));
        let decoded = buffer.decode(
            &mut self.decoder.borrow_mut(),
            block,
            limits,
            existing.is_some(),
            H::field,
        )?;

        if let Some(stream) = existing {
            if stream.is_remote_closed.get() {
                return self.reset_stream(&stream, ErrorCode::STREAM_CLOSED);
            }
            if !frame.ends_stream || decoded.is_none_or(|(head, _)| head.has_malformed_field) {
                return self.reset_stream(&stream, ErrorCode::PROTOCOL_ERROR);
            }
            stream.is_remote_closed.set(true);
            return (stream.receive(b"", 0, true)).or_else(|code| self.reset_stream(&stream, code));
        }

        let last_stream = self.last_stream.get();
        if id <= last_stream {
            return self.check_was_reset(
                id,
                if id == last_stream {
                    ErrorCode::STREAM_CLOSED
                } else {
                    ErrorCode::PROTOCOL_ERROR
                },
            );
        }
        self.last_stream.set(id);
        if self.has_sent_goaway.get() {
            self.output().reset_streams.add(id);
            return Ok(());
        }
        if self.streams.borrow().len() >= MAX_CONCURRENT_STREAMS {
            self.output().rst_stream(id, ErrorCode::REFUSED_STREAM);
            return Ok(());
        }
        self.last_processed_stream.set(id);

        let Some((head, fields)) = decoded else {
            self.open_stream(frame, None).end_with_status(b"431");
            return Ok(());
        };
        if head.is_malformed()
            || frame.depends_on_itself
            || frame.ends_stream && head.content_length.is_some_and(|len| len != 0)
        {
            self.output().rst_stream(id, ErrorCode::PROTOCOL_ERROR);
            return Ok(());
        }
        let stream = self.open_stream(frame, head.content_length);
        self.has_progressed.set(true);
        let Some(method) = head.known_method() else {
            stream.end_with_status(b"501");
            return Ok(());
        };
        if head.expects_continue() {
            stream.write_continue();
        }
        let request = Request {
            method,
            path: head.path,
            authority: head.authority(),
            fields,
        };
        if !server.host.route(&stream, request) && !stream.is_retired() {
            stream.end_with_status(b"404");
        }
        if stream.is_remote_closed.get() {
            stream.deliver_end(b"");
        }
        Ok(())
    }
}

fn strip_padding(payload: &[u8], padding: u8) -> Option<&[u8]> {
    payload.get(..payload.len().checked_sub(padding.into())?)
}

/// Closing one can close the others.
fn pin_all<H: Host>(connections: impl Iterator<Item = Rc<Connection<H>>>) -> Vec<Pin<H>> {
    connections
        .map(|connection| Pin::new(&connection))
        .collect()
}
