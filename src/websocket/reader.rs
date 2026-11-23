//! The frames that a server receives.

use core::mem::MaybeUninit;
use std::borrow::Cow;

use bun_core::strings;

use crate::frame::{MAX_CONTROL_PAYLOAD, Opcode, WebsocketHeader, is_valid_close_code};

const MAX_HEAD_LEN: usize = 14;
/// The peer chooses the length.
const MAX_RESERVED_LEN: usize = 16 * 1024 * 1024;

/// Why a connection is failed (RFC 6455 §7.1.7).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Failure {
    Unmasked,
    Rsv1,
    Rsv2Or3,
    Opcode(Opcode),
    Continuation,
    Interleaved(Opcode),
    FragmentedControlFrame,
    ControlFrameTooBig(u8),
    ClosePayload,
    CloseCode(u16),
    Text,
    CompressedData,
    MessageTooBig,
    UnsupportedLength,
    OutOfMemory,
}

impl Failure {
    /// The close code and the reason for the peer.
    pub fn close(self) -> (u16, &'static [u8]) {
        match self {
            Self::Unmasked => (1002, b"Received an incorrectly masked frame"),
            Self::Rsv1 => (1002, b"Received unexpected RSV1 bit"),
            Self::Rsv2Or3 => (1002, b"Received unexpected RSV2 or RSV3 bit"),
            Self::Opcode(_) => (1002, b"Received invalid opcode"),
            Self::Continuation => (
                1002,
                b"Received continuation frame outside a fragmented message",
            ),
            Self::Interleaved(_) => (1002, b"Received new message inside a fragmented message"),
            Self::FragmentedControlFrame => (1002, b"Received fragmented control frame"),
            Self::ControlFrameTooBig(_) => (1002, b"Received too big control frame"),
            Self::ClosePayload => (1002, b"Received invalid close payload"),
            Self::CloseCode(_) => (1002, b"Received invalid close code"),
            Self::Text => (1007, b"Received invalid UTF-8"),
            Self::CompressedData => (1007, b"Received invalid compressed data"),
            Self::MessageTooBig | Self::UnsupportedLength => (1009, b"Received too big message"),
            Self::OutOfMemory => (1011, b"Received message that does not fit in memory"),
        }
    }

    /// The key in `serverFailures` (src/js/thirdparty/ws.ts), and the number in its message.
    pub fn for_ws_package(self) -> (i32, Option<u16>) {
        match self {
            Self::Unmasked => (1, None),
            Self::Rsv1 => (2, None),
            Self::Rsv2Or3 => (3, None),
            Self::Opcode(opcode) | Self::Interleaved(opcode) => (4, Some(opcode as u16)),
            Self::Continuation => (4, Some(0)),
            Self::FragmentedControlFrame => (5, None),
            Self::ControlFrameTooBig(len) => (6, Some(len.into())),
            Self::ClosePayload => (6, Some(1)),
            Self::CloseCode(code) => (7, Some(code)),
            Self::Text => (8, None),
            Self::MessageTooBig => (9, None),
            Self::UnsupportedLength => (10, None),
            Self::CompressedData => (11, None),
            Self::OutOfMemory => (12, None),
        }
    }
}

/// The code and the reason of a Close frame.
pub fn parse_close(payload: &[u8], validates_utf8: bool) -> Result<(u16, &[u8]), Failure> {
    if payload.is_empty() {
        return Ok((1005, payload));
    }
    let (code, reason) = payload.split_first_chunk().ok_or(Failure::ClosePayload)?;
    let code = u16::from_be_bytes(*code);
    if !is_valid_close_code(code) {
        return Err(Failure::CloseCode(code));
    }
    if validates_utf8 && !strings::is_valid_utf8(reason) {
        return Err(Failure::Text);
    }
    Ok((code, reason))
}

/// How many bytes at the start of `input` are whole control frames.
pub fn control_frames_len(input: &[u8]) -> usize {
    let mut rest = input;
    while let Some(header) = rest
        .first_chunk()
        .map(|bytes| WebsocketHeader::from_slice(*bytes))
        && header.opcode().is_control()
        && let Some(next) = rest.get(WebsocketHeader::frame_size(header.len().into(), true)..)
    {
        rest = next;
    }
    input.len() - rest.len()
}

/// A whole message, or a control frame.
pub struct Message<'a> {
    pub opcode: Opcode,
    pub is_compressed: bool,
    /// An owned one goes back to [`Reader::reuse`].
    pub payload: Cow<'a, [u8]>,
}

/// For a control frame that took several reads.
pub type ControlFrameRoom = [MaybeUninit<u8>; MAX_CONTROL_PAYLOAD];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Compression {
    Disabled,
    Enabled,
    InMessage,
}

