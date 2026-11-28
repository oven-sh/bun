use crate::arithmetic::known;
use crate::{B16, Isa, MaskOf, Simd, Width};
use core::ops::RangeInclusive;

/// Up to eight classes of bytes, each with one bit or more. Byte `b` is in the classes `high[b >> 4] & low[b & 15]`.
/// A byte can be in several classes. Two bytes of a class with several bits can have different ones, so test with `any_bits`. See [`with`](Self::with) for an example.
#[derive(Copy, Clone, Debug)]
pub struct ByteClasses {
    /// By the upper four bits of a byte.
    pub high: [u8; 16],
    /// By the lower four bits of a byte.
    pub low: [u8; 16],
}

impl ByteClasses {
    /// No byte is in a class.
    pub const EMPTY: Self = Self { high: [0; 16], low: [0; 16] };

    /// Classes that have the bytes in these ranges. Panics if that takes more than eight bits: see [`with`](Self::with).
    #[track_caller]
    pub const fn new(ranges: &[RangeInclusive<u8>]) -> Self {
        Self::EMPTY.with_rows(!0, rows(ranges)).expect("more than eight different rows")
    }
    /// Adds a class: each of `members` gets one or more of `bits`, and the other bytes get none of them. Panics if another class uses one of
    /// the bits, or if they are too few. In a table of all bytes with 16 in a row, the members take a bit for each different row, or for each different
    /// column. Those that are empty or the union of others don't count.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// const SPACE: u8 = 0b00011;
    /// const STRUCTURAL: u8 = 0b11100;
    /// const JSON: ByteClasses = ByteClasses::EMPTY.with(SPACE, ByteSet::of(b" \t\n\r")).with(STRUCTURAL, ByteSet::of(b"{}[]:,"));
    /// let classes = JSON.classes(u8x8::from(b"{ \"a\":1}"));
    /// assert_eq!(classes.any_bits(SPACE).to_bitmask(), 0b10);
    /// assert_eq!(classes.simd_gt(SPACE).to_bitmask(), 0b1010_0001);
    /// assert!(JSON.classes_of(b',') & STRUCTURAL != 0);
    /// # } example()
    /// ```
    #[track_caller]
    pub const fn with(self, bits: u8, members: ByteSet) -> Self {
        let (mut rows, mut byte) = ([0; 16], 0);
        while byte < 256 {
            rows[byte >> 4] |= ((members.tables[byte >> 7][byte & 15] >> (byte >> 4 & 7) & 1) as u16) << (byte & 15);
            byte += 1;
        }
        assert!(
            (u128::from_ne_bytes(self.high) | u128::from_ne_bytes(self.low)) & u128::from_ne_bytes([bits; 16]) == 0,
            "another class has one of these bits"
        );
        self.with_rows(bits, rows).expect("too few bits for this class")
    }
    const fn with_rows(self, bits: u8, rows: [u16; 16]) -> Option<Self> {
        if let Some([high, low]) = cover(bits, rows, [self.high, self.low]) {
            return Some(Self { high, low });
        }
        let (mut columns, mut byte) = ([0; 16], 0);
        while byte < 256 {
            columns[byte & 15] |= (rows[byte >> 4] >> (byte & 15) & 1) << (byte >> 4);
            byte += 1;
        }
        if let Some([low, high]) = cover(bits, columns, [self.low, self.high]) {
            Some(Self { high, low })
        } else {
            None
        }
    }
    /// The classes of one byte.
    #[inline(always)]
    pub const fn classes_of(&self, byte: u8) -> u8 {
        self.high[byte as usize >> 4] & self.low[byte as usize & 15]
    }

    /// The classes of each byte.
    #[doc(alias("classify"))]
    #[op]
    pub fn classes<S: Isa, W: Width>(&self, v: Simd<u8, W, S>) -> Simd<u8, W, S> {
        return_if!(S::SCALAR, {
            let all = v.to_array();
            v.tag().from_fn(
                #[inline(always)]
                |i| self.classes_of(all.as_ref()[i]),
            )
        });
        return_if!(W::BYTES < 16, v.tag().resize_bitcast(self.classes(v.s.fixed::<u8, B16>().resize_bitcast(v))));
        // `pshufb` ignores the other bits, and LLVM drops this mask if it is constant.
        let ascii = u128::from_le_bytes(self.high) >> 64 == 0;
        let ascii = cfg!(target_arch = "x86_64") && is_known!(ascii) && ascii;
        let low = v & if ascii { 0x8f } else { 15 };
        v.tag().dup128(self.high).table_lookup_bytes(v >> 4) & v.tag().dup128(self.low).table_lookup_bytes(low)
    }

