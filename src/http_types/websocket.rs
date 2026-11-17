// Based on https://github.com/frmdstryr/zhp/blob/a4b5700c289c3619647206144e10fb414113a888/src/websocket.zig. Thank you @frmdstryr.

//! WebSocket frames without I/O: <https://datatracker.ietf.org/doc/html/rfc6455#section-5>
#![forbid(unsafe_code)]

use core::cell::Cell;
use core::mem;
use std::rc::Rc;

use bun_collections::LinearFifo;
use bun_collections::linear_fifo::DynamicBuffer;
use bun_core::BoundedArray;

const MAX_CONTROL_PAYLOAD: usize = 125;
pub const MAX_CONTROL_FRAME_SIZE: usize = 2 + size_of::<MaskingKey>() + MAX_CONTROL_PAYLOAD;
/// The largest length `ws` and undici accept: `Number.MAX_SAFE_INTEGER`.
const MAX_PAYLOAD_LENGTH: u64 = (1 << 53) - 1;
/// Stands for a Close frame with an empty payload (§7.1.5).
const NO_STATUS_RECEIVED: u16 = 1005;

const FIN: u8 = 0x80;
const RSV1: u8 = 0x40;
const RSV2_AND_RSV3: u8 = 0x30;
const OPCODE: u8 = 0x0f;
const MASK: u8 = 0x80;
const LENGTH: u8 = 0x7f;
const LENGTH_IN_16_BITS: u8 = 126;
const LENGTH_IN_64_BITS: u8 = 127;

type Buffer = LinearFifo<u8, DynamicBuffer<u8>>;
type MaskingKey = [u8; 4];
type ControlPayload = BoundedArray<u8, MAX_CONTROL_PAYLOAD>;

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Opcode {
    Continue = 0x0,
    Text = 0x1,
    Binary = 0x2,
    Close = 0x8,
    Ping = 0x9,
    Pong = 0xA,
}

impl Opcode {
    /// `None` for a reserved opcode.
    pub fn from_u8(value: u8) -> Option<Self> {
        Some(match value {
            0x0 => Self::Continue,
            0x1 => Self::Text,
            0x2 => Self::Binary,
            0x8 => Self::Close,
            0x9 => Self::Ping,
            0xA => Self::Pong,
            _ => return None,
        })
    }
}

/// What the peer sent that fails the connection (§7.1.7).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ProtocolError {
    UnexpectedRsv2Or3,
    ExpectedMask,
    UnexpectedMask,
    ReservedOpcode(u8),
    UnexpectedOpcode(u8),
    ControlFrameIsFragmented,
    UnexpectedRsv1,
    InvalidControlLength(u8),
    UnsupportedPayloadLength,
    MessageTooBig,
    InvalidCloseCode(u16),
}

fn copy_masked(key: Option<MaskingKey>, output: &mut [u8], input: &[u8]) {
    match key {
        Some(key) => bun_highway::fill_with_skip_mask(key, output, input, false),
        None => output.copy_from_slice(input),
    }
}

fn mask_in_place(key: Option<MaskingKey>, payload: &mut [u8]) {
    if let Some(key) = key {
        bun_highway::fill_with_skip_mask_inplace(key, payload, false);
    }
}

fn take<const N: usize>(bytes: &mut &[u8]) -> Option<[u8; N]> {
    let (taken, rest) = bytes.split_first_chunk()?;
    *bytes = rest;
    Some(*taken)
}

/// 1005 makes an empty payload. A `reason` that doesn't fit is left out.
pub fn close_payload(code: u16, reason: &[u8]) -> ControlPayload {
    let mut payload = ControlPayload::new();
    if code != NO_STATUS_RECEIVED {
        let _ = payload.append_slice(&code.to_be_bytes());
        let _ = payload.append_slice(reason);
    }
    payload
}

#[derive(Copy, Clone)]
pub struct Header {
    pub opcode: Opcode,
    pub fin: bool,
    /// RSV1 (RFC 7692 §6).
    pub compressed: bool,
    pub len: usize,
    /// A client masks every frame, a server masks none (§5.1).
    pub key: Option<MaskingKey>,
}

impl Header {
    pub fn frame_size(self) -> usize {
        self.size() + self.len
    }

    fn size(self) -> usize {
        let extended_length = match self.len {
            0..=MAX_CONTROL_PAYLOAD => 0,
            126..=0xFFFF => size_of::<u16>(),
            _ => size_of::<u64>(),
        };
        2 + extended_length + self.key.map_or(0, |key| key.len())
    }

