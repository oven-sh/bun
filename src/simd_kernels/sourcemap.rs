//! The `mappings` of a source map, 64 bytes at a time. It stops at anything unusual, and leaves that and all
//! errors to the scalar parser.
//!
//! - Muła, "SIMD base64 decoding", <http://0x80.pl/notesen/2016-01-17-sse-base64-decoding.html>
//! - "Masked VByte", <https://arxiv.org/abs/1503.07387>

use bun_simd::prelude::*;
use core::mem::MaybeUninit;

/// The number of `,` and `;`.
#[kernel]
#[inline(never)]
pub fn count_delimiters(bytes: &[u8]) -> usize {
    over(bytes).count(|v| v.simd_eq(b',') | v.simd_eq(b';'))
}

/// Room for the same number of rows in each.
pub struct Columns<'a> {
    /// Line and column.
    pub generated: &'a mut [MaybeUninit<[i32; 2]>],
    /// Line and column.
    pub original: &'a mut [MaybeUninit<[i32; 2]>],
    pub source: &'a mut [MaybeUninit<i32>],
    /// -1 before the first name.
    pub name: Option<&'a mut [MaybeUninit<i32>]>,
}

#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct Parsed {
    /// This many are initialized in each column.
    pub rows: usize,
    /// The start of the segment at which the scalar parser goes on, with the values below.
    pub resume_at: usize,
    pub generated_line: i32,
    pub generated_column: i32,
    pub source: i32,
    pub original_line: i32,
    pub original_column: i32,
    pub name: i32,
    pub needs_sort: bool,
    pub has_names: bool,
}

struct Rows<'a> {
    generated: Output<'a, [i32; 2]>,
    original: Output<'a, [i32; 2]>,
    source: Output<'a, i32>,
    name: Option<Output<'a, i32>>,
}

#[simd]
impl Rows<'_> {
    fn len(&self) -> usize {
        let len = self
            .generated
            .len()
            .min(self.original.len())
            .min(self.source.len());
        self.name.as_ref().map_or(len, |name| len.min(name.len()))
    }

    fn truncate(&mut self, rows: usize) {
        self.generated.truncate(rows);
        self.original.truncate(rows);
        self.source.truncate(rows);
        if let Some(name) = &mut self.name {
            name.truncate(rows);
        }
    }
}

// These are `lut_lo`, `lut_hi` and `lut_roll` of aklomp/base64 (lib/arch/ssse3/dec_loop.c), which simdutf has too.
#[rustfmt::skip]
const NOT_DIGITS: ByteClasses = ByteClasses {
    low: [0x15, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x13, 0x1a, 0x1b, 0x1b, 0x1b, 0x1a],
    high: [0x10, 0x10, 0x01, 0x02, 0x04, 0x08, 0x04, 0x08, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10],
};
/// What to add to a digit, by its upper four bits. `/` has the place before that of `+`.
#[rustfmt::skip]
const ROLL: [u8; 16] = [0, 0x10, 0x13, 0x04, 0xbf, 0xbf, 0xb9, 0xb9, 0, 0, 0, 0, 0, 0, 0, 0];

/// By the continuation bits of a segment: moves five numbers of one or two digits to a `u16` each. The last two bytes
/// are the lengths of the first four and of all five, if they are that short.
static GATHER: Aligned<[[u8; 16]; 256]> = Aligned({
    let (mut table, mut more) = ([[0x80; 16]; 256], 0);
    while more < 256 {
        let (mut at, mut field) = (0, 0);
        while field < 5 {
            table[more][2 * field] = at as u8;
            if more >> at & 1 != 0 {
                at += 1;
                table[more][2 * field + 1] = at as u8;
            }
            at += 1;
            field += 1;
            if field >= 4 && more & more >> 1 & !(!0 << (at - 1)) == 0 {
                table[more][10 + field] = at as u8;
            }
        }
        more += 1;
    }
    table
});

#[simd]
struct Classes {
    digits: u8x64<S>,
    /// Those before the first byte that has no meaning.
    delimiters: u64,
    /// The digits that another one follows.
    more: u64,
    semicolons: u64,
}

#[simd]
fn classify(v: u8x64<S>) -> Classes<S> {
    let is_digit = !NOT_DIGITS.contains(v);
    let place = (v >> 4) + v.simd_eq(b'/').to_simd::<u8>();
    let digits = v + u8x64::repeat(&ROLL).in_blocks().lookup_bytes_relaxed(place);
    let comma = v.simd_eq(b',');
    let more = (is_digit & digits.all_bits(32)).to_bitmask();
    if (is_digit | comma).all() {
        return Classes {
            digits,
            delimiters: comma.to_bitmask(),
            more,
            semicolons: 0,
        };
    }
    let semicolons = v.simd_eq(b';').to_bitmask();
    let delimiters = comma.to_bitmask() | semicolons;
    let invalid = !(is_digit.to_bitmask() | delimiters);
    Classes {
        digits,
        delimiters: delimiters & !invalid & invalid.wrapping_sub(1),
        more,
        semicolons,
    }
}

