//! RFC 9000 §17 and RFC 9001 §5.4.

use crate::cid::{ConnectionId, LocalId};
use crate::coding::{MAX_VARINT, Read, Write, two_byte_varint};
use crate::crypto::{HeaderKey, Keys, PayloadKey, SAMPLE_LEN, TAG_LEN};
use crate::frame::Frame;
use crate::version::Version;

pub(crate) const LONG_HEADER: u8 = 0x80;
pub(crate) const FIXED_BIT: u8 = 0x40;
pub(crate) const SPIN_BIT: u8 = 0x20;
pub(crate) const KEY_PHASE: u8 = 0x04;
const MAX_NUMBER_LEN: usize = 4;

/// Of a datagram with an Initial packet, and what every path has to carry (RFC 9000 §14).
pub(crate) const MIN_DATAGRAM_LEN: usize = 1200;

/// Of the destination of the first packet (RFC 9000 §7.2).
pub(crate) const MIN_INITIAL_ID_LEN: usize = 8;

/// RFC 9000 §10.3.
pub(crate) const MIN_RESET_LEN: usize = 21;
/// So that the peer can answer any packet with a reset that passes for one of its own.
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
        let [first, version @ ..] = input.array::<5>()?;
        Some(Self {
            first,
            version: u32::from_be_bytes(version),
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
            LongKind::Retry => rest.split_last_chunk::<TAG_LEN>()?.0,
            LongKind::EarlyData | LongKind::Handshake => &[],
        };
        let (protected_len, len) = match kind {
            LongKind::Retry => (TAG_LEN, datagram.len()),
            _ => (rest.prefixed_bytes()?.len(), datagram.len() - rest.len()),
        };
        Some(Self {
            version,
            kind,
            destination: ConnectionId::new(invariants.destination)?,
            source: ConnectionId::new(invariants.source)?,
            token,
            number_offset: len - protected_len,
            len,
        })
    }

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
        let (first, bytes, sample) = protected_parts(packet, number_offset)?;
        let [first_mask, mask @ ..] = key.mask(sample);
        *first ^= first_mask & protected_bits(*first);
        let first = *first;
        let len = usize::from(first & 3) + 1;
        let unused_bits = 8 * (MAX_NUMBER_LEN - len);
        let mask = u32::from_be_bytes(mask) >> unused_bits << unused_bits;
        let word = u32::from_be_bytes(*bytes) ^ mask;
        *bytes = word.to_be_bytes();
        let (header, payload) = packet.split_at_mut((number_offset + len).min(packet.len()));
        Some(Self {
            first,
            number: Some(expand_number(word >> unused_bits, len, expected))
                .filter(|&number| number <= MAX_VARINT)?,
            header,
            payload,
        })
    }

    #[inline]
    pub(crate) fn open(self, key: &PayloadKey) -> Option<Opened<'a>> {
        Some(Opened {
            first: self.first,
            number: self.number,
            payload: key.open(self.number, self.header, self.payload)?,
        })
    }
}

/// An authentic packet.
pub(crate) struct Opened<'a> {
    pub(crate) first: u8,
    pub(crate) number: u64,
    pub(crate) payload: &'a [u8],
}

impl Opened<'_> {
    #[inline]
    pub(crate) fn has_reserved_bits(&self) -> bool {
        let is_long = self.first & LONG_HEADER != 0;
        self.first & if is_long { 0x0c } else { 0x18 } != 0
    }

    /// For an Initial packet, which is dropped if there is something wrong with it (RFC 9000 §11.1). The frames also
    /// have to pass `check`.
    pub(crate) fn is_valid_initial(&self, mut check: impl FnMut(&Frame) -> bool) -> bool {
        let mut rest = self.payload;
        let mut is_valid = !self.has_reserved_bits() && !rest.is_empty();
        while is_valid && !rest.is_empty() {
            is_valid = Frame::read(&mut rest)
                .is_ok_and(|frame| frame.is_allowed_in_handshake() && check(&frame));
        }
        is_valid
    }
}

#[inline]
fn protected_bits(first: u8) -> u8 {
    if first & LONG_HEADER != 0 { 0x0f } else { 0x1f }
}