    /// `frame` is [`Self::frame_size`] long and `payload` is `len` long.
    #[inline(always)]
    pub fn encode(self, frame: &mut [u8], payload: &[u8]) {
        copy_masked(self.key, self.write(frame), payload);
    }

    /// [`Self::encode`] for a payload that `fill` writes, all `len` bytes of it.
    #[inline(always)]
    pub fn encode_with(self, frame: &mut [u8], fill: impl FnOnce(&mut [u8])) {
        let payload = self.write(frame);
        fill(payload);
        mask_in_place(self.key, payload);
    }

    /// Returns the room for the payload.
    #[inline(always)]
    fn write(self, frame: &mut [u8]) -> &mut [u8] {
        let (head, payload) = frame.split_at_mut(frame.len() - self.len);
        self.write_head(head);
        payload
    }

    #[inline(always)]
    fn write_head(self, head: &mut [u8]) {
        let bit = |is_set, bit| if is_set { bit } else { 0 };
        head[0] = bit(self.fin, FIN) | bit(self.compressed, RSV1) | self.opcode as u8;
        head[1] = bit(self.key.is_some(), MASK)
            | match self.len {
                0..=MAX_CONTROL_PAYLOAD => self.len as u8,
                126..=0xFFFF => {
                    head[2..4].copy_from_slice(&(self.len as u16).to_be_bytes());
                    LENGTH_IN_16_BITS
                }
                _ => {
                    head[2..10].copy_from_slice(&(self.len as u64).to_be_bytes());
                    LENGTH_IN_64_BITS
                }
            };
        if let (Some(key), Some(slot)) = (self.key, head.last_chunk_mut()) {
            *slot = key;
        }
    }
}

/// What the first frame of a data message says about all of it.
#[derive(Copy, Clone)]
pub struct Message {
    /// `Text` or `Binary`.
    pub opcode: Opcode,
    pub compressed: bool,
}

pub enum Payload<'a> {
    Borrowed(&'a [u8]),
    Buffered(Buffer),
}

impl core::ops::Deref for Payload<'_> {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        match self {
            Self::Borrowed(bytes) => bytes,
            Self::Buffered(buffer) => buffer.readable_slice(0),
        }
    }
}

/// Borrows nothing from the [`Reader`], which is already past it.
pub enum Event<'a> {
    /// The payload goes back to [`Reader::recycle`].
    Message(Message, Payload<'a>),
    Ping(&'a [u8]),
    Pong(&'a [u8]),
    /// The status code (1005 if there is none) and the reason, not checked for UTF-8.
    Close(u16, &'a [u8]),
}

/// What is left of one read, and room for the payload of the control frame in an [`Event`].
pub struct Input<'a> {
    bytes: &'a [u8],
    control: ControlPayload,
    /// An event came out of this read, and left the reader between messages if `bytes` is not empty.
    is_past_event: bool,
    /// What an [`Event`] borrows if it came out of [`Reader::queue`].
    queue: Option<Rc<Queue>>,
}

impl<'a> Input<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            control: ControlPayload::new(),
            is_past_event: false,
            queue: None,
        }
    }
}

struct Queue {
    bytes: Vec<u8>,
    consumed: Cell<usize>,
}

impl Queue {
    fn rest(&self) -> &[u8] {
        self.bytes.get(self.consumed.get()..).unwrap_or_default()
    }
}

#[derive(Copy, Clone)]
pub struct ReaderOptions {
    /// The peer is a client.
    pub masked: bool,
    /// permessage-deflate was negotiated.
    pub deflate: bool,
    /// Of one message, before it is inflated.
    pub max_payload: usize,
}

/// The rest of a data frame's payload.
#[derive(Copy, Clone)]
struct Body {
    message: Message,
    fin: bool,
    remaining: usize,
    /// Rotated, so that its first byte is for the next byte of the payload.
    key: Option<MaskingKey>,
}

#[derive(Copy, Clone)]
enum State {
    /// Holds the fragmented message that the next data frame continues.
    Head(Option<Message>),
    Body(Body),
    Stopped,
}

/// With a tag of its own, nothing overlaps `Body`, which then stays in registers.
#[repr(u8)]
enum Head {
    Data(Body),
    /// The payload is in [`Input::control`].
    Control(Opcode),
    Invalid(ProtocolError),
}

