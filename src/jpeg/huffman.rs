//! Huffman tables: the DHT form, and lookup tables for decoding and encoding.

use crate::bit_reader::{BITS_IN_REFILL, Bits, Window};
use crate::{Error, MAX_COMPONENTS, Result, wrapped, wrapped_mut};
use core::hint::{cold_path, select_unpredictable};

#[derive(Clone, Copy)]
pub(crate) struct Spec {
    /// How many codes there are of 1 to 16 bits.
    pub(crate) counts: [u8; 16],
    pub(crate) symbols: [u8; 256],
}

impl Spec {
    const fn new(counts: [u8; 16], used: &[u8]) -> Self {
        let mut symbols = [0; 256];
        symbols.split_at_mut(used.len()).0.copy_from_slice(used);
        Self { counts, symbols }
    }

    pub(crate) fn len(&self) -> usize {
        self.counts.iter().map(|&count| usize::from(count)).sum()
    }

    /// For each code length: the length, its first code and its symbols.
    fn groups(&self) -> impl Iterator<Item = (u32, u32, &[u8])> {
        let (mut code, mut rest) = (0, self.symbols.as_slice());
        (1..).zip(self.counts).map(move |(length, count)| {
            let (symbols, others) = rest.split_at_checked(count.into()).unwrap_or_default();
            let first = code;
            (code, rest) = ((code + u32::from(count)) << 1, others);
            (length, first, symbols)
        })
    }

    /// The shortest codes of at most 16 bits. It breaks ties like `jpeg_gen_optimal_table()`.
    pub(crate) fn optimal(frequencies: &[u64]) -> Self {
        const MERGED: u64 = u64::MAX;
        const NONE: usize = 0;

        // Indexed by leaf, from 1. `next` chains the leaves of a subtree, and the first one holds its weight.
        let (mut symbols, mut weights) = ([0u8; 512], [0; 512]);
        let (mut lengths, mut next) = ([0u16; 512], [NONE as u16; 512]);
        let mut last = 1;
        for (symbol, &frequency) in frequencies.iter().enumerate() {
            if frequency != 0 {
                *wrapped_mut(&mut symbols, last) = symbol as u8;
                *wrapped_mut(&mut weights, last) = frequency;
                last += 1;
            }
        }
        // A dummy leaf takes the all-ones code, which no symbol may have.
        *wrapped_mut(&mut weights, last) = 1;

        loop {
            let (mut rarest, mut second) = ((MERGED - 1, NONE), (MERGED - 1, NONE));
            for (leaf, &weight) in weights.iter().enumerate().take(last + 1).skip(1) {
                if weight <= rarest.0 {
                    second = rarest;
                    rarest = (weight, leaf);
                } else if weight <= second.0 {
                    second = (weight, leaf);
                }
            }
            let ((_, first), (weight, second)) = (rarest, second);
            if second == NONE {
                break;
            }
            *wrapped_mut(&mut weights, first) += weight;
            *wrapped_mut(&mut weights, second) = MERGED;
            let mut lengthen = |mut leaf: usize, append: usize| loop {
                *wrapped_mut(&mut lengths, leaf) += 1;
                let next = wrapped_mut(&mut next, leaf);
                if usize::from(*next) == NONE {
                    *next = append as u16;
                    break;
                }
                leaf = (*next).into();
            };
            lengthen(second, NONE);
            lengthen(first, second);
        }

        let mut counts = [0u16; 512];
        let mut longest = 0;
        for &length in lengths.iter().take(last + 1).skip(1) {
            *wrapped_mut(&mut counts, length.into()) += 1;
            longest = longest.max(usize::from(length));
        }
        let mut starts = [0u16; 512];
        for length in 1..longest {
            *wrapped_mut(&mut starts, length + 1) =
                wrapped(&starts, length) + wrapped(&counts, length);
        }
        let mut spec = Self::new([0; 16], &[]);
        for (&symbol, &length) in symbols.iter().zip(&lengths).take(last).skip(1) {
            let at = wrapped_mut(&mut starts, length.into());
            *wrapped_mut(&mut spec.symbols, (*at).into()) = symbol;
            *at += 1;
        }

        // Limits lengths to 16 (ITU-T T.81, K.2): of two longest codes, one takes their prefix, one splits a shorter code.
        for length in (17..=longest).rev() {
            while *wrapped(&counts, length) != 0 {
                let shorter = (1..length - 1)
                    .rfind(|&shorter| *wrapped(&counts, shorter) != 0)
                    .unwrap_or(0);
                *wrapped_mut(&mut counts, length) -= 2;
                *wrapped_mut(&mut counts, length - 1) += 1;
                *wrapped_mut(&mut counts, shorter + 1) += 2;
                *wrapped_mut(&mut counts, shorter) -= 1;
            }
        }
        *wrapped_mut(&mut counts, longest.min(16)) -= 1;
        for (to, &count) in spec.counts.iter_mut().zip(counts.iter().skip(1)) {
            *to = count as u8;
        }
        spec
    }
}

