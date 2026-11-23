//! Scans, and bits that move apart or together.

use crate::WithToken;
use crate::arithmetic::known;
use crate::asked::BitPerm;
use crate::pattern as p;
use crate::{Isa, Lane, Simd, Unsigned, Width};

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// Lane `i` joins the lanes `0..=i`: a running maximum, minimum, `^` and so on. `join(earlier, later)` has to treat all lanes alike and to be
    /// associative, and `join(neutral, x)` has to be `x`. It is called about log2(`LANES`) times, in an order that depends on the target: floats are added by `prefix_sum`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let v = u8x8::from([3, 1, 4, 1, 5, 9, 2, 6]);
    /// assert_eq!(v.scan(0, |a, b| a.simd_max(b)), [3, 3, 4, 4, 5, 9, 9, 9]);
    /// // In a loop, the last lane carries over.
    /// let carry = u8x8::splat(7).splat_last();
    /// assert_eq!(v.scan(0, |a, b| a ^ b) ^ carry, [4, 5, 1, 0, 5, 12, 14, 8]);
    /// # } example()
    /// ```
    #[doc(alias("prefix_max", "prefix_min", "prefix_xor", "running_max", "running_min", "cummax", "inclusive_scan"))]
    #[op]
    pub fn scan(self, neutral: T, join: impl Fn(Self, Self) -> Self) -> Self {
        crate::closures::inlined_here!(self.s, join(a, b));
        let (mut v, none) = (self, self.tag().set(neutral));
        macro_rules! step { ($($k:literal)*) => {$(
            when!(Self::LANES > $k, v = join(v.shift_elements_right::<$k>(none), v));
        )*}; }
        return_if!(S::REGISTER == 64 && size_of::<T>() >= 4 || W::BYTES <= 16 || W::BYTES > 64 || !crate::X86, {
            step!(1 2 4 8 16 32 64 128 256);
            v
        });
        // Within the blocks, where shifts are cheap, and then whole blocks.
        macro_rules! step { ($($k:literal)*) => {$(
            when!(16 / size_of::<T>() > $k, v = join(v.shuffle::<{ p::SHIFT_LEFT }, $k>(none), v));
        )*}; }
        step!(1 2 4 8);
        let mut before = v.shuffle::<{ p::LAST_OF_BLOCK_BEFORE }, 1>(none);
        when!(W::BYTES == 64, {
            before = join(before.shuffle::<{ p::LAST_OF_BLOCK_BEFORE }, 1>(none), before);
            before = join(v.shuffle::<{ p::LAST_OF_BLOCK_BEFORE }, 3>(none), before);
        });
        join(before, v)
    }
}