/// Bit 0 is the sign.
#[simd]
fn signed<T: Unsigned, W: Width>(v: Simd<T, W, S>) -> Simd<T::Signed, W, S> {
    let sign = -(v & T::of::<1>());
    ((v >> 1 ^ sign) - sign).cast_signed()
}

#[simd]
fn gather(digits: &[u8; 80], at: usize, more: u8) -> i16x8<S> {
    let pairs = u8x16::load(&digits[at % 64..])
        .in_blocks()
        .lookup_bytes_relaxed(GATHER[more as usize]);
    let pairs = pairs.bitcast::<u16>();
    signed(pairs & 0x1f | pairs >> 3 & 0x3e0)
}

#[simd]
fn four_digits(digits: &[u8; 80], at: usize, len: usize) -> u32 {
    u32::from_le_bytes(*digits[at % 64..].first_chunk().unwrap()) & !(!0u64 << (8 * len)) as u32
}

/// Of up to 4 digits.
#[simd]
fn short_number(digits: &[u8; 80], at: usize, len: usize) -> i32 {
    let four = four_digits(digits, at, len);
    let all = four & 0x1f | four >> 3 & 0x3e0 | four >> 6 & 0x7c00 | four >> 9 & 0xf_8000;
    let sign = -(all as i32 & 1);
    ((all >> 1) as i32 ^ sign) - sign
}

/// Four such numbers, by the places of their last digits, and where they end.
#[simd]
fn short_numbers(digits: &[u8; 80], mut at: usize, mut ends: u64) -> (i32x4<S>, usize) {
    let four = u32x4::from(array::from_fn(|_| {
        let end = ends.trailing_zeros() as usize + 1;
        let number = four_digits(digits, at, end - at);
        (at, ends) = (end, ends & (ends - 1));
        number
    }));
    let all = four & 0x1f | four >> 3 & 0x3e0 | four >> 6 & 0x7c00 | four >> 9 & 0xf_8000;
    (signed(all), at)
}

/// The numbers of any segment, and how many. `None` unless there are 1, 4 or 5 that have up to 7 digits.
// With PGO, the rare paths next to a call save all registers, and AArch64 has many.
#[cfg_attr(target_arch = "aarch64", inline(always))]
#[cfg_attr(not(target_arch = "aarch64"), cold, inline(never))]
fn long_segment(digits: &[u8]) -> Option<([i32; 5], usize)> {
    let (mut numbers, mut count, mut all, mut shift) = ([0; 5], 0, 0, 0);
    for &digit in digits {
        // An eighth digit is shifted too far.
        all |= (digit as u32 & 31).checked_shl(shift)?;
        shift += 5;
        if digit & 32 == 0 {
            let sign = -(all as i32 & 1);
            *numbers.get_mut(count)? = ((all >> 1) as i32 ^ sign) - sign;
            (count, all, shift) = (count + 1, 0, 0);
        }
    }
    (shift == 0 && matches!(count, 1 | 4 | 5)).then_some((numbers, count))
}

/// The most segments of four fields that end in a block.
const MOST: usize = 12;
/// The commas if all have four digits.
const EVERY_FIFTH: u64 = 0x0842_1084_2108_4210;
const WITHOUT_COMMAS: [u8; 64] = {
    let (mut indices, mut i) = ([0; 64], 0);
    while i < 4 * MOST {
        indices[i] = (i + i / 4) as u8;
        i += 1;
    }
    indices
};

/// The generated column, source, original line and original column.
#[simd]
type Row = i32x4<S>;

/// What a block changes. It only counts if all is in range.
#[simd]
struct Batch {
    row: Row<S>,
    line: Row<S>,
    limit: Row<S>,
    out_of_range: Row<S>,
    negative: Row<S>,
}

#[simd]
impl Batch<S> {
    fn add(&mut self, delta: Row<S>) {
        self.row += delta;
        self.negative |= delta;
        self.out_of_range |= self.row;
    }

    fn push(
        &mut self,
        delta: Row<S>,
        generated: &mut [i32; 2],
        original: &mut [i32; 2],
        source: &mut i32,
    ) {
        self.add(delta);
        self.out_of_range |= self.limit - self.row;
        self.line.interleave(self.row)[0].split()[0].store(generated);
        self.row.split()[1].store(original);
        *source = self.row[1];
    }
}

