use bun_core::strings;

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Mode {
    /// Length-prefixed structured clones, after a version packet. Bun to Bun only.
    Advanced,
    /// One JSON value per line, as in Node.js.
    Json,
}

/// Who a message is sent to.
#[derive(Copy, Clone)]
pub enum Audience {
    User,
    Cluster,
}

/// The discriminant is the tag of an advanced frame.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Kind {
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

/// One frame, ready to be written.
#[derive(Eq, PartialEq, Debug)]
pub struct Packet(pub(crate) Vec<u8>);

#[derive(Copy, Clone)]
pub struct ReplyPacket(&'static [u8]);

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Frame<B> {
    /// Advanced only.
    Version,
    Message(Kind, B),
}

#[derive(Copy, Clone)]
pub enum Body<'a> {
    Clone(&'a [u8]),
    Json(&'a [u8]),
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FrameError {
    Invalid,
    LineTooLong,
}

/// A frame and its length with the header, tag or newline. `None` until more is read.
pub(crate) type Framed<'a> = Result<Option<(Frame<Body<'a>>, usize)>, FrameError>;

const HEADER_LEN: usize = 5;
const VERSION_TAG: u8 = 1;
const JSON_INTERNAL_TAG: u8 = 2;

impl Mode {
    pub fn version_packet(self) -> Option<Packet> {
        match self {
            // Version 2 added `DataWithBuffers`. The peer's version is never consulted.
            Mode::Advanced => Some(Packet(vec![VERSION_TAG, 2, 0, 0, 0])),
            Mode::Json => None,
        }
    }

    pub fn reply_packet(self, reply: Reply) -> ReplyPacket {
        ReplyPacket(match (self, reply) {
            (Mode::Advanced, Reply::Ack) => b"\x02\x24\x00\x00\x00\r\x00\x00\x00\x02\x03\x00\x00\x80cmd\x10\x0f\x00\x00\x80NODE_HANDLE_ACK\xff\xff\xff\xff",
            (Mode::Advanced, Reply::Nack) => b"\x02\x25\x00\x00\x00\r\x00\x00\x00\x02\x03\x00\x00\x80cmd\x10\x10\x00\x00\x80NODE_HANDLE_NACK\xff\xff\xff\xff",
            (Mode::Json, Reply::Ack) => b"{\"cmd\":\"NODE_HANDLE_ACK\"}\n",
            (Mode::Json, Reply::Nack) => b"{\"cmd\":\"NODE_HANDLE_NACK\"}\n",
        })
    }
}

impl ReplyPacket {
    pub(crate) fn bytes(self) -> &'static [u8] {
        self.0
    }
}

pub fn encode_json(audience: Audience, body: &[u8]) -> Packet {
    Packet(match audience {
        Audience::User => [body, b"\n"].concat(),
        Audience::Cluster => [&[JSON_INTERNAL_TAG], body, b"\n"].concat(),
    })
}

/// `None`: the length does not fit in the header.
pub fn encode_advanced(kind: Kind, body: &[u8]) -> Option<Packet> {
    let len = u32::try_from(body.len()).ok()?.to_le_bytes();
    Some(Packet([&[kind as u8], len.as_slice(), body].concat()))
}

/// `max_body`: a longer body is rejected from its header, before it is buffered.
#[inline]
pub(crate) fn advanced_frame(bytes: &[u8], max_body: usize) -> Framed<'_> {
    let Some((&[tag, len @ ..], rest)) = bytes.split_first_chunk::<HEADER_LEN>() else {
        return Ok(None);
    };
    let kind = match tag {
        VERSION_TAG => return Ok(Some((Frame::Version, HEADER_LEN))),
        2 => Kind::Data,
        3 => Kind::Internal,
        4 => Kind::DataWithBuffers,
        _ => return Err(FrameError::Invalid),
    };
    let len = u32::from_le_bytes(len) as usize;
    if len > max_body {
        return Err(FrameError::Invalid);
    }
    Ok((rest.get(..len)).map(|body| (Frame::Message(kind, Body::Clone(body)), HEADER_LEN + len)))
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
    Ok(Some((Frame::Message(kind, Body::Json(body)), newline + 1)))
}
