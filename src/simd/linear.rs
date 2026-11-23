use crate::{Isa, Simd, Width};

/// A function from bytes to bytes with `f(a ^ b) == f(a) ^ f(b)`, such as a multiplication in any GF(2^8) or a permutation
/// of bits. Each block can have its own. It is one instruction with GFNI, and two lookups elsewhere.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let [low, high] = galois_nibbles(3, 0x1d);
/// let times_three = LinearMap::new(u8xN::repeat(&low), u8xN::repeat(&high));
/// assert_eq!(times_three.of(u8xN::splat(0x80)), 0x9d);
/// # } example()
/// ```
#[derive(Copy, Clone)]
pub struct LinearMap<W: Width, S: Isa>(Simd<u8, W, S>, Simd<u8, W, S>);

impl<S: Isa, W: Width> LinearMap<W, S> {
    /// In each block, byte `i` of `low` is `f(i)`, and that of `high` is `f(16 * i)`. If the tables are not those of such
    /// a function, the results are unspecified. Make it outside of loops.
    #[op]
    #[track_caller]
    pub fn new(low: Simd<u8, W, S>, high: Simd<u8, W, S>) -> Self {
        require!("this takes vectors of 16 bytes or more", W::BYTES >= 16);
        if const { !S::GFNI } {
            return Self(low, high);
        }
        // The columns of the matrix, and then its rows.
        let d = low.tag().repartition::<u64>();
        let columns = low.table_lookup_bytes(d.set(0x0102_0408_8080_8080))
            | high.table_lookup_bytes(d.set(0x8080_8080_0102_0408));
        let rows = d.set(0x0102_0408_1020_4080).bitcast().galois_affine(columns);
        Self(rows, rows)
    }
    /// Byte `j` of `columns` is `f(1 << j)`.
    #[inline(always)]
    pub(crate) fn by_columns(v: Simd<u8, W, S>, columns: u64) -> Simd<u8, W, S> {
        apart_unoptimized!(v.s, {
            // Times two, as in RAID-6 and AES.
            if crate::arithmetic::known(columns << 8 == 0x8040_2010_0804_0200) {
                return (v + v) ^ v.cast_signed().is_negative().if_then_else_zero(v.like((columns >> 56) as u8));
            }
            // Without an address or a branch that depends on a value.
            return_if!(!S::LOOKS_UP_IN_REGISTERS, {
                let (mut all, mut v) = (v.tag().zero(), v.cast_signed());
                macro_rules! bits { ($($j:literal)*) => {$(
                all ^= v.is_negative().if_then_else_zero(all.like((columns >> (8 * $j)) as u8));
                v += v;
            )*}; }
                bits!(7 6 5 4 3 2 1 0);
                let _ = v;
                all
            });
            return_if!(
                W::BYTES < 16,
                v.tag().resize_bitcast(LinearMap::by_columns(v.s.fixed::<u8, crate::B16>().resize_bitcast(v), columns))
            );
            let d = v.tag();
            // Byte `i` is full where `i` has the bit.
            const HAS: [u128; 4] =
                [!0 / 0xffff * 0xff00, !0 / 0xffff_ffff * 0xffff_0000, !0 << 96 | 0xffff_ffff << 32, !0 << 64];
            let part = always!(|j: usize| d.set((columns >> (8 * j)) as u8) & d.dup128(HAS[j % 4].to_le_bytes()));
            Self(part(0) ^ part(1) ^ part(2) ^ part(3), part(4) ^ part(5) ^ part(6) ^ part(7)).looked_up(v)
        })
    }
    /// `f` of each byte. `v` is as wide as the map, but a `LinearMap<B16, S>` takes any number of blocks. That is the form for a table of maps in memory.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let maps = [2, 3].map(|factor| galois_nibbles(factor, 0x1d).map(u8x16::from)).map(|[low, high]| LinearMap::new(low, high));
    /// assert_eq!(maps[0].of(u8x64::splat(0x80)) ^ maps[1].of(u8x64::splat(1)), 0x1d ^ 3);
    /// # } example()
    /// ```
    #[op]
    #[track_caller]
    pub fn of<X: Width>(self, v: Simd<u8, X, S>) -> Simd<u8, X, S> {
        require!(
            "the vector is as wide as the map, unless that has 16 bytes",
            X::BYTES == W::BYTES || W::BYTES == 16 && X::BYTES > 16
        );
        self.at_width(v)
    }
    #[op]
    fn at_width<X: Width>(self, v: Simd<u8, X, S>) -> Simd<u8, X, S> {
        return_if!(S::GFNI && X::BYTES == W::BYTES, v.galois_affine(self.0.same::<u8, X>().bitcast()));
        return_if!(S::GFNI, v.galois_affine(self.0.bitcast::<u64>().get_lane()));
        let all = always!(
            |it: Simd<u8, W, S>| choose! { X::BYTES == W::BYTES => it.same(), _ => v.tag().load_dup128(it.as_ref()) }
        );
        LinearMap(all(self.0), all(self.1)).looked_up(v)
    }
    #[op]
    fn looked_up(self, v: Simd<u8, W, S>) -> Simd<u8, W, S> {
        return_if!(S::BY_HAND || crate::simd::PACKED != 0, {
            let (mut all, mut v) = (v.tag().zero(), v.cast_signed());
            macro_rules! bits { ($($table:tt $at:literal,)*) => {$(
                all ^= v.is_negative().if_then_else_zero(self.$table.broadcast::<$at>());
                v += v;
            )*}; }
            bits!(1 8, 1 4, 1 2, 1 1, 0 8, 0 4, 0 2, 0 1,);
            let _ = v;
            all
        });
        self.0.table_lookup_bytes(v & 15) ^ self.1.table_lookup_bytes(v >> 4)
    }
}

