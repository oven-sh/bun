//! Operations that are made of others.

use crate::f16;
use crate::pattern as p;
use crate::raw::Raw;
use crate::{Float, Int, Isa, Lane, MaskOf, Operand, Signed, Simd, Tag, Width, X86};
use core::ops::*;

macro_rules! inline { ($($(#[$m:meta])* $(pub($v:ident))? fn $name:ident $(<const $k:ident>)? ($($args:tt)*) $(-> $out:ty)? $body:block)*) => {$(
    $(#[$m])* #[op] pub $(($v))? fn $name $(<const $k: usize>)? ($($args)*) $(-> $out)? $body
)*}; }

/// For each bit that is set: how many are set below it. For the others 0x80, which looks up zero.
const RANKS: &[[u8; 8]; 256] = &crate::Aligned(once!(
    [[u8; 8]; 256] = {
        let (mut table, mut bits) = ([[0x80; 8]; 256], 1usize);
        while bits < 256 {
            let below = bits ^ 1 << bits.ilog2();
            table[bits] = table[below];
            table[bits][bits.ilog2() as usize] = below.count_ones() as u8;
            bits += 1;
        }
        table
    }
))
.0;

/// The same for four lanes of `N / 4` bytes: the index of each byte.
const fn ranks_of_four<const N: usize>() -> [[u8; N]; 16] {
    let (mut table, mut i) = ([[0x80; N]; 16], 0);
    while i < 16 * N {
        let (bits, byte) = (i / N, i % N);
        if RANKS[bits][byte / (N / 4)] < 0x80 {
            table[bits][byte] = RANKS[bits][byte / (N / 4)] * (N / 4) as u8 + (byte % (N / 4)) as u8;
        }
        i += 1;
    }
    table
}
const RANKS_BY_2: &[[u8; 8]; 16] = &crate::Aligned(ranks_of_four()).0;
const RANKS_BY_4: &[[u8; 16]; 16] = &crate::Aligned(ranks_of_four()).0;

/// Each lane with the one that is half a vector away, and so on: the order of the reductions, with the result everywhere.
macro_rules! across {
    ($v:ident, $op:ident) => {{
        let mut v = $v;
        when!(W::BYTES == 64, v = v.$op(v.tag().concat_lower_upper(v, v)));
        when!(W::BYTES >= 32, v = v.$op(v.swap_adjacent_blocks()));
        when!(size_of::<T>() == 4, v = v.$op(v.shuffle1032()));
        v.$op(v.swap_pairs())
    }};
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    const FLOAT: bool = matches!(T::KIND, crate::lane::Kind::Float);
    /// Four lanes of 2, 4 or 8 bytes, and 16 bytes.
    const EXPANDS_BY_ROWS: bool = (S::SSE41 || S::A64 || S::WASM)
        && cfg!(target_endian = "little")
        && S::COMPRESS[size_of::<T>().trailing_zeros() as usize] < 64
        && W::BYTES <= S::REGISTER
        && (Self::LANES == 4 && size_of::<T>() > 1 || W::BYTES == 16 && size_of::<T>() == 1);
    /// Whether the bits of all bytes of a mask are counted by one instruction.
    pub(crate) const RANKS_AT_ONCE: bool =
        S::A64 && cfg!(target_endian = "little") && size_of::<T>() == 1 && matches!(W::BYTES, 32 | 64);
    /// Whether a reduction is better off without a scalar in between.
    const STAYS: bool =
        size_of::<T>() >= 4 && W::BYTES >= 16 && W::BYTES <= S::REGISTER && (X86 || S::WASM || Self::FLOAT);
    /// `phminposuw` has the least without a sign. LLVM would turn it back in a general register.
    const TURNED: bool = S::SSE41 && !T::IS_FLOAT && size_of::<T>() <= 2 && W::BYTES >= 16 && W::BYTES <= S::REGISTER;
    const ACROSS: bool = S::A64 && size_of::<T>() == 4;
    /// Whether it is cheaper to order numbers as integers than to mind NaN and the sign of zero at each step.
    pub(crate) const BY_KEYS: bool = W::BYTES >= 16
        && (W::BYTES <= S::REGISTER || X86 || S::WASM)
        && Self::FLOAT
        && size_of::<T>() == 4
        && (S::SSE41 && !S::AVX512DQ || S::WASM);
    #[op]
    fn splat_by_keys<const MAX: bool>(self) -> Self {
        // The sum wraps around for NaN of the sign that would win, so that all numbers come after it.
        (key::<MAX, W, S>(self.bitcast()) + 0x7f_ffff).splat_from_keys::<MAX>().bitcast()
    }
    /// LLVM would add a carry before the last step, so that the next round waits for two additions.
    #[op]
    fn summed(self) -> Self {
        choose! {
            X86 && !Self::FLOAT && size_of::<T>() >= 4 && W::BYTES >= 32 && W::BYTES <= S::REGISTER => self.black_box(),
            S::A64 && !Self::FLOAT && W::BYTES >= 16 => self.hidden_unless_known(),
            _ => self,
        }
    }
    /// The bytes or 16-bit lanes, moved up or down by one within each pair.
    #[op]
    pub(crate) fn shift_in_pairs(self, up: bool) -> Self {
        choose! {
            size_of::<T>() == 1 => {
                let v = self.bitcast::<u16>();
                (if up { v << 8 } else { v >> 8 }).bitcast()
            },
            _ => {
                let v = self.bitcast::<u32>();
                (if up { v << 16 } else { v >> 16 }).bitcast()
            },
        }
    }
}

/// Puts the bits of `f32` in order, as signed numbers, or in reverse as unsigned ones. It is its own reverse. After `abs`, there is little to do.
#[op]
fn key<const MAX: bool, W: Width, S: Isa>(v: Simd<i32, W, S>) -> Simd<i32, W, S> {
    if MAX { v ^ v >> 31 & i32::MAX } else { v ^ !(v >> 31) & i32::MAX }
}
impl<S: Isa, W: Width> Simd<i32, W, S> {
    #[op]
    fn splat_from_keys<const MAX: bool>(self) -> Self {
        halves_if!(W::BYTES > S::REGISTER, |v: Self = self| {
            let (a, b) = (v.lower_half(), v.upper_half());
            let half = if MAX { a.simd_max(b) } else { a.cast_unsigned().simd_max(b.cast_unsigned()).cast_signed() }.splat_from_keys::<MAX>();
            v.tag().combine(half, half)
        });
        let most = if MAX { self.splat_max() } else { self.cast_unsigned().splat_max().cast_signed() };
        // LLVM would subtract in a general register.
        key::<MAX, W, S>(most.barrier() - 0x7f_ffff)
    }
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    inline! {
        /// `load(&from[at..])` with one check in a loop.
        #[track_caller]
        fn load_at(self, from: &[T], at: usize) -> Simd<T, W, S> {
            crate::window::check(from.len(), at, Self::LANES);
            self.load(&from[at..])
        }
        /// Only the highest bit of each lane.
        fn sign_bit(self) -> Simd<T, W, S> { (self.to_unsigned().set(Lane::from_usize(1)) << (T::BITS - 1)).bitcast() }
        /// In each block: the lanes of `lo` from `K` on, and then the first `K` of `hi`.
        #[track_caller]
        fn combine_shift_right_lanes<const K>(self, hi: Simd<T, W, S>, lo: Simd<T, W, S>) -> Simd<T, W, S> {
            require!("`K` is more than a block", K * size_of::<T>() <= W::BYTES && K * size_of::<T>() <= 16);
            lo.shuffle::<{ p::ALIGN_RIGHT }, K>(hi)
        }
        /// The same bits for each block.
        fn dup128_mask_from_bits(self, bits: u64) -> MaskOf<T, W, S> {
            return_if!(W::BYTES <= 16, self.mask_from_number(bits));
            halves_if!(W::BYTES > 64, |this: Self = self, bits: u64 = bits| {
                crate::Mask::join(this.part::<W>().dup128_mask_from_bits(bits), this.part::<W>().dup128_mask_from_bits(bits))
            });
            return_if!(!MaskOf::<T, W, S>::IS_BITS && size_of::<T>() == 1, self.mask_from_bytes(bits, 1));
            return_if!(!MaskOf::<T, W, S>::IS_BITS, {
                let d = self.to_unsigned();
                let within = d.iota(Lane::from_usize(0)) & d.set(Lane::from_usize(16 / size_of::<T>() - 1));
                d.set(Lane::from_u64(bits)).has_bit(d.set(Lane::from_usize(1)) << within).retype()
            });
            let ones = !0 >> (64 - 16 / size_of::<T>());
            self.mask_from_bits((bits & ones) * (!0 / ones))
        }
    }
}

impl<S: Isa, T: crate::Signed, W: Width> crate::mask::Mask<T, W, S> {
    inline! {
        /// True in the first lane that is true and in all after it.
        #[doc(alias("SetAtOrAfterFirst"))]
        fn from_first(self) -> Self {
            return_if!(!Self::SPREADS || Self::BREAKS, !self.before_first());
            return_if!(W::BYTES / size_of::<T>() <= 2, self | Self::from_full(self.to_vector().dup_even()));
            // `x | -x` has all bits from the lowest one on.
            let x = self.s.fixed::<i64, crate::B16>().resize_bitcast(self.to_vector());
            let mut x = x | -x;
            when!(W::BYTES == 16, x |= x.shift_left_lanes::<1>().broadcast_sign_bit());
            Self::from_full(self.tag().resize_bitcast(x))
        }
        /// True in the first lane that is true and in all before it. If there is none, in all lanes.
        #[doc(alias("SetAtOrBeforeFirst"))]
        fn through_first(self) -> Self {
            return_if!(Self::BREAKS, self.up_to_first(true));
            return_if!(Self::SPREADS, !self.from_first().slide_up::<1>());
            return_if!(Self::LANES > 64, self.tag().first_n(self.count_before_first() + 1));
            return_if!(S::REGISTER < 64, {
                let d = self.tag().to_signed();
                d.iota(Lane::from_usize(0)).simd_le(d.set(Lane::from_usize(self.count_before_first()))).retype()
            });
            let bits = self.own_bits();
            self.tag().mask_from_bits(bits ^ bits.wrapping_sub(1))
        }
        /// Toward higher lanes.
        pub(crate) fn slide_up_lanes(self, n: usize) -> Self {
            return_if!(Self::IN_BLOCK && W::BYTES <= 8, self.as_number(#[inline(always)] |x| if n < self.tag().lanes() { x << (n as u32 * T::BITS) } else { 0 }));
            return_if!(Self::IN_BLOCK || Self::LANES > 64, Self::from_full(self.to_vector().up_by(n)));
            self.tag().mask_from_bits(self.own_bits().unbounded_shl(n.min(64) as u32))
        }
        /// Toward lower lanes.
        pub(crate) fn slide_down_lanes(self, n: usize) -> Self {
            return_if!(Self::IN_BLOCK && W::BYTES <= 8, self.as_number(#[inline(always)] |x| if n < self.tag().lanes() { x >> (n as u32 * T::BITS) } else { 0 }));
            return_if!(Self::IN_BLOCK || Self::LANES > 64, Self::from_full(self.to_vector().down_by(n)));
            self.tag().mask_from_bits(self.own_bits().unbounded_shr(n.min(64) as u32))
        }
        /// The same.
        pub(crate) fn slide_out(self, n: usize) -> Self {
            let it = self.slide_down_lanes(n);
            choose! { crate::X86 && Self::IS_BITS && Self::LANES <= 64 => it.tag().mask_from_number(crate::regs::word(it.own_bits())), _ => it }
        }
        /// Toward higher lanes, by a constant. `SlideMask1Up`.
        pub(crate) fn slide_up<const K>(self) -> Self {
            return_if!(crate::X86 && Self::IN_BLOCK && W::BYTES <= 8 && K * size_of::<T>() < 8, {
                let all = self.s.fixed::<u64, crate::B8>().resize_bitcast(self.to_vector());
                Self::from_full(self.tag().resize_bitcast(all << (K as u32 * T::BITS)))
            });
            choose! { Self::IS_BITS && Self::LANES <= 64 => self.slide_up_lanes(K), _ => Self::from_full(self.to_vector().slide_up::<K>()) }
        }
        /// Toward lower lanes, by a constant. `SlideMask1Down`.
        pub(crate) fn slide_down<const K>(self) -> Self {
            return_if!(Self::IS_BITS && K + 1 == Self::LANES, self.slide_out(K));
            choose! { Self::IS_BITS && Self::LANES <= 64 => self.slide_down_lanes(K), _ => Self::from_full(self.to_vector().slide_down::<K>()) }
        }
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    inline! {
        /// [`compress_store_exact`](Self::compress_store_exact) with a bit for each lane.
        #[track_caller]
        pub(crate) fn compress_bits_blended_store(self, bits: u64, to: &mut [T]) -> usize {
            let lanes = self.tag().lanes();
            if const { S::SCALAR && Self::LANES > 4 } {
                let (all, mut bits) = (self.to_array(), bits);
                let to = &mut to[..crate::ops::count_bits_on::<S>(bits, lanes)];
                for to in &mut *to {
                    *to = all.as_ref()[bits.trailing_zeros() as usize % lanes];
                    bits &= bits.wrapping_sub(1);
                }
                return to.len();
            }
            if to.len() >= lanes {
                let count = crate::ops::count_bits_on::<S>(bits, lanes);
                self.compress_own(bits).blended_store(self.tag().first_n(count), to);
                return count;
            }
            // To load what was stored in parts stalls.
            if const { W::BYTES > 16 && W::BYTES > S::COMPRESS[size_of::<T>().trailing_zeros() as usize] } {
                let lower = again!(Simd::compress_bits_blended_store, self.lower_half(), bits, &mut *to);
                return lower + again!(Simd::compress_bits_blended_store, self.upper_half(), bits >> (lanes / 2), &mut to[lower..]);
            }
            let count = crate::ops::count_bits_on::<S>(bits, lanes);
            self.compress_own(bits).store_n(&mut to[..count]);
            count
        }
        /// The reverse of [`compress`](Self::compress): the first lanes go where `mask` is true, and the others are zero.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u8x4::from([1, 2, 3, 4]).expand(mask8x4::from_bitmask(0b1010)), [0, 1, 0, 2]);
        /// # } example()
        /// ```
        #[track_caller]
        fn expand(self, mask: impl crate::Keep<T, W, S>) -> Self { self.expand_any(mask, None) }
        /// The same, but the others are those of `or`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u8x4::from([1, 2, 3, 4]).expand_or(0b1010, 9), [9, 1, 9, 2]);
        /// # } example()
        /// ```
        #[doc(alias("mask_expand", "merge"))]
        #[track_caller]
        fn expand_or(self, mask: impl crate::Keep<T, W, S>, or: impl crate::Operand<T, W, S>) -> Self { self.expand_any(mask, Some(self.like(or))) }
        #[track_caller]
        pub(crate) fn expand_any(self, mask: impl crate::Keep<T, W, S>, or: Option<Self>) -> Self {
            if const { Self::LANES == 8 && W::BYTES <= S::REGISTER && S::COMPRESS[size_of::<T>().trailing_zeros() as usize] < 64 && !S::LOOKS_UP_IN_MEMORY } && !crate::Keep::is_mask(mask) {
                return self.expand_eight(mask.kept(self.tag()) as u8, None, or);
            }
            if const { Self::EXPANDS_BY_ROWS } && !crate::Keep::is_mask(mask) {
                return self.expand_by_rows(mask.kept(self.tag()), or);
            }
            if const { Self::RANKS_AT_ONCE } && !crate::Keep::is_mask(mask) {
                return live!(S::A64 && Self::RANKS_AT_ONCE, {
                    let bits = mask.kept(self.tag());
                    let at = Self::ranks(self.s, bits, Self::counted(self.s, bits) << 8, 0);
                    let found = self.swizzle_dyn(at.bitcast());
                    match or {
                        Some(or) => found.dropped_or(at.cast_signed().is_negative().retype(), Some(or)),
                        None => found,
                    }
                });
            }
            self.expand_mask(crate::Keep::as_mask(mask, self.s), or)
        }
        /// Byte `k` is the number of bits that are set in the bytes `0..=k`.
        #[on(A64)]
        pub(crate) fn counted(s: S, bits: u64) -> u64 {
            u64::from_le_bytes(s.fixed::<u8, crate::B8>().from_array(bits.to_le_bytes()).count_ones().to_array()).wrapping_mul(0x0101_0101_0101_0101)
        }
        /// For each bit that is set, the number of those before it in its byte, plus that byte of `before`, for which the lower byte of each pair takes `0x80` as an index if `skip` says so.
        #[on(A64)]
        pub(crate) fn ranks(s: S, bits: u64, before: u64, skip: u8) -> Simd<u8, W, S> {
            let d = s.fixed::<u8, W>();
            let rows = d.from_parts(0, &mut passed!(|k| s.fixed::<u8, crate::B8>().load(&RANKS[(bits >> (8 * k)) as u8 as usize])));
            let from = d.from_fn(#[inline(always)] |i| (i / 8) as u8 | if i % 16 < 8 { skip } else { 0 });
            rows + d.repartition::<u64>().set(before).table_lookup_bytes(from)
        }
        /// An index of 128 or more finds zero, or `or`.
        pub(crate) fn bytes_or(self, at: Simd<u8, W, S>, or: Option<Self>) -> Self {
            if const { S::A64 && W::BYTES <= 16 } && let Some(or) = or {
                return live!(S::A64 && W::BYTES <= 16, self.with_bytes(W::from16(self.s.table_or(W::to16(or.bytes()), W::to16(self.bytes()).resize(), W::to16(at.bytes()), 1))));
            }
            let found = self.table_lookup_bytes(at);
            match or {
                Some(or) => at.cast_signed().is_negative().if_then_else(or.bitcast::<u8>(), found).bitcast(),
                None => found.bitcast(),
            }
        }
        pub(crate) fn kept_or(self, mask: MaskOf<T, W, S>, or: Option<Self>) -> Self {
            match or {
                Some(or) => mask.if_then_else(self, or),
                None => mask.if_then_else_zero(self),
            }
        }
        pub(crate) fn dropped_or(self, mask: MaskOf<T, W, S>, or: Option<Self>) -> Self {
            match or {
                Some(or) => mask.if_then_else(or, self),
                None => mask.if_then_zero_else(self),
            }
        }
        pub(crate) fn expand_eight(self, bits: u8, mask: Option<MaskOf<T, W, S>>, or: Option<Self>) -> Self {
            let (ranks, bytes) = (self.s.fixed::<u8, crate::B8>().load(&RANKS[bits as usize]), self.tag().repartition::<u8>());
            choose! {
                Self::LANES != 8 => unreachable!(),
                size_of::<T>() == 1 => self.bytes_or(bytes.resize_bitcast(ranks), or),
                size_of::<T>() == 2 => {
                    let d = self.s.fixed::<u8, crate::B16>();
                    let twice = d.resize_bitcast(ranks).saturating_add(d.resize_bitcast(ranks));
                    self.bytes_or(bytes.resize_bitcast(twice.interleave_lower(twice).bitcast::<u16>() | 0x0100), or)
                },
                _ => match mask {
                    Some(mask) => self.swizzle_dyn_relaxed(self.tag().to_unsigned().resize_bitcast(ranks.cast::<u32>())).kept_or(mask, or),
                    None => {
                        let at = self.tag().to_unsigned().resize_bitcast(ranks.cast_signed().cast::<i32>());
                        let at = choose! { X86 => at.barrier(), _ => at };
                        self.swizzle_wrapping(at).dropped_or(at.to_mask().retype::<T::Signed>(), or)
                    }
                },
            }
        }
        pub(crate) fn expand_by_rows(self, bits: u64, or: Option<Self>) -> Self {
            let (four, bytes) = ((bits & 15) as usize, self.tag().repartition::<u8>());
            choose! {
                !Self::EXPANDS_BY_ROWS => unreachable!(),
                Self::LANES == 16 => {
                    let d = self.s.fixed::<u8, crate::B8>();
                    let before = choose! { X86 => d.set((bits as u8).count_ones() as u8), _ => d.set(bits as u8).count_ones() };
                    let ranks = self.s.fixed::<u8, crate::B16>().combine(d.load(&RANKS[(bits >> 8) as u8 as usize]) + before, d.load(&RANKS[bits as u8 as usize]));
                    self.bytes_or(bytes.resize_bitcast(ranks), or)
                },
                size_of::<T>() == 2 => self.bytes_or(bytes.resize_bitcast(self.s.fixed::<u8, crate::B8>().load(&RANKS_BY_2[four])), or),
                size_of::<T>() == 4 => self.bytes_or(bytes.resize_bitcast(self.s.fixed::<u8, crate::B16>().load(&RANKS_BY_4[four])), or),
                _ => {
                    let d = self.s.fixed::<u32, crate::B32>();
                    let at = d.resize_bitcast(self.s.fixed::<u8, crate::B8>().load(&RANKS_BY_2[four]).cast_signed().cast::<i32>());
                    let at = choose! { X86 => at.barrier(), _ => at };
                    self.tag().resize_bitcast(d.resize_bitcast(self).swizzle_wrapping(at).dropped_or(at.to_mask(), or.map(#[inline(always)] |or| d.resize_bitcast(or))))
                },
            }
        }
        pub(crate) fn expand_mask(self, mask: MaskOf<T, W, S>, or: Option<Self>) -> Self {
            halves_if!(W::BYTES > 64, |this: Self = self, mask: MaskOf<T, W, S> = mask, or: Option<Self> = or| {
                let [lower, upper] = mask.parts::<W>();
                let rest = this.tag().part::<W>().load(&this.to_array().as_ref()[lower.count()..]);
                let part = always!(|i: usize| or.map(#[inline(always)] |or| or.parts::<W>()[i]));
                this.tag().join(this.parts::<W>()[0].expand_mask(lower, part(0)), rest.expand_mask(upper, part(1)))
            });
            return_if!(S::SCALAR, self.spread_ones(mask.own_bits()).kept_or(mask, or));
            return_if!(S::COMPRESS[size_of::<T>().trailing_zeros() as usize] == 64, {
                let (v, or, bits) = (self.bytes(), or.unwrap_or(self.tag().zero()).bytes(), mask.own_bits());
                self.with_bytes(if const { size_of::<T>() == 1 } {
                    self.s.expand8::<W>(v, or, bits)
                } else if const { size_of::<T>() == 2 } {
                    self.s.expand16::<W>(v, or, bits)
                } else if const { size_of::<T>() == 4 } {
                    self.s.expand32::<W>(v, or, bits)
                } else {
                    self.s.expand64::<W>(v, or, bits)
                })
            });
            return_if!(S::REGISTER == 64 && size_of::<T>() == 2 && W::BYTES >= 32, {
                // The indices are expanded as lanes of 32 bits.
                let (d, bits) = (self.s.fixed::<u32, crate::B64>(), mask.own_bits());
                let half = always!(|first: u32, bits: u64| self.s.fixed::<u16, crate::B32>().truncate_to(d.iota(first).expand_mask(d.mask_from_bits(bits), None)));
                let all = self.s.fixed::<u16, crate::B64>().combine(half((bits as u16).count_ones(), bits >> 16), half(0, bits));
                self.swizzle_dyn_relaxed(self.tag().to_unsigned().resize_bitcast(all)).kept_or(mask, or)
            });
            return_if!(W::BYTES / size_of::<T>() <= 2, crate::mask::Mask::from_full(mask.to_vector().dup_even()).if_then_else(self, self.dup_even()).kept_or(mask, or));
            return_if!(Self::LANES == 8 && W::BYTES <= S::REGISTER && !S::LOOKS_UP_IN_MEMORY, self.expand_eight(mask.to_bitmask() as u8, Some(mask), or));
            return_if!(Self::EXPANDS_BY_ROWS && (X86 || Self::LANES == 4), self.expand_by_rows(mask.to_bitmask(), or));
            halves_if!(S::SSE41 && !S::AVX512VL && W::BYTES == 2 * S::REGISTER && Self::LANES > 4, |this: Self = self, mask: MaskOf<T, W, S> = mask, or: Option<Self> = or| {
                let (lower, upper) = (mask.lower_half(), mask.upper_half());
                let rest = this.lower_half().shift_elements_left_dyn(lower.count(), this.upper_half());
                this.tag().combine(
                    rest.expand_mask(upper, or.map(#[inline(always)] |or| or.upper_half())),
                    this.lower_half().expand_mask(lower, or.map(#[inline(always)] |or| or.lower_half())),
                )
            });
            let kept = mask.to_vector().cast_unsigned();
            return_if!(S::SSE2 && T::BITS == 64, self.swizzle_dyn_relaxed((kept >> 63).prefix_sum() - T::Unsigned::ONE).kept_or(mask, or));
            self.swizzle_dyn_relaxed(!kept.prefix_sum()).kept_or(mask, or)
        }
        /// Lane `i` is the sum of the lanes `0..=i`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u32x4::from([1, 2, 3, 4]).prefix_sum(), [1, 3, 6, 10]);
        /// # } example()
        /// ```
        #[doc(alias("cumsum"))]
        fn prefix_sum(self) -> Self { apart!(self.s, {
            halves_if!(W::BYTES > 64, |this: Self = self| {
                let [lower, upper] = this.parts::<W>();
                let lower = lower.prefix_sum();
                this.tag().join(lower, upper.prefix_sum() + lower.splat_last())
            });
            return_if!(S::SCALAR && size_of::<T>() > 1 && !T::IS_FLOAT, {
                let (lanes, mut sum) = (self.cast_unsigned().to_array(), 0u64);
                self.tag().to_unsigned().from_fn(#[inline(always)] |i| { sum = sum.wrapping_add(crate::lane::Int::to_u64(lanes.as_ref()[i])); Lane::from_u64(sum) }).bitcast()
            });
            halves_if!(S::SSE2 && !T::IS_FLOAT && W::BYTES > 16 && S::REGISTER == 16, |this: Self = self| {
                let lower = this.lower_half().prefix_sum();
                this.tag().combine(this.upper_half().prefix_sum() + lower.splat_last(), lower)
            });
            return_if!(S::SSE41 && !S::AVX512VL && !T::IS_FLOAT && W::BYTES == 16, self.in_blocks().prefix_sum().summed());
            // Only -0.0 changes no sum.
            let (mut v, none) = (self, choose! { T::IS_FLOAT => self.tag().sign_bit(), _ => self.tag().zero() });
            macro_rules! step { ($($k:literal)*) => {$(
                when!(W::BYTES / size_of::<T>() > $k, v += v.shift_elements_right::<$k>(none));
            )*}; }
            // Floats are added in the same order on all targets.
            return_if!(S::REGISTER == 64 && size_of::<T>() >= 4 && !matches!(T::KIND, crate::lane::Kind::Float) || W::BYTES <= 16, {
                step!(1 2 4 8);
                v.summed()
            });
            halves_if!(S::A64 && W::BYTES > 16 && size_of::<T>() < 4 && !T::IS_FLOAT, |this: Self = self| {
                // Those of the odd lanes take half of the registers.
                let [lower, upper] = this.split();
                let odd = lower.add_pairs(upper).prefix_sum();
                let [lower, upper] = (odd - lower.deinterleave(upper)[1]).interleave(odd);
                this.tag().combine(upper, lower)
            });
            // Within the blocks, where shifts are cheap, and then the sums of whole blocks.
            let v = v.in_blocks().prefix_sum();
            // Two masked additions. With zeros as an operand, the moves are `vpermi2w`.
            return_if!(X86 && S::REGISTER == 64 && W::BYTES == 64 && !Self::FLOAT && (size_of::<T>() == 2 || S::AVX512VBMI), {
                let (d, mut v) = (self.tag(), v);
                macro_rules! from { ($($k:literal)*) => {$(
                    let last = v.unseen().of_one(#[inline(always)] |i| (i / (16 / size_of::<T>()) + 4 - $k) % 4 * (16 / size_of::<T>()) + 16 / size_of::<T>() - 1);
                    v += (!d.first_n($k * 16 / size_of::<T>())).in_register::<true>().if_then_else_zero(last.unseen());
                )*}; }
                from!(1 2);
                v
            });
            let none = choose! { cfg!(not(miri)) && Self::SOFT && crate::simd::ARRAYS => none.black_box(), _ => none };
            let mut before = v.shuffle::<{ p::LAST_OF_BLOCK_BEFORE }, 1>(none);
            when!(W::BYTES == 64, {
                before += before.shuffle::<{ p::LAST_OF_BLOCK_BEFORE }, 1>(none);
                before += v.shuffle::<{ p::LAST_OF_BLOCK_BEFORE }, 3>(none);
            });
            (v + before).summed()
        }) }
        /// `self.simd_max_relaxed(min).simd_min_relaxed(max)`.
        #[doc(alias("Clamp"))]
        fn simd_clamp_relaxed(self, min: impl Operand<T, W, S>, max: impl Operand<T, W, S>) -> Self { self.simd_max_relaxed(min).simd_min_relaxed(max) }
        /// [`reduce_sum`](Self::reduce_sum) in each lane.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let v = f32x4::from([1.0, 1.0, 2.0, 4.0]);
        /// assert_eq!(v / v.splat_sum(), [0.125, 0.125, 0.25, 0.5]);
        /// # } example()
        /// ```
        #[doc(alias("sum_of_lanes", "SumOfLanes"))]
        fn splat_sum(self) -> Self {
            return_if!(X86 && size_of::<T>() == 1 && W::BYTES >= 8, {
                let sums = self.bitcast::<u8>().sums_of_8();
                self.tag().set(T::from_usize(sums.reduce_sum() as usize))
            });
            choose! { Self::STAYS => across!(self, add), _ => self.tag().set(self.reduce_sum()) }
        }
        /// `reduce_min` in each lane. `v.simd_eq(v.splat_min()).first_set()` tells where it is.
        #[doc(alias("min_of_lanes", "MinOfLanes", "minpos", "phminposuw"))]
        fn splat_min(self) -> Self {
            return_if!(Self::BY_KEYS, self.splat_by_keys::<false>());
            return_if!(X86 && Self::TURNED && T::IS_SIGNED, (self ^ T::MIN).cast_unsigned().splat_min().barrier().bitcast::<T>() ^ T::MIN);
            choose! { Self::STAYS && !Self::ACROSS => across!(self, simd_min), _ => self.tag().set(self.reduce_min()) }
        }
        /// `reduce_max` in each lane.
        #[doc(alias("max_of_lanes", "MaxOfLanes"))]
        fn splat_max(self) -> Self {
            return_if!(Self::BY_KEYS, self.splat_by_keys::<true>());
            return_if!(X86 && Self::TURNED, (self ^ T::MAX).cast_unsigned().splat_min().barrier().bitcast::<T>() ^ T::MAX);
            choose! { Self::STAYS && !Self::ACROSS => across!(self, simd_max), _ => self.tag().set(self.reduce_max()) }
        }
        /// The same with the odd lane less the even one.
        pub(crate) fn pairwise_sub(self, other: Self) -> Self {
            (other - other.shift_in_pairs(true)).odd_even(self.shift_in_pairs(false) - self)
        }
        /// Like [`in_blocks().add_pairs`](crate::InBlocks::add_pairs), with the odd lane less the even one.
        pub(crate) fn pairwise_sub128(self, other: Self) -> Self {
            return_if!(S::SSSE3 && size_of::<T>() == 1 && W::BYTES >= 16 && !S::AVX512VBMI, {
                let differences = self.pairwise_sub(other);
                differences.shuffle::<{ p::EVEN_ODD_IN_BLOCK }, 0>(differences)
            });
            return_if!(S::SSSE3 && !Self::FLOAT && W::BYTES >= 16 && W::BYTES <= 32 && matches!(size_of::<T>(), 2 | 4), {
                // `phsub` has the even lane less the odd one. LLVM would merge an ordinary negation into the subtraction.
                let v = self.shuffle::<{ p::STRIDE_IN_BLOCK }, 0>(other) - self.shuffle::<{ p::STRIDE_IN_BLOCK }, 1>(other);
                let (v, negative) = (v.bytes(), (!self.tag().zero()).bytes());
                self.with_bytes(if const { size_of::<T>() == 2 } { self.s.sign_i16::<W>(v, negative) } else { self.s.sign_i32::<W>(v, negative) })
            });
            self.shuffle::<{ p::STRIDE_IN_BLOCK }, 1>(other) - self.shuffle::<{ p::STRIDE_IN_BLOCK }, 0>(other)
        }
    }
}

impl<S: Isa, T: Signed, W: Width> Simd<T, W, S> {
    inline! {
        /// `-self`, where the lowest value gives the highest.
        #[doc(alias("saturated_neg", "SaturatedNeg"))]
        fn saturating_neg(self) -> Self {
            return_if!((crate::X86 || S::WASM) && size_of::<T>() == 8 && !S::AVX512VL, self.simd_eq(T::MIN).to_vector() - self);
            choose! { (crate::X86 || S::WASM) && size_of::<T>() >= 4 => -self.simd_max(-self.tag().set(T::MAX)), _ => self.tag().zero().saturating_sub(self) }
        }
        /// The absolute value, where the lowest value gives the highest.
        #[doc(alias("saturated_abs", "SaturatedAbs"))]
        fn saturating_abs(self) -> Self {
            return_if!(S::A64, {
                let v = self.bytes();
                self.with_bytes(if const { size_of::<T>() == 1 } {
                    self.s.saturated_abs8::<W>(v)
                } else if const { size_of::<T>() == 2 } {
                    self.s.saturated_abs16::<W>(v)
                } else if const { size_of::<T>() == 4 } {
                    self.s.saturated_abs32::<W>(v)
                } else {
                    self.s.saturated_abs64::<W>(v)
                })
            });
            return_if!((crate::X86 || S::WASM) && size_of::<T>() == 8 && !S::AVX512VL || S::BY_HAND && size_of::<T>() == 4, self.abs() + self.abs().broadcast_sign_bit());
            choose! { crate::X86 || S::WASM => self.abs().cast_unsigned().simd_min(self.tag().set(T::MAX).cast_unsigned()).bitcast(), _ => self.simd_max(self.saturating_neg()) }
        }
    }
}

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    inline! {
        /// Each lane to the left by its own count.
        pub(crate) fn rol(self, counts: Self) -> Self {
            return_if!(S::NEON, {
                // A negative count shifts to the right.
                let mask = self.tag().set(T::from_usize(T::BITS as usize - 1));
                let (v, left, right) = (self.bytes(), (counts & mask).bytes(), (counts | !mask).bytes());
                macro_rules! both { ($f:ident) => { self.with_bytes(self.s.$f::<W>(v, left)) | self.with_bytes::<T>(self.s.$f::<W>(v, right)) }; }
                choose! { size_of::<T>() == 1 => both!(shift8), size_of::<T>() == 2 => both!(shift16), size_of::<T>() == 4 => both!(shift32), _ => both!(shift64) }
            });
            return_if!(S::AVX512VBMI && size_of::<T>() == 1 && W::BYTES >= 16 && W::BYTES <= 64, |this: Self = self, counts: Self = counts| {
                let (d, v, counts) = (this.tag().repartition::<u8>(), this.bitcast::<u64>(), counts.bitcast::<u8>() & 7);
                let from = d.repartition::<u64>().set(0x3830_2820_1810_0800).bitcast::<u8>() - counts;
                let low = d.dup128([0, 1, 3, 7, 15, 31, 63, 127, 0, 0, 0, 0, 0, 0, 0, 0]).table_lookup_bytes(counts).bitcast::<u64>();
                low.bit_select(v.rotate_bytes_from(from + 8), v.rotate_bytes_from(from)).bitcast()
            });
            let (v, counts) = (self.cast_unsigned(), counts.cast_unsigned());
            return_if!(S::SSE41 && !S::AVX512BW && size_of::<T>() == 1 && W::BYTES >= 16, {
                // The upper half of a byte and its copy.
                let (v, by) = (v.bitcast::<u8>(), (v.tag().repartition::<u8>().dup128([1, 2, 4, 8, 16, 32, 64, 128, 0, 0, 0, 0, 0, 0, 0, 0])).table_lookup_bytes(counts.bitcast::<u16>() & 0x0707));
                ((v.dup_even().bitcast::<u16>() * (by & 0xff)) >> 8 | (v.dup_odd().bitcast::<u16>() * (by >> 8)) & 0xff00).bitcast()
            });
            if_here!(S::AVX512BW && !S::AVX512VBMI && size_of::<T>() == 1 && matches!(W::BYTES, 16..=64), if !are_known!(counts.raw) {
                // The same by shifts.
                return live!(S::AVX512BW && !S::AVX512VBMI && size_of::<T>() == 1 && matches!(W::BYTES, 16..=64), {
                    let (v, by) = (v.bitcast::<u8>(), counts.bitcast::<u16>() & 0x0707);
                    (v.dup_even().bitcast::<u16>().unbounded_shl(by & 0xff) >> 8 | v.dup_odd().bitcast::<u16>().unbounded_shl(by >> 8) & 0xff00).bitcast()
                });
            });
            return_if!(X86 && S::SSE2 && !S::AVX512BW && size_of::<T>() == 1 && W::BYTES >= 2, {
                // By 4, 2 and 1, as the top bits say.
                let (v, by) = (v.bitcast::<u8>(), (counts.bitcast::<u16>() << 5).bitcast::<i8>());
                let v = by.is_negative().select(v << 4 | v >> 4, v);
                let by = by + by;
                let v = by.is_negative().select(v << 2 | v >> 6, v);
                (by + by).is_negative().select(v << 1 | v >> 7, v).bitcast()
            });
            return_if!(X86 && size_of::<T>() == 1, {
                // LLVM sees the rotation.
                Simd::<T::Unsigned, W, S>::new(self.s, v.raw.shl(counts.raw).or(v.raw.shr((-counts).raw))).bitcast()
            });
            halves_if!(X86 && W::BYTES > S::REGISTER, |this: Self = self, counts: Simd<T::Unsigned, W, S> = counts| {
                this.tag().combine(this.upper_half().rol(counts.upper_half().bitcast()), this.lower_half().rol(counts.lower_half().bitcast()))
            });
            // Both parts of a product.
            return_if!((S::SSE2 || S::WASM) && !S::AVX512BW && (size_of::<T>() == 2 || S::WASM && size_of::<T>() < 8), {
                let power = v.tag().set(Lane::from_usize(1)) << counts;
                ((v * power) | v.mul_high(power)).bitcast()
            });
            return_if!(X86 && S::SSE2 && !S::AVX2 && size_of::<T>() == 4 && W::BYTES == 16, {
                let (v, power) = (v.bitcast::<u32>(), self.s.fixed::<u32, W>().set(1) << counts.bitcast::<u32>());
                let (even, odd) = (v.widening_mul_even(power).bitcast::<u32>(), v.widening_mul_odd(power).bitcast::<u32>());
                (even.interleave_even(odd) | even.interleave_odd(odd)).bitcast()
            });
            return_if!(S::AVX2 && !S::AVX512VL && size_of::<T>() == 8, crate::Count::funnel(counts, v, v, true).bitcast());
            // So that LLVM still sees the rotation.
            let counts = choose! { X86 => counts.barrier_unless_known(), _ => counts };
            (v << counts | v >> -counts).bitcast()
        }
        /// Each lane to the right by its own count.
        pub(crate) fn ror(self, counts: Self) -> Self {
            halves_if!(X86 && W::BYTES > S::REGISTER, |this: Self = self, counts: Self = counts| {
                this.tag().combine(this.upper_half().ror(counts.upper_half()), this.lower_half().ror(counts.lower_half()))
            });
            return_if!(S::AVX2 && !S::AVX512VL && size_of::<T>() == 8, {
                let v = self.cast_unsigned();
                crate::Count::funnel(counts.cast_unsigned(), v, v, false).bitcast()
            });
            return_if!(X86 && size_of::<T>() >= 4 && S::AVX2, {
                let (v, counts) = (self.cast_unsigned(), counts.cast_unsigned().barrier_unless_known());
                (v >> counts | v << -counts).bitcast()
            });
            self.rol(-counts)
        }
        /// -1 for zero.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(i32x4::from([1, 2, 1000, 0]).ilog2(), [0, 1, 9, -1]);
        /// # } example()
        /// ```
        #[doc(alias("highest_set_bit_index", "HighestSetBitIndex"))]
        fn ilog2(self) -> Self { self.tag().set(T::from_usize(T::BITS as usize - 1)) - self.leading_zeros() }
    }
}

impl<S: Isa, T: Float, W: Width> Simd<T, W, S> {
    #[op]
    fn infinity() -> T::Signed {
        Lane::from_u64(!0 >> (65 - T::BITS) >> T::FRACTION << T::FRACTION)
    }
    /// `Normal` stands for all that is not normal, and `Nan` for all that isn't finite.
    #[on(X86)]
    #[op]
    pub(crate) fn class(self, kind: core::num::FpCategory) -> MaskOf<T, W, S> {
        let (s, v) = (self.s, self.bytes());
        let all = self.with_bytes::<T>(if const { T::BITS == 16 } {
            s.class_f16::<W>(v, kind)
        } else if const { T::BITS == 32 } {
            s.class_f32::<W>(v, kind)
        } else {
            s.class_f64::<W>(v, kind)
        });
        choose! {
            W::BYTES > 32 => all.to_mask(),
            T::BITS == 16 => crate::mask::Mask::compared(s, all.raw.top_bits()),
            _ => crate::mask::Mask::of_floats(s, all.raw.top_bits()),
        }
    }
}

impl<S: Isa, T: Float, W: Width> Simd<T, W, S> {
    inline! {
        /// True where the lane is not a number.
        fn is_nan(self) -> MaskOf<T, W, S> {
            return_if!(Self::SOFT, self.abs().cast_signed().simd_gt(Self::infinity()));
            self.simd_ne(self)
        }
        /// True where the lane is positive or negative infinity.
        #[doc(alias("IsInf"))]
        fn is_infinite(self) -> MaskOf<T, W, S> {
            return_if!(Self::SOFT, self.abs().cast_signed().simd_eq(Self::infinity()));
            return_if!(S::AVX512DQ, self.class(core::num::FpCategory::Infinite));
            return_if!(S::A64, (self.tag().set(T::MAX) + T::MAX).abs_le(self));
            self.abs().simd_eq(self.tag().set(T::MAX) + T::MAX)
        }
        /// True where the lane is neither infinite nor NaN.
        fn is_finite(self) -> MaskOf<T, W, S> {
            return_if!(Self::SOFT, self.abs().cast_signed().simd_lt(Self::infinity()));
            return_if!(S::AVX512DQ, !self.class(core::num::FpCategory::Nan));
            self.abs_le(self.like(T::MAX))
        }
        /// `self.abs().simd_le(other.abs())`
        pub(crate) fn abs_le(self, other: Self) -> MaskOf<T, W, S> {
            return_if!(S::A64 && !Self::HALF, self.with_bytes::<T>(self.s.abs_le::<W>(self.bytes(), other.bytes(), T::BITS)).full_mask());
            return_if!(S::A64 && !Self::SOFT, self.with_bytes::<T>(self.s.abs_le_f16::<W>(self.bytes(), other.bytes())).full_mask());
            self.abs().simd_le(other.abs())
        }
        /// The magnitude of `self` with the sign bit of `sign`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(f32x2::from([1.0, -2.0]).copysign([-0.0, 5.0]), [-1.0, 2.0]);
        /// # } example()
        /// ```
        #[doc(alias("copy_sign", "CopySign"))]
        fn copysign(self, sign: impl Operand<T, W, S>) -> Self {
            self.tag().sign_bit().selects().bit_select(sign.vector(self.tag()), choose! { S::A64 => self.tag().opaque(self.raw), _ => self })
        }
    }
}

impl<S: Isa, W: Width> MaskOf<u64, W, S> {
    /// `select` for a mask that was made of a vector.
    #[op]
    pub(crate) fn select_bits(self, yes: Simd<u64, W, S>, no: Simd<u64, W, S>) -> Simd<u64, W, S> {
        choose! { S::AVX512VL => self.into_vector().bitcast::<u64>().bit_select(yes, no), _ => self.if_then_else(yes, no) }
    }
}

/// Each block is a number of 128 bits. Both lanes of a mask are the same.
impl<S: Isa, W: Width> Simd<u64, W, S> {
    inline! {
        /// `self == other`.
        pub(crate) fn eq128(self, other: Self) -> MaskOf<u64, W, S> {
            return_if!(crate::X86 && S::REGISTER == 64, {
                let differ = self ^ other;
                (differ | differ.swap_pairs()).simd_eq(0)
            });
            let same = self.simd_eq(other).to_vector();
            (same & same.swap_pairs()).moved_mask()
        }
        /// `self < other`. The second lane of a block is the more significant.
        pub(crate) fn lt128(self, other: Self) -> MaskOf<u64, W, S> {
            let less = self.simd_lt(other).to_vector();
            self.simd_eq(other).if_then_else(less.dup_even(), less).dup_odd().moved_mask()
        }
        /// The same, for `select_bits`.
        pub(crate) fn less128(self, other: Self) -> MaskOf<u64, W, S> {
            return_if!(crate::X86 && MaskOf::<u64, W, S>::BOTH, {
                let signed = always!(|v: Self| (v ^ 1 << 63).cast_signed().unseen());
                let less = signed(self).simd_lt(signed(other)).into_vector();
                let less = self.simd_eq(other).into_vector().bit_select(less.dup_even(), less).dup_odd();
                less.to_mask().also(less, false, true)
            });
            self.lt128(other)
        }
        /// The smaller number.
        pub(crate) fn min128(self, other: Self) -> Self { self.less128(other).select_bits(self, other) }
        /// The larger number.
        pub(crate) fn max128(self, other: Self) -> Self { self.less128(other).select_bits(other, self) }
    }
}

use crate::bf16;
macro_rules! number_first {
    ($traits:tt $($t:ident)*) => { $(number_first!(@ $t $traits);)* };
    (@ $t:ident [$($trait:ident $f:ident)*]) => {$(
        impl<S: Isa, W: Width> $trait<Simd<$t, W, S>> for $t {
            type Output = Simd<$t, W, S>;
            #[op]
            fn $f(self, v: Self::Output) -> Self::Output { v.tag().set(self).$f(v) }
        }
    )*};
}
number_first!([Add add Sub sub Mul mul BitAnd bitand BitOr bitor BitXor bitxor] u8 u16 u32 u64 i8 i16 i32 i64 f16 bf16 f32 f64);
number_first!([Div div] u8 u16 u32 u64 i8 i16 i32 i64 f16 bf16 f32 f64);
number_first!([Rem rem] u8 u16 u32 u64 i8 i16 i32 i64 f16 bf16 f32 f64);
number_first!([Shl shl Shr shr] u8 u16 u32 u64 i8 i16 i32 i64);
macro_rules! reference_first { ($($trait:ident $f:ident)*) => {$(
    impl<S: Isa, T: Lane, W: Width, O> $trait<O> for &Simd<T, W, S> where Simd<T, W, S>: $trait<O, Output = Simd<T, W, S>> {
        type Output = Simd<T, W, S>;
        #[op]
        fn $f(self, other: O) -> Self::Output { (*self).$f(other) }
    }
)*}; }
reference_first!(Add add Sub sub Mul mul Div div Rem rem BitAnd bitand BitOr bitor BitXor bitxor Shl shl Shr shr);
