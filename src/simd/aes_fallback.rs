//! AES without its instructions, in a time that doesn't depend on the data. All tables are computed from the definition of the field.
//!
//! GF(256) is a plane over GF(16): a byte is `i * alpha + k`. With `conjugate = alpha^16`, the norm
//! `n = (i * alpha + k) * (i * conjugate + k)` is in GF(16), and the inverse is `(i * conjugate + k) / n`.

use crate::ops::Ops;
use crate::simd::prelude::*;
use {crate::endian::ToBytes, crate::simd::Swizzle};

const fn mul(mut a: u8, mut b: u8) -> u8 {
    let mut product = 0;
    while b != 0 {
        product ^= a * (b & 1);
        a = (a << 1) ^ ((a >> 7) * 0x1b);
        b >>= 1;
    }
    product
}
const fn conjugate(x: u8) -> u8 {
    let (mut x, mut i) = (x, 0);
    while i < 4 {
        x = mul(x, x);
        i += 1;
    }
    x
}
const fn norm(x: u8) -> u8 {
    mul(x, conjugate(x))
}
/// Zero is its own.
const fn inverse(x: u8) -> u8 {
    let (n, n2) = (norm(x), mul(norm(x), norm(x)));
    let n4 = mul(n2, n2);
    mul(conjugate(x), mul(mul(n2, n4), mul(n4, n4)) * (n != 0) as u8)
}
/// The linear map of the S-box, or the identity.
const fn mapped(x: u8, map: bool) -> u8 {
    if map { x ^ x.rotate_left(1) ^ x.rotate_left(2) ^ x.rotate_left(3) ^ x.rotate_left(4) } else { x }
}
const CONSTANT: u8 = 0x63;

macro_rules! table {
    ($n:literal, |$i:ident| $e:expr) => {{
        let (mut table, mut at) = ([0u8; $n], 0);
        while at < $n {
            let $i = at as u8;
            table[at] = $e;
            at += 1;
        }
        table
    }};
}

/// Four bits are a polynomial in `beta`, for which `beta^4 = beta + 1`.
#[derive(Copy, Clone)]
struct Plane {
    alpha: u8,
    elements: [u8; 16],
    /// `i` in the upper and `k` in the lower four bits, of what the S-box has to invert.
    coordinates: [u8; 256],
    decrypts: bool,
}
impl Plane {
    const fn new(alpha: u8, beta: u8, decrypts: bool) -> Plane {
        let square = mul(beta, beta);
        assert!(mul(square, square) == beta ^ 1 && conjugate(alpha) != alpha);
        let elements =
            table!(16, |n| n & 1 ^ ((n >> 1 & 1) * beta) ^ ((n >> 2 & 1) * square) ^ ((n >> 3) * mul(square, beta)));
        let (mut coordinates, mut both) = ([0; 256], 0);
        while both < 256 {
            coordinates[mapped(mul(elements[both >> 4], alpha) ^ elements[both & 15], decrypts) as usize] = both as u8;
            both += 1;
        }
        Plane { alpha, elements, coordinates, decrypts }
    }
    const fn bits_of(&self, element: u8) -> u8 {
        self.coordinates[mapped(element, self.decrypts) as usize]
    }
}

/// For lookups of four bits in registers, by the method of Mike Hamburg's "Accelerating AES with Vector Permute Instructions".
/// If `a` is both the norm of `alpha` and `alpha + conjugate`, and `j = i + k`, then `n = k * k + a * i * j`, and
/// `j + 1 / (1 / i + a / k) = n / (k + a * i)`. The same holds with `i` and `j` swapped. The inverse is linear in the reciprocals
/// of these two. An index of 128 or more stands for infinity, and finds zero.
#[derive(Copy, Clone)]
struct Lookups {
    lower: [u8; 16],
    upper: [u8; 16],
    /// Of the elements of the plane.
    inverses: [u8; 16],
    plane: Plane,
}
impl Lookups {
    const fn new(decrypts: bool) -> Lookups {
        let mut alpha = 2;
        while norm(alpha) != alpha ^ conjugate(alpha) {
            alpha += 1;
        }
        let plane = Plane::new(alpha, 0x5c, decrypts);
        let constant = if decrypts { CONSTANT } else { 0 };
        Lookups {
            lower: table!(16, |n| plane.coordinates[(n ^ constant) as usize]),
            upper: table!(16, |n| plane.coordinates[(n << 4) as usize]),
            inverses: table!(16, |n| inverse(plane.elements[n as usize])),
            plane,
        }
    }
    const fn over(&self, numerator: u8) -> u8x16 {
        u8x16::from_array(table!(16, |n| if n == 0 {
            0x80
        } else {
            self.plane.bits_of(mul(numerator, self.inverses[n as usize]))
        }))
    }
    /// What leads from the two quotients to `factor` times the result of the S-box, without its constant.
    const fn times(&self, factor: u8) -> [u8x16; 2] {
        let (by, other, plane) = (inverse(norm(self.plane.alpha)), conjugate(self.plane.alpha), &self.plane);
        let second = mul(by, mul(by, other) ^ 1);
        let first = second ^ mul(by, other);
        [
            u8x16::from_array(table!(16, |n| mul(
                factor,
                mapped(mul(first, self.inverses[n as usize]), !plane.decrypts)
            ))),
            u8x16::from_array(table!(16, |n| mul(
                factor,
                mapped(mul(second, self.inverses[n as usize]), !plane.decrypts)
            ))),
        ]
    }
}
const ENCRYPT: Lookups = once!(Lookups = Lookups::new(false));
const DECRYPT: Lookups = once!(Lookups = Lookups::new(true));

