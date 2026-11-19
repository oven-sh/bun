//! RFC 9000 §17 and RFC 9001 §5.4.

use crate::cid::{ConnectionId, LocalId};
use crate::coding::{MAX_VARINT, Read, Write, two_byte_varint};
use crate::crypto::{HeaderKey, Keys, PayloadKey, SAMPLE_LEN, TAG_LEN};
use crate::version::Version;

pub(crate) const LONG_HEADER: u8 = 0x80;
pub(crate) const FIXED_BIT: u8 = 0x40;
pub(crate) const SPIN_BIT: u8 = 0x20;
pub(crate) const KEY_PHASE: u8 = 0x04;
const MAX_NUMBER_LEN: usize = 4;

/// Of a datagram with an Initial packet, and what every path has to carry (RFC 9000 §14).
pub(crate) const MIN_DATAGRAM_LEN: usize = 1200;

/// RFC 9000 §10.3.
pub(crate) const MIN_RESET_LEN: usize = 21;
const MIN_SENT_LEN: usize = MIN_RESET_LEN + 1 + LocalId::LEN;

/// What a long header has in every version (RFC 8999 §5.1).
pub(crate) struct Invariants<'a> {
    pub(crate) first: u8,
    pub(crate) version: u32,
    pub(crate) destination: &'a [u8],
    pub(crate) source: &'a [u8],
    pub(crate) rest: &'a [u8],
}

impl<'a> Invariants<'a> {
    pub(crate) fn read(mut input: &'a [u8]) -> Option<Self> {
        let id = |input: &mut &'a [u8]| input.u8().and_then(|len| input.bytes(len.into()));
        Some(Self {
            first: input.u8()?,
            version: u32::from_be_bytes(input.array()?),
            destination: id(&mut input)?,
            source: id(&mut input)?,
            rest: input,
        })
    }

    pub(crate) fn write(&self, out: &mut Vec<u8>) {
        out.push(self.first);
        out.extend_from_slice(&self.version.to_be_bytes());
        for id in [self.destination, self.source] {
            out.push(id.len() as u8);
            out.extend_from_slice(id);
        }
        out.extend_from_slice(self.rest);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LongKind {
    Initial,
    EarlyData,
    Handshake,
    Retry,
}

impl LongKind {
    pub(crate) fn first_byte(self, version: Version) -> u8 {
        LONG_HEADER | FIXED_BIT | ((self as u8 + version.long_type_offset()) % 4) << 4
    }
}

pub(crate) struct LongHeader<'a> {
    pub(crate) version: Version,
    pub(crate) kind: LongKind,
    pub(crate) destination: ConnectionId,
    pub(crate) source: ConnectionId,
    pub(crate) token: &'a [u8],
    /// Where the packet number is, or the integrity tag of a Retry packet.
    pub(crate) number_offset: usize,
    /// Of the whole packet.
    pub(crate) len: usize,
}

impl<'a> LongHeader<'a> {
    pub(crate) fn read(datagram: &'a [u8]) -> Option<Self> {
        let invariants = Invariants::read(datagram)?;
        let version = Version::from_number(invariants.version)?;
        let kind = match ((invariants.first >> 4) + 4 - version.long_type_offset()) % 4 {
            0 => LongKind::Initial,
            1 => LongKind::EarlyData,
            2 => LongKind::Handshake,
            _ => LongKind::Retry,
        };
        let mut rest = invariants.rest;
        let token = match kind {
            LongKind::Initial => rest.prefixed_bytes()?,
            LongKind::Retry => rest.split_off(..rest.len().checked_sub(TAG_LEN)?)?,
            LongKind::EarlyData | LongKind::Handshake => &[],
        };
        let protected = match kind {
            LongKind::Retry => rest,
            _ => rest.prefixed_bytes()?,
        };
        let len = match kind {
            LongKind::Retry => datagram.len(),
            _ => datagram.len() - rest.len(),
        };
        Some(Self {
            version,
            kind,
            destination: ConnectionId::new(invariants.destination)?,
            source: ConnectionId::new(invariants.source)?,
            token,
            number_offset: len - protected.len(),
            len,
        })
    }
}

impl LongHeader<'_> {
    pub(crate) fn without_token(&self) -> LongHeader<'static> {
        LongHeader {
            token: &[],
            ..*self
        }
    }
}

/// A packet whose header is not protected any more.
pub(crate) struct Sealed<'a> {
    pub(crate) first: u8,
    pub(crate) number: u64,
    header: &'a [u8],
    payload: &'a mut [u8],
}

impl<'a> Sealed<'a> {
    /// `expected` follows the largest packet number so far.
    #[inline]
    pub(crate) fn new(
        packet: &'a mut [u8],
        number_offset: usize,
        key: &dyn HeaderKey,
        expected: u64,
    ) -> Option<Self> {
        let [first_mask, mask @ ..] = key.mask(sample(packet, number_offset)?);
        let first = packet.first_mut()?;
        *first ^= first_mask & protected_bits(*first);
        let first = *first;
        let len = usize::from(first & 3) + 1;
        let unused_bits = 8 * (MAX_NUMBER_LEN - len);
        let bytes = packet.get_mut(number_offset..)?.first_chunk_mut()?;
        let mask = u32::from_be_bytes(mask) >> unused_bits << unused_bits;
        let word = u32::from_be_bytes(*bytes) ^ mask;
        *bytes = word.to_be_bytes();
        let (header, payload) = packet.split_at_mut_checked(number_offset + len)?;
        Some(Self {
            first,
            number: Some(expand_number(word >> unused_bits, len, expected))
                .filter(|&number| number <= MAX_VARINT)?,
            header,
            payload,
        })
    }