pub struct Reader {
    state: State,
    /// In `Head`: what the last read had of a control frame, or of a data frame up to its payload.
    held: BoundedArray<u8, MAX_CONTROL_FRAME_SIZE>,
    /// The message so far, unmasked. It is only appended to, so it never wraps.
    buffer: Buffer,
    /// The rest of a read that a read made inside one of its events must not overtake.
    queue: Option<Rc<Queue>>,
    options: ReaderOptions,
}

impl Reader {
    pub fn new(options: ReaderOptions) -> Self {
        Self {
            state: State::Head(None),
            held: BoundedArray::new(),
            buffer: Buffer::init(),
            queue: None,
            options,
        }
    }

    pub fn reserve(&mut self, capacity: usize) {
        bun_core::handle_oom(self.buffer.ensure_total_capacity(capacity));
    }

    pub fn capacity(&self) -> usize {
        self.buffer.capacity()
    }

    pub fn is_stopped(&self) -> bool {
        matches!(self.state, State::Stopped)
    }

    /// Ignores everything from now on.
    pub fn stop(&mut self) {
        self.state = State::Stopped;
        self.buffer = Buffer::init();
        self.queue = None;
    }

    /// Takes back the allocation of a message, unless bytes of another message are buffered.
    pub fn recycle(&mut self, payload: Payload<'_>) {
        if let Payload::Buffered(mut buffer) = payload
            && self.buffer.readable_length() == 0
            && !self.is_stopped()
        {
            buffer.discard(buffer.readable_length());
            buffer.reset_head_if_empty();
            self.buffer = buffer;
        }
    }