pub struct Reader {
    /// The fragments of a message so far, then `control_len` bytes of a control frame.
    buffer: Vec<u8>,
    control_len: u8,
    partial_head: [u8; MAX_HEAD_LEN - 1],
    partial_head_len: u8,
    /// Of the frame whose head was read.
    opcode: Opcode,
    is_final: bool,
    mask: u32,
    remaining: u32,
    unfinished_message: Option<Opcode>,
    compression: Compression,
}

impl Reader {
    pub fn new(has_compression: bool) -> Self {
        Self {
            buffer: Vec::new(),
            control_len: 0,
            partial_head: [0; MAX_HEAD_LEN - 1],
            partial_head_len: 0,
            opcode: Opcode::Continue,
            is_final: true,
            mask: 0,
            remaining: 0,
            unfinished_message: None,
            compression: if has_compression {
                Compression::Enabled
            } else {
                Compression::Disabled
            },
        }
    }

    /// Not while a compressed message arrives.
    pub fn allows_compression(&self) -> bool {
        self.compression == Compression::Enabled
    }

    /// Takes what `input` has of one frame, and unmasks it in place.
    #[inline]
    pub fn read_frame<'input: 'a, 'a>(
        &mut self,
        input: &mut &'input mut [u8],
        max_len: u32,
        room: &'a mut ControlFrameRoom,
    ) -> Result<Option<Message<'a>>, Failure> {
        if self.remaining == 0 && !self.read_head(input, max_len)? {
            return Ok(None);
        }
        let len = input.len().min(self.remaining as usize);
        let (payload, rest) = core::mem::take(input).split_at_mut(len);
        *input = rest;
        unmask(payload, self.mask);
        self.remaining -= len as u32;
        if self.remaining != 0 {
            self.mask = self.mask.rotate_right(len as u32 % 4 * 8);
        }

        let opcode = self.opcode;
        if opcode.is_control() {
            let payload = self.add_to_control_frame(payload, room)?;
            return Ok(payload.map(|payload| Message {
                opcode,
                is_compressed: false,
                payload: Cow::Borrowed(payload),
            }));
        }
        let Some(payload) = self.add_to_message(payload, max_len)? else {
            return Ok(None);
        };
        let is_compressed = self.compression == Compression::InMessage;
        if is_compressed {
            self.compression = Compression::Enabled;
        }
        Ok(Some(Message {
            opcode,
            is_compressed,
            payload,
        }))
    }

    /// Keeps the allocation for the next message.
    pub fn reuse(&mut self, mut buffer: Vec<u8>) {
        if self.buffer.capacity() == 0 {
            buffer.clear();
            self.buffer = buffer;
        }
    }

    /// For a connection that reads no more.
    pub fn release(&mut self) {
        self.buffer = Vec::new();
        self.control_len = 0;
    }

    /// False if `input` ends first.
    #[inline]
    fn read_head(&mut self, input: &mut &mut [u8], max_len: u32) -> Result<bool, Failure> {
        let kept = usize::from(self.partial_head_len);
        let mut joined;
        let bytes = if kept == 0 {
            &**input
        } else {
            let added = input.len().min(MAX_HEAD_LEN - kept);
            joined = [0; MAX_HEAD_LEN];
            joined[..kept].copy_from_slice(&self.partial_head[..kept]);
            joined[kept..][..added].copy_from_slice(&input[..added]);
            &joined[..kept + added]
        };
        let Some(len) = self.parse_head(bytes, max_len)? else {
            self.partial_head[..bytes.len()].copy_from_slice(bytes);
            self.partial_head_len = bytes.len() as u8;
            *input = &mut [];
            return Ok(false);
        };
        self.partial_head_len = 0;
        *input = &mut core::mem::take(input)[len - kept..];
        Ok(true)
    }

    /// The length of the head. It runs again for a head that was not complete.
    #[inline]
    fn parse_head(&mut self, bytes: &[u8], max_len: u32) -> Result<Option<usize>, Failure> {
        let Some((header, rest)) = bytes.split_first_chunk() else {
            return Ok(None);
        };
        let header = WebsocketHeader::from_slice(*header);
        if !header.mask() {
            return Err(Failure::Unmasked);
        }
        if rest.len() < 4 {
            return Ok(None);
        }

        let opcode = header.opcode();
        if header.compressed() {
            if !matches!(opcode, Opcode::Text | Opcode::Binary)
                || self.compression == Compression::Disabled
            {
                return Err(Failure::Rsv1);
            }
            self.compression = Compression::InMessage;
        }
        if header.rsv() != 0 {
            return Err(Failure::Rsv2Or3);
        }
        match opcode {
            Opcode::Continue | Opcode::Text | Opcode::Binary => {}
            Opcode::Close | Opcode::Ping | Opcode::Pong => {
                if !header.final_() {
                    return Err(Failure::FragmentedControlFrame);
                }
                if usize::from(header.len()) > MAX_CONTROL_PAYLOAD {
                    return Err(Failure::ControlFrameTooBig(header.len()));
                }
            }
            _ => return Err(Failure::Opcode(opcode)),
        }

        let (len, rest) = match (header.len(), rest) {
            (len @ ..126, rest) => (len.into(), rest),
            (126, &[a, b, ref rest @ ..]) => (u16::from_be_bytes([a, b]).into(), rest),
            (127, &[a, b, c, d, e, f, g, h, ref rest @ ..]) => {
                (u64::from_be_bytes([a, b, c, d, e, f, g, h]), rest)
            }
            _ => return Ok(None),
        };
        let Some((mask, rest)) = rest.split_first_chunk() else {
            return Ok(None);
        };

        self.opcode = match (opcode, self.unfinished_message) {
            (Opcode::Continue, unfinished) => unfinished.ok_or(Failure::Continuation)?,
            (Opcode::Text | Opcode::Binary, Some(_)) => return Err(Failure::Interleaved(opcode)),
            _ => opcode,
        };
        if !opcode.is_control() {
            if len > u64::from(max_len) {
                return Err(if len >> 53 == 0 {
                    Failure::MessageTooBig
                } else {
                    Failure::UnsupportedLength
                });
            }
            self.unfinished_message = (!header.final_()).then_some(self.opcode);
        }
        self.is_final = header.final_();
        self.mask = u32::from_le_bytes(*mask);
        self.remaining = len as u32;
        Ok(Some(bytes.len() - rest.len()))
    }

    #[inline]
    fn add_to_message<'a>(
        &mut self,
        payload: &'a [u8],
        max_len: u32,
    ) -> Result<Option<Cow<'a, [u8]>>, Failure> {
        let is_complete = self.remaining == 0 && self.is_final;
        if self.buffer.is_empty() {
            if is_complete {
                return Ok(Some(Cow::Borrowed(payload)));
            }
            let len = MAX_RESERVED_LEN.min(payload.len() + self.remaining as usize);
            if len > self.buffer.capacity() {
                // Growing it would copy the last message. If this fails, it grows as bytes arrive.
                self.buffer = Vec::new();
                let _ = self.buffer.try_reserve_exact(len);
            }
        }
        if self.buffer.len() + payload.len() > max_len as usize {
            return Err(Failure::MessageTooBig);
        }
        self.append(payload)?;
        Ok(is_complete.then(|| Cow::Owned(core::mem::take(&mut self.buffer))))
    }

    #[inline]
    fn add_to_control_frame<'a>(
        &mut self,
        payload: &'a [u8],
        room: &'a mut ControlFrameRoom,
    ) -> Result<Option<&'a [u8]>, Failure> {
        if self.remaining == 0 && self.control_len == 0 {
            return Ok(Some(payload));
        }
        self.append(payload)?;
        self.control_len += payload.len() as u8;
        if self.remaining != 0 {
            return Ok(None);
        }
        let len = usize::from(core::mem::take(&mut self.control_len));
        let start = self.buffer.len() - len;
        let payload = room[..len].write_copy_of_slice(&self.buffer[start..]);
        self.buffer.truncate(start);
        Ok(Some(payload))
    }

    fn append(&mut self, payload: &[u8]) -> Result<(), Failure> {
        self.buffer
            .try_reserve(payload.len())
            .or_else(|_| self.buffer.try_reserve_exact(payload.len()))
            .map_err(|_| Failure::OutOfMemory)?;
        self.buffer.extend_from_slice(payload);
        Ok(())
    }
}

#[inline]
fn unmask(payload: &mut [u8], mask: u32) {
    fn words(block: &mut [u8], mask: u32) {
        for word in block.as_chunks_mut::<4>().0 {
            *word = (u32::from_le_bytes(*word) ^ mask).to_le_bytes();
        }
    }

    if mask == 0 {
        return;
    }
    let (blocks, mut rest) = payload.as_chunks_mut::<64>();
    for block in blocks {
        words(block, mask);
    }
    for len in [32, 16, 8, 4] {
        if let Some(block) = rest.split_off_mut(..len) {
            words(block, mask);
        }
    }
    for (byte, mask) in rest.iter_mut().zip(mask.to_le_bytes()) {
        *byte ^= mask;
    }
}
