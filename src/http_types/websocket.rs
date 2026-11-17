// Based on https://github.com/frmdstryr/zhp/blob/a4b5700c289c3619647206144e10fb414113a888/src/websocket.zig. Thank you @frmdstryr.

//! WebSocket frames without I/O: <https://datatracker.ietf.org/doc/html/rfc6455#section-5>
#![forbid(unsafe_code)]

use core::mem;

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
        let extended_length = match self.len {
            0..=MAX_CONTROL_PAYLOAD => 0,
            126..=0xFFFF => size_of::<u16>(),
            _ => size_of::<u64>(),
        };
        2 + extended_length + self.key.map_or(0, |key| key.len()) + self.len
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
        payload
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
    /// [`Reader::reads`] when this read began.
    number: Option<u32>,
    /// During an event: where this read stopped. Otherwise: where the reads made in its events stopped.
    parked: Position,
    /// What is left of `bytes` after a run of control frames.
    after_control_frames: usize,
}

impl<'a> Input<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            control: ControlPayload::new(),
            number: None,
            parked: Position::between_messages(),
            after_control_frames: usize::MAX,
        }
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

struct Position {
    state: State,
    /// In `Head`: the start of a header or of a control frame that the last read cut off.
    held: BoundedArray<u8, MAX_CONTROL_FRAME_SIZE>,
    /// The message so far, unmasked. It is only appended to, so it never wraps.
    buffer: Buffer,
}

impl Position {
    fn between_messages() -> Self {
        Self {
            state: State::Head(None),
            held: BoundedArray::new(),
            buffer: Buffer::init(),
        }
    }

    #[inline(always)]
    fn is_between_messages(&self) -> bool {
        matches!(self.state, State::Head(None)) && self.held.is_empty()
    }
}

pub struct Reader {
    at: Position,
    reads: u32,
    /// Inputs that are parked inside a message.
    parked_messages: u32,
    options: ReaderOptions,
}

impl Reader {
    pub fn new(options: ReaderOptions) -> Self {
        Self {
            at: Position::between_messages(),
            reads: 0,
            parked_messages: 0,
            options,
        }
    }

    pub fn reserve(&mut self, capacity: usize) {
        bun_core::handle_oom(self.at.buffer.ensure_total_capacity(capacity));
    }

    pub fn capacity(&self) -> usize {
        self.at.buffer.capacity()
    }

    pub fn is_stopped(&self) -> bool {
        matches!(self.at.state, State::Stopped)
    }

    /// Ignores everything from now on.
    pub fn stop(&mut self) {
        self.at.state = State::Stopped;
        self.at.buffer = Buffer::init();
    }

    /// Takes back the allocation of a message, unless bytes of another message are buffered.
    pub fn recycle(&mut self, payload: Payload<'_>) {
        if let Payload::Buffered(mut buffer) = payload
            && self.at.buffer.readable_length() == 0
            && !self.is_stopped()
        {
            buffer.discard(buffer.readable_length());
            buffer.reset_head_if_empty();
            self.at.buffer = buffer;
        }
    }

