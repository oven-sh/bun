//! Huffman tables: as a file has them, and as the decoders and encoders look codes up in them.

use crate::bit_reader::{BITS_IN_REFILL, Bits, Window};
use crate::header::{MAX_COMPONENTS, Scan};
use crate::{Error, Result, wrapped, wrapped_mut};
use core::hint::select_unpredictable;

#[derive(Clone, Copy)]
pub(crate) struct Spec {
    /// How many codes there are of 1 to 16 bits.
    pub(crate) counts: [u8; 16],
    pub(crate) symbols: [u8; 256],
}

impl Spec {
    #[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
    const fn new(counts: [u8; 16], used: &[u8]) -> Self {
        let mut symbols = [0; 256];
        let mut i = 0;
        while i < used.len() {
            symbols[i] = used[i];
            i += 1;
        }
        Self { counts, symbols }
    }

    pub(crate) fn len(&self) -> usize {
        self.counts.iter().map(|&count| usize::from(count)).sum()
    }

    /// For each length: the length, the first code of that length, and the symbols that it and the next codes are for.
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
    pub(crate) fn optimal(frequencies: &[u64; 256]) -> Self {
        const MERGED: u64 = u64::MAX;
        const NONE: usize = 0;

        // By leaf, from 1 on. Of the leaves of a subtree, the first has the weight of them all.
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
        // It takes the code that is all ones, which is not allowed.
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
                    break *next = append as u16;
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

        // Two of the longest codes make way: one for their prefix, the other for half of a shorter code.
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
        if let Some(count) = counts.iter_mut().take(17).rfind(|count| **count != 0) {
            *count -= 1;
        }
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

/// The run of 16 zeros that no coefficient follows.
pub(crate) const ZEROS: usize = 16;
/// The run of the code that ends a block.
pub(crate) const END: usize = 128;

/// No bits follow that difference. [`extend`] makes 32768 or -32768 of anything, which is the same in 16 bits.
const MASK_OF_32768: u32 = 0x8000;

/// The number that the bits of `bits` under `mask` stand for.
#[inline(always)]
pub(crate) fn extend(bits: u32, mask: u32) -> i32 {
    let (bits, mask) = ((bits & mask) as i32, mask as i32);
    bits - select_unpredictable(2 * bits > mask, 0, mask)
}

/// A code, and how to read the bits that follow it.
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
            (_, 15, 0) => (ZEROS, 0),
            (Alphabet::Ac, _, 0) => (END, 0),
            (_, _, 0) => (END, high),
            (Alphabet::AcRefine, ..) => (high.into(), 1),
            _ => (high.into(), low),
        };
        Self((code_length + u32::from(extra)) | (run as u32) << 8 | ((1 << extra) - 1) << 16)
    }

    /// Of the code and the bits that follow it: at most 32.
    #[inline(always)]
    pub(crate) fn length(self) -> u32 {
        self.0 & 0xFF
    }

    /// Takes them from `bits`.
    #[inline(always)]
    pub(crate) fn take(self, bits: &mut Bits) -> u32 {
        bits.take_low_byte(self.0)
    }

    /// How many zeros come before the coefficient.
    #[inline(always)]
    pub(crate) fn run(self) -> usize {
        (self.0 >> 8 & 0xFF) as usize
    }

    /// A one for each of the bits that follow the code, or [`MASK_OF_32768`].
    #[inline(always)]
    pub(crate) fn mask(self) -> u32 {
        self.0 >> 16
    }

    fn extra_length(self) -> u32 {
        self.mask().trailing_ones()
    }

    /// The number that `bits`, which end with those that follow the code, stand for.
    #[inline(always)]
    pub(crate) fn value(self, bits: u32) -> i32 {
        extend(bits, self.mask())
    }

    /// For how many more blocks [`END`] counts.
    #[inline(always)]
    pub(crate) fn end_run(self, bits: u32) -> usize {
        (self.mask() + (bits & self.mask())) as usize
    }
}

/// All the codes of a table.
pub(crate) struct Codes {
    /// For each length, the first 16 bits that no code of at most that length is the start of.
    limits: [u16; 16],
    /// For each length, where in `codes` the code 0 would be.
    offsets: [u16; 16],
    codes: [Code; 256],
    /// libjpeg takes 17 bits to be sure that there is no such code, and goes on as if it were for symbol 0.
    no_code: Code,
}

impl Codes {
    pub(crate) const NONE: Self = Self {
        limits: [0; 16],
        offsets: [0; 16],
        codes: [Code::NONE; 256],
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
        self.no_code = Code::new(alphabet, 0, 17);
        Ok(())
    }

    /// Calls `visit` for each code that is no longer than an index into `slots`, with those whose indices start with it.
    #[inline(always)]
    pub(crate) fn share_out<T>(&self, mut slots: &mut [T], mut visit: impl FnMut(Code, &mut [T])) {
        let bits = slots.len().ilog2();
        for &code in self.codes.iter().take_while(|code| code.length() != 0) {
            let after_code = bits.checked_sub(code.length() - code.extra_length());
            let share = after_code.and_then(|bits| slots.split_off_mut(..1 << bits));
            let Some(share) = share else { return };
            visit(code, share);
        }
    }