/// The first byte, the room for the longest packet number, and the sample (RFC 9001 §5.4.2).
#[inline]
fn protected_parts(
    packet: &mut [u8],
    number_offset: usize,
) -> Option<(&mut u8, &mut [u8; MAX_NUMBER_LEN], &[u8; SAMPLE_LEN])> {
    let (before, rest) = packet.split_at_mut(number_offset.min(packet.len()));
    let (number, rest) = rest.split_first_chunk_mut()?;
    (before.first_mut().zip(rest.first_chunk())).map(|(first, sample)| (first, number, sample))
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
        let packet = out.get_mut(self.start..).unwrap_or_default();
        if keys.and_then(|keys| self.try_seal(packet, keys)).is_none() {
            packet.fill(0);
        }
    }

    #[inline]
    fn try_seal(&self, packet: &mut [u8], keys: &Keys) -> Option<()> {
        let number_offset = self.number_offset - self.start;
        if packet.first() >= Some(&LONG_HEADER) {
            let length = two_byte_varint(packet.len() - number_offset);
            let before = packet.get_mut(..number_offset);
            crate::with(before.and_then(|it| it.last_chunk_mut()), |it| *it = length);
        }
        let header_len = (self.payload_start - self.start).min(packet.len());
        let (header, rest) = packet.split_at_mut(header_len);
        let sealed = (rest.split_last_chunk_mut())
            .map(|(payload, tag)| *tag = keys.payload.seal(self.number, header, payload));
        let parts = protected_parts(packet, number_offset);
        sealed.and(parts).map(|(first, bytes, sample)| {
            let [first_mask, mask @ ..] = keys.header.mask(sample);
            *first ^= first_mask & protected_bits(*first);
            let unused_bits = 8 * (self.number_offset + MAX_NUMBER_LEN - self.payload_start);
            let mask = u32::from_be_bytes(mask) >> unused_bits << unused_bits;
            *bytes = (u32::from_be_bytes(*bytes) ^ mask).to_be_bytes();
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Unprotected;

    impl HeaderKey for Unprotected {
        fn mask(&self, _: &[u8; SAMPLE_LEN]) -> [u8; 5] {
            [0; 5]
        }
    }

    #[test]
    fn numbers_are_as_long_as_it_takes() {
        for (number, largest_acked, len) in [
            (0x7ffe, None, 2),
            (0x7fff, None, 3),
            (0xac_5c02, Some(0xab_e8b3), 2),
            (0xac_e8fe, Some(0xab_e8b3), 3),
            (0x80_0000, Some(1), 3),
            (0x80_0001, Some(1), 4),
        ] {
            assert_eq!(number_len(number, largest_acked), len);
        }
    }

    #[test]
    fn numbers_are_expanded_within_their_range() {
        for (truncated, len, expected, number) in [
            (0x9b32, 2, 0xa82f_30eb, Some(0xa82f_9b32)),
            (0xff, 1, 0, Some(0xff)),
            (0x00, 1, 0x17f, Some(0x100)),
            (0x00, 1, 0x180, Some(0x200)),
            (0xff, 1, 0x17f, Some(0x1ff)),
            (0xff, 1, 0x17e, Some(0xff)),
            (0x00, 1, MAX_VARINT, Some(MAX_VARINT - 0xff)),
            (0xff, 1, MAX_VARINT + 1, Some(MAX_VARINT)),
            (0x00, 1, MAX_VARINT + 1, None),
        ] {
            let mut packet = Vec::new();
            Unsealed::short(&mut packet, 0, &ConnectionId::default(), truncated, len)
                .end(&mut packet);
            let sealed = Sealed::new(&mut packet, 1, &Unprotected, expected);
            assert_eq!(sealed.map(|it| it.number), number);
        }
    }

    #[test]
    fn nothing_is_left_of_a_packet_without_keys() {
        let mut out = vec![1];
        let packet = Unsealed::short(&mut out, FIXED_BIT, &ConnectionId::default(), 1, 1);
        packet.end(&mut out);
        packet.seal(&mut out, None);
        assert_eq!(out, [&[1][..], &[0; MIN_SENT_LEN]].concat());
    }
}