    /// Whether each byte is in any class.
    #[inline(always)]
    pub fn contains<S: Isa, W: Width>(&self, v: Simd<u8, W, S>) -> MaskOf<u8, W, S> {
        apart_unoptimized!(v.s, {
            if_here!(
                S::BY_HAND && crate::OPTIMIZED,
                if is_known!(u128::from_le_bytes(self.high)) && is_known!(u128::from_le_bytes(self.low)) {
                    let (low, mut rows) = (v.s.fixed::<u8, B16>().from_array(self.low), [0; 16]);
                    unrolled!(
                        16,
                        for i in 0..16 {
                            rows[i] = low.any_bits(self.high[i]).to_bitmask() as u16;
                        }
                    );
                    let runs = Runs::of_rows(rows);
                    if known(runs.fit()) {
                        return runs.contains(v);
                    }
                }
            );
            return_if!(S::A64 && W::BYTES >= 16, {
                let d = v.tag();
                d.dup128(self.high).table_lookup_bytes(v >> 4).has_bit(d.dup128(self.low).table_lookup_bytes(v & 15))
            });
            self.classes(v).simd_ne(0)
        })
    }
}

/// A bit for each row that is not the union of those before it that are equal and of all that have less. It goes to all rows that include that one.
const fn cover(mut bits: u8, rows: [u16; 16], [mut by_row, mut by_column]: [[u8; 16]; 2]) -> Option<[[u8; 16]; 2]> {
    let mut row = 0;
    while row < 16 {
        let (mut left, mut i) = (rows[row], 0);
        while i < 16 {
            if rows[i] & !rows[row] == 0 && (rows[i] != rows[row] || i < row) {
                left &= !rows[i];
            }
            i += 1;
        }
        if left != 0 {
            if bits == 0 {
                return None;
            }
            let (bit, mut i) = (bits.isolate_lowest_one(), 0);
            while i < 16 {
                by_row[i] |= if rows[row] & !rows[i] == 0 { bit } else { 0 };
                by_column[i] |= if rows[row] >> i & 1 == 1 { bit } else { 0 };
                i += 1;
            }
            bits ^= bit;
        }
        row += 1;
    }
    Some([by_row, by_column])
}

/// A set as ranges, for comparisons.
#[derive(Copy, Clone, Debug)]
struct Runs {
    /// After the last one, the first one again.
    ranges: [[u8; 2]; 8],
    /// Of all, also of those that have no place.
    len: usize,
    /// In instructions.
    cost: usize,
}

impl Runs {
    #[inline(always)]
    #[allow(unused_assignments)]
    const fn of_rows(rows: [u16; 16]) -> Self {
        macro_rules! times { ($($round:literal)*; $body:block) => { $(let _ = $round; $body)* }; }
        let (mut bits, mut i) = ([0u128; 2], 0);
        times!(0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; {
            bits[i / 8] |= (rows[i] as u128) << (i % 8 * 16);
            i += 1;
        });
        let len = ((bits[0] & !(bits[0] << 1)).count_ones() + (bits[1] & !(bits[1] << 1 | bits[0] >> 127)).count_ones())
            as usize;
        let (mut runs, mut i) = (Self { ranges: [[0; 2]; 8], len, cost: len }, 0);
        times!(0 1 2 3 4 5 6 7; {
            let [low, high] = bits;
            let first = if low != 0 { low.trailing_zeros() } else { 128 + high.trailing_zeros() };
            // The carry goes through the run, and stops after it.
            let (sum, carry) = low.overflowing_add(low.isolate_lowest_one());
            let upper = high.wrapping_add(if low != 0 { carry as u128 } else { high.isolate_lowest_one() });
            bits = [low & sum, high & upper];
            let count = (low ^ bits[0]).count_ones() + (high ^ bits[1]).count_ones();
            runs.ranges[i] = if i < len { [first as u8, (first + count - 1) as u8] } else { runs.ranges[0] };
            runs.cost += if i >= len {
                0
            } else if count == 1 {
                1
            } else {
                2
            };
            i += 1;
        });
        runs
    }
    #[inline(always)]
    const fn fit(&self) -> bool {
        1 <= self.len && self.len <= 8
    }
    #[op]
    fn contains<S: Isa, W: Width>(&self, v: Simd<u8, W, S>) -> MaskOf<u8, W, S> {
        let known = always!(|it| if S::SCALAR { it } else { known(it) });
        let test = always!(|[first, last]: [u8; 2]| if known(first == last) {
            v.simd_eq(first)
        } else {
            v.in_range(first, last)
        });
        let mut found = test(self.ranges[0]);
        unrolled!(
            8,
            for i in 1..8 {
                if !known(i >= self.len) {
                    found |= test(self.ranges[i]);
                }
            }
        );
        found
    }
}

/// For each value of the upper four bits, a bit for each value of the lower four.
const fn rows(ranges: &[RangeInclusive<u8>]) -> [u16; 16] {
    let (mut rows, mut rest) = ([0; 16], ranges);
    while let [range, more @ ..] = rest {
        let mut byte = *range.start() as usize;
        while byte <= *range.end() as usize {
            rows[byte >> 4] |= 1 << (byte & 15);
            byte += 1;
        }
        rest = more;
    }
    rows
}