#[op]
fn quotients<O: Ops>(ops: O, v: u8x16, lower: [u8; 16], upper: [u8; 16]) -> [u8x16; 2] {
    const ONE: u8x16 = ENCRYPT.over(1);
    const A: u8x16 = ENCRYPT.over(norm(ENCRYPT.plane.alpha));
    let both =
        ops.table_16(u8x16::from_array(lower), v & Simd::splat(15)) ^ ops.table_16(u8x16::from_array(upper), v >> 4);
    let (i, k) = (both >> 4, both & Simd::splat(15));
    let (j, a_over_k) = (i ^ k, ops.table_16(A, k));
    [j ^ ops.table_16(ONE, ops.table_16(ONE, i) ^ a_over_k), i ^ ops.table_16(ONE, ops.table_16(ONE, j) ^ a_over_k)]
}
macro_rules! times {
    ($ops:ident, $quotients:ident, $lookups:ident, $factor:literal) => {{
        const TABLES: [u8x16; 2] = once!([u8x16; 2] = $lookups.times($factor));
        $ops.table_16(TABLES[0], $quotients[0]) ^ $ops.table_16(TABLES[1], $quotients[1])
    }};
}

/// One bit of each byte in its lowest bit. The other bits don't matter.
type Bit = u64x2;

/// What each bit of the argument adds to the result of a linear map.
macro_rules! linear { ($columns:expr, $from:expr => $($to:literal)*) => {{
    const COLUMNS: &[u8] = &$columns;
    let from = $from;
    [$(sum::<{ row(COLUMNS, $to) }, _>(from)),*]
}}; }
const fn row(columns: &[u8], to: u32) -> u16 {
    let (mut row, mut i) = (0, 0);
    while i < columns.len() {
        row |= ((columns[i] >> to & 1) as u16) << i;
        i += 1;
    }
    row
}
#[op]
fn sum<const THESE: u16, const N: usize>(from: [Bit; N]) -> Bit {
    macro_rules! of { ($($i:literal)*) => { Bit::zero() $(^ if const { THESE >> $i & 1 != 0 } { from[$i] } else { Bit::zero() })* }; }
    of!(0 1 2 3 4 5 6 7 8 9 10 11 12 13 14)
}