/// Writes a row of absolute values for each segment with four or five fields.
#[kernel(Upto<B32>)]
#[inline(never)]
pub fn parse_mappings(bytes: &[u8], to: Columns<'_>, sources: i32) -> Parsed {
    let mut out = Rows {
        generated: Output::new(to.generated),
        original: Output::new(to.original),
        source: Output::new(to.source),
        name: to.name.map(Output::new),
    };
    let room = out.source.capacity();
    let limit = Row::from([i32::MAX, sources.max(0) - 1, i32::MAX, i32::MAX]);
    let (mut row, mut line, mut negative) = (Row::zero(), Row::zero(), Row::zero());
    let (mut last_name, mut has_names) = (0i32, false);
    let (mut rows, mut pos) = (0, 0);
    let mut digits = [0; 80];
    let mut unused = [0; MOST];

    while rows + MOST <= room
        && let Some((v, valid)) = u8x64::over(&bytes[pos..]).padded().next()
    {
        let block = classify(v);
        // Only empty lines: no row is written.
        if block.semicolons == valid {
            let lines = valid.count_ones();
            (line, row[0], pos) = (line + lines as i32, 0, pos + lines as usize);
            continue;
        }
        let names = out
            .name
            .as_mut()
            .map_or(&mut unused, |name| name.push_array([0; _]));
        let generated = out.generated.push_array([[0; 2]; MOST]);
        let original = out.original.push_array([[0; 2]; MOST]);
        let mut slots = generated
            .iter_mut()
            .zip(original)
            .zip(out.source.push_array([0; MOST]));
        let mut batch = Batch {
            row,
            line,
            limit,
            out_of_range: Row::zero(),
            negative,
        };
        let (mut count, mut at) = (0, 0);
        let (mut name, mut named) = (last_name, has_names);
        let mut shown_name = if named { name } else { -1 };
        if (block.more | block.semicolons | block.delimiters ^ EVERY_FIFTH) << 4 == 0 {
            let packed = signed(block.digits).swizzle_dyn_relaxed(WITHOUT_COMMAS);
            for four in [
                packed.block::<0>(),
                packed.block::<1>(),
                packed.block::<2>(),
            ] {
                for two in four.widen::<i16>() {
                    for one in two.widen::<i32>() {
                        let ((generated, original), source) = slots.next().unwrap();
                        batch.push(one, generated, original, source);
                    }
                }
            }
            *names = [shown_name; MOST];
            (count, at) = (MOST, 5 * MOST);
        } else {
            block.digits.store(&mut digits);
            let after = |end: usize| end + (!block.semicolons >> end & 1) as usize;
            'segments: for (((generated, original), source), name_slot) in slots.zip(names) {
                let (delta, len) = loop {
                    if at < 64 && block.semicolons >> at & 1 != 0 {
                        let lines = (block.semicolons >> at).trailing_ones();
                        batch.line += lines as i32;
                        batch.row[0] = 0;
                        at += lines as usize;
                    }
                    if at == 64 || block.delimiters >> at == 0 {
                        break 'segments;
                    }
                    let len = (block.delimiters >> at).trailing_zeros() as usize;
                    let more = block.more >> at & !(!0 << len);
                    let all = gather(&digits, at, more as u8);
                    let [.., four, five] = GATHER[more as u8 as usize];
                    let (four, [delta, _]) = (four as usize, all.widen::<i32>());
                    if len == four {
                        break (delta, len);
                    }
                    if len == five as usize && more < 256 {
                        name = name.wrapping_add(all[4] as i32);
                        (shown_name, named) = (name, true);
                        break (delta, len);
                    }
                    let rest = len.wrapping_sub(four);
                    if rest <= 4 && more >> four == !(!0 << rest) >> 1 {
                        name = name.wrapping_add(short_number(&digits, at + four, rest));
                        (shown_name, named) = (name, true);
                        break (delta, len);
                    }
                    // One field.
                    if len.wrapping_sub(1) < 4 && more == !(!0 << len) >> 1 {
                        batch.add(Row::from([short_number(&digits, at, len), 0, 0, 0]));
                        at = after(at + len);
                        continue;
                    }
                    let (ends, two) = (more ^ !(!0 << len), more & more >> 1);
                    if matches!(ends.count_ones(), 4 | 5) && two & two >> 2 == 0 && ends > more {
                        let (delta, end) = short_numbers(&digits, at, ends << at);
                        if end != at + len {
                            name = name.wrapping_add(short_number(&digits, end, at + len - end));
                            (shown_name, named) = (name, true);
                        }
                        break (delta, len);
                    }
                    let Some(([delta @ .., name_delta], fields)) =
                        long_segment(&digits[at..at + len])
                    else {
                        break 'segments;
                    };
                    if fields == 1 {
                        batch.add(Row::from(delta));
                        at = after(at + len);
                        continue;
                    }
                    if fields == 5 {
                        name = name.wrapping_add(name_delta);
                        (shown_name, named) = (name, true);
                    }
                    break (Row::from(delta), len);
                };
                batch.push(delta, generated, original, source);
                *name_slot = shown_name;
                (count, at) = (count + 1, after(at + len));
            }
        }
        if at == 0 || batch.out_of_range.is_negative().any() {
            break;
        }
        (row, line, negative, last_name, has_names) =
            (batch.row, batch.line, batch.negative, name, named);
        (rows, pos) = (rows + count, pos + at);
        out.truncate(rows);
    }

    out.truncate(rows);
    let [generated_column, source, original_line, original_column] = row.to_array();
    Parsed {
        rows: out.len(),
        resume_at: pos,
        generated_line: line[0],
        generated_column,
        source,
        original_line,
        original_column,
        name: last_name,
        needs_sort: negative[0] < 0,
        has_names,
    }
}
