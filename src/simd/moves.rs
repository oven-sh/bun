//! What moves lanes.

use crate::pattern as p;
use crate::{InBlocks, Isa, Lane, MaskOf, Operand, Simd, Unsigned, Width};

macro_rules! methods { ($($(#[$m:meta])* fn $name:ident[$($g:tt)*]($($args:tt)*) -> $out:ty $body:block)*) => {$(
    $(#[$m])* #[op] #[track_caller] pub fn $name<$($g)*>($($args)*) -> $out $body
)*}; }

type V<S, T, W> = Simd<T, W, S>;

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    methods! {
        /// Alternating lanes of `self` and `other`: first from their lower halves, and then from the upper ones.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let [lo, hi] = u8x4::from([0, 1, 2, 3]).interleave([4, 5, 6, 7]);
        /// assert_eq!((lo.to_array(), hi.to_array()), ([0, 4, 1, 5], [2, 6, 3, 7]));
        /// # } example()
        /// ```
        #[doc(alias("InterleaveWholeLower", "InterleaveWholeUpper", "zip", "zip1", "zip2"))]
        fn interleave[](self, other: impl Operand<T, W, S>) -> [Self; 2] {
            // As in `shift_elements_right`.
            let zero = const { S::REGISTER >= 32 && T::BITS == 64 && W::BYTES >= 32 } && crate::hints::zero(crate::Operand::number(other));
            let other = if zero { self.like(other).unseen() } else { self.like(other) };
            halves_if!(S::AVX2 && !S::AVX512VL && T::BITS == 64 && W::BYTES > 32, |a: Self = self, b: Self = other| {
                let ([c, d], [e, f]) = (a.lower_half().interleave(b.lower_half()), a.upper_half().interleave(b.upper_half()));
                [a.tag().combine(d, c), a.tag().combine(f, e)]
            });
            if const { S::AVX2 && !S::AVX512VL && T::BITS == 64 && W::BYTES == 32 } && !zero {
                let (even, odd) = (self.interleave_lower(other).barrier(), self.interleave_upper(other).barrier());
                return [even.interleave_lower_blocks(odd), even.interleave_upper_blocks(odd)];
            }
            [self.interleave_whole_lower(other), self.interleave_whole_upper(other)]
        }
        /// The even lanes of `self` and then of `other`, and the odd ones. This is the reverse of [`interleave`](Self::interleave).
        /// On AVX2 it takes up to four instructions for each result. For records of 8 or 16 values, [`transpose_in_blocks`](Self::transpose_in_blocks) is faster than rounds of this,
        /// and so is `in_blocks().deinterleave` with one `swizzle` at the end.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let [even, odd] = u8x4::from([0, 1, 2, 3]).deinterleave([4, 5, 6, 7]);
        /// assert_eq!((even.to_array(), odd.to_array()), ([0, 2, 4, 6], [1, 3, 5, 7]));
        /// # } example()
        /// ```
        #[doc(alias("ConcatEven", "ConcatOdd", "unzip", "uzp1", "uzp2"))]
        fn deinterleave[](self, other: impl Operand<T, W, S>) -> [Self; 2] {
            let other = self.like(other);
            return_if!(S::SSE41 && S::REGISTER < 64 && T::BITS <= 16 && W::BYTES >= S::REGISTER && W::BYTES <= 32, self.tag().halves_of_pairs(self.concat(other)));
            return_if!(S::AVX512BW && T::BITS >= 32 && (W::BYTES == 32 || W::BYTES == 16 && T::BITS == 32 && !T::IS_FLOAT), [self.of_two(other, always!(|i: usize| 2 * i)), self.of_two(other, always!(|i: usize| 2 * i + 1))]);
            [self.tag().concat_even(other, self), self.tag().concat_odd(other, self)]
        }
        /// The even lanes of `self` and `other`, alternating, and the odd ones.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let [even, odd] = u8x4::from([0, 1, 2, 3]).transpose_pairs([4, 5, 6, 7]);
        /// assert_eq!((even.to_array(), odd.to_array()), ([0, 4, 2, 6], [1, 5, 3, 7]));
        /// # } example()
        /// ```
        #[doc(alias("InterleaveEven", "InterleaveOdd", "trn1", "trn2"))]
        fn transpose_pairs[](self, other: impl Operand<T, W, S>) -> [Self; 2] {
            let other = self.like(other);
            [self.interleave_even(other), self.interleave_odd(other)]
        }
        /// The even lanes of `self` and the odd lanes of `odd`, each in its place.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u8x4::from([0, 1, 2, 3]).alternate([4, 5, 6, 7]), [0, 5, 2, 7]);
        /// # } example()
        /// ```
        #[doc(alias("OddEven"))]
        fn alternate[](self, odd: impl Operand<T, W, S>) -> Self {
            let odd = self.like(odd);
            // In bits, LLVM joins it with what follows, and needs no mask register. With a shift in sight, it would take `vpermt2w`.
            return_if!(crate::X86 && S::REGISTER == 64 && W::BYTES == 64 && T::BITS <= 16 && !T::IS_FLOAT, |even: Self = self, odd: Self = odd| {
                let all = (!even.tag().zero()).odd_even(even.tag().zero());
                let (all, odd, even) = (all.bitcast::<u32>(), odd.bitcast::<u32>().barrier_unless_known(), even.bitcast::<u32>().barrier_unless_known());
                (odd & all | even & !all).bitcast()
            });
            odd.odd_even(self)
        }
        /// Half `A` of `self`, and then half `B` of `other`. The lower half is 0.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u8x4::from([0, 1, 2, 3]).concat_halves::<1, 0>([4, 5, 6, 7]), [2, 3, 4, 5]);
        /// # } example()
        /// ```
        #[doc(alias("ConcatLowerLower", "ConcatUpperUpper", "ConcatLowerUpper", "ConcatUpperLower"))]
        fn concat_halves[const A: usize, const B: usize](self, other: impl Operand<T, W, S>) -> Self {
            const { assert!(A < 2 && B < 2, "the halves are 0 and 1") };
            require!("the vector has too few lanes", Self::LANES >= 2);
            let (d, other) = (self.tag(), self.like(other));
            match (A, B) {
                (0, 0) => d.concat_lower_lower(other, self),
                (1, 1) => d.concat_upper_upper(other, self),
                (1, 0) => d.concat_lower_upper(other, self),
                _ => d.concat_upper_lower(other, self),
            }
        }
        /// By `K` lanes toward lane 0. The first lanes of `next` come in: zero slides, and a vector joins.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let v = u8x4::from([1, 2, 3, 4]);
        /// assert_eq!(v.shift_elements_left::<1>(0), [2, 3, 4, 0]);
        /// assert_eq!(v.shift_elements_left::<1>([5, 6, 7, 8]), [2, 3, 4, 5]);
        /// # } example()
        /// ```
        #[doc(alias("SlideDownLanes", "Slide1Down", "CombineSlideDown", "ext", "next", "lookahead", "valign", "alignr"))]
        fn shift_elements_left[/* else .._dyn */ const K: usize](self, next: impl Operand<T, W, S>) -> Self {
            require!("`K` is more than the number of lanes", K <= Self::LANES, at any width K <= 512);
            self.tag().to_unsigned().combine_slide_down::<K>(self.like(next).bitcast(), self.bitcast()).bitcast()
        }
        /// By `K` lanes away from lane 0. The last lanes of `previous` come in.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let (previous, v) = (u8x4::from(b"abc\\"), u8x4::from(b"\"def"));
        /// assert_eq!(v.shift_elements_right::<1>(previous), *b"\\\"de");
        /// # } example()
        /// ```
        #[doc(alias("SlideUpLanes", "Slide1Up", "CombineSlideUp", "prev", "previous", "carry", "valign"))]
        fn shift_elements_right[/* else .._dyn */ const K: usize](self, previous: impl Operand<T, W, S>) -> Self {
            require!("`K` is more than the number of lanes", K <= Self::LANES, at any width K <= 512);
            // If LLVM sees zeros, it takes `vexpandps`, which is slower.
            let previous = choose! {
                S::REGISTER == 64 && T::IS_FLOAT && T::BITS >= 32 && W::BYTES >= 32 && K > 0 && K < Self::LANES && 2 * K != Self::LANES => self.like(previous).unseen(),
                _ => self.like(previous),
            };
            self.tag().to_unsigned().combine_slide_up::<K>(self.bitcast(), previous.bitcast()).bitcast()
        }
        /// [`shift_elements_left`](Self::shift_elements_left) by a number that is known only at run time. More than all lanes is as much as all.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let v = u8x4::from([1, 2, 3, 4]);
        /// assert_eq!(v.shift_elements_left_dyn(3, 0), [4, 0, 0, 0]);
        /// assert_eq!(v.shift_elements_left_dyn(3, [5, 6, 7, 8]), [4, 5, 6, 7]);
        /// # } example()
        /// ```
        #[doc(alias("SlideDownLanes", "splice"))]
        fn shift_elements_left_dyn[](self, n: usize, next: impl Operand<T, W, S>) -> Self {
            if Self::fills(next) {
                return (self ^ next).cast_unsigned().down_by(n).bitcast::<T>() ^ next;
            }
            self.spliced(n.min(Self::LANES), self.like(next))
        }
        /// [`shift_elements_right`](Self::shift_elements_right) by a number that is known only at run time. More than all lanes is as much as all.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let v = u8x4::from([1, 2, 3, 4]);
        /// assert_eq!(v.shift_elements_right_dyn(3, 0), [0, 0, 0, 1]);
        /// assert_eq!(v.shift_elements_right_dyn(3, [5, 6, 7, 8]), [6, 7, 8, 1]);
        /// # } example()
        /// ```
        #[doc(alias("SlideUpLanes"))]
        fn shift_elements_right_dyn[](self, n: usize, previous: impl Operand<T, W, S>) -> Self {
            if Self::fills(previous) {
                return (self ^ previous).cast_unsigned().up_by(n).bitcast::<T>() ^ previous;
            }
            self.like(previous).spliced(Self::LANES - n.min(Self::LANES), self)
        }
        /// By `K` lanes toward lane 0. The first lanes become the last.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u8x4::from([1, 2, 3, 4]).rotate_elements_left::<1>(), [2, 3, 4, 1]);
        /// # } example()
        /// ```
        fn rotate_elements_left[/* else .._dyn */ const K: usize](self) -> Self { self.shuffle::<{ p::SLIDE_DOWN }, K>(self) }
        /// By `K` lanes away from lane 0. The last lanes become the first.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u8x4::from([1, 2, 3, 4]).rotate_elements_right::<1>(), [4, 1, 2, 3]);
        /// # } example()
        /// ```
        fn rotate_elements_right[/* else .._dyn */ const K: usize](self) -> Self { self.shuffle::<{ p::SLIDE_UP }, K>(self) }
        /// [`rotate_elements_left`](Self::rotate_elements_left) by a number that is known only at run time.
        fn rotate_elements_left_dyn[](self, n: usize) -> Self {
            return_if!(Self::LANES == 1, self);
            return_if!(S::SCALAR && W::BYTES <= 64, |this: Self = self, n: usize = n| this.followed_by(this, n % Self::LANES));
            return_if!(S::BY_HAND && W::BYTES == 16, |this: Self = self, n: usize = n| this.rotate_by_hand(n % Self::LANES * size_of::<T>()));
            return_if!(crate::X86 && Self::SLIDES_BY_TABLE, self.rotate_by_table(W::BYTES - n % Self::LANES * size_of::<T>()));
            if const { W::BYTES <= 16 && !S::BY_HAND } {
                let d = self.tag().repartition::<u8>();
                return self.move_lanes(d.iota(n.wrapping_mul(size_of::<T>()) as u8) & (W::BYTES - 1) as u8);
            }
            return_if!(W::BYTES > 64 || S::BY_HAND, |this: Self = self, n: usize = n| {
                this.down_by(n % Self::LANES) | this.up_by(Self::LANES - n % Self::LANES)
            });
            self.swizzle_wrapping(self.tag().to_unsigned().iota(Lane::from_usize(n)))
        }
        /// [`rotate_elements_right`](Self::rotate_elements_right) by a number that is known only at run time.
        fn rotate_elements_right_dyn[](self, n: usize) -> Self { self.rotate_elements_left_dyn(n.wrapping_neg()) }
        /// In each group of `N` lanes, lane `i` of the result is lane `order[i]` of that group. `N` is a power of two, and `order` should be a constant.
        /// Panics if an index is out of range.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let rgba = u8x8::from(b"RGBArgba");
        /// assert_eq!(rgba.swizzle_groups([2, 1, 0, 3]), *b"BGRAbgra");
        /// # } example()
        /// ```
        #[doc(alias("Reverse4", "Reverse8", "DupEven", "DupOdd", "Shuffle1032", "Shuffle0321", "Shuffle2103", "Per4LaneBlockShuffle", "pshufd"))]
        fn swizzle_groups[const N: usize](self, order: [usize; N]) -> Self {
            const { assert!(N.is_power_of_two(), "the length of a group has to be a power of two, since no vector has room for whole groups of another length") };
            if const { N == 2 && Self::LANES >= 2 } {
                match order[..] {
                    [1, 0] => return self.swap_pairs(),
                    [0, 0] => return self.dup_even(),
                    [1, 1] => return self.dup_odd(),
                    _ => {}
                }
            }
            if const { N == 4 } {
                match order[..] {
                    [3, 2, 1, 0] => return self.reverse4(),
                    [2, 3, 0, 1] => return self.shuffle1032(),
                    [1, 2, 3, 0] => return self.shuffle0321(),
                    [3, 0, 1, 2] => return self.shuffle2103(),
                    [0, 2, 1, 3] => return self.shuffle4::<0b11_01_10_00>(),
                    _ => {}
                }
            }
            if const { N == 8 } && matches!(order[..], [7, 6, 5, 4, 3, 2, 1, 0]) {
                return self.reverse8();
            }
            require!("the vector has too few lanes", N <= Self::LANES);
            self.permute_groups(order)
        }
        /// The lane of `self` at each index, or zero if it is out of range. [`swizzle_dyn_relaxed`](Self::swizzle_dyn_relaxed) saves the test, and [`lookup_or`](Self::lookup_or) takes another value than zero.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(f32x4::from([0.5, 1.5, 2.5, 3.5]).swizzle_dyn([3, 3, 0, 5]), [3.5, 3.5, 0.5, 0.0]);
        /// # } example()
        /// ```
        #[doc(alias("TableLookupLanes", "permute", "vpermd", "vpermb", "tbl", "vpermw"))]
        fn swizzle_dyn[](self, indices: impl Operand<T::Unsigned, W, S>) -> Self {
            let indices = indices.vector(self.tag().to_unsigned());
            return_if!(size_of::<T>() == 1 && (W::BYTES >= 256 || Self::TBL && W::BYTES >= 16 && W::BYTES <= 64 || S::WASM && W::BYTES == 16 || S::WASM && matches!(W::BYTES, 32 | 64) || Self::PSHUFB && !S::AVX512VL && W::BYTES > S::REGISTER && W::BYTES <= 128), self.swizzle_dyn_relaxed(indices));
            return_if!((Self::TBL || Self::PSHUFB || S::WASM) && size_of::<T>() == 1 && W::BYTES < 16, self.resize::<crate::B16>().swizzle_dyn(indices.resize()).resize());
            return_if!(Self::PSHUFB && size_of::<T>() == 1 && W::BYTES == 16, self.table_lookup_bytes(indices.bitcast::<u8>().saturating_add(0x70)).bitcast());
            if_here!(S::SVE2 && W::BYTES == 16 && size_of::<T>() > 1, if !are_known!(indices.raw) {
                return self.with_bytes(self.s.lanes_at::<W>(self.bytes(), indices.bytes(), (size_of::<T>(), false)));
            });
            return_if!(Self::TBL && size_of::<T>() < 8 && W::BYTES >= 16 && W::BYTES <= 64, self.lookup_in_one(indices.simd_min(T::Unsigned::from_usize(Self::LANES))));
            if const { S::AVX2 && !S::AVX512VL && size_of::<T>() == 1 && W::BYTES == 32 } && !are_known!(indices.raw) {
                return live!(S::AVX2 && !S::AVX512VL && size_of::<T>() == 1 && W::BYTES == 32, {
                    let v = self.bitcast::<u8>();
                    indices.bitcast::<u8>().in_chain_or_zero(2, &passed!(|k| if k == 0 { v.broadcast_block::<0>() } else { v.broadcast_block::<1>() })).bitcast()
                });
            }
            if const { Self::PSHUFB && !S::AVX512VL && (W::BYTES == 16 || !S::AVX2 && matches!(W::BYTES, 32 | 64)) && size_of::<T>() == 2 } && !are_known!(indices.raw) {
                return live!(crate::X86 && Self::PSHUFB && !S::AVX512VL && size_of::<T>() == 2, {
                    let at = indices.bitcast::<u16>().simd_min(Self::LANES as u16) * 0x0202 + 0x0100;
                    self.reinterpret::<u8>().swizzle_dyn(at.bitcast::<u8>()).reinterpret()
                });
            }
            indices.simd_lt(T::Unsigned::from_usize(Self::LANES)).retype::<T::Signed>().if_then_else_zero(self.swizzle_dyn_relaxed(indices))
        }
        /// The same in `self` followed by `other`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u8x4::from(b"abcd").concat_swizzle_dyn(u8x4::from(b"efgh"), [7, 0, 4, 9]), *b"hae\0");
        /// # } example()
        /// ```
        #[doc(alias("TwoTablesLookupLanes", "vpermt2b", "vpermi2b", "vpermi2d", "tbl2"))]
        fn concat_swizzle_dyn[](self, other: impl crate::Operand<T, W, S>, indices: impl Operand<T::Unsigned, W, S>) -> Self {
            let (other, indices) = (crate::Operand::vector(other, crate::Tag::new(self.s)), indices.vector(self.tag().to_unsigned()));
            return_if!(size_of::<T>() == 1 && (W::BYTES >= 128 || Self::TBL && W::BYTES >= 8 && W::BYTES <= 32 || Self::PSHUFB && !S::AVX512VL && W::BYTES > S::REGISTER), self.concat_swizzle_dyn_relaxed(other, indices));
            return_if!(Self::TBL && size_of::<T>() < 8 && matches!(W::BYTES, 16 | 32), self.concat_swizzle_dyn_relaxed(other, indices.simd_min(T::Unsigned::from_usize(2 * Self::LANES))));
            indices.simd_lt(T::Unsigned::from_usize(2 * Self::LANES)).retype::<T::Signed>().if_then_else_zero(self.concat_swizzle_dyn_relaxed(other, indices))
        }
        /// The sums of adjacent lanes of `self`, and then those of `other`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(i32x4::from([1, 2, 3, 4]).add_pairs(i32x4::from([10, 20, 30, 40])), [3, 7, 30, 70]);
        /// # } example()
        /// ```
        #[doc(alias("hadd", "addp", "PairwiseAdd"))]
        fn add_pairs[](self, other: impl crate::Operand<T, W, S>) -> Self {
            let other = crate::Operand::vector(other, crate::Tag::new(self.s));
            if const { W::BYTES <= 16 } {
                return self.pairwise_add128(other);
            }
            halves_if!(W::BYTES > S::REGISTER, |this: Self = self, other: Self = other| this.tag().combine(other.lower_half().add_pairs(other.upper_half()), this.lower_half().add_pairs(this.upper_half())));
            return_if!(S::AVX512VBMI && W::BYTES == 32 && size_of::<T>() == 1, {
                let sums = always!(|v: Self| v.bitcast::<u8>().sums_of_2().bitcast::<T>());
                sums(self).of_two(sums(other), always!(|i: usize| 2 * i))
            });
            if const { W::BYTES == 32 && S::REGISTER >= 32 && size_of::<T>() < 8 } {
                return self.pairwise_add128(other).reinterpret::<u64>().shuffle4::<0b11_01_10_00>().reinterpret();
            }
            let [even, odd] = self.deinterleave(other);
            even + odd
        }
        /// The same with each odd lane less the even one before it.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(i32x4::from([1, 2, 3, 5]).sub_pairs(i32x4::from([10, 20, 30, 50])), [1, 2, 10, 20]);
        /// # } example()
        /// ```
        #[doc(alias("hsub", "PairwiseSub"))]
        fn sub_pairs[](self, other: impl crate::Operand<T, W, S>) -> Self {
            let other = crate::Operand::vector(other, crate::Tag::new(self.s));
            if const { W::BYTES <= 16 } {
                return self.pairwise_sub128(other);
            }
            halves_if!(W::BYTES > S::REGISTER, |this: Self = self, other: Self = other| this.tag().combine(other.lower_half().sub_pairs(other.upper_half()), this.lower_half().sub_pairs(this.upper_half())));
            if const { W::BYTES == 32 && S::REGISTER >= 32 && size_of::<T>() < 8 } {
                return self.pairwise_sub128(other).reinterpret::<u64>().shuffle4::<0b11_01_10_00>().reinterpret();
            }
            let [even, odd] = self.deinterleave(other);
            odd - even
        }
        /// Transposes a square of as many rows as there are lanes.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let [a, b] = u64x2::transpose([u64x2::from([1, 2]), u64x2::from([3, 4])]);
        /// assert_eq!((a.to_array(), b.to_array()), ([1, 3], [2, 4]));
        /// # } example()
        /// ```
        fn transpose[const N: usize](rows: [Self; N]) -> [Self; N] { require!("there have to be as many rows as lanes", N == Self::LANES && N > 0); rows[0].tag().transpose(rows) }
        /// Transposes the square in each block: lane `j` of row `i` goes to lane `i` of row `j`. `N` is the number of lanes
        /// in a block, or a multiple for several squares.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let [a, b] = u64x4::transpose_in_blocks([u64x4::from([1, 2, 5, 6]), u64x4::from([3, 4, 7, 8])]);
        /// assert_eq!((a.to_array(), b.to_array()), ([1, 3, 5, 7], [2, 4, 6, 8]));
        /// # } example()
        /// ```
        fn transpose_in_blocks[const N: usize](rows: [Self; N]) -> [Self; N] { require!("there has to be a row", N > 0); rows[0].tag().transpose_in_blocks(rows) }
        /// Transposes a square of blocks: block `j` of row `i` goes to block `i` of row `j`. `N` is the number of blocks, or a multiple for several squares.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let [a, b] = u64x4::transpose_blocks([u64x4::from([1, 2, 3, 4]), u64x4::from([5, 6, 7, 8])]);
        /// assert_eq!((a.to_array(), b.to_array()), ([1, 2, 5, 6], [3, 4, 7, 8]));
        /// # } example()
        /// ```
        #[doc(alias("vshufi32x4", "vperm2i128"))]
        fn transpose_blocks[const N: usize](rows: [Self; N]) -> [Self; N] { require!("the number of rows has to be a multiple of the blocks, and not zero", N > 0 && N.is_multiple_of(W::BYTES.div_ceil(16))); rows[0].tag().squares_of_blocks(rows) }
        /// A view in which each block is one lane.
        fn as_u128s[](self) -> U128s<T, W, S> { U128s(self) }
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    const SPLICES: bool = W::BYTES <= 64 && crate::vector::two_tables::<S, T>() || S::A64 && W::BYTES <= 32;
    /// Whether `with` is a number that is best made from zeros, by `^` before and after the shift.
    #[op]
    fn fills(with: impl Operand<T, W, S>) -> bool {
        choose! { Self::SPLICES => crate::hints::zero(Operand::number(with)), _ => Operand::number(with).is_some() }
    }
    /// Both, from lane `n` on.
    #[op]
    pub(crate) fn spliced(self, n: usize, next: Self) -> Self {
        return_if!(S::A64 && W::BYTES <= 32, |this: Self = self, n: usize = n, next: Self = next| {
            let from = this.tag().repartition::<u8>().iota((n * size_of::<T>()) as u8);
            this.bitcast::<u8>().concat_swizzle_dyn_relaxed(next.bitcast::<u8>(), from).bitcast()
        });
        return_if!(
            crate::X86 && Self::SLIDES_BY_TABLE && W::BYTES == 32,
            self.splice_by_table(next, 32 - n * size_of::<T>())
        );
        return_if!(
            Self::SPLICES,
            self.concat_swizzle_dyn_relaxed(next, self.tag().to_unsigned().iota(Lane::from_usize(n)))
        );
        return_if!(S::AVX512BW && W::BYTES == 64 && size_of::<T>() == 1, |this: Self = self, n: usize = n, next: Self = next| {
            let (v, w, odd) = (this.bitcast::<u16>(), next.bitcast::<u16>(), (n & 1) as u32 * 8);
            (v.spliced(n / 2, w) >> odd | v.spliced(n.div_ceil(2), w) << odd).bitcast()
        });
        // `pshufb` gives zero from 128 on.
        return_if!(S::SSSE3 && W::BYTES == 16 && !Self::SLIDES_BY_TABLE, |this: Self = self, n: usize = n, next: Self = next| {
            let at = this.tag().repartition::<u8>().iota(0) + (n * size_of::<T>()) as u8;
            (this.table_lookup_bytes(at + 0x70) | next.table_lookup_bytes(at - 16)).bitcast()
        });
        (self.cast_unsigned().down_by(n) | next.cast_unsigned().up_by(Self::LANES - n)).bitcast()
    }
    /// It gives zero for what is out of range.
    const TBL: bool = S::NEON && cfg!(target_arch = "aarch64");
    const PSHUFB: bool = crate::X86 && S::SSE41;
    #[op]
    pub(crate) fn swizzle_wrapping(self, indices: V<S, T::Unsigned, W>) -> Self {
        self.swizzle_dyn_relaxed(indices & T::Unsigned::from_usize(Self::LANES - 1))
    }
}

impl<S: Isa, T: Unsigned, W: Width> Simd<T, W, S> {
    /// The lanes of the instruction that takes indices modulo their number, if there is one.
    const PERMUTED: usize = {
        let has = match size_of::<T>() {
            1 => S::AVX512VBMI,
            2 => S::AVX512VL,
            4 => S::AVX2,
            _ => S::AVX512VL,
        };
        if crate::X86 && has && W::BYTES >= 32 {
            (if W::BYTES < S::REGISTER { W::BYTES } else { S::REGISTER }) / size_of::<T>()
        } else {
            0
        }
    };
    /// This needs no `and`.
    #[inline(always)]
    fn lookup_repeated<U: Lane, const N: usize>(self, table: &[U; N]) -> V<S, U, W> {
        apart!(self.isa(), {
            halves_if!(W::BYTES > S::REGISTER, |this: Self = self, table: &[U; N] = table| {
                this.tag().repartition::<U>().combine(this.upper_half().lookup_repeated(table), this.lower_half().lookup_repeated(table))
            });
            let d = self.tag().repartition::<U>();
            let repeated = choose! { N * size_of::<U>() == 16 && W::BYTES > 16 => d.load_dup128(table), _ => d.load_known(table).swizzle(#[inline(always)] |i| i % N) };
            let permuted = repeated.swizzle_wrapping(crate::raw::same::<_, V<S, U::Unsigned, W>>(self));
            return_if!(size_of::<T>() > 1 || N > 16 || !crate::OPTIMIZED, permuted);
            // `pshufb` is quicker if it needs none either.
            let within = self & T::from_usize(N - 1);
            let same = within == self;
            core::hint::select_unpredictable(
                is_known!(same) & same,
                d.lookup(table, crate::raw::same(within)),
                permuted,
            )
        })
    }
    #[op]
    fn lookup_256<U: Lane>(self, table: &[U]) -> V<S, U, W> {
        return_if!(!S::LOOKS_UP_IN_REGISTERS, {
            let (at, table) = (self.to_array(), table.first_chunk::<256>().unwrap());
            self.tag().repartition::<U>().from_fn(
                #[inline(always)]
                |i| table[crate::lane::Int::to_u64(at.as_ref()[i]) as u8 as usize],
            )
        });
        let (lower, upper) = (table.first_chunk::<128>().unwrap(), table.last_chunk::<128>().unwrap());
        // There, an index from 128 on gives zero.
        return_if!(
            cfg!(target_arch = "aarch64") && S::NEON,
            self.lookup_same::<_, _, false>(lower) | (self ^ T::from_usize(128)).lookup_same::<_, _, false>(upper)
        );
        self.cast_signed()
            .is_negative()
            .retype::<U::Signed>()
            .if_then_else(self.lookup_same::<_, _, true>(upper), self.lookup_same::<_, _, true>(lower))
    }
}

impl<S: Isa, T: Unsigned, W: Width> Simd<T, W, S> {
    methods! {
        /// `table[index]` for each lane. The table has up to 1024 bytes, and its length is a power of two. The index counts modulo the length.
        /// The values can have another size than the indices, and are as many: bytes are the best indices for a small table of wider values.
        /// If these are summed over many vectors, a table for each of their bytes, made once by `load_interleaved`, took 0.7 to 0.95 of the time on long inputs.
        ///
        /// Up to 16 bytes take one instruction, and an `and` unless the compiler sees that the index is in range or `has!(icelake)`. Without that, each 16 bytes more take about three more on x86.
        /// Up to 128 bytes, and 256 single bytes, are in registers but on `portable` and `sse2`. More mostly are with AVX-512, for values of 2 bytes or more, and take a load for each lane otherwise.
        /// For a table of 8-byte values that fills more than two registers, plain loads took as little as a quarter of the time.
        /// In code that is generic over the lane, add `resize::<W>()`, as after [`cast`](Self::cast).
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!((u8x4::from([0x12, 0xab, 0x00, 0xff]) >> 4).lookup(b"0123456789abcdef"), *b"1a0f");
        /// let levels: f32x16<S> = u8x16::iota(0).lookup(&[-1.0f32, -0.25, 0.25, 1.0]);
        /// assert_eq!(levels.to_array()[..5], [-1.0, -0.25, 0.25, 1.0, -1.0]);
        ///
        /// // Sums by planes, of up to 256 values.
        /// let table: [u32; 16] = core::array::from_fn(|i| 0x0123_4567 * i as u32);
        /// let planes = u8x16::load_interleaved::<4>(table.map(u32::to_le_bytes).as_flattened()).map(|v| v.to_array());
        /// let (mut all, mut odd) = ([u16x8::zero(); 4], [u16x8::zero(); 4]);
        /// for at in [u8x16::iota(0), u8x16::splat(3)] {
        ///     unroll!(for k in 0..4 {
        ///         let v = at.lookup(&planes[k]).bitcast::<u16>();
        ///         (all[k], odd[k]) = (all[k] + v, odd[k] + (v >> 8));
        ///     });
        /// }
        /// let join = |s: [u16x8<S>; 4]| s.iter().rfold(u32x8::zero(), |sum, s| (sum << 8) + s.cast::<u32>());
        /// let [lower, _] = join(array::from_fn(|k| all[k] - (odd[k] << 8))).interleave(join(odd));
        /// assert_eq!(lower, u32x8::from_fn(|i| table[i] + table[3]));
        /// # } example()
        /// ```
        #[doc(alias("Lookup8", "Lookup16", "table", "lut", "translate", "vpermw", "vpermb", "lookup_wide", "dequantize", "codebook", "palette"))]
        fn lookup[U: Lane, const N: usize](self, /* a vector: table.swizzle_dyn(indices). A slice: first_chunk, or gather_or */ table: &[U; N]) -> V<S, U, crate::Scaled<T, U, W>> {
            const { assert!(N.is_power_of_two(), "the length of the table of `lookup` has to be a power of two: `lookup_relaxed` takes the others") };
            const { fits::<U, N>() };
            self.lookup_any::<U, _, N, true>(table)
        }
        /// The same for any length. The result is unspecified for an index that is out of range.
        fn lookup_relaxed[U: Lane, const N: usize](self, /* a vector: table.swizzle_dyn(indices). A slice: first_chunk, or gather_or */ table: &[U; N]) -> V<S, U, crate::Scaled<T, U, W>> {
            const { fits::<U, N>() };
            self.lookup_any::<U, _, N, false>(table)
        }
        /// `table[index]` for any length up to 1024 bytes, or the lane of `or` if the index is out of range. From bytes to up to 128 single bytes on NEON, the number 0 as `or` costs nothing.
        /// With a vector as `or` and 16, 32, 48 or 64 of them, AArch64 takes `tbx`. For a table in a vector of a fixed width: `indices.lookup_or(&table.to_array(), or)`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let text = u8x4::from(b"7a?0");
        /// assert_eq!((text - b'0').lookup_or(b"zotTffssen", text), *b"sa?z");
        /// # } example()
        /// ```
        #[doc(alias("tbl", "tbx", "vqtbl", "vqtbx", "lookup_or_default", "lookup_or_zero"))]
        fn lookup_or[U: Lane, const N: usize](self, /* a vector: table.swizzle_dyn(indices). A slice: first_chunk, or gather_or */ table: &[U; N], or: impl Operand<U, crate::Scaled<T, U, W>, S>) -> V<S, U, crate::Scaled<T, U, W>> {
            const { fits::<U, N>() };
            self.lookup_or_any::<U, _, N>(table, or)
        }
    }
    /// For values of the size of the indices.
    #[op]
    pub(crate) fn lookup_same<U: Lane, const N: usize, const EXACT: bool>(self, table: &[U; N]) -> V<S, U, W> {
        return_if!(S::SCALAR && N > 0 && (EXACT || N.is_power_of_two()), {
            let at = self.to_array();
            self.tag().repartition::<U>().from_fn(
                #[inline(always)]
                |i| table[crate::lane::Int::to_u64(at.as_ref()[i]) as usize % N],
            )
        });
        return_if!(EXACT && Self::PERMUTED > N, self.lookup_repeated(table));
        return_if!(N == 256 && size_of::<T>() == 1, self.lookup_256(table));
        return_if!(
            N > 128 && size_of::<T>() == 1,
            self.lookup_256(&crate::array::own::from_fn::<U, 256>(
                #[inline(always)]
                |i| table[i % N]
            ))
        );
        return_if!(S::AVX512F && N * size_of::<U>() > 128, self.lookup_parts(table));
        self.tag()
            .repartition::<U>()
            .lookup(table, crate::raw::same(choose! { EXACT && T::BITS == 8 => self & T::from_usize(N - 1), EXACT => self & self.like(T::from_usize(N - 1)), _ => self }))
    }
}

impl<T: Lane, W: Width, S: Isa> InBlocks<T, W, S> {
    methods! {
        /// Alternating lanes of `self` and `other`: first from the lower halves of the blocks, and then from the upper ones.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let [lo, hi] = u64x4::from([0, 1, 2, 3]).in_blocks().interleave([4, 5, 6, 7]);
        /// assert_eq!((lo.to_array(), hi.to_array()), ([0, 4, 2, 6], [1, 5, 3, 7]));
        /// # } example()
        /// ```
        #[doc(alias("InterleaveLower", "InterleaveUpper", "ZipLower", "ZipUpper", "punpckl", "punpckh", "unpacklo", "unpackhi"))]
        fn interleave[](self, other: impl Operand<T, W, S>) -> [V<S, T, W>; 2] {
            let other = self.0.like(other);
            [self.0.interleave_lower(other), self.0.interleave_upper(other)]
        }
        /// The even lanes of a block of `self` and then of `other`, and the odd ones.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let [even, odd] = u32x8::iota(0).in_blocks().deinterleave(u32x8::iota(10));
        /// assert_eq!(even, [0, 2, 10, 12, 4, 6, 14, 16]);
        /// assert_eq!(odd, [1, 3, 11, 13, 5, 7, 15, 17]);
        /// # } example()
        /// ```
        fn deinterleave[](self, other: impl Operand<T, W, S>) -> [V<S, T, W>; 2] {
            let other = self.0.like(other);
            [self.0.shuffle::<{ p::STRIDE_IN_BLOCK }, 0>(other), self.0.shuffle::<{ p::STRIDE_IN_BLOCK }, 1>(other)]
        }
        /// Each lane plus those before it in its block.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u32x8::splat(2).in_blocks().prefix_sum(), [2, 4, 6, 8, 2, 4, 6, 8]);
        /// # } example()
        /// ```
        fn prefix_sum[](self) -> V<S, T, W> {
            // Only -0.0 changes no sum.
            let (mut v, none) = (self.0, choose! { T::IS_FLOAT => self.0.tag().sign_bit(), _ => self.0.tag().zero() });
            return_if!(S::SSE41 && !S::AVX512VL && !T::IS_FLOAT && T::BITS < 64 && W::BYTES >= 16 && (T::BITS != 16 || S::AVX2 && W::BYTES >= 32), {
                // Shifts of numbers run on other ports than shuffles.
                let carry = always!(|v: V<S, T, W>, n: usize| {
                    let from = always!(|i: usize| if i / n % 2 == 0 { 0x80 } else { (i % 16 / n * n - size_of::<T>() + i % size_of::<T>()) as u8 });
                    v + v.table_lookup_bytes(v.tag().repartition::<u8>().from_fn(from)).bitcast::<T>()
                });
                when!(T::BITS == 8, v += (v.bitcast::<u32>() << 8).bitcast::<T>());
                carry(choose! { T::BITS == 32 => v + (v.bitcast::<u64>() << 32).bitcast::<T>(), _ => carry(v + (v.bitcast::<u32>() << 16).bitcast::<T>(), 4) }, 8)
            });
            macro_rules! step { ($($k:literal)*) => {$(
                when!(W::BYTES / size_of::<T>() > $k && 16 / size_of::<T>() > $k, v += v.in_blocks().shift_elements_right::<$k>(none));
            )*}; }
            step!(1 2 4 8);
            v
        }
        /// The lanes of each block from the last to the first.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u32x8::iota(0).in_blocks().reverse(), [3, 2, 1, 0, 7, 6, 5, 4]);
        /// # } example()
        /// ```
        fn reverse[](self) -> V<S, T, W> {
            match const { (if W::BYTES < 16 { W::BYTES } else { 16 }) / size_of::<T>() } {
                1 => self.0,
                2 => self.0.swap_pairs(),
                4 => self.0.reverse4(),
                8 => self.0.reverse8(),
                _ => self.0.shuffle::<{ p::REVERSE_GROUPS }, 16>(self.0),
            }
        }
        /// Lane `K` of each block, in all lanes of that block.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u32x8::iota(0).in_blocks().splat_lane::<1>(), [1, 1, 1, 1, 5, 5, 5, 5]);
        /// # } example()
        /// ```
        #[doc(alias("Broadcast"))]
        fn splat_lane[const K: usize](self) -> V<S, T, W> { const { assert!(K < 16, "a block has no lane `K`") }; self.0.broadcast::<K>() }
        /// By `K` lanes toward the start of each block. The first lanes of that block of `next` come in.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u32x8::iota(1).in_blocks().shift_elements_left::<1>(0), [2, 3, 4, 0, 6, 7, 8, 0]);
        /// # } example()
        /// ```
        #[doc(alias("ShiftRightLanes", "ShiftRightBytes", "CombineShiftRightBytes", "CombineShiftRightLanes", "palignr", "alignr", "psrldq"))]
        fn shift_elements_left[const K: usize](self, next: impl Operand<T, W, S>) -> V<S, T, W> {
            const { crate::make::Fits::<K>::SHIFT };
            self.0.tag().to_unsigned().combine_shift_right_lanes::<K>(self.0.like(next).bitcast(), self.0.bitcast()).bitcast()
        }
        /// By `K` lanes toward the end of each block. The last lanes of that block of `previous` come in.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u32x8::iota(1).in_blocks().shift_elements_right::<1>(0), [0, 1, 2, 3, 0, 5, 6, 7]);
        /// # } example()
        /// ```
        #[doc(alias("ShiftLeftLanes", "ShiftLeftBytes", "pslldq"))]
        fn shift_elements_right[const K: usize](self, previous: impl Operand<T, W, S>) -> V<S, T, W> {
            const { crate::make::Fits::<K>::SHIFT };
            require!("`K` is more than a block", K * size_of::<T>() <= W::BYTES && K * size_of::<T>() <= 16);
            self.0.bitcast::<T::Unsigned>().shuffle::<{ p::SHIFT_LEFT }, K>(self.0.like(previous).bitcast()).bitcast()
        }
        /// By `K` lanes toward the start of each block. The first lanes become the last.
        fn rotate_elements_left[const K: usize](self) -> V<S, T, W> { const { crate::make::Fits::<K>::SHIFT }; self.shift_elements_left::<K>(self.0) }
        /// By `K` lanes toward the end of each block. The last lanes become the first.
        fn rotate_elements_right[const K: usize](self) -> V<S, T, W> { const { crate::make::Fits::<K>::SHIFT }; self.shift_elements_right::<K>(self.0) }
        /// The sums of adjacent lanes of a block of `self`, and then those of `other`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u32x8::iota(0).in_blocks().add_pairs(u32x8::splat(50)), [1, 5, 100, 100, 9, 13, 100, 100]);
        /// # } example()
        /// ```
        #[doc(alias("PairwiseAdd128", "phadd"))]
        fn add_pairs[](self, other: impl crate::Operand<T, W, S>) -> V<S, T, W> { let other = crate::Operand::vector(other, crate::Tag::new(self.0.s)); self.0.pairwise_add128(other) }
        /// The same with each odd lane less the even one before it.
        #[doc(alias("PairwiseSub128", "phsub"))]
        fn sub_pairs[](self, other: impl crate::Operand<T, W, S>) -> V<S, T, W> { let other = crate::Operand::vector(other, crate::Tag::new(self.0.s)); self.0.pairwise_sub128(other) }
        /// The byte of `self` at each index, modulo the size of a block. From 128 on it is zero.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let digits = u8x32::repeat(b"0123456789abcdef");
        /// assert_eq!(digits.in_blocks().lookup_bytes(u8x32::splat(10)), [b'a'; 32]);
        /// assert_eq!(digits.in_blocks().lookup_bytes(u8x32::splat(128)), [0; 32]);
        /// # } example()
        /// ```
        #[doc(alias("TableLookupBytes", "TableLookupBytesOr0", "pshufb", "shuffle_epi8", "tbl"))]
        fn lookup_bytes[](self, indices: impl Operand<u8, W, S>) -> V<S, T, W> {
            let indices = indices.vector(self.0.tag().repartition());
            if const { S::TABLE_BIAS != 0 && W::BYTES >= 16 } {
                return self.lookup_bytes_relaxed(indices);
            }
            self.lookup_bytes_relaxed(indices & (0x80 | (W::BYTES.min(16) - 1) as u8))
        }
        /// The same, but unspecified for the indices below 128 that are out of range. On Arm this saves an instruction where
        /// the compiler doesn't know the range.
        fn lookup_bytes_relaxed[](self, indices: impl Operand<u8, W, S>) -> V<S, T, W> {
            self.0.table_lookup_bytes(indices.vector(self.0.tag().repartition())).bitcast()
        }
        /// The byte at each index, modulo 32, in a block of `self` followed by that of `other`. It takes 16 bytes or more.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let (lower, upper) = (u8x16::iota(100), u8x16::iota(200));
        /// assert_eq!(lower.in_blocks().concat_lookup_bytes(upper, 17), [201; 16]);
        /// # } example()
        /// ```
        #[doc(alias("tbl2"))]
        fn concat_lookup_bytes[](self, other: impl Operand<T, W, S>, indices: impl Operand<u8, W, S>) -> V<S, T, W> {
            let other = self.0.like(other);
            self.concat_lookup_bytes_relaxed(other, indices.vector(self.0.tag().repartition()) & 31)
        }
        /// The same, but unspecified for an index of 32 and more.
        fn concat_lookup_bytes_relaxed[](self, other: impl Operand<T, W, S>, indices: impl Operand<u8, W, S>) -> V<S, T, W> {
            let other = self.0.like(other);
            return_if!(S::A64 && W::BYTES == 16, self.0.bitcast::<u8>().concat_swizzle_dyn_relaxed(other.bitcast::<u8>(), indices).bitcast());
            self.0.two_tables_lookup_bytes(other, indices.vector(self.0.tag().repartition())).bitcast()
        }
    }
}

/// A vector in which each block is one lane. A vector of less than 16 bytes is one block.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let v = u64x4::from([1, 2, 3, 4]);
/// assert_eq!(v.as_u128s().reverse(), [3, 4, 1, 2]);
/// assert_eq!(v.as_u128s().splat_lane::<1>(), [3, 4, 3, 4]);
/// assert_eq!(v.as_u128s().simd_lt(u64x4::from([0, 3, 9, 3])).to_bitmask(), 0b0011);
/// # } example()
/// ```
pub struct U128s<T: Lane, W: Width, S: Isa>(V<S, T, W>);
/// The same, where only the upper 64 bits count in comparisons: a key and its value.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let (a, b) = (u64x4::from([7, 1, 8, 5]), u64x4::from([9, 2, 6, 3]));
/// assert_eq!(a.as_u128s().by_upper().simd_min(b), [7, 1, 6, 3]);
/// # } example()
/// ```
pub struct ByUpper<W: Width, S: Isa>(V<S, u64, W>);
impl<T: Lane, W: Width, S: Isa> Copy for U128s<T, W, S> {}
impl<T: Lane, W: Width, S: Isa> Clone for U128s<T, W, S> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}
impl<W: Width, S: Isa> Copy for ByUpper<W, S> {}
impl<W: Width, S: Isa> Clone for ByUpper<W, S> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T: Lane, W: Width, S: Isa> U128s<T, W, S> {
    methods! {
        /// The blocks from the last to the first.
        #[doc(alias("ReverseBlocks"))]
        fn reverse[](self) -> V<S, T, W> { self.0.reverse_blocks() }
        /// Swaps the blocks of each pair. One block stays as it is.
        #[doc(alias("SwapAdjacentBlocks"))]
        fn swap_pairs[](self) -> V<S, T, W> { self.0.swap_adjacent_blocks() }
        /// Block `K` in all blocks.
        #[doc(alias("BroadcastBlock"))]
        fn splat_lane[const K: usize](self) -> V<S, T, W> { require!("the vector has no block `K`", K < W::BYTES.div_ceil(16), at any width K < 32); self.0.broadcast_block::<K>() }
        /// Alternating blocks from the lower halves, and from the upper ones. With one block, `self` and `other`.
        #[doc(alias("InterleaveLowerBlocks", "InterleaveUpperBlocks"))]
        fn interleave[](self, other: impl Operand<T, W, S>) -> [V<S, T, W>; 2] {
            let other = self.0.like(other);
            choose! { W::BYTES <= 16 => [self.0, other], _ => [self.0.interleave_lower_blocks(other), self.0.interleave_upper_blocks(other)] }
        }
        /// The even blocks of `self` and `other`, alternating, and the odd ones. With one block, both are `self`.
        #[doc(alias("InterleaveEvenBlocks", "InterleaveOddBlocks"))]
        fn transpose_pairs[](self, other: impl Operand<T, W, S>) -> [V<S, T, W>; 2] {
            let other = self.0.like(other);
            [self.0.interleave_even_blocks(other), self.0.interleave_odd_blocks(other)]
        }
        /// The even blocks of `self` and the odd blocks of `odd`.
        #[doc(alias("OddEvenBlocks"))]
        fn alternate[](self, odd: impl Operand<T, W, S>) -> V<S, T, W> { self.0.like(odd).odd_even_blocks(self.0) }
        /// By `K` blocks toward block 0. The first blocks of `next` come in. More than all blocks is as much as all.
        #[doc(alias("SlideDownBlocks"))]
        fn shift_elements_left[const K: usize](self, next: impl Operand<T, W, S>) -> V<S, T, W> { self.0.slide_down_blocks::<K>(self.0.like(next)) }
        /// By `K` blocks away from block 0. The last blocks of `previous` come in. More than all blocks is as much as all.
        #[doc(alias("SlideUpBlocks"))]
        fn shift_elements_right[const K: usize](self, previous: impl Operand<T, W, S>) -> V<S, T, W> { self.0.slide_up_blocks::<K>(self.0.like(previous)) }
        /// Block `i` of the result is block `source(i)`. See [`swizzle`](Simd::swizzle). It takes 16 bytes or more.
        #[doc(alias("swizzle_blocks"))]
        fn swizzle[](self, source: impl Fn(usize) -> usize) -> V<S, T, W> {
            require!("this takes vectors of 16 bytes or more", W::BYTES >= 16);
            self.0.reinterpret::<u64>().swizzle(#[inline(always)] |i| source(i / 2).saturating_mul(2) | (i % 2)).reinterpret()
        }
        /// [`swizzle`](Self::swizzle) from `self` followed by `other`. The even blocks are `|i| 2 * i`.
        #[doc(alias("concat_swizzle_blocks", "vperm2i128", "vshufi64x2"))]
        fn concat_swizzle[](self, other: impl Operand<T, W, S>, source: impl Fn(usize) -> usize) -> V<S, T, W> {
            require!("this takes vectors of 16 bytes or more", W::BYTES >= 16);
            let other = self.0.like(other);
            self.0.reinterpret::<u64>().concat_swizzle(other.reinterpret(), #[inline(always)] |i| source(i / 2).saturating_mul(2) | (i % 2)).reinterpret()
        }
    }
}

macro_rules! compare { ($([$($of:tt)*] $eq:ident $lt:ident $min:ident $max:ident;)*) => {$(
    impl<W: Width, S: Isa> $($of)* { methods! {
        /// `self == other`. Both lanes of a block of the mask are the same.
        #[doc(alias("Eq128", "Eq128Upper"))]
        fn simd_eq[](self, other: V<S, u64, W>) -> MaskOf<u64, W, S> { self.0.$eq(other) }
        /// `self < other`. The second lane of a block is the more significant.
        #[doc(alias("Lt128", "Lt128Upper"))]
        fn simd_lt[](self, other: V<S, u64, W>) -> MaskOf<u64, W, S> { self.0.$lt(other) }
        /// The smaller number, or else `other`.
        #[doc(alias("Min128", "Min128Upper"))]
        fn simd_min[](self, other: V<S, u64, W>) -> V<S, u64, W> { self.0.$min(other) }
        /// The larger number, or else `other`.
        #[doc(alias("Max128", "Max128Upper"))]
        fn simd_max[](self, other: V<S, u64, W>) -> V<S, u64, W> { self.0.$max(other) }
    } }
)*}; }
compare! {
    [U128s<u64, W, S>] eq128 lt128 min128 max128;
    [ByUpper<W, S>] eq128_upper lt128_upper min128_upper max128_upper;
}

impl<W: Width, S: Isa> U128s<u64, W, S> {
    methods! {
        /// Compares the upper halves only.
        fn by_upper[](self) -> ByUpper<W, S> { ByUpper(self.0) }
    }
}

const fn fits<U, const N: usize>() {
    assert!(N * size_of::<U>() <= 1024, "the table of `lookup` has up to 1024 bytes: `gather_or_default` takes more");
}
