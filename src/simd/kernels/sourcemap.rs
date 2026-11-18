//! The mappings of a source map, after Muła's base64 decoder and Masked VByte.
use crate::ByteSet;
use bun_simd::{Out, Writer};

pub use simd::{count_delimiters, parse_mappings};

const NOT_BASE64: ByteSet = ByteSet {
    rows: [
        0x10, 0x10, 0x01, 0x02, 0x04, 0x08, 0x04, 0x08, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10,
        0x10,
    ],
    columns: [
        0x15, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x13, 0x1A, 0x1B, 0x1B, 0x1B,
        0x1A,
    ],
};
const LUT_ROLL: [u8; 16] = [
    0x00, 0x10, 0x13, 0x04, 0xBF, 0xBF, 0xB9, 0xB9, 0, 0, 0, 0, 0, 0, 0, 0,
];

/// In the last byte of a shuffle, for a field of more than two digits.
const TOO_LONG: u8 = 0xFE;

/// For the continuation bits of 8 digits: moves each of 5 fields to a 16-bit lane.
static SHUFFLES: [[u8; 16]; 256] = {
    let mut table = [[0x80; 16]; 256];
    let mut continues = 0;
    while continues < 256 {
        let (mut digit, mut field) = (0, 0);
        while field < 5 {
            table[continues][2 * field] = digit;
            if continues >> digit & 1 != 0 {
                digit += 1;
                table[continues][2 * field + 1] = digit;
            }
            digit += 1;
            field += 1;
        }
        table[continues][15] = if continues & continues >> 1 != 0 {
            TOO_LONG
        } else {
            0
        };
        continues += 1;
    }
    table
};

#[derive(Default, Clone, Copy, PartialEq, Eq, Debug)]
pub struct MappingsState {
    pub gen_line: i32,
    pub gen_col: i32,
    pub orig_line: i32,
    pub orig_col: i32,
    pub src_idx: i32,
    pub name_idx: i32,
    pub needs_sort: bool,
    pub has_names: bool,
}

/// `Pairs` has a line and a column per row.
pub struct Columns<Pairs, Indices> {
    pub generated: Pairs,
    pub original: Pairs,
    pub src_idx: Indices,
    pub name_idx: Option<Indices>,
}

pub type ColumnsOut<'a> = Columns<Out<'a, [i32; 2]>, Out<'a, i32>>;
type ColumnsFilled<'a> = Columns<&'a mut [[i32; 2]], &'a mut [i32]>;
type Rows<'a> = Columns<Writer<'a, [i32; 2]>, Writer<'a, i32>>;

impl<'a> Rows<'a> {
    #[inline(always)]
    fn new(out: ColumnsOut<'a>) -> Self {
        let names = out.name_idx.as_ref().map_or(usize::MAX, Out::len);
        let pairs = out.generated.len().min(out.original.len());
        let len = pairs.min(out.src_idx.len()).min(names);
        Self {
            generated: out.generated.take(len).into_writer(),
            original: out.original.take(len).into_writer(),
            src_idx: out.src_idx.take(len).into_writer(),
            name_idx: out.name_idx.map(|names| names.take(len).into_writer()),
        }
    }

    #[inline(always)]
    fn remaining(&self) -> usize {
        self.src_idx.remaining()
    }

    /// Needs room for `N` rows.
    #[inline(always)]
    fn push<const N: usize>(&mut self, batch: &Batch<N>) {
        self.generated.push_first(batch.generated, batch.len);
        self.original.push_first(batch.original, batch.len);
        self.src_idx.push_first(batch.src_idx, batch.len);
        if let Some(names) = &mut self.name_idx {
            names.push_first(batch.name_idx, batch.len);
        }
    }

    #[inline(always)]
    fn finish(self) -> ColumnsFilled<'a> {
        Columns {
            generated: self.generated.finish(),
            original: self.original.finish(),
            src_idx: self.src_idx.finish(),
            name_idx: self.name_idx.map(Writer::finish),
        }
    }
}

/// The rows of a block.
struct Batch<const N: usize> {
    generated: [[i32; 2]; N],
    original: [[i32; 2]; N],
    src_idx: [i32; N],
    name_idx: [i32; N],
    len: usize,
}

impl<const N: usize> Batch<N> {
    const EMPTY: Self = Self {
        generated: [[0; 2]; N],
        original: [[0; 2]; N],
        src_idx: [0; N],
        name_idx: [0; N],
        len: 0,
    };

    #[inline(always)]
    fn push(&mut self, gen_line: i32, [gen_col, src_idx, line, column]: [i32; 4], name_idx: i32) {
        self.generated[self.len] = [gen_line, gen_col];
        self.original[self.len] = [line, column];
        self.src_idx[self.len] = src_idx;
        self.name_idx[self.len] = name_idx;
        self.len += 1;
    }
}

/// One bit per byte of a block.
#[derive(Clone, Copy)]
struct Bits {
    delimiters: u64,
    semicolons: u64,
    continues: u64,
    invalid: u64,
}