/// Any set of bytes.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// const WORD: ByteSet = ByteSet::new(&[b'0'..=b'9', b'A'..=b'Z', b'_'..=b'_', b'a'..=b'z']);
/// assert_eq!(over(b"a_1 b").position(|v| !WORD.contains(v)), Some(3));
/// let quotes = ByteSet::of(b"'\"");
/// assert_eq!(over(b"say 'hi'").count(|v| quotes.contains(v)), 2);
/// # } example()
/// ```
#[derive(Copy, Clone, Debug)]
pub struct ByteSet {
    tables: [[u8; 16]; 2],
    classes: Option<ByteClasses>,
    runs: Runs,
    /// The member for each value of the lower four bits, if there is one at most. In the other places is what can't be equal.
    members: Option<[u8; 16]>,
}

impl ByteSet {
    /// The bytes in these ranges. It is meant for a `const`, whose test takes comparisons if there are few ranges, one lookup if
    /// no two bytes have the same lower four bits, two if [`ByteClasses::new`] would do, as for all sets of ASCII, and three otherwise.
    pub const fn new(/* a list of bytes: of */ ranges: &[RangeInclusive<u8>]) -> Self {
        let rows = rows(ranges);
        let (mut tables, mut byte) = ([[0; 16]; 2], 0);
        while byte < 256 {
            tables[byte >> 7][byte & 15] |= ((rows[byte >> 4] >> (byte & 15) & 1) as u8) << (byte >> 4 & 7);
            byte += 1;
        }
        let (mut members, mut are_apart, mut low) = ([0; 16], true, 0);
        while low < 16 {
            let column = u16::from_le_bytes([tables[0][low], tables[1][low]]);
            members[low] = if column == 0 { low as u8 ^ 1 } else { (column.trailing_zeros() as u8) << 4 | low as u8 };
            are_apart &= column.count_ones() <= 1;
            low += 1;
        }
        let members = if are_apart { Some(members) } else { None };
        Self { tables, classes: ByteClasses::EMPTY.with_rows(!0, rows), runs: Runs::of_rows(rows), members }
    }
    /// The bytes of `set`. This is quick at run time, but belongs outside of loops. The test takes three lookups.
    #[doc(alias("any_of"))]
    #[inline(always)]
    pub const fn of(set: &[u8]) -> Self {
        let (mut tables, mut i) = ([[0; 16]; 2], 0);
        while i < set.len() {
            let byte = set[i];
            tables[byte as usize >> 7][byte as usize & 15] |= 1 << (byte >> 4 & 7);
            i += 1;
        }
        let (mut runs, mut i) = (Runs { ranges: [[0; 2]; 8], len: set.len(), cost: usize::MAX }, 0);
        while i < 8 && runs.fit() {
            runs.ranges[i] = [set[if i < set.len() { i } else { 0 }]; 2];
            i += 1;
        }
        Self { tables, classes: None, runs, members: None }
    }
    /// Whether each byte is in the set.
    #[inline(always)]
    pub fn contains<S: Isa, W: Width>(&self, v: Simd<u8, W, S>) -> MaskOf<u8, W, S> {
        apart_unoptimized!(v.s, {
            if const { crate::OPTIMIZED && (S::SSSE3 || S::A64 || S::WASM) && W::BYTES >= 16 }
                && known(self.members.is_some() && self.runs.cost > 4)
            {
                // From 128 on, the lookup gives zero.
                let ascii = crate::X86 && known(u128::from_ne_bytes(self.tables[1]) == 0);
                return v.simd_eq(
                    v.tag().dup128(self.members.unwrap()).table_lookup_bytes(v & if ascii { 0x8f } else { 15 }),
                );
            }
            if choose! { S::BY_HAND || crate::Tag::<S, u8, W>::PACKED => self.runs.fit(), _ => crate::OPTIMIZED && known(self.runs.fit() && self.runs.cost <= if const { crate::X86 && S::REGISTER < 64 } { 6 } else { 5 }) }
            {
                return self.runs.contains(v);
            }
            if crate::OPTIMIZED && known(self.classes.is_some()) {
                return self.classes.unwrap().contains(v);
            }
            let d = v.tag();
            return_if!(S::SCALAR, {
                let all = v.to_array();
                d.from_fn(
                    #[inline(always)]
                    |i| {
                        let byte = all.as_ref()[i];
                        self.tables[byte as usize >> 7][byte as usize & 15] >> (byte >> 4 & 7) & 1
                    },
                )
                .simd_ne(0)
            });
            return_if!(
                W::BYTES < 16,
                d.resize_bitcast(self.contains(v.s.fixed::<u8, B16>().resize_bitcast(v)).to_vector()).moved_mask()
            );
            v.in_columns(d.dup128(self.tables[0]), d.dup128(self.tables[1]))
        })
    }
}