    /// Consumes `input` up to the end of the next event. Stops after a Close frame (§5.5.1) or an error.
    #[inline(always)]
    pub fn next<'a>(
        &mut self,
        input: &'a mut Input<'_>,
    ) -> Option<Result<Event<'a>, ProtocolError>> {
        if input.bytes.is_empty() || self.is_stopped() {
            return None;
        }
        if input.number.is_none() {
            self.reads = self.reads.wrapping_add(1);
            input.number = Some(self.reads);
        } else if !self.both_are_between_messages(input) {
            self.parked_messages -= u32::from(!input.parked.is_between_messages());
            self.swap_position(input);
        }
        while !input.bytes.is_empty() {
            let body = match self.at.state {
                State::Stopped => return None,
                State::Body(body) => body,
                State::Head(open) => match self.read_head(open, input) {
                    None => break,
                    Some(Head::Data(body)) => body,
                    Some(Head::Control(opcode @ (Opcode::Ping | Opcode::Pong))) => {
                        return Some(self.make_way(input).map(|()| match opcode {
                            Opcode::Ping => Event::Ping(&input.control),
                            _ => Event::Pong(&input.control),
                        }));
                    }
                    Some(Head::Control(_)) => {
                        self.stop();
                        return Some(parse_close(&input.control));
                    }
                    Some(Head::Invalid(error)) => return Some(Err(self.fail(error))),
                },
            };
            // Messages do not interleave (§5.4).
            if self.parked_messages > 0 {
                let error = ProtocolError::UnexpectedOpcode(body.message.opcode as u8);
                return Some(Err(self.fail(error)));
            }
            if let Some(payload) = self.read_body(body, &mut input.bytes) {
                if let Err(error) = self.make_way(input) {
                    return Some(Err(error));
                }
                return Some(Ok(Event::Message(body.message, payload)));
            }
        }
        self.make_way(input).err().map(Err)
    }

    /// Goes to where the next read starts: a rest of `input` is taken to end between messages, and checked at its end.
    #[inline(always)]
    fn make_way(&mut self, input: &mut Input<'_>) -> Result<(), ProtocolError> {
        if self.both_are_between_messages(input) {
            return Ok(());
        }
        self.make_way_inside_message(input)
    }

    #[inline(always)]
    fn both_are_between_messages(&self, input: &Input<'_>) -> bool {
        self.at.is_between_messages() && input.parked.is_between_messages()
    }

    #[inline(never)]
    fn make_way_inside_message(&mut self, input: &mut Input<'_>) -> Result<(), ProtocolError> {
        let must_park = !input.bytes.is_empty()
            && (self.at.is_between_messages() || !self.only_control_frames_are_left(input));
        if must_park {
            self.swap_position(input);
            self.parked_messages += u32::from(!input.parked.is_between_messages());
        } else if input.number != Some(self.reads) || !input.parked.is_between_messages() {
            match (self.at.state, self.at.held.is_empty(), input.parked.state) {
                (State::Head(None), true, _) => self.swap_position(input),
                // Only control frames can have been read since.
                (State::Head(Some(_)), true, State::Head(None)) => {
                    mem::swap(&mut self.at.held, &mut input.parked.held);
                }
                _ => {
                    return Err(self.fail(ProtocolError::UnexpectedOpcode(Opcode::Continue as u8)));
                }
            }
        }
        Ok(())
    }

    #[inline(never)]
    fn swap_position(&mut self, input: &mut Input<'_>) {
        let (at, parked) = (&mut self.at, &mut input.parked);
        mem::swap(&mut at.state, &mut parked.state);
        mem::swap(&mut at.buffer, &mut parked.buffer);
        if !at.held.is_empty() || !parked.held.is_empty() {
            mem::swap(&mut at.held, &mut parked.held);
        }
    }

    /// Then the next read continues the open message. No byte is looked at twice.
    fn only_control_frames_are_left(&self, input: &mut Input<'_>) -> bool {
        if input.bytes.len() < input.after_control_frames {
            let (mut rest, mut control) = (input.bytes, ControlPayload::new());
            input.after_control_frames = rest.len();
            while let Some(Head::Control(_)) = self.parse_head(None, &mut rest, &mut control) {
                input.after_control_frames = rest.len();
            }
        }
        input.after_control_frames == 0
    }

    fn fail(&mut self, error: ProtocolError) -> ProtocolError {
        self.stop();
        error
    }

    /// What is too short to parse fits in `held`.
    #[inline(always)]
    fn read_head(&mut self, open: Option<Message>, input: &mut Input<'_>) -> Option<Head> {
        let held = self.at.held.len();
        let fits = &input.bytes[..input.bytes.len().min(MAX_CONTROL_FRAME_SIZE - held)];
        let mut bytes = input.bytes;
        if held > 0 {
            self.at.held.append_slice_assume_capacity(fits);
            bytes = &self.at.held;
        }
        let available = bytes.len();
        let Some(head) = self.parse_head(open, &mut bytes, &mut input.control) else {
            debug_assert_eq!(fits.len(), input.bytes.len());
            if held == 0 {
                self.at.held.append_slice_assume_capacity(fits);
            }
            input.bytes = &[];
            return None;
        };
        let consumed = (available - bytes.len()).saturating_sub(held);
        input.bytes = input.bytes.get(consumed..).unwrap_or_default();
        self.at.held.clear();
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
        if self.at.buffer.readable_length().saturating_add(remaining) > self.options.max_payload {
            return Some(Head::Invalid(MessageTooBig));
        }
        let key = self.take_key(bytes)?;
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
        if ended && body.key.is_none() && self.at.buffer.readable_length() == 0 {
            self.at.state = State::Head(None);
            return Some(Payload::Borrowed(chunk));
        }

        let output = bun_core::handle_oom(self.at.buffer.writable_with_size(chunk.len()));
        copy_masked(body.key, output, chunk);
        self.at.buffer.update(chunk.len());
        if ended {
            self.at.state = State::Head(None);
            let buffer = mem::replace(&mut self.at.buffer, Buffer::init());
            return Some(Payload::Buffered(buffer));
        }
        if let Some(key) = &mut body.key {
            key.rotate_left(chunk.len() % 4);
        }
        self.at.state = match body.remaining {
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