impl Bits {
    #[inline(always)]
    fn skip(&mut self, len: usize) {
        self.delimiters >>= len;
        self.semicolons >>= len;
        self.continues >>= len;
    }

    /// The continuation bits of the first `len` digits, and the number of fields in them.
    #[inline(always)]
    fn fields(self, len: usize) -> (u64, usize) {
        let continues = self.continues & ((1 << len) - 1);
        match continues {
            0 => (0, len),
            _ => (continues, len - continues.count_ones() as usize),
        }
    }
}

/// With room to load a vector at any digit of a block.
type Digits = [u8; 80];

#[inline(always)]
fn decode_vlq(digits: &Digits, at: &mut usize, end: usize) -> i32 {
    let (mut vlq, mut shift) = (0u32, 0u32);
    loop {
        let digit = digits[*at];
        vlq |= u32::from(digit & 31) << (shift & 31);
        *at += 1;
        if digit & 32 == 0 || *at >= end {
            break;
        }
        shift += 5;
    }
    let sign = -((vlq & 1) as i32);
    ((vlq >> 1) as i32 ^ sign) - sign
}

#[bun_simd::foreach_target]
mod simd {
    use crate::byte_set::simd::this_target::class;
    use isa::{I8, I32, U8, Vector, x128};

    const BLOCK: usize = U8::LEN;
    /// The segments of four digits and a comma that fit in a block.
    const SHORT_SEGMENTS: usize = BLOCK / 5;

    /// The generated column, the source, and the original line and column.
    type Fields = x128::I32;

    #[derive(Clone, Copy)]
    struct State {
        position: Fields,
        /// Negative where a delta was.
        signs: Fields,
        gen_line: i32,
        name_idx: i32,
        has_names: bool,
    }

    fn decode_fields(digits: &Digits, at: usize, shuffle: &[u8; 16]) -> [i16; 8] {
        use x128::{I16, U8, U16};
        let digits = U8::from_slice(&digits[at..at + 16]);
        let fields: U16 = digits.lookup(U8::load(shuffle)).bitcast();
        let vlq = fields & 0x001F | (fields & 0x1F00) >> 3;
        let sign = (vlq & 1).wrapping_neg();
        ((vlq >> 1 ^ sign) - sign).bitcast::<I16>().to_array()
    }

    /// The value of each digit, or 0xFF.
    #[inline(always)]
    fn classify(block: U8) -> (U8, Bits) {
        let is_other = class(block, &NOT_BASE64).simd_ne(0);
        let roll = U8::repeat(LUT_ROLL).lookup((block >> 4) + block.simd_eq(b'/').to_vector());
        let digits = is_other.select(0xFF, block + roll);
        let is_semicolon = block.simd_eq(b';');
        let is_delimiter = block.simd_eq(b',') | is_semicolon;
        let is_invalid = is_other & !is_delimiter;
        let mut bits = Bits {
            delimiters: is_delimiter.to_bitmask(),
            continues: ((digits & 0x20).simd_ne(0) & !is_other).to_bitmask(),
            semicolons: 0,
            invalid: 0,
        };
        if (is_semicolon | is_invalid).any() {
            bits.semicolons = is_semicolon.to_bitmask();
            bits.invalid = is_invalid.to_bitmask();
        }
        (digits, bits)
    }

    /// The deltas of the segment of `len` digits at `at`, and how many it has.
    #[inline(always)]
    fn deltas(digits: &Digits, bits: Bits, at: usize, len: usize) -> Option<(Fields, i32, usize)> {
        let (continues, fields) = bits.fields(len);
        let shuffle = &SHUFFLES[continues as usize & 0xFF];
        match fields {
            4 | 5 if continues >> 8 == 0 && shuffle[15] != TOO_LONG => {
                let deltas = decode_fields(digits, at, shuffle);
                Some((Vector::from_slice(&deltas).cast(), deltas[4].into(), fields))
            }
            1 | 4 | 5 if len - fields < 7 => {
                let (mut deltas, mut next) = ([0; 5], at);
                for delta in &mut deltas[..fields] {
                    *delta = decode_vlq(digits, &mut next, at + len);
                }
                Some((Fields::from_slice(&deltas), deltas[4], fields))
            }
            _ => None,
        }
    }

    impl State {
        fn name(&self) -> i32 {
            if self.has_names { self.name_idx } else { -1 }
        }

        fn advance(&mut self, deltas: Fields) {
            self.position += deltas;
            self.signs |= deltas;
        }

        /// Negative where the position is out of range.
        fn excess(&self, max: Fields) -> Fields {
            self.position | (max - self.position)
        }