#[op]
fn product([a0, a1, a2, a3]: [Bit; 4], b: [Bit; 4]) -> [Bit; 4] {
    // The rows are b, b * beta, and so on.
    let (b1, b2, b3) = (b[0] ^ b[3], b[3] ^ b[2], b[2] ^ b[1]);
    [
        a0 & b[0] ^ a1 & b[3] ^ a2 & b[2] ^ a3 & b[1],
        a0 & b[1] ^ a1 & b1 ^ a2 & b2 ^ a3 & b3,
        a0 & b[2] ^ a1 & b[1] ^ a2 & b1 ^ a3 & b2,
        a0 & b[3] ^ a1 & b[2] ^ a2 & b[1] ^ a3 & b1,
    ]
}
/// As a sum of the products of all subsets of the bits.
#[op]
fn reciprocal([a, b, c, d]: [Bit; 4]) -> [Bit; 4] {
    const TERMS: [u8; 15] = {
        let (mut terms, mut step) = (table!(16, |n| ENCRYPT.plane.bits_of(ENCRYPT.inverses[n as usize])), 1);
        while step < 16 {
            terms = table!(16, |n| terms[n as usize] ^ if n & step != 0 { terms[(n ^ step) as usize] } else { 0 });
            step *= 2;
        }
        table!(15, |n| terms[n as usize + 1])
    };
    let (ab, cd) = (a & b, c & d);
    linear!(TERMS, [a, b, ab, c, a & c, b & c, ab & c, d, a & d, b & d, ab & d, cd, a & cd, b & cd, ab & cd] => 0 1 2 3)
}
/// With logic only. Of all planes where `alpha + conjugate = 1`, these have the fewest terms in their linear maps.
macro_rules! circuits { ($($name:ident $alpha:literal $beta:literal $decrypts:literal;)*) => {$(
    #[cfg_attr(any(bun_simd_unoptimized, all(debug_assertions, not(bun_simd_check))), inline)]
    #[cfg_attr(not(any(bun_simd_unoptimized, all(debug_assertions, not(bun_simd_check)))), inline(always))]
    fn $name(v: Bit) -> Bit {
        const PLANE: Plane = once!(Plane = Plane::new($alpha, $beta, $decrypts));
        const { assert!($alpha ^ conjugate($alpha) == 1) };
        const fn basis(n: u8, of_upper: u8) -> u8 { mul(PLANE.elements[1 << n % 4], if n < 4 { 1 } else { of_upper }) }
        let bits = [v, v >> 1, v >> 2, v >> 3, v >> 4, v >> 5, v >> 6, v >> 7];
        let both = linear!(table!(8, |n| PLANE.coordinates[1 << n]), bits => 0 1 2 3 4 5 6 7);
        let [k0, k1, k2, k3, i0, i1, i2, i3] = both;
        let (i, k) = ([i0, i1, i2, i3], [k0, k1, k2, k3]);
        let squares = linear!(table!(8, |n| PLANE.bits_of(mul(basis(n, 1), basis(n, norm($alpha))))), both => 0 1 2 3);
        let mixed = product(i, k);
        let by = reciprocal([mixed[0] ^ squares[0], mixed[1] ^ squares[1], mixed[2] ^ squares[2], mixed[3] ^ squares[3]]);
        let ([k0, k1, k2, k3], [i0, i1, i2, i3]) = (product(k, by), product(i, by));
        let out = linear!(table!(8, |n| mapped(basis(n, conjugate($alpha)), !$decrypts)), [k0, k1, k2, k3, i0, i1, i2, i3] => 0 1 2 3 4 5 6 7);
        let bit = always!(|n: usize| (out[n] & const { Bit::repeated(0x0101_0101_0101_0101) }) << n as u64);
        bit(0) | bit(1) | bit(2) | bit(3) | bit(4) | bit(5) | bit(6) | bit(7)
    }
)*}; }
circuits! {
    substitute 0xa2 0x5d false;
    substitute_back 0x1f 0xe1 true;
}

/// Byte `row` of column `column` comes from `row + DOWN` and `column + STEP * row`.
struct Order<const DOWN: usize, const STEP: usize>;
impl<const DOWN: usize, const STEP: usize> Swizzle<16> for Order<DOWN, STEP> {
    const INDEX: [usize; 16] = {
        let (mut index, mut i) = ([0; 16], 0);
        while i < 16 {
            index[i] = (i / 4 + STEP * (i % 4)) % 4 * 4 + (i + DOWN) % 4;
            i += 1;
        }
        index
    };
}
#[op]
fn down<const ROWS: usize>(v: u8x16) -> u8x16 {
    <Order<ROWS, 0> as Swizzle<16>>::swizzle(v)
}
#[op]
fn shift_rows<const STEP: usize>(v: u8x16) -> u8x16 {
    <Order<0, STEP> as Swizzle<16>>::swizzle(v)
}
#[op]
fn times_two<S: crate::simd::Cpu>(v: u8x16) -> u8x16
where
    crate::simd::Here: crate::simd::In<S>,
{
    (v + v) ^ (v.cast::<i8, _>() >> 7).cast::<u8, _>() & Simd::splat(0x1b)
}

/// The same in words, which suits CPUs without shuffles of bytes, or without vectors.
mod words {
    use super::*;
    const ONES: u64 = 0x0101_0101_0101_0101;

