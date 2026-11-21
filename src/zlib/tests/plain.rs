//! RFC 1951 a bit at a time, to check against.

use bun_zlib::Damage;

pub(crate) const CODE_LENGTH_ORDER: [usize; 19] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];
/// Base and extra bits.
#[rustfmt::skip]
pub(crate) const LENGTHS: [(usize, u32); 29] = [
    (3, 0), (4, 0), (5, 0), (6, 0), (7, 0), (8, 0), (9, 0), (10, 0), (11, 1), (13, 1), (15, 1), (17, 1), (19, 2),
    (23, 2), (27, 2), (31, 2), (35, 3), (43, 3), (51, 3), (59, 3), (67, 4), (83, 4), (99, 4), (115, 4), (131, 5),
    (163, 5), (195, 5), (227, 5), (258, 0),
];
#[rustfmt::skip]
pub(crate) const DISTANCES: [(usize, u32); 30] = [
    (1, 0), (2, 0), (3, 0), (4, 0), (5, 1), (7, 1), (9, 2), (13, 2), (17, 3), (25, 3), (33, 4), (49, 4), (65, 5),
    (97, 5), (129, 6), (193, 6), (257, 7), (385, 7), (513, 8), (769, 8), (1025, 9), (1537, 9), (2049, 10), (3073, 10),
    (4097, 11), (6145, 11), (8193, 12), (12289, 12), (16385, 13), (24577, 13),
];

pub(crate) fn adler32(adler: u32, bytes: &[u8]) -> u32 {
    let (mut a, mut b) = (adler & 0xffff, adler >> 16);
    for &byte in bytes {
        a = (a + u32::from(byte)) % 65521;
        b = (b + a) % 65521;
    }
    b << 16 | a
}

pub(crate) fn crc32(crc: u32, bytes: &[u8]) -> u32 {
    !bytes.iter().fold(!crc, |state, &byte| {
        (0..8).fold(state ^ u32::from(byte), |state, _| {
            state >> 1 ^ (0xedb8_8320 * (state & 1))
        })
    })
}

pub(crate) fn fixed_lengths() -> (Vec<u8>, Vec<u8>) {
    let runs = [(8, 144), (9, 112), (7, 24), (8, 8)];
    let literals = runs.into_iter().flat_map(|(bits, count)| vec![bits; count]);
    (literals.collect(), vec![5; 32])
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub(crate) enum End {
    /// Behind so many bytes of input.
    Stream(usize),
    CutShort,
    Damaged(Damage),
}

impl From<Damage> for End {
    fn from(damage: Damage) -> Self {
        Self::Damaged(damage)
    }
}

pub(crate) struct Inflated {
    pub(crate) bytes: Vec<u8>,
    pub(crate) end: End,
    /// Of the code length, literal/length and distance codes of all dynamic blocks.
    pub(crate) longest_codes: [u8; 3],
    pub(crate) max_distance: usize,
}

struct Bits<'a> {
    input: &'a [u8],
    at: usize,
}

impl Bits<'_> {
    fn take(&mut self, count: u32) -> Result<usize, End> {
        (0..count).try_fold(0, |value, shift| {
            let byte = self.input.get(self.at / 8).ok_or(End::CutShort)?;
            let bit = usize::from(byte >> (self.at % 8) & 1);
            self.at += 1;
            Ok(value | bit << shift)
        })
    }
}

struct Code {
    counts: [usize; 16],
    symbols: Vec<usize>,
}

impl Code {
    /// One that leaves bits without a meaning has to have a single code of one bit, or none.
    fn new(lengths: &[u8]) -> Option<Self> {
        let mut symbols: Vec<_> = (0..lengths.len()).filter(|&it| lengths[it] != 0).collect();
        symbols.sort_by_key(|&it| lengths[it]);
        let mut counts = [0; 16];
        symbols
            .iter()
            .for_each(|&it| counts[usize::from(lengths[it])] += 1);
        let used: usize = (1..16).map(|bits| counts[bits] << (15 - bits)).sum();
        (used == 1 << 15 || (symbols.len() < 2 && symbols.len() == counts[1]))
            .then_some(Self { counts, symbols })
    }

    fn read(&self, bits: &mut Bits<'_>) -> Result<Option<usize>, End> {
        let (mut code, mut first, mut index) = (0, 0, 0);
        for &count in &self.counts[1..] {
            code |= bits.take(1)?;
            if code < first + count {
                return Ok(Some(self.symbols[index + code - first]));
            }
            if self.symbols.len() < 2 {
                break;
            }
            (code, first, index) = (code << 1, (first + count) << 1, index + count);
        }
        Ok(None)
    }
}