/// On the way together: where the bits are before step `i`, and those of them that move down by `1 << i`.
#[op]
#[allow(unused_assignments)]
fn steps(mask: u64, bits: u32, prefix_xor: impl Fn(u64) -> u64) -> [(u64, u64); 7] {
    let (mut all, mut at, mut gaps) = ([(mask, 0); 7], mask, !mask << 1);
    macro_rules! step { ($($i:literal)*) => {$(
        if 1 << $i < bits {
            let odd = prefix_xor(gaps);
            all[$i] = (at, odd & at);
            at = at & !odd | (odd & at) >> (1 << $i);
            gaps &= !odd;
        } else {
            all[$i] = (at, 0);
        }
    )*}; }
    step!(0 1 2 3 4 5);
    all[6] = (at, 0);
    all
}
/// Where each byte of 64 bits begins before the deposit, and whether that tells all: something moves, and the ones in each byte of `mask` are adjacent.
#[op]
fn runs_of_bytes(mask: u64, bits: u32) -> (u64, bool) {
    let (mut counts, mut runs) = (0, mask & mask.wrapping_add(1) != 0);
    macro_rules! step { ($($i:literal)*) => {$(
        let at = 8 * $i % bits;
        let (byte, before) = ((mask >> at) as u8, (mask & !(!0 << at)).count_ones());
        let run = byte >> (byte.trailing_zeros() % 8);
        runs &= run & run.wrapping_add(1) == 0;
        counts |= (((8 * $i - at + before).wrapping_sub(byte.trailing_zeros()) % 64) as u64) << (8 * $i);
    )*}; }
    step!(0 1 2 3 4 5 6 7);
    (counts, runs)
}
/// All bits of the bytes that are not zero.
#[op]
fn bytes_of(x: u64) -> u64 {
    const LOW: u64 = !0 / 255 * 127;
    ((((x & LOW) + LOW) | x) >> 7 & (!0 / 255)) * 255
}
/// The matrix that deposits the lowest bits of a byte, and whether one does for all bytes of the mask.
#[op]
fn ranks(mask: u64, bits: u32) -> (u64, bool) {
    let (mut matrix, mut same) = (0, true);
    macro_rules! row { ($bit:literal: $($i:literal)*) => { 0 $(| {
        let byte = (mask >> (8 * $i % bits)) as u8;
        (byte >> $bit & 1) << (byte & !(!0 << $bit)).count_ones()
    })* }; }
    macro_rules! rows { ($($bit:literal)*) => {$(
        let row: u8 = row!($bit: 0 1 2 3 4 5 6 7);
        same &= row & row.wrapping_sub(1) == 0;
        matrix |= (row as u64) << (56 - 8 * $bit);
    )*}; }
    rows!(0 1 2 3 4 5 6 7);
    (matrix, same)
}
#[op]
fn by_shifts(x: u64, bits: u32) -> u64 {
    let mut x = x;
    macro_rules! step { ($($n:literal)*) => {$( if $n < bits { x ^= x << $n; } )*}; }
    step!(1 2 4 8 16 32);
    x
}
/// For speed: on Arm, LLVM moves only the shifts out of all loops over vectors. Apple multiplies fast enough.
#[op]
fn steps_on<S: Isa, T: Unsigned, const LANES: bool>(s: S, mask: u64) -> [(u64, u64); 7] {
    if const { S::HAS_AES && !(S::A64 && LANES && !cfg!(target_vendor = "apple")) } && !is_known!(mask) {
        return steps(
            mask,
            T::BITS,
            #[inline(always)]
            |x| s.prefix_xor(x),
        );
    }
    steps(
        mask,
        T::BITS,
        #[inline(always)]
        |x| by_shifts(x, T::BITS),
    )
}
/// Zen 1 and 2 have it in microcode. No token has BMI1 alone.
#[op]
fn has_pdep<S: Isa>() -> bool {
    (const { cfg!(target_arch = "x86_64") && S::BMI1 })
        && (const { S::AVX512F || S::GFNI || S::AVXVNNI || S::VAES || S::FAST_PDEP } || crate::gate::is_tuned::<0>())
}
/// Whether to ask for `bext` and `bdep`. A constant has to take `many` steps.
#[op]
fn asks<S: Isa>(mask: u64, all: [(u64, u64); 7], many: u32) -> bool {
    let moves = always!(|i: usize| (all[i].1 != 0) as u32);
    !is_known!(mask) || S::FAST_PDEP && moves(0) + moves(1) + moves(2) + moves(3) + moves(4) + moves(5) >= many
}
/// LLVM vectorizes no loop with the test in it, which costs bytes most.
#[op]
fn asked<S: Isa, T: Unsigned>(x: u64, mask: u64, all: [(u64, u64); 7], deposit: bool) -> Option<u64> {
    #[cold]
    #[inline(never)]
    fn first(x: u64, mut mask: u64, deposit: bool) -> u64 {
        crate::gate::cpu();
        let (mut all, mut next) = (0, 0);
        for at in 0..64 {
            let (from, to) = if deposit { (next, at) } else { (at, next) };
            all |= (x >> from & mask & 1) << to;
            (next, mask) = (next + (mask & 1), mask >> 1);
        }
        all
    }
    if_here!(
        S::A64 && (!S::PORTABLE && T::BITS > 8 || S::SVE2 || S::FAST_PDEP),
        if asks::<S>(mask, all, 4) {
            match BitPerm::here() {
                Ok(it) => return Some(it.number(x, mask, deposit)),
                Err(false) => return Some(first(x, mask, deposit)),
                Err(true) => {}
            }
        }
    );
    None
}