    #[inline]
    pub(crate) fn open(self, key: &PayloadKey) -> Option<&'a [u8]> {
        key.open(self.number, self.header, self.payload)
    }
}

#[inline]
pub(crate) fn has_reserved_bits(first: u8) -> bool {
    first & if first & LONG_HEADER != 0 { 0x0c } else { 0x18 } != 0
}

#[inline]
fn protected_bits(first: u8) -> u8 {
    if first & LONG_HEADER != 0 { 0x0f } else { 0x1f }
}

#[inline]
fn sample(packet: &[u8], number_offset: usize) -> Option<&[u8; SAMPLE_LEN]> {
    packet.get(number_offset + MAX_NUMBER_LEN..)?.first_chunk()
}

/// RFC 9000 §A.3.
#[inline]
fn expand_number(truncated: u32, len: usize, expected: u64) -> u64 {
    let window = 1 << (8 * len);
    let candidate = expected & !(window - 1) | u64::from(truncated);
    if candidate + window / 2 <= expected && candidate + window <= MAX_VARINT {
        candidate + window
    } else if candidate > expected + window / 2 && candidate >= window {
        candidate - window
    } else {
        candidate
    }
}

/// RFC 9000 §A.2. One byte is not enough for a packet that arrives late.
#[inline]
pub(crate) fn number_len(number: u64, largest_acked: Option<u64>) -> usize {
    match largest_acked.map_or(number + 1, |acked| number - acked) {
        ..0x8000 => 2,
        0x8000..0x80_0000 => 3,
        _ => 4,
    }
}

/// A packet at the end of a buffer whose frames are being written.
pub(crate) struct Unsealed {
    pub(crate) number: u64,
    pub(crate) start: usize,
    number_offset: usize,
    pub(crate) payload_start: usize,
}

pub(crate) struct LongFields<'a> {
    pub(crate) version: Version,
    pub(crate) kind: LongKind,
    pub(crate) destination: &'a ConnectionId,
    pub(crate) source: &'a ConnectionId,
    pub(crate) token: &'a [u8],
}

impl Unsealed {
    pub(crate) fn long(out: &mut Vec<u8>, fields: &LongFields, number: u64, len: usize) -> Self {
        let start = out.len();
        Invariants {
            first: fields.kind.first_byte(fields.version) | (len - 1) as u8,
            version: fields.version.number(),
            destination: fields.destination,
            source: fields.source,
            rest: &[],
        }
        .write(out);
        if fields.kind == LongKind::Initial {
            out.prefixed_bytes(fields.token);
        }
        out.extend_from_slice(&[0; 2]);
        Self::numbered(out, start, number, len)
    }

    /// `flags` are the bits of the first byte.
    #[inline]
    pub(crate) fn short(
        out: &mut Vec<u8>,
        flags: u8,
        destination: &ConnectionId,
        number: u64,
        len: usize,
    ) -> Self {
        let start = out.len();
        out.push(flags | (len - 1) as u8);
        out.extend_from_slice(destination);
        Self::numbered(out, start, number, len)
    }

    #[inline]
    fn numbered(out: &mut Vec<u8>, start: usize, number: u64, len: usize) -> Self {
        let number_offset = out.len();
        let word = (number as u32) << (8 * (MAX_NUMBER_LEN - len));
        out.extend_from_slice(&word.to_be_bytes());
        out.truncate(number_offset + len);
        Self {
            number,
            start,
            number_offset,
            payload_start: out.len(),
        }
    }

    /// Makes room for the tag after the last frame.
    #[inline]
    pub(crate) fn end(&self, out: &mut Vec<u8>) {
        let min_len =
            (self.number_offset + MAX_NUMBER_LEN).max(self.start + MIN_SENT_LEN - TAG_LEN);
        if out.len() < min_len {
            out.resize(min_len, 0);
        }
        out.extend_from_slice(&[0; TAG_LEN]);
    }

    /// `out` ends where [`Self::end`] left it. Nothing is left of the packet if there are no keys.
    #[inline]
    pub(crate) fn seal(&self, out: &mut [u8], keys: Option<&Keys>) {
        if keys.and_then(|keys| self.try_seal(out, keys)).is_none() {
            out.get_mut(self.start..).unwrap_or_default().fill(0);
        }
    }

    #[inline]
    fn try_seal(&self, out: &mut [u8], keys: &Keys) -> Option<()> {
        if out.get(self.start)? & LONG_HEADER != 0 {
            let length = two_byte_varint(out.len() - self.number_offset);
            *out.get_mut(..self.number_offset)?.last_chunk_mut()? = length;
        }
        let (before, rest) = out.split_at_mut_checked(self.payload_start)?;
        let (payload, tag) = rest.split_last_chunk_mut()?;
        *tag = (keys.payload).seal(self.number, before.get(self.start..)?, payload);
        let [first_mask, mask @ ..] = keys.header.mask(sample(out, self.number_offset)?);
        let first = out.get_mut(self.start)?;
        *first ^= first_mask & protected_bits(*first);
        let unused_bits = 8 * (self.number_offset + MAX_NUMBER_LEN - self.payload_start);
        let bytes = out.get_mut(self.number_offset..)?.first_chunk_mut()?;
        let mask = u32::from_be_bytes(mask) >> unused_bits << unused_bits;
        *bytes = (u32::from_be_bytes(*bytes) ^ mask).to_be_bytes();
        Some(())
    }
}