    /// Consumes `input` up to the end of the next event. Stops after a Close frame (§5.5.1) or an error.
    #[inline(always)]
    pub fn next<'a>(
        &mut self,
        input: &'a mut Input<'_>,
    ) -> Option<Result<Event<'a>, ProtocolError>> {
        let is_past_event = mem::replace(&mut input.is_past_event, true);
        let is_unfinished = !self.held.is_empty() || !matches!(self.state, State::Head(None));
        if self.queue.is_some() || (is_past_event && is_unfinished && !input.bytes.is_empty()) {
            return self.next_from_queue(input);
        }
        self.read_event::<true>(&mut input.bytes, &mut input.control)
    }

    /// Only where it is rare or short: a copy after every event would be a copy of most reads.
    #[inline(always)]
    fn queue_after_event(&mut self, is_rare: bool, rest: &mut &[u8]) {
        let key = if self.options.masked { 4 } else { 0 };
        let short_len = rest.get(1).map_or(0, |second| second & LENGTH);
        let is_cut_short = rest.len() < 2 + key + usize::from(short_len);
        if !rest.is_empty() && (is_rare || is_cut_short) {
            self.enqueue(mem::take(rest));
        }
    }

    #[cold]
    fn enqueue(&mut self, bytes: &[u8]) {
        let queued = self.queue.as_deref().map(Queue::rest).unwrap_or_default();
        self.queue = Some(Rc::new(Queue {
            bytes: [queued, bytes].concat(),
            consumed: Cell::new(0),
        }));
    }

    #[cold]
    #[inline(never)]
    fn next_from_queue<'a>(
        &mut self,
        input: &'a mut Input<'_>,
    ) -> Option<Result<Event<'a>, ProtocolError>> {
        let bytes = mem::take(&mut input.bytes);
        if self.queue.is_none() {
            if let Err(error) = self.unread_behind(bytes) {
                self.stop();
                return Some(Err(error));
            }
        } else if !bytes.is_empty() {
            self.enqueue(bytes);
        }
        let queue = input.queue.insert(self.queue.take()?);
        let mut rest = queue.rest();
        let event = self.read_queued_event(&mut rest, &mut input.control);
        queue.consumed.set(queue.bytes.len() - rest.len());
        if !rest.is_empty() && !self.is_stopped() {
            self.queue = Some(Rc::clone(queue));
        }
        event
    }

    /// A read made inside an event overtook `earlier` and ended within a message, which is queued as bytes again.
    fn unread_behind(&mut self, earlier: &[u8]) -> Result<(), ProtocolError> {
        let (message, fin, remaining, mut key) = match self.state {
            State::Stopped => return Ok(()),
            State::Head(None) => {
                let held = mem::take(&mut self.held);
                self.enqueue(&[earlier, &held].concat());
                return Ok(());
            }
            State::Head(Some(message)) => {
                (message, false, 0, self.options.masked.then_some([0; 4]))
            }
            State::Body(body) => (body.message, body.fin, body.remaining, body.key),
        };
        // What looked like the start of a message was the rest of a frame.
        if self.ends_within_a_frame(earlier) {
            return Err(ProtocolError::UnexpectedOpcode(message.opcode as u8));
        }
        let mut payload = self.buffer.readable_slice(0).to_vec();
        if let Some(key) = &mut key {
            key.rotate_right(payload.len() % 4);
        }
        mask_in_place(key, &mut payload);
        let header = Header {
            opcode: message.opcode,
            fin,
            compressed: message.compressed,
            len: payload.len() + remaining,
            key,
        };
        let mut head = vec![0; header.size()];
        header.write_head(&mut head);
        let held = mem::take(&mut self.held);
        self.enqueue(&[earlier, &head, &payload, &held].concat());
        (self.state, self.buffer) = (State::Head(None), Buffer::init());
        Ok(())
    }

    fn ends_within_a_frame(&self, mut bytes: &[u8]) -> bool {
        let (mut reader, mut control) = (Self::new(self.options), ControlPayload::new());
        while reader.read_queued_event(&mut bytes, &mut control).is_some() {}
        !reader.held.is_empty() || matches!(reader.state, State::Body(_))
    }

    #[cold]
    #[inline(never)]
    fn read_queued_event<'a, 'b: 'a>(
        &mut self,
        bytes: &mut &'b [u8],
        control: &'a mut ControlPayload,
    ) -> Option<Result<Event<'a>, ProtocolError>> {
        self.read_event::<false>(bytes, control)
    }

    #[inline(always)]
    fn read_event<'a, 'b: 'a, const MAY_QUEUE: bool>(
        &mut self,
        input: &mut &'b [u8],
        control: &'a mut ControlPayload,
    ) -> Option<Result<Event<'a>, ProtocolError>> {
        let began_in_head = !self.held.is_empty();
        while !input.is_empty() {
            let body = match self.state {
                State::Stopped => return None,
                State::Body(body) => body,
                State::Head(open) => match self.read_head(open, input, control)? {
                    Head::Data(body) => body,
                    Head::Control(opcode @ (Opcode::Ping | Opcode::Pong)) => {
                        if MAY_QUEUE {
                            self.queue_after_event(began_in_head || open.is_some(), input);
                        }
                        return Some(Ok(match opcode {
                            Opcode::Ping => Event::Ping(control),
                            _ => Event::Pong(control),
                        }));
                    }
                    Head::Control(_) => {
                        self.stop();
                        return Some(parse_close(control));
                    }
                    Head::Invalid(error) => {
                        self.stop();
                        return Some(Err(error));
                    }
                },
            };
            if let Some(payload) = self.read_body(body, input) {
                if MAY_QUEUE {
                    self.queue_after_event(began_in_head, input);
                }
                return Some(Ok(Event::Message(body.message, payload)));
            }
        }
        None
    }

    /// What is too short to parse fits in `held`.
    #[inline(always)]
    fn read_head(
        &mut self,
        open: Option<Message>,
        input: &mut &[u8],
        control: &mut ControlPayload,
    ) -> Option<Head> {
        let held = self.held.len();
        let fits = &input[..input.len().min(MAX_CONTROL_FRAME_SIZE - held)];
        let mut bytes = *input;
        if held > 0 {
            self.held.append_slice_assume_capacity(fits);
            bytes = &self.held;
        }
        let available = bytes.len();
        let Some(head) = self.parse_head(open, &mut bytes, control) else {
            debug_assert_eq!(fits.len(), input.len());
            if held == 0 {
                self.held.append_slice_assume_capacity(fits);
            }
            *input = &[];
            return None;
        };
        let consumed = (available - bytes.len()).saturating_sub(held);
        *input = input.get(consumed..).unwrap_or_default();
        self.held.clear();
        Some(head)
    }

    /// The header of a data frame, or a whole control frame. An error wins over bytes that are missing after it.
    #[inline(always)]
    fn parse_head(
        &self,
        open: Option<Message>,
        bytes: &mut &[u8],
        control: &mut ControlPayload,
    ) -> Option<Head> {
        use ProtocolError::*;

        let [first, second] = take(bytes)?;
        let (fin, compressed) = (first & FIN != 0, first & RSV1 != 0);
        let short_len = second & LENGTH;
        if first & RSV2_AND_RSV3 != 0 {
            return Some(Head::Invalid(UnexpectedRsv2Or3));
        }
        match (second & MASK != 0, self.options.masked) {
            (true, false) => return Some(Head::Invalid(UnexpectedMask)),
            (false, true) => return Some(Head::Invalid(ExpectedMask)),
            _ => {}
        }
        let Some(opcode) = Opcode::from_u8(first & OPCODE) else {
            return Some(Head::Invalid(ReservedOpcode(first & OPCODE)));
        };
        let message = match (opcode, open) {
            (Opcode::Continue, Some(message)) => Some(message),
            (Opcode::Text | Opcode::Binary, None) => Some(Message { opcode, compressed }),
            (Opcode::Continue | Opcode::Text | Opcode::Binary, _) => {
                return Some(Head::Invalid(UnexpectedOpcode(opcode as u8)));
            }
            _ if !fin => return Some(Head::Invalid(ControlFrameIsFragmented)),
            _ => None,
        };
        // RFC 7692 §6.1: only on the first frame of a data message.
        if compressed && !(self.options.deflate && matches!(opcode, Opcode::Text | Opcode::Binary))
        {
            return Some(Head::Invalid(UnexpectedRsv1));
        }

        let Some(message) = message else {
            // A Close payload is empty or starts with a status code.
            if short_len >= LENGTH_IN_16_BITS || (short_len == 1 && opcode == Opcode::Close) {
                return Some(Head::Invalid(InvalidControlLength(short_len)));
            }
            let key = self.take_key(bytes)?;
            control.clear();
            let payload = bytes.split_off(..usize::from(short_len))?;
            if control.append_slice(payload).is_err() {
                return Some(Head::Invalid(InvalidControlLength(short_len)));
            }
            mask_in_place(key, control);
            return Some(Head::Control(opcode));
        };

        let len = match short_len {
            LENGTH_IN_16_BITS => u16::from_be_bytes(take(bytes)?).into(),
            LENGTH_IN_64_BITS => u64::from_be_bytes(take(bytes)?),
            len => len.into(),
        };
        if len > MAX_PAYLOAD_LENGTH {
            return Some(Head::Invalid(UnsupportedPayloadLength));
        }
        let remaining = len as usize;
        if self.buffer.readable_length().saturating_add(remaining) > self.options.max_payload {
            return Some(Head::Invalid(MessageTooBig));
        }
        let key = self.take_key(bytes)?;
        if bytes.is_empty() && remaining > 0 {
            return None;
        }
        Some(Head::Data(Body {
            message,
            fin,
            remaining,
            key,
        }))
    }

    fn take_key(&self, bytes: &mut &[u8]) -> Option<Option<MaskingKey>> {
        if self.options.masked {
            take(bytes).map(Some)
        } else {
            Some(None)
        }
    }

    /// Returns the payload of the message, once it has ended.
    #[inline(always)]
    fn read_body<'a>(&mut self, mut body: Body, input: &mut &'a [u8]) -> Option<Payload<'a>> {
        let (chunk, rest) = input.split_at(body.remaining.min(input.len()));
        *input = rest;
        body.remaining -= chunk.len();
        let ended = body.fin && body.remaining == 0;
        if ended && body.key.is_none() && self.buffer.readable_length() == 0 {
            self.state = State::Head(None);
            return Some(Payload::Borrowed(chunk));
        }

        let output = bun_core::handle_oom(self.buffer.writable_with_size(chunk.len()));
        copy_masked(body.key, output, chunk);
        self.buffer.update(chunk.len());
        if ended {
            self.state = State::Head(None);
            let buffer = mem::replace(&mut self.buffer, Buffer::init());
            return Some(Payload::Buffered(buffer));
        }
        if let Some(key) = &mut body.key {
            key.rotate_left(chunk.len() % 4);
        }
        self.state = match body.remaining {
            0 => State::Head(Some(body.message)),
            _ => State::Body(body),
        };
        None
    }
}

fn parse_close(mut payload: &[u8]) -> Result<Event<'_>, ProtocolError> {
    match take(&mut payload).map(u16::from_be_bytes) {
        None => Ok(Event::Close(NO_STATUS_RECEIVED, payload)),
        // §7.4
        Some(code @ (1000..=1003 | 1007..=1014 | 3000..=4999)) => Ok(Event::Close(code, payload)),
        Some(code) => Err(ProtocolError::InvalidCloseCode(code)),
    }
}