        /// For a block of segments with four fields of one digit.
        #[inline(always)]
        fn short_segments(
            mut self,
            digits: U8,
            max: Fields,
        ) -> Option<(Self, Batch<SHORT_SEGMENTS>)> {
            let (mut deltas, sign) = ([0; 64], (digits & 1).wrapping_neg());
            ((digits >> 1 ^ sign) - sign)
                .bitcast::<I8>()
                .copy_to_slice(&mut deltas);
            let (mut batch, mut excess) = (Batch::EMPTY, Fields::zero());
            for &[a, b, c, d, _] in &deltas.as_chunks().0[..SHORT_SEGMENTS] {
                self.advance(Fields::from_array([a.into(), b.into(), c.into(), d.into()]));
                excess |= self.excess(max);
                batch.push(self.gen_line, self.position.to_array(), self.name());
            }
            excess.simd_lt(0).none().then_some((self, batch))
        }

        /// Also returns the bytes consumed. `None` leaves the block to the scalar decoder.
        #[inline(always)]
        fn segments(
            mut self,
            digits: &Digits,
            mut bits: Bits,
            max: Fields,
            batch: &mut Batch<{ I32::LEN }>,
        ) -> Option<(Self, usize)> {
            let (mut at, mut excess) = (0, Fields::zero());
            loop {
                if bits.semicolons & 1 != 0 {
                    let lines = bits.semicolons.trailing_ones() as usize;
                    self.gen_line = self.gen_line.wrapping_add(lines as i32);
                    self.position &= Fields::from_array([0, -1, -1, -1]);
                    at += lines;
                    if at >= BLOCK {
                        break;
                    }
                    bits.skip(lines);
                }
                if bits.delimiters == 0 {
                    break;
                }
                let len = bits.delimiters.trailing_zeros() as usize;
                if !(1..=10).contains(&len) || bits.continues >> (len - 1) & 1 != 0 {
                    return None;
                }
                let (deltas, name_delta, fields) = deltas(digits, bits, at, len)?;
                self.advance(deltas);
                if fields == 5 {
                    self.name_idx = self.name_idx.wrapping_add(name_delta);
                    self.has_names = true;
                }
                if fields == 1 {
                    excess |= self.position;
                } else {
                    excess |= self.excess(max);
                    batch.push(self.gen_line, self.position.to_array(), self.name());
                }
                let with_comma = len + usize::from(bits.semicolons >> len & 1 == 0);
                at += with_comma;
                if at >= BLOCK {
                    break;
                }
                bits.skip(with_comma);
            }
            (at != 0 && excess.simd_lt(0).none()).then_some((self, at))
        }
    }

    #[export]
    pub fn count_delimiters(bytes: &[u8]) -> usize {
        U8::count(bytes, |v| v.simd_eq(b',') | v.simd_eq(b';'))
    }

    /// Also returns where the scalar decoder has to resume. Leaves room for up to 15 rows unused.
    #[export(up_to = avx2, up_to = neon)]
    pub fn parse_mappings<'a>(
        bytes: &[u8],
        out: ColumnsOut<'a>,
        sources_count: i32,
        state: &mut MappingsState,
    ) -> (ColumnsFilled<'a>, usize) {
        const IN_SHORT_SEGMENTS: u64 = (1 << (5 * SHORT_SEGMENTS)) - 1;
        const EVERY_FIFTH: u64 = 0x0842_1084_2108_4210;
        let max = Fields::from_array([i32::MAX, sources_count.wrapping_sub(1), i32::MAX, i32::MAX]);
        let position = [
            state.gen_col,
            state.src_idx,
            state.orig_line,
            state.orig_col,
        ];
        let mut now = State {
            position: Fields::from_array(position),
            signs: Fields::zero(),
            gen_line: state.gen_line,
            name_idx: state.name_idx,
            has_names: state.has_names,
        };
        let (mut rest, mut rows) = (bytes, Rows::new(out));
        let (mut digits, mut batch) = ([0; 80], Batch::EMPTY);
        while let Some(block) = rest.first_chunk()
            && rows.remaining() >= I32::LEN
        {
            let (values, bits) = classify(U8::load(block));
            if bits.invalid != 0 {
                break;
            }
            let not_short = bits.continues | bits.semicolons | bits.delimiters ^ EVERY_FIFTH;
            let consumed;
            if not_short & IN_SHORT_SEGMENTS == 0 {
                let Some((next, batch)) = now.short_segments(values, max) else {
                    break;
                };
                rows.push(&batch);
                (now, consumed) = (next, 5 * SHORT_SEGMENTS);
            } else {
                values.copy_to_slice(&mut digits);
                batch.len = 0;
                let Some(next) = now.segments(&digits, bits, max, &mut batch) else {
                    break;
                };
                rows.push(&batch);
                (now, consumed) = next;
            }
            rest = &rest[consumed..];
        }
        [
            state.gen_col,
            state.src_idx,
            state.orig_line,
            state.orig_col,
        ] = now.position.to_array();
        (state.gen_line, state.name_idx) = (now.gen_line, now.name_idx);
        state.has_names = now.has_names;
        state.needs_sort |= now.signs[0] < 0;
        (rows.finish(), bytes.len() - rest.len())
    }
}
