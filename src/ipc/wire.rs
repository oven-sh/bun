use bun_core::strings;

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Mode {
    /// Length-prefixed structured clones, after a version packet. Bun to Bun only.
    Advanced,
    /// One JSON value per line, as in Node.js.
    Json,
}

/// The discriminant is the tag of an advanced frame.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Kind {
    /// Has no body. Advanced only.
    Version = 1,
    Data = 2,
    /// From or for node:cluster.
    Internal = 3,
    /// A `[message, buffers]` envelope, so that the receiver can restore `Buffer` prototypes. Advanced only.
    DataWithBuffers = 4,
}

/// The receiver's answer to a message that announced a handle.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Reply {
    Ack,
    Nack,
}

#[derive(Eq, PartialEq, Debug)]
pub struct Frame<'a> {
    pub kind: Kind,
    pub body: &'a [u8],
    /// With the header, tag or newline.
    pub len: usize,
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FrameError {
    Invalid,
    LineTooLong,
}

/// `None` until more is read.
pub(crate) type Framed<'a> = Result<Option<Frame<'a>>, FrameError>;

const HEADER_LEN: usize = 5;
const JSON_INTERNAL_TAG: u8 = 2;

impl Mode {
    pub fn version_packet(self) -> Option<&'static [u8]> {
        match self {
            // Version 2 added `DataWithBuffers`. The peer's version is never consulted.
            Mode::Advanced => Some(&[Kind::Version as u8, 2, 0, 0, 0]),
            Mode::Json => None,
        }
    }

    pub fn reply_packet(self, reply: Reply) -> &'static [u8] {
        match (self, reply) {
            (Mode::Advanced, Reply::Ack) => b"\x02\x24\x00\x00\x00\r\x00\x00\x00\x02\x03\x00\x00\x80cmd\x10\x0f\x00\x00\x80NODE_HANDLE_ACK\xff\xff\xff\xff",
            (Mode::Advanced, Reply::Nack) => b"\x02\x25\x00\x00\x00\r\x00\x00\x00\x02\x03\x00\x00\x80cmd\x10\x10\x00\x00\x80NODE_HANDLE_NACK\xff\xff\xff\xff",
            (Mode::Json, Reply::Ack) => b"{\"cmd\":\"NODE_HANDLE_ACK\"}\n",
            (Mode::Json, Reply::Nack) => b"{\"cmd\":\"NODE_HANDLE_NACK\"}\n",
        }
    }

    /// `None`: the length does not fit in the header.
    pub fn encode(self, kind: Kind, body: &[u8]) -> Option<Vec<u8>> {
        Some(match self {
            Mode::Advanced => {
                let len = u32::try_from(body.len()).ok()?.to_le_bytes();
                [&[kind as u8], len.as_slice(), body].concat()
            }
            Mode::Json if kind == Kind::Internal => [&[JSON_INTERNAL_TAG], body, b"\n"].concat(),
            Mode::Json => [body, b"\n"].concat(),
        })
    }
}

/// `max_body`: a longer body is rejected from its header, before it is buffered.
#[inline]
pub fn advanced_frame(bytes: &[u8], max_body: usize) -> Framed<'_> {
    let Some((&[tag, len @ ..], rest)) = bytes.split_first_chunk::<HEADER_LEN>() else {
        return Ok(None);
    };
    let len = u32::from_le_bytes(len) as usize;
    let (kind, len) = match tag {
        1 => (Kind::Version, 0),
        2 => (Kind::Data, len),
        3 => (Kind::Internal, len),
        4 => (Kind::DataWithBuffers, len),
        _ => return Err(FrameError::Invalid),
    };
    if len > max_body {
        return Err(FrameError::Invalid);
    }
    Ok(rest.get(..len).map(|body| Frame {
        kind,
        body,
        len: HEADER_LEN + len,
    }))
}

/// `scanned`: how many of `bytes` are known to hold no newline, so that each byte is scanned once.
#[inline]
pub(crate) fn json_frame<'a>(
    bytes: &'a [u8],
    scanned: &mut usize,
    max_string_len: usize,
) -> Framed<'a> {
    let newline = strings::index_of_char_pos(bytes, b'\n', *scanned);
    *scanned = newline.unwrap_or(bytes.len());
    // The longest string in UTF-8, and a tag.
    let max_line = (max_string_len.saturating_mul(3).saturating_add(1)).min(u32::MAX as usize - 1);
    if *scanned > max_line {
        return Err(FrameError::LineTooLong);
    }
    let Some(newline) = newline else {
        return Ok(None);
    };
    let (kind, body) = match &bytes[..newline] {
        [] | [JSON_INTERNAL_TAG] => return Err(FrameError::Invalid),
        [JSON_INTERNAL_TAG, body @ ..] => (Kind::Internal, body),
        body => (Kind::Data, body),
    };
    Ok(Some(Frame {
        kind,
        body,
        len: newline + 1,
    }))
}