#[op]
pub(crate) fn deposit<S: Isa, T: Unsigned>(s: S, bits: T, mask: T) -> T {
    let (mut x, mask) = (bits.to_u64(), mask.to_u64());
    if has_pdep::<S>() {
        return T::from_u64(s.deposit(x, mask));
    }
    let all = steps_on::<S, T, false>(s, mask);
    if let Some(it) = asked::<S, T>(x, mask, all, true) {
        return T::from_u64(it);
    }
    macro_rules! step { ($($i:literal)*) => {$( x = x & !all[$i].1 | x << (1 << $i) & all[$i].1; )*}; }
    step!(5 4 3 2 1 0);
    T::from_u64(x & mask)
}
#[op]
pub(crate) fn extract<S: Isa, T: Unsigned>(s: S, bits: T, mask: T) -> T {
    let (x, mask) = (bits.to_u64(), mask.to_u64());
    if has_pdep::<S>() {
        return T::from_u64(s.extract(x, mask));
    }
    let all = steps_on::<S, T, false>(s, mask);
    if let Some(it) = asked::<S, T>(x, mask, all, false) {
        return T::from_u64(it);
    }
    let mut x = x & mask;
    macro_rules! step { ($($i:literal)*) => {$( x = x & !all[$i].1 | (x & all[$i].1) >> (1 << $i); )*}; }
    step!(0 1 2 3 4 5);
    T::from_u64(x)
}