    #[op]
    fn columns(v: Bit, f: impl FnOnce(u32x4) -> u32x4) -> Bit {
        Bit::from_le_bytes(f(u32x4::from_le_bytes(v.to_le_bytes())).to_le_bytes())
    }
    #[op]
    fn down(v: Bit, rows: u32) -> Bit {
        columns(
            v,
            #[inline(always)]
            |v| v >> (8 * rows) | v << (32 - 8 * rows),
        )
    }
    /// Rows 2 and 3 move by two columns, and then rows 1 and 3 by one, or by three.
    #[op]
    pub fn shift_rows<const STEP: usize, S: crate::simd::Cpu>(v: u8x16) -> Bit
    where
        crate::simd::Here: crate::simd::In<S>,
    {
        let v = u32x4::from_le_bytes(v);
        let v = v ^ (v ^ v.rotate_elements_left::<2>()) & Simd::splat(0xffff_0000);
        Bit::from_le_bytes((v ^ (v ^ v.rotate_elements_left::<STEP>()) & Simd::splat(0xff00_ff00)).to_le_bytes())
    }
    #[op]
    fn times_two<S: crate::simd::Cpu>(v: Bit) -> Bit
    where
        crate::simd::Here: crate::simd::In<S>,
    {
        if cfg!(target_feature = "sse2") {
            return Bit::from_le_bytes(super::times_two(v.to_le_bytes()));
        }
        let top = v & Bit::splat(0x80 * ONES);
        (v ^ top) << 1 ^ (top + top - (top >> 7)) & Bit::splat(0x1b * ONES)
    }
    #[op]
    pub fn mix<S: crate::simd::Cpu>(v: Bit) -> Bit
    where
        crate::simd::Here: crate::simd::In<S>,
    {
        let pairs = v ^ down(v, 1);
        times_two(pairs) ^ v ^ pairs ^ down(pairs, 2)
    }
    #[op]
    pub fn mix_back<S: crate::simd::Cpu>(v: Bit) -> Bit
    where
        crate::simd::Here: crate::simd::In<S>,
    {
        mix(v ^ times_two(times_two(v ^ down(v, 2))))
    }
    pub const CONSTANT: Bit = Bit::repeated(super::CONSTANT as u64 * ONES);
    #[op]
    pub fn with_key(v: Bit, key: u8x16) -> u8x16 {
        (v ^ Bit::from_le_bytes(key)).to_le_bytes()
    }
}

#[op]
pub fn inv_mix_columns<O: Ops>(v: u8x16) -> u8x16 {
    if !O::LOOKS_UP_IN_REGISTERS {
        return words::mix_back(Bit::from_le_bytes(v)).to_le_bytes();
    }
    let v = v ^ times_two(times_two(v ^ down::<2>(v)));
    let pairs = v ^ down::<1>(v);
    times_two(pairs) ^ v ^ pairs ^ down::<2>(pairs)
}
#[op]
pub fn last_round<O: Ops>(ops: O, v: u8x16, key: u8x16) -> u8x16 {
    if !O::LOOKS_UP_IN_REGISTERS {
        return words::with_key(substitute(words::shift_rows::<1, _>(v)) ^ words::CONSTANT, key);
    }
    let q = quotients(ops, shift_rows::<1>(v), const { ENCRYPT.lower }, const { ENCRYPT.upper });
    times!(ops, q, ENCRYPT, 1) ^ (key ^ Simd::splat(CONSTANT))
}
/// The factors of a column add up to one, so that mixing doesn't change the constant.
#[op]
pub fn round<O: Ops>(ops: O, v: u8x16, key: u8x16) -> u8x16 {
    if !O::LOOKS_UP_IN_REGISTERS {
        return words::with_key(words::mix(substitute(words::shift_rows::<1, _>(v))) ^ words::CONSTANT, key);
    }
    let q = quotients(ops, shift_rows::<1>(v), const { ENCRYPT.lower }, const { ENCRYPT.upper });
    let once = times!(ops, q, ENCRYPT, 1);
    let pairs = times!(ops, q, ENCRYPT, 2) ^ down::<1>(once);
    pairs ^ down::<1>(pairs) ^ (down::<3>(once) ^ (key ^ Simd::splat(CONSTANT)))
}
#[op]
pub fn last_round_inv<O: Ops>(ops: O, v: u8x16, key: u8x16) -> u8x16 {
    if !O::LOOKS_UP_IN_REGISTERS {
        return words::with_key(substitute_back(words::shift_rows::<3, _>(v) ^ words::CONSTANT), key);
    }
    let q = quotients(ops, shift_rows::<3>(v), const { DECRYPT.lower }, const { DECRYPT.upper });
    times!(ops, q, DECRYPT, 1) ^ key
}
#[op]
pub fn round_inv<O: Ops>(ops: O, v: u8x16, key: u8x16) -> u8x16 {
    if !O::LOOKS_UP_IN_REGISTERS {
        return words::with_key(words::mix_back(substitute_back(words::shift_rows::<3, _>(v) ^ words::CONSTANT)), key);
    }
    let q = quotients(ops, shift_rows::<3>(v), const { DECRYPT.lower }, const { DECRYPT.upper });
    times!(ops, q, DECRYPT, 14)
        ^ down::<1>(times!(ops, q, DECRYPT, 11))
        ^ down::<2>(times!(ops, q, DECRYPT, 13))
        ^ down::<3>(times!(ops, q, DECRYPT, 9))
        ^ key
}