impl Inflated {
    fn read_lengths(&mut self, bits: &mut Bits<'_>) -> Result<(Vec<u8>, Vec<u8>), End> {
        let (literals, distances) = (bits.take(5)? + 257, bits.take(5)? + 1);
        let count = bits.take(4)? + 4;
        if literals > 286 || distances > 30 {
            return Err(Damage::TooManySymbols.into());
        }
        let mut of_lengths = [0; 19];
        for &symbol in &CODE_LENGTH_ORDER[..count] {
            of_lengths[symbol] = bits.take(3)? as u8;
        }
        let code = Code::new(&of_lengths).filter(|it| it.symbols.len() != 1);
        let code = code.ok_or(Damage::CodeLengthsSet)?;
        let mut lengths = Vec::new();
        while lengths.len() < literals + distances {
            let (length, times) = match code.read(bits)?.unwrap_or_default() {
                16 => (lengths.last().copied(), 3 + bits.take(2)?),
                17 => (Some(0), 3 + bits.take(3)?),
                18 => (Some(0), 11 + bits.take(7)?),
                length => (Some(length as u8), 1),
            };
            let length = length.filter(|_| lengths.len() + times <= literals + distances);
            lengths.resize(
                lengths.len() + times,
                length.ok_or(Damage::BitLengthRepeat)?,
            );
        }
        if lengths[256] == 0 {
            return Err(Damage::MissingEndOfBlock.into());
        }
        let distances = lengths.split_off(literals);
        let all = [&of_lengths[..], &lengths, &distances];
        for (longest, lengths) in self.longest_codes.iter_mut().zip(all) {
            *longest = lengths.iter().copied().fold(*longest, u8::max);
        }
        Ok((lengths, distances))
    }

    fn read_symbols(
        &mut self,
        bits: &mut Bits<'_>,
        lengths: &(Vec<u8>, Vec<u8>),
    ) -> Result<(), End> {
        let literals = Code::new(&lengths.0).ok_or(Damage::LiteralLengthsSet)?;
        let distances = Code::new(&lengths.1).ok_or(Damage::DistancesSet)?;
        loop {
            let (len, extra) = match literals.read(bits)? {
                Some(byte @ ..256) => {
                    self.bytes.push(byte as u8);
                    continue;
                }
                Some(256) => return Ok(()),
                Some(symbol @ ..286) => LENGTHS[symbol - 257],
                _ => return Err(Damage::LiteralLengthCode.into()),
            };
            let len = len + bits.take(extra)?;
            let range = distances.read(bits)?.and_then(|it| DISTANCES.get(it));
            let &(distance, extra) = range.ok_or(Damage::DistanceCode)?;
            let distance = distance + bits.take(extra)?;
            let start = self.bytes.len().checked_sub(distance);
            let start = start.ok_or(Damage::DistanceTooFarBack)?;
            self.max_distance = self.max_distance.max(distance);
            for at in start..start + len {
                self.bytes.push(self.bytes[at]);
            }
        }
    }

    fn read_blocks(&mut self, bits: &mut Bits<'_>) -> Result<usize, End> {
        loop {
            let is_last = bits.take(1)? == 1;
            match bits.take(2)? {
                0 => {
                    bits.at = bits.at.next_multiple_of(8);
                    let len = bits.take(16)?;
                    if len != bits.take(16)? ^ 0xffff {
                        return Err(Damage::StoredLengths.into());
                    }
                    for _ in 0..len {
                        self.bytes.push(bits.take(8)? as u8);
                    }
                }
                1 => self.read_symbols(bits, &fixed_lengths())?,
                2 => {
                    let lengths = self.read_lengths(bits)?;
                    self.read_symbols(bits, &lengths)?;
                }
                _ => return Err(Damage::BlockType.into()),
            }
            if is_last {
                return Ok(bits.at.div_ceil(8));
            }
        }
    }
}

/// A raw stream.
pub(crate) fn inflate(input: &[u8], dictionary: &[u8]) -> Inflated {
    let mut inflated = Inflated {
        bytes: dictionary.to_vec(),
        end: End::CutShort,
        longest_codes: [0; 3],
        max_distance: 0,
    };
    inflated.end = match inflated.read_blocks(&mut Bits { input, at: 0 }) {
        Ok(read) => End::Stream(read),
        Err(end) => end,
    };
    inflated.bytes.drain(..dictionary.len());
    inflated
}