impl<S: Isa, T: Unsigned, W: Width> Simd<T, W, S> {
    /// In each lane, the lowest bits go to where `mask` has ones, in order, and the others are zero. With a constant, this is up to three
    /// instructions for each power of two that a bit moves by, or two to three in all on `icelake` if the ones in each byte are adjacent, or evenly apart. Otherwise the mask is prepared first, which belongs outside of loops.
    /// On `sve2`, a CPU with `fast_pdep` takes a test and one instruction instead. With that word in the list, so do all levels of Arm, and constants that take many steps.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (x, y) = (u32x2::from([0b11, 0b101]), u32x2::from([0b01, 0b110]));
    /// let morton = x.deposit_bits(0x5555_5555) | y.deposit_bits(0xaaaa_aaaa);
    /// assert_eq!(morton, [0b0111, 0b11_1001]);
    /// assert_eq!(morton.extract_bits(0xaaaa_aaaa), y);
    /// # } example()
    /// ```
    #[doc(alias("pdep", "bdep", "spread", "morton", "interleave_bits", "scatter_bits", "unpack_bits"))]
    #[inline(always)]
    pub fn deposit_bits(self, mask: T) -> Self {
        apart_unoptimized!(self.s, {
            if const { Self::BY_BYTES } && known(runs_of_bytes(mask.to_u64(), T::BITS).1) {
                return live!(Self::BY_BYTES, {
                    let v = self.reinterpret::<u64>();
                    v.rotate_bytes_from(v.tag().set(runs_of_bytes(mask.to_u64(), T::BITS).0).reinterpret::<u8>())
                        .reinterpret::<T>()
                        & mask
                });
            }
            if_here!(S::A64 && T::BITS > 8 && W::BYTES >= 16 && W::BYTES <= 64, {
                let even = T::MAX.to_u64() / 3;
                if known(mask.to_u64() == even) | known(mask.to_u64() == !even & T::MAX.to_u64()) {
                    let lower = self.bitcast::<T::Narrow>();
                    let lower = lower.shuffle::<{ p::STRIDE_IN_BLOCK }, 0>(lower);
                    return self.with_bytes::<T>(self.s.spread_bits::<W>(lower.bytes()))
                        << mask.to_u64().trailing_zeros();
                }
            });
            if_here!(crate::OPTIMIZED && Self::BY_MATRIX && (Self::BY_BYTES || T::BITS == 8), {
                let (bits, (matrix, same)) = (mask.to_u64(), ranks(mask.to_u64(), T::BITS));
                if known(same && matrix != 0 && bits & bits.wrapping_add(1) != 0) {
                    let mut v = self.reinterpret::<u64>();
                    when!(T::BITS > 8, {
                        let first = always!(|i: usize| {
                            let at = 8 * i as u32 % T::BITS;
                            (8 * i as u32 % 64 - at + (bits & !(!0 << at)).count_ones()) as u8
                        });
                        v = v.rotate_bytes_from(v.tag().repartition::<u8>().from_fn(first)).reinterpret();
                    });
                    let v = v.reinterpret::<u8>().galois_affine(matrix).reinterpret();
                    return if Self::repeats(bits) { v } else { v & mask };
                }
            });
            let all = steps_on::<S, T, true>(self.s, mask.to_u64());
            if let Some(it) = self.asked(mask, all, true) {
                return it;
            }
            let (mut x, mut clean) = (self, 0);
            macro_rules! step { ($($i:literal)*) => {$(
            when!(1 << $i < T::BITS, {
                let ((to, moved), from) = (all[$i], all[$i + 1].0);
                if !known(moved == 0) {
                    (x, clean) = x.moved(x.shifted::<true>(1 << $i), clean, from, from << (1 << $i), to, moved);
                }
            });
        )*}; }
            if let Some(moved) = x.whole_bytes::<true>(all) {
                x = moved;
            } else {
                step!(5 4 3);
            }
            step!(2 1 0);
            if clean == 1 { x } else { x & mask }
        })
    }
    /// In each lane, the bits where `mask` has ones go to the lowest places, in order, and the others are zero. This is the reverse of
    /// [`deposit_bits`](Self::deposit_bits), and costs about the same.
    #[doc(alias("pext", "bext", "compact_bits", "gather_bits", "pack_bits"))]
    #[inline(always)]
    pub fn extract_bits(self, mask: T) -> Self {
        apart_unoptimized!(self.s, {
            let all = steps_on::<S, T, true>(self.s, mask.to_u64());
            if let Some(it) = self.asked(mask, all, false) {
                return it;
            }
            // To the start of each byte, and then products join the bytes.
            if_here!(crate::OPTIMIZED && Self::BY_MATRIX, {
                let (bits, (matrix, same)) = (mask.to_u64(), ranks(mask.to_u64(), T::BITS));
                let moves = always!(|i: usize| (all[i].1 != 0) as u32);
                let many = moves(0) + moves(1) + moves(2) + moves(3) + moves(4) + moves(5) > T::BITS.ilog2() - 2;
                // No byte is full.
                if known(same && matrix & 0x80 == 0 && many) {
                    let count = always!(|at: usize, n: u32| (bits >> (at as u32 % T::BITS) & !(!0 << n)).count_ones());
                    let v = if Self::repeats(bits) { self } else { self & mask }.reinterpret::<u8>();
                    let mut v = v.galois_affine(crate::linear::transposed(matrix.swap_bytes()).swap_bytes());
                    when!(T::BITS > 8, {
                        let by = v
                            .tag()
                            .from_fn(always!(|i: usize| 1 << if i % 2 == 1 { count(8 * i - 8, 8) % 8 } else { 0 }));
                        v = v.with_bytes(v.s.mul_add_u8_i8::<W>(by.bytes(), v.bytes()));
                    });
                    when!(T::BITS > 16, {
                        let by = v
                            .tag()
                            .repartition::<u16>()
                            .from_fn(always!(|i: usize| 1 << if i % 2 == 1 { count(16 * i - 16, 16) % 16 } else { 0 }));
                        v = v.with_bytes(v.s.mul_add_i16::<W>(by.bytes(), v.bytes()));
                    });
                    let v = v.reinterpret::<T>();
                    return_if!(
                        T::BITS == 64,
                        v.like(T::from_u64(!0 << count(0, 32))).bit_select(v >> (32 - count(0, 32)), v)
                    );
                    return v;
                }
            });
            let (mut x, mut clean) = (self, 0);
            macro_rules! step { ($($i:literal)*) => {$(
            when!(1 << $i < T::BITS, {
                let ((from, moved), to) = (all[$i], all[$i + 1].0);
                if !known(moved == 0) {
                    (x, clean) = x.moved(x.shifted::<false>(1 << $i), clean, from, from >> (1 << $i), to, moved >> (1 << $i));
                }
            });
        )*}; }
            step!(0 1 2);
            if let Some(moved) = x.whole_bytes::<false>(all) {
                return if bytes_of(all[6].0) == all[6].0 { moved } else { moved & T::from_u64(all[6].0) };
            }
            step!(3 4 5);
            if clean == 1 { x } else { x & T::from_u64(all[6].0) }
        })
    }
    #[op]
    fn asked(self, mask: T, all: [(u64, u64); 7], deposit: bool) -> Option<Self> {
        return_if!(S::A64 && (S::SVE2 || S::FAST_PDEP), {
            let it = if asks::<S>(mask.to_u64(), all, 3) { BitPerm::here() } else { return None };
            // Otherwise the CPU was asked on the way here.
            if cfg!(target_feature = "sve2") && matches!(it, Err(false)) {
                crate::gate::cpu();
            }
            let it = it.ok()?;
            Some(self.with_bytes(self.s.move_bits::<W>(self.bytes(), self.like(mask).bytes(), (it, T::BITS, deposit))))
        });
        None
    }
    /// The steps by 8 bits and more in one lookup, if none of them splits a byte. Bytes without bits of the mask become zero.
    #[op]
    fn whole_bytes<const LEFT: bool>(self, all: [(u64, u64); 7]) -> Option<Self> {
        return_if!(S::A64 && crate::OPTIMIZED && T::BITS > 8 && W::BYTES >= 16, {
            let (mut from, mut whole) = (0x0706_0504_0302_0100u64, all[3].1 | all[4].1 | all[5].1 != 0);
            macro_rules! step { ($($i:literal)*) => {$(
                let (to, moved) = if LEFT { all[$i] } else { (all[$i + 1].0, all[$i].1 >> (1 << $i)) };
                whole &= to & bytes_of(moved) == moved;
                from = from & !bytes_of(moved) | (if LEFT { from << (1 << $i) } else { from >> (1 << $i) }) & bytes_of(moved);
            )*}; }
            if LEFT {
                step!(5 4 3);
            } else {
                step!(3 4 5);
            }
            if !known(whole) {
                return None;
            }
            let from = self.tag().set(T::from_u64(from | !bytes_of(all[if LEFT { 3 } else { 6 }].0))).bitcast::<u8>();
            let from = from | from.tag().iota(0) & (16 - size_of::<T>()) as u8;
            Some(self.table_lookup_bytes(from.tag().opaque(from.raw)).bitcast())
        });
        None
    }
    const BY_BYTES: bool = S::AVX512VBMI && T::BITS > 8 && W::BYTES >= 16;
    const BY_MATRIX: bool = S::GFNI && W::BYTES >= 16;
    #[op]
    fn repeats(mask: u64) -> bool {
        mask == (mask & 255) * (0x0101_0101_0101_0101 >> (64 - T::BITS))
    }
    /// What crosses into another byte is never chosen.
    #[op]
    fn shifted<const LEFT: bool>(self, n: u32) -> Self {
        return_if!(crate::X86 && T::BITS == 8, {
            let v = self.reinterpret::<u16>();
            (if LEFT { v << n } else { v >> n }).reinterpret()
        });
        if LEFT { self << n } else { self >> n }
    }
    /// The bits that count are at `from`, and in `shifted` at `beside`. The result has them at `to`, of which `moved` are from `shifted`.
    /// `clean` is 1 if all other bits are zero.
    #[op]
    fn moved(self, shifted: Self, clean: u8, from: u64, beside: u64, to: u64, moved: u64) -> (Self, u8) {
        // On x86, the steps would share less.
        macro_rules! step {
            ($body:block) => {
                cfg_select! {
                    target_arch = "aarch64" => apart!(self.s, $body),
                    _ => apart_unoptimized!(self.s, $body),
                }
            };
        }
        step!({
            let k = always!(|bits| self.tag().set(T::from_u64(bits)));
            if known(moved == to) {
                return (shifted & k(to), 1);
            }
            if const { S::A64 } && is_known!(to) {
                return (k(moved).selects().bit_select(self.tag().opaque(shifted.raw), self), 0);
            }
            if is_known!(to) {
                if const { T::BITS > 8 } && clean == 1 && known(moved & from == 0 && to & !moved & beside == 0) {
                    return ((self | shifted) & k(to), 1);
                }
                return (self & k(to & !moved) | shifted & k(moved), 1);
            }
            (k(moved).bit_select(shifted, self), 0)
        })
    }
}