/// Bit `j` of byte `i` goes to bit `i` of byte `j`.
#[inline(always)]
pub(crate) const fn transposed(mut x: u64) -> u64 {
    let t = (x ^ x >> 7) & 0x00aa_00aa_00aa_00aa;
    x ^= t ^ t << 7;
    let t = (x ^ x >> 14) & 0x0000_cccc_0000_cccc;
    x ^= t ^ t << 14;
    let t = (x ^ x >> 28) & 0x0000_0000_f0f0_f0f0;
    x ^ t ^ t << 28
}
#[inline(always)]
pub(crate) const fn powers(factor: u8, polynomial: u8) -> u64 {
    let (mut all, mut power) = (0, factor);
    macro_rules! bits { ($($bit:literal)*) => {$(
        all |= (power as u64) << (8 * $bit);
        power = (power << 1) ^ ((power as i8 >> 7) as u8 & polynomial);
    )*}; }
    bits!(0 1 2 3 4 5 6);
    all | (power as u64) << 56
}

/// The matrix of [`galois_affine`](Simd::galois_affine) for the multiplication by `factor` in GF(2^8), modulo `x^8 + polynomial`:
/// `0x1d` for RAID-6 and most Reed-Solomon codes.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// assert_eq!(u8xN::splat(0x80).galois_affine(galois_matrix(3, 0x1d)), 0x9d);
/// # } example()
/// ```
#[doc(alias("gf_mul", "reed_solomon", "raid6", "erasure"))]
#[inline(always)]
pub const fn galois_matrix(factor: u8, polynomial: u8) -> u64 {
    transposed(powers(factor, polynomial)).swap_bytes()
}

/// The tables of [`LinearMap::new`] for the multiplication by `factor` in GF(2^8), modulo `x^8 + polynomial`.
pub const fn galois_nibbles(factor: u8, polynomial: u8) -> [[u8; 16]; 2] {
    let (mut tables, mut power, mut bit) = ([[0; 16]; 2], factor, 0);
    while bit < 8 {
        let mut i = 0;
        while i < 16 {
            tables[bit / 4][i] ^= power * (i >> (bit % 4) & 1) as u8;
            i += 1;
        }
        power = (power << 1) ^ ((power >> 7) * polynomial);
        bit += 1;
    }
    tables
}

/// A byte is `2 * h + l` for `h` and `l` of the subfield with 16 members, where logarithms fit a lookup. It takes Karatsuba's three products.
#[on(X86)]
#[op]
pub(crate) fn product<S: Isa, W: Width>(a: Simd<u8, W, S>, b: Simd<u8, W, S>) -> Simd<u8, W, S> {
    /// The map to the nibbles `h` and `l`, their logarithms, and the powers times 2, 3 and 6.
    const TOWER: [[u8; 16]; 6] = {
        let (mut tables, mut members, mut power, mut nibble, mut i) = ([[0; 16]; 6], [[0; 8]; 16], 1, 1, 0);
        // A sum with this one finds zero.
        tables[2][0] = 0xc0;
        while i < 15 {
            let by = powers(power, 0x1b).to_le_bytes();
            (members[nibble], tables[2][nibble]) = (by, i as u8);
            [tables[3][i], tables[4][i], tables[5][i]] = [by[1], by[0] ^ by[1], by[1] ^ by[2]];
            // Times 0xe1, a root of x^4 + x + 1.
            (power, nibble, i) = (by[0] ^ by[5] ^ by[6] ^ by[7], (nibble << 1) ^ ((nibble >> 3) * 0x13), i + 1);
        }
        i = 0;
        while i < 256 {
            let byte = (members[i >> 4][1] ^ members[i & 15][0]) as usize;
            if byte < 16 || byte & 15 == 0 {
                tables[(byte >= 16) as usize][byte & 15 | byte >> 4] = i as u8;
            }
            i += 1;
        }
        tables
    };
    let of = always!(|k: usize, v: Simd<u8, W, S>| v.tag().dup128(TOWER[k]).table_lookup_bytes(v));
    let logs = always!(|v: Simd<u8, W, S>| {
        let both = of(0, v & 15) ^ of(1, v >> 4);
        let (h, l) = (both >> 4, both & 15);
        [of(2, h ^ l), of(2, l), of(2, h)]
    });
    let (a, b) = (logs(a), logs(b));
    let part = always!(|k: usize| {
        let sum = a[k].saturating_add(b[k]);
        of(3 + k, sum.simd_min(sum - 15))
    });
    part(0) ^ part(1) ^ part(2)
}