    /// `bits` has the next bit at its top, and at least 16 of them.
    #[cold]
    #[inline(never)]
    pub(crate) fn search(&self, bits: u64) -> Code {
        let bits = (bits >> 48) as u16;
        let shorter: u16 = self
            .limits
            .iter()
            .map(|&limit| u16::from(bits >= limit))
            .sum();
        let Some(offset) = self.offsets.get(usize::from(shorter)) else {
            return self.no_code;
        };
        let code = bits >> (15 - shorter);
        *wrapped(&self.codes, code.wrapping_add(*offset).into())
    }
}

const QUICK_BITS: u32 = 10;
/// For all but DC coefficients.
const MAX_QUICK_LENGTH: u32 = 15;
/// What is left after so many is enough to look up the next.
pub(crate) const QUICK_CODES_IN_REFILL: u32 = (BITS_IN_REFILL - QUICK_BITS) / MAX_QUICK_LENGTH;
/// So is what is left after a code of 16 bits, a sign and so many more.
pub(crate) const MAX_BITS_AFTER_CODE: u32 = BITS_IN_REFILL - QUICK_BITS - 17;

pub(crate) struct DecodeTable {
    /// By the next bits. What is long or takes special care is not here.
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
            Alphabet::Dc => (32, 0),
            Alphabet::AcFirst { shift } => (MAX_QUICK_LENGTH, shift),
            _ => (MAX_QUICK_LENGTH, 0),
        };
        self.codes.share_out(&mut self.quick, |code, slots| {
            // So a coefficient that a quick code is for is not zero, not even in 16 bits after the shift.
            if code.length() <= longest
                && code.run() != ZEROS
                && (code.run() == END || code.mask() << shift <= 0xFFFF)
            {
                slots.fill(code);
            }
        });
        Ok(())
    }

    /// `bits` has at least [`QUICK_BITS`], the next at its top. A length of 0 is a case for [`Self::search`].
    #[inline(always)]
    pub(crate) fn quick(&self, bits: u64) -> Code {
        *wrapped(&self.quick, (bits >> (64 - QUICK_BITS)) as usize)
    }

    /// `bits` has at least 16.
    #[inline(always)]
    pub(crate) fn search(&self, bits: u64) -> Code {
        self.codes.search(bits)
    }

    /// It refills `bits`.
    #[inline(always)]
    pub(crate) fn find(&self, bits: &mut Bits, window: &Window<'_, '_>) -> Code {
        let quick = self.quick(bits.peek());
        bits.refill(window);
        if quick.length() != 0 {
            quick
        } else {
            self.search(bits.peek())
        }
    }
}

/// The table for each of the components of a scan. Those that name the same one share it.
pub(crate) struct DecodeTables {
    tables: Vec<DecodeTable>,
    by_number: [usize; 4],
}

impl DecodeTables {
    pub(crate) fn new(
        numbers: impl Iterator<Item = u8>,
        specs: &[Option<Spec>; 4],
        alphabet: Alphabet,
    ) -> Result<Self> {
        let mut this = Self {
            tables: Vec::new(),
            by_number: [usize::MAX; 4],
        };
        for number in numbers.map(usize::from) {
            let spec = specs.get(number).and_then(Option::as_ref);
            let spec = spec.ok_or(Error::MissingTable)?;
            let index = wrapped_mut(&mut this.by_number, number);
            if *index == usize::MAX {
                *index = this.tables.len();
                this.tables.try_reserve(1)?;
                this.tables
                    .push_mut(DecodeTable::NONE)
                    .fill(spec, alphabet)?;
            }
        }
        Ok(this)
    }

    pub(crate) fn get(&self, number: u8) -> Result<&DecodeTable> {
        let index = *wrapped(&self.by_number, number.into());
        self.tables.get(index).ok_or(Error::Internal)
    }

    /// For [`Slot::pick`](crate::scan::Slot::pick).
    pub(crate) fn dc_by_component(&self, scan: &Scan) -> Result<[&DecodeTable; MAX_COMPONENTS]> {
        let mut tables = [self.tables.first().ok_or(Error::Internal)?; MAX_COMPONENTS];
        for (to, component) in tables.iter_mut().zip(scan.components()) {
            *to = self.get(component.dc_table)?;
        }
        Ok(tables)
    }
}

/// For each symbol: its code, and below that 8 bits with its length.
pub(crate) struct EncodeTable([u32; 256]);

impl EncodeTable {
    pub(crate) const EMPTY: Self = Self([0; 256]);

    pub(crate) fn new(spec: &Spec) -> Self {
        let mut table = Self::EMPTY;
        table.add(spec, 0);
        table
    }

    /// The codes of `spec` go to symbols that are `offset` higher.
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