/// For luma, then chroma (ITU-T T.81, K.3).
pub(crate) static STANDARD_DC: [Spec; 2] = [
    Spec::new(
        [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
        &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    ),
    Spec::new(
        [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
        &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    ),
];

#[rustfmt::skip]
pub(crate) static STANDARD_AC: [Spec; 2] = [
    Spec::new([0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], &[
        0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
        0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
        0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
        0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
        0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
        0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
        0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
        0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
        0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
        0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
        0xf9, 0xfa,
    ]),
    Spec::new([0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], &[
        0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
        0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
        0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
        0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
        0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
        0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
        0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
        0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
        0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
        0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
        0xf9, 0xfa,
    ]),
];

/// What the symbols of a table mean.
#[derive(Clone, Copy)]
pub(crate) enum Alphabet {
    Dc,
    Lossless,
    Ac,
    AcFirst { shift: u8 },
    AcRefine,
}

/// The [`Code::run`] of ZRL, 16 zeros, except in [`Alphabet::AcRefine`]. Both are large enough to leave any block.
pub(crate) const RUN_OF_ZRL: usize = 64;
/// The [`Code::run`] of EOB and EOBn.
pub(crate) const RUN_OF_EOB: usize = 128;

/// For lossless category 16, which has no extra bits. [`extend`] gives 32768 or -32768, the same in 16 bits.
const MASK_OF_32768: u32 = 0x8000;

/// `EXTEND` (ITU-T T.81, F.2.2.1) of the bits under `mask`.
#[inline(always)]
pub(crate) fn extend(bits: u32, mask: u32) -> i32 {
    let (bits, mask) = ((bits & mask) as i32, mask as i32);
    bits - select_unpredictable(2 * bits > mask, 0, mask)
}

/// The inverse of [`extend`]: how many extra bits `value` takes, and those bits.
#[inline(always)]
pub(crate) const fn categorize(value: i32) -> (u32, u32) {
    let size = value.unsigned_abs().bit_width();
    (size, (value + (value >> 31)) as u32 & ((1 << size) - 1))
}

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static AC_CATEGORIES: [(u8, u16); 2048] = {
    let mut categories = [(0, 0); 2048];
    let mut value = -1024;
    while value < 1024 {
        let (size, bits) = categorize(value);
        categories[value as usize % 2048] = (size as u8, bits as u16);
        value += 1;
    }
    categories
};

/// [`categorize`] for an AC coefficient, which is at most 8 times a sample.
#[inline(always)]
pub(crate) fn categorize_ac(value: i16) -> (u32, u32) {
    let (size, bits) = *wrapped(&AC_CATEGORIES, value as usize % 2048);
    (size.into(), bits.into())
}

/// From the low byte up: [`Self::length`], [`Self::run`] and 16 bits of [`Self::mask`].
#[derive(Clone, Copy)]
pub(crate) struct Code(u32);

impl Code {
    const NONE: Self = Self(0);

    fn new(alphabet: Alphabet, symbol: u8, code_length: u32) -> Self {
        let (high, low) = (symbol >> 4, symbol & 15);
        let (run, extra) = match (alphabet, high, low) {
            (Alphabet::Lossless, 1, 0) => return Self(code_length | MASK_OF_32768 << 16),
            (Alphabet::Dc | Alphabet::Lossless, ..) => (0, low),
            (Alphabet::AcRefine, 15, 0) => (15, 0),
            (_, 15, 0) => (RUN_OF_ZRL, 0),
            (Alphabet::Ac, _, 0) => (RUN_OF_EOB, 0),
            (_, _, 0) => (RUN_OF_EOB, high),
            (Alphabet::AcRefine, ..) => (high.into(), 1),
            _ => (high.into(), low),
        };
        Self((code_length + u32::from(extra)) | (run as u32) << 8 | ((1 << extra) - 1) << 16)
    }

    /// Of the code and its extra bits: at most 32.
    #[inline(always)]
    pub(crate) fn length(self) -> u32 {
        self.0 & 0xFF
    }

    /// Takes the code and its extra bits.
    #[inline(always)]
    pub(crate) fn take(self, bits: &mut Bits) -> u32 {
        bits.take_low_byte(self.0)
    }

    /// How many zeros come before the coefficient.
    #[inline(always)]
    pub(crate) fn run(self) -> usize {
        (self.0 >> 8 & 0xFF) as usize
    }

    /// Covers the extra bits, or is [`MASK_OF_32768`].
    #[inline(always)]
    pub(crate) fn mask(self) -> u32 {
        self.0 >> 16
    }

    fn extra_length(self) -> u32 {
        self.mask().trailing_ones()
    }

    /// `bits` ends with the extra bits, like the result of [`Self::take`].
    #[inline(always)]
    pub(crate) fn value(self, bits: u32) -> i32 {
        extend(bits, self.mask())
    }

    /// How many more blocks an EOBn ends.
    #[inline(always)]
    pub(crate) fn eob_run(self, bits: u32) -> usize {
        (self.mask() + (bits & self.mask())) as usize
    }
}

/// In most tables, all codes of more than 8 bits start with four ones.
const FOUR_ONES: u16 = 0xF000;

/// [`Codes::for_each_prefix`] for the last `entries.len()` indices of `bits` bits.
#[inline(always)]
fn for_each_prefix<T>(
    codes: &[Code],
    bits: u32,
    entries: &mut [T],
    mut visit: impl FnMut(Code, &mut [T]),
) {
    let mut start = entries.len().wrapping_sub(1 << bits);
    for &code in codes.iter().take_while(|code| code.length() != 0) {
        let Some(after_code) = bits.checked_sub(code.length() - code.extra_length()) else {
            return;
        };
        let end = start.wrapping_add(1 << after_code);
        if let Some(prefixed) = entries.get_mut(start..end) {
            visit(code, prefixed);
        }
        start = end;
    }
}

/// All the codes of a table.
pub(crate) struct Codes {
    /// For each length: the first 16-bit prefix that needs a longer code.
    limits: [u16; 16],
    /// For each length: what to add to a code to get its index in `codes`.
    offsets: [u16; 16],
    codes: [Code; 256],
    /// Codes of up to 8 bits by the first byte, and of up to 12 bits by the byte after [`FOUR_ONES`].
    by_byte: [[Code; 256]; 2],
    /// Where no code matches, libjpeg takes 17 bits and goes on with symbol 0.
    no_code: Code,
}

impl Codes {
    pub(crate) const NONE: Self = Self {
        limits: [0; 16],
        offsets: [0; 16],
        codes: [Code::NONE; 256],
        by_byte: [[Code::NONE; 256]; 2],
        no_code: Code::NONE,
    };

    /// To be called on [`Self::NONE`].
    pub(crate) fn fill(&mut self, spec: &Spec, alphabet: Alphabet) -> Result<()> {
        let highest = match alphabet {
            Alphabet::Dc => 15,
            Alphabet::Lossless => 16,
            _ => u8::MAX,
        };
        let mut codes = self.codes.iter_mut();
        let bounds = self.limits.iter_mut().zip(&mut self.offsets);
        for ((length, first, symbols), (limit, offset)) in spec.groups().zip(bounds) {
            let end = first + symbols.len() as u32;
            if end >= 1 << length || symbols.iter().any(|&symbol| symbol > highest) {
                return Err(Error::InvalidTable);
            }
            *limit = (end << (16 - length)) as u16;
            *offset = ((256 - codes.len()) as u16).wrapping_sub(first as u16);
            for (&symbol, code) in symbols.iter().zip(&mut codes) {
                *code = Code::new(alphabet, symbol, length);
            }
        }
        for (bits, entries) in [8, 12].into_iter().zip(&mut self.by_byte) {
            for_each_prefix(&self.codes, bits, entries, |code, entries| {
                entries.fill(code)
            });
        }
        self.no_code = Code::new(alphabet, 0, 17);
        Ok(())
    }

    /// Calls `visit` with each code that fits in an index into `entries`, and the entries whose index starts with it.
    #[inline(always)]
    pub(crate) fn for_each_prefix<T>(&self, entries: &mut [T], visit: impl FnMut(Code, &mut [T])) {
        for_each_prefix(&self.codes, entries.len().ilog2(), entries, visit);
    }

    /// `bits` has at least 16 bits, the next at its top.
    #[inline(always)]
    pub(crate) fn search(&self, bits: u64) -> Code {
        let bits = (bits >> 48) as u16;
        let ([.., up_to_15, up_to_16], [.., offset_of_16]) = (self.limits, self.offsets);
        let [by_first, by_second] = &self.by_byte;
        let code = if bits < FOUR_ONES {
            cold_path();
            *wrapped(by_first, (bits >> 8).into())
        } else {
            let of_16 = *wrapped(&self.codes, bits.wrapping_add(offset_of_16).into());
            let shorter = *wrapped(by_second, (bits >> 4 & 0xFF).into());
            select_unpredictable(bits >= up_to_15, of_16, shorter)
        };
        if code.length() != 0 && bits < up_to_16 {
            code
        } else {
            self.search_limits(bits)
        }
    }

    /// For codes of more than 8 bits.
    #[cold]
    #[inline(never)]
    fn search_limits(&self, bits: u16) -> Code {
        let bounds = self.limits[8..].iter().zip(&self.offsets[8..]);
        for (length, (&limit, &offset)) in (9..).zip(bounds) {
            if bits < limit {
                let index = (bits >> (16 - length)).wrapping_add(offset);
                return *wrapped(&self.codes, index.into());
            }
        }
        self.no_code
    }
}

const QUICK_BITS: u32 = 10;
/// Except in DC and lossless tables.
pub(crate) const MAX_QUICK_LENGTH: u32 = 15;
/// After this many, enough bits are left to look up the next code.
pub(crate) const QUICK_CODES_IN_REFILL: u32 = (BITS_IN_REFILL - QUICK_BITS) / MAX_QUICK_LENGTH;
/// After a 16-bit code, a sign and this many bits, enough are left to look up the next code.
pub(crate) const MAX_BITS_AFTER_CODE: u32 = BITS_IN_REFILL - QUICK_BITS - 17;

pub(crate) struct DecodeTable {
    /// By the next [`QUICK_BITS`]. Long codes and those that need special care are [`Code::NONE`].
    quick: [Code; 1 << QUICK_BITS],
    codes: Codes,
}

impl DecodeTable {
    const NONE: Self = Self {
        quick: [Code::NONE; 1 << QUICK_BITS],
        codes: Codes::NONE,
    };

    fn fill(&mut self, spec: &Spec, alphabet: Alphabet) -> Result<()> {
        self.codes.fill(spec, alphabet)?;
        let (longest, shift) = match alphabet {
            Alphabet::Dc | Alphabet::Lossless => (32, 0),
            Alphabet::AcFirst { shift } => (MAX_QUICK_LENGTH, shift),
            _ => (MAX_QUICK_LENGTH, 0),
        };
        self.codes
            .for_each_prefix(&mut self.quick, |code, entries| {
                // A quick coefficient has to stay nonzero in 16 bits after the shift.
                if code.length() <= longest
                    && (code.run() == RUN_OF_EOB || code.mask() << shift <= 0xFFFF)
                {
                    entries.fill(code);
                }
            });
        Ok(())
    }

    /// `bits` has at least [`QUICK_BITS`], the next at its top. A length of 0 calls for [`Self::search`].
    #[inline(always)]
    pub(crate) fn quick(&self, bits: u64) -> Code {
        *wrapped(&self.quick, (bits >> (64 - QUICK_BITS)) as usize)
    }

    /// `bits` has at least 16.
    #[inline(always)]
    pub(crate) fn search(&self, bits: u64) -> Code {
        self.codes.search(bits)
    }

    /// Refills `bits`, and leaves the code in them.
    #[inline(always)]
    pub(crate) fn next_code(&self, bits: &mut Bits, window: &Window<'_, '_>) -> Code {
        let quick = self.quick(bits.peek());
        bits.refill(window);
        if quick.length() != 0 {
            quick
        } else {
            self.search(bits.peek())
        }
    }
}

/// The tables that a scan names, each built once.
pub(crate) struct DecodeTables {
    tables: Vec<DecodeTable>,
    by_component: [usize; MAX_COMPONENTS],
}

impl DecodeTables {
    /// `numbers` has the number of a table for each component of the scan.
    pub(crate) fn new(
        numbers: impl Iterator<Item = u8>,
        specs: &[Option<Spec>; 4],
        alphabet: Alphabet,
    ) -> Result<Self> {
        let (mut tables, mut by_component) = (Vec::new(), [0; MAX_COMPONENTS]);
        let mut by_number = [None; 4];
        for (number, index) in numbers.map(usize::from).zip(&mut by_component) {
            let spec = specs.get(number).and_then(Option::as_ref);
            let spec = spec.ok_or(Error::MissingTable)?;
            *index = *wrapped_mut(&mut by_number, number).get_or_insert(tables.len());
            if *index == tables.len() {
                tables.try_reserve(1)?;
                tables.push_mut(DecodeTable::NONE).fill(spec, alphabet)?;
            }
        }
        Ok(Self {
            tables,
            by_component,
        })
    }

    pub(crate) fn first(&self) -> Result<&DecodeTable> {
        self.tables.first().ok_or(Error::Internal)
    }

    /// For [`Slot::pick`](crate::scan::Slot::pick).
    pub(crate) fn by_component(&self) -> Result<[&DecodeTable; MAX_COMPONENTS]> {
        let mut tables = [self.first()?; MAX_COMPONENTS];
        for (to, &index) in tables.iter_mut().zip(&self.by_component) {
            *to = self.tables.get(index).ok_or(Error::Internal)?;
        }
        Ok(tables)
    }
}

/// For each symbol: `code << 8 | length`.
pub(crate) struct EncodeTable([u32; 256]);

impl EncodeTable {
    pub(crate) const EMPTY: Self = Self([0; 256]);

    pub(crate) fn new(spec: &Spec) -> Self {
        let mut table = Self::EMPTY;
        table.add(spec, 0);
        table
    }

    /// Adds the codes of `spec`, for symbols that are `offset` higher.
    pub(crate) fn add(&mut self, spec: &Spec, offset: usize) {
        for (length, first, symbols) in spec.groups() {
            for (code, &symbol) in (first..).zip(symbols) {
                *wrapped_mut(&mut self.0, offset + usize::from(symbol)) = code << 8 | length;
            }
        }
    }

    /// The code and its length.
    #[inline(always)]
    pub(crate) fn code(&self, symbol: usize) -> (u32, u32) {
        let entry = *wrapped(&self.0, symbol);
        (entry >> 8, entry & 0xFF)
    }
}
