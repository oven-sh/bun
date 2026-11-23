//! Masks and comparisons.

use crate::lane::Kind;
use crate::pattern as p;
use crate::raw::{Raw, RawMask};
use crate::{Isa, Keep, Lane, MaskOf, Operand, Scaled, Signed, Simd, Tag, Width};
use core::ops::RangeInclusive;

macro_rules! makers {
    ($then:ident $target:ident) => {
        crate::masks::$then! { $target;
            /// The same in all lanes.
            #[doc(alias("SetMask", "MaskFalse", "MaskTrue"))]
            splat mask_splat(value: bool) = set_mask;
            /// True in the first `n` lanes. `n` can be more than there are.
            #[doc(alias("FirstN", "tail_mask"))]
            first_n mask_first_n(n: usize) = first_n;
            /// Lane `i` is bit `i`.
            #[doc(alias("LoadMaskBits", "from_bits", "bitmap"))]
            from_bitmask mask_from_bitmask(bits: u64) = mask_from_number;
            /// Lane `i` is bit `i % 8` of byte `i / 8`, for any number of lanes. Panics if there are too few bytes.
            #[doc(alias("LoadMaskBits", "load_mask_bits", "bitmap"))]
            load_bitmask mask_load_bitmask(from: &(impl crate::Slice<Item = u8> + ?Sized)) = load_mask_bits;
            /// Lane `i` is `lanes[i]`.
            from_array mask_from_array(lanes: crate::Bools<T, W>) = mask_from_array;
            /// The same bits for each block.
            #[doc(alias("Dup128MaskFromMaskBits"))]
            repeat_bitmask mask_repeat_bitmask(bits: u64) = dup128_mask_from_bits;
        }
    };
}
#[rules]
macro_rules! types { ($table:ident; $($(#[$m:meta])* $name:ident $token:ident($a:ident: $t:ty) = $tag:ident;)*) => {
    crate::make::enabled! { $table $([$(#[$m])*] { pub fn $name($a: $t) -> Self where crate::Code: crate::At<S> { W::${concat(make_, $token)}(crate::make::Own(S::here()), $a) } })* }
}; }
#[rules]
macro_rules! widths { ($target:ident; $($(#[$m:meta])* $name:ident $token:ident($a:ident: $t:ty) = $tag:ident;)*) => {$(
    #[op]
    fn ${concat(make_, $token)}<S: Isa, T: crate::Signed, W: Width>(s: Own<S>, $a: $t) -> crate::mask::Mask<T, W, S> { Tag::<S, T, W>::new(s.0).$tag($a) }
)*}; }
macro_rules! tokens { ($target:ident; $($(#[$m:meta])* $name:ident $token:ident($a:ident: $t:ty) = $tag:ident;)*) => {$(
    #[op]
    fn $token<T: crate::Signed, W: crate::Width>(self, $a: $t) -> crate::Mask<T, W, Self> { crate::Tag::<Self, T, W>::new(self).$tag($a) }
)*}; }
macro_rules! shapes { ($then:ident) => {
    crate::masks::$then! {
        i8 mask8xN: B2 2 mask8x2, B4 4 mask8x4, B8 8 mask8x8, B16 16 mask8x16, B32 32 mask8x32, B64 64 mask8x64;
        i16 mask16xN: B2 1 mask16x1, B4 2 mask16x2, B8 4 mask16x4, B16 8 mask16x8, B32 16 mask16x16, B64 32 mask16x32, B128 64 mask16x64;
        i32 mask32xN: B4 1 mask32x1, B8 2 mask32x2, B16 4 mask32x4, B32 8 mask32x8, B64 16 mask32x16, B128 32 mask32x32, B256 64 mask32x64;
        i64 mask64xN: B8 1 mask64x1, B16 2 mask64x2, B32 4 mask64x4, B64 8 mask64x8, B128 16 mask64x16, B256 32 mask64x32, B512 64 mask64x64;
    }
}; }
/// In `WithToken`.
macro_rules! on_token { () => { crate::masks::makers!(tokens none); }; }
pub(crate) use crate::native::native_masks;
pub(crate) use {makers, on_token, shapes, tokens, types, widths};
makers!(types of_masks);

impl<S: Isa, T: crate::Signed, W: Width> crate::mask::Mask<T, W, S> {
    #[doc(hidden)]
    #[inline(always)]
    pub fn isa(self) -> S {
        self.s
    }
    /// Whether lane `i` is true. Panics if there is no such lane.
    #[op]
    #[track_caller]
    pub fn test(self, i: usize) -> bool {
        assert!(i < Self::LANES);
        halves_if!(Self::LANES > 64, |this: Self = self, i: usize = i| {
            this.parts::<W>()[i / (Self::LANES / 2)].test(i % (Self::LANES / 2))
        });
        let (bits, per_lane) = self.wide_bits();
        bits >> (i as u32 * per_lane) & 1 == 1
    }
    /// The lanes of `yes` where the mask is true, and those of `no` elsewhere.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let v = u8x4::from(b"aBcD");
    /// assert_eq!(v.within(b'A'..=b'Z').select(v | 0x20, v), *b"abcd");
    /// # } example()
    /// ```
    #[doc(alias("IfThenElse", "IfThenElseZero", "IfThenZeroElse", "blend"))]
    #[inline(always)]
    pub fn select<U>(self, yes: impl Operand<U, W, S>, no: impl Operand<U, W, S>) -> Simd<U, W, S>
    where
        U: crate::SameSize<T>, // m.cast() is a mask for lanes of another size. Numbers: 1u8, 1.0f32.
    {
        apart!(self.s, {
            let mask = self;
            // LLVM makes three instructions of `bsl` with that constant.
            if_here!(S::A64 && !U::IS_FLOAT, {
                let ones = always!(|it: Option<U>| matches!(it, Some(it) if is_known!(it) && it == U::from_i64(-1)));
                if ones(Operand::number(no)) {
                    return !mask.to_simd::<U>() | yes;
                }
                if ones(Operand::number(yes)) {
                    return mask.to_simd::<U>() | no;
                }
            });
            // That is `to_simd`, with its barrier.
            if_here!(
                crate::X86
                    && crate::OPTIMIZED
                    && Self::IS_BITS
                    && W::BYTES >= 16
                    && W::BYTES <= 64
                    && !U::IS_FLOAT
                    && size_of::<U>() <= 2,
                {
                    if matches!(Operand::number(no), Some(it) if crate::arithmetic::known(it == U::from_i64(-1)))
                        && crate::arithmetic::known(
                            yes.vector(crate::Tag::new(mask.isa())).simd_eq(U::from_i64(0)).all(),
                        )
                    {
                        return (!mask).to_simd();
                    }
                }
            );
            if crate::hints::zero(crate::Operand::number(no)) {
                // As in `to_simd`.
                if_here!(crate::X86 && crate::OPTIMIZED && Self::IS_BITS && W::BYTES == 64 && !U::IS_FLOAT, {
                    if matches!(Operand::number(yes), Some(it) if crate::arithmetic::known(it == U::ONE || it == U::from_i64(-1)))
                    {
                        return mask.if_then_else_zero(yes.vector(crate::Tag::new(mask.isa())).unseen()).barrier();
                    }
                });
                mask.in_register::<true>().if_then_else_zero(yes)
            } else if crate::hints::zero(crate::Operand::number(yes)) {
                mask.in_register::<true>().if_then_zero_else(no)
            } else {
                // For speed.
                return_if!(crate::X86 && crate::OPTIMIZED && Self::IS_BITS && W::BYTES == 64 && !U::IS_FLOAT, {
                    let d = crate::Tag::new(mask.isa());
                    let (yes, no, bits) = (yes.vector(d), no.vector(d), mask.own_bits());
                    let known = crate::arithmetic::known(yes.simd_lt(no).own_bits() == bits)
                        | crate::arithmetic::known(yes.simd_gt(no).own_bits() == bits);
                    mask.in_register::<false>()
                        .if_then_else(core::hint::select_unpredictable(known, yes, yes.barrier_unless_known()), no)
                });
                mask.if_then_else_whole(yes, no).stored_whole()
            }
        })
    }
    /// All bits are set in the lanes that are true. They have any type of this size, which has to be named if a method follows.
    /// `sum - m.to_simd()` counts. For `m.to_simd() & v`, `m.select(v, 0)` is as fast or faster.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(mask16x4::first_n(1).to_simd::<i16>(), [-1, 0, 0, 0]);
    /// # } example()
    /// ```
    #[doc(alias("VecFromMask", "to_int", "to_vector"))]
    #[op]
    pub fn to_simd<U>(self) -> Simd<U, W, S>
    where
        U: crate::SameSize<T>, // m.cast() is a mask for lanes of another size.
    {
        // `vpmovm2b` and `vpmovm2w` wait for their destination from Sapphire Rapids on, and `sum - m.to_simd()` is one masked instruction.
        // Below 64 bytes, most comparisons can give a vector.
        // LLVM would make masked instructions of `&`, which take 3 cycles for small lanes on Intel.
        return_if!(crate::X86 && S::REGISTER == 64 && W::BYTES == 64, |this: Self = self| {
            this.if_then_else_zero(this.tag().hidden_ones()).barrier().bitcast()
        });
        if_here!(crate::X86 && Self::BOTH, {
            if let Some(v) = live!(Self::BOTH, self.whole()) {
                return v.bitcast();
            }
        });
        return_if!(crate::X86 && S::REGISTER == 64 && W::BYTES >= 16 && W::BYTES < 64, |this: Self = self| this.to_vector().barrier_unless_known().bitcast());
        self.to_vector().bitcast()
    }
    /// The same booleans for lanes of another size. It needs the prelude, and outside of marked code the type.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (bytes, floats) = (u8x4::from(b"a b "), f32x4::from([1.0, 2.0, 3.0, 4.0]));
    /// assert_eq!(bytes.simd_eq(b' ').cast().select(0.0, floats), [1.0, 0.0, 3.0, 0.0]);
    /// assert_eq!(bytes.simd_eq(b' ').cast::<f32>(), mask32x4::from_bitmask(0b1010));
    /// # } example()
    /// ```
    #[doc(alias("RebindMask", "PromoteMaskTo", "DemoteMaskTo"))]
    #[cfg(doc)]
    pub fn cast<U: Lane>(self) -> MaskOf<U, Scaled<T, U, W>, S> {
        self.rebind::<U>()
    }
    #[op]
    #[track_caller]
    pub(crate) fn rebind<U: Lane>(self) -> MaskOf<U, Scaled<T, U, W>, S> {
        require!(
            "there is no vector with as many lanes of that type: the widths are 2 to 512 bytes",
            MaskOf::<U, Scaled<T, U, W>, S>::LANES == Self::LANES
        );
        if const { size_of::<U>() == size_of::<T>() } {
            return crate::raw::same(self);
        }
        return_if!(Self::IS_BITS && Self::LANES <= 64 && Scaled::<T, U, W>::BYTES > 64 && !cfg!(all(target_arch = "x86", not(miri))), |this: Self = self| {
            Tag::<S, U, _>::new(this.s).mask_from_bits(this.own_bits())
        });
        halves_if!(W::BYTES > 64, |this: Self = self| {
            let [lower, upper] = this.parts::<W>();
            crate::Mask::join(lower.rebind::<U>(), upper.rebind::<U>())
        });
        // One shuffle for each register. LLVM widens in steps.
        return_if!(S::AVX2 && S::REGISTER == 32 && W::BYTES == 16 && size_of::<U>() >= 4 * size_of::<T>(), |this: Self = self| {
            let (d, v) = (this.s.fixed::<u8, crate::B32>(), this.s.fixed::<u8, crate::B16>().resize_bitcast(this.to_vector()));
            let at = always!(|i: u8| crate::Mask::<U::Signed, crate::B32, S>::from_full(d.combine(v, v).table_lookup_bytes((d.iota(32 * i) >> size_of::<U>().ilog2()) << size_of::<T>().ilog2())));
            let two = always!(|i: u8| crate::Mask::<U::Signed, crate::B64, S>::join(at(i), at(i + 1)));
            choose! { size_of::<U>() == 4 * size_of::<T>() => crate::raw::same(two(0)), _ => crate::raw::same(crate::Mask::<U::Signed, crate::B128, S>::join(two(0), two(2))) }
        });
        halves_if!(Scaled::<T, U, W>::BYTES > 64, |this: Self = self| {
            let [lower, upper] = this.parts::<Scaled<T, U, W>>();
            crate::Mask::join(lower.rebind::<U>(), upper.rebind::<U>())
        });
        return_if!(S::A64 && W::BYTES <= 16 && Self::LANES * size_of::<U>() <= 16, |this: Self = self| {
            crate::mask::Mask::from_full(this.to_vector().cast::<U::Signed>().resize::<Scaled<T, U, W>>())
        });
        crate::mask::Mask::new(self.s, self.raw().convert::<_, { p::REPEAT }, 0, _>(self.raw()))
    }
    /// The first half of the lanes, and the second.
    #[doc(alias("LowerHalfOfMask", "UpperHalfOfMask"))]
    #[op]
    #[track_caller]
    pub fn split(self) -> [MaskOf<T, W::Half, S>; 2] {
        require!(
            "one lane has no halves, and there is no vector of less than 2 bytes",
            Self::LANES > 1 && W::BYTES > 2
        );
        [self.lower_half(), self.upper_half()]
    }
    /// The lanes of `self`, and then those of `hi`. It doesn't build if the width is [`B512`](crate::B512).
    #[doc(alias("CombineMasks", "join"))]
    #[op]
    #[track_caller]
    pub fn concat(self, hi: Self) -> MaskOf<T, W::Twice, S> {
        require!("there is no vector of more than 512 bytes", W::BYTES < 512);
        crate::mask::Mask::combine(crate::raw::same(hi), crate::raw::same(self))
    }
    /// The lanes of `self` and then those of `hi`, for lanes that are half as wide.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(mask16x4::first_n(1).narrow(mask16x4::first_n(2)).to_bitmask(), 0b0011_0001);
    /// # } example()
    /// ```
    #[doc(alias("OrderedDemote2MasksTo"))]
    #[op]
    #[track_caller]
    pub fn narrow(self, hi: Self) -> MaskOf<T::Narrow, W, S> {
        Tag::<S, T::Narrow, W>::new(self.s).ordered_demote2_masks_to::<T>(self, hi)
    }
    /// By `K` lanes toward lane 0. The first lanes of `next` come in, which is a mask or a `bool`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(mask8x4::from_bitmask(0b0110).shift_elements_left::<1>(true).to_bitmask(), 0b1011);
    /// # } example()
    /// ```
    #[doc(alias("SlideMask1Down", "next"))]
    #[op]
    #[track_caller]
    pub fn shift_elements_left<const K: usize>(self, next: impl Keep<T, W, S>) -> Self {
        require!("`K` is more than the number of lanes", K <= Self::LANES, at any width K <= 512);
        if let Some(fill) = Keep::same(next) {
            return if fill { !(!self).slide_down::<K>() } else { self.slide_down::<K>() };
        }
        let next = Keep::as_mask(next, self.s);
        return_if!(Self::IS_BITS && Self::LANES <= 64, self.slide_down_lanes(K) | next.slide_up_lanes(Self::LANES - K));
        Self::from_full(self.to_move().shift_elements_left::<K>(next.to_move()))
    }
    /// By `K` lanes away from lane 0. The last lanes of `previous` come in, which is a mask or a `bool`. In a loop, this tells what was true of the value before.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(mask8x4::from_bitmask(0b0110).shift_elements_right::<1>(false).to_bitmask(), 0b1100);
    /// let (previous, letters) = (u8x4::from(b"a bc").is_ascii_alphabetic(), u8x4::from(b"d ef").is_ascii_alphabetic());
    /// let starts = letters & !letters.shift_elements_right::<1>(previous);
    /// assert_eq!(starts.to_bitmask(), 0b0100);
    /// # } example()
    /// ```
    #[doc(alias("SlideMask1Up", "prev", "previous", "carry"))]
    #[op]
    #[track_caller]
    pub fn shift_elements_right<const K: usize>(self, previous: impl Keep<T, W, S>) -> Self {
        require!("`K` is more than the number of lanes", K <= Self::LANES, at any width K <= 512);
        if let Some(fill) = Keep::same(previous) {
            return if fill { !(!self).slide_up::<K>() } else { self.slide_up::<K>() };
        }
        let previous = Keep::as_mask(previous, self.s);
        return_if!(
            Self::IS_BITS && Self::LANES <= 64,
            self.slide_up_lanes(K) | previous.slide_down_lanes(Self::LANES - K)
        );
        Self::from_full(self.to_move().shift_elements_right::<K>(previous.to_move()))
    }
    /// [`shift_elements_left`](Self::shift_elements_left) by a number that is known only at run time. More than all lanes is as much as all.
    #[doc(alias("SlideMaskDownLanes"))]
    #[op]
    #[track_caller]
    pub fn shift_elements_left_dyn(self, n: usize, next: impl Keep<T, W, S>) -> Self {
        if let Some(fill) = Keep::same(next) {
            return if fill { !(!self).slide_out(n) } else { self.slide_out(n) };
        }
        self.slide_down_lanes(n) | Keep::as_mask(next, self.s).slide_up_lanes(Self::LANES.saturating_sub(n))
    }
    /// [`shift_elements_right`](Self::shift_elements_right) by a number that is known only at run time. More than all lanes is as much as all.
    #[doc(alias("SlideMaskUpLanes"))]
    #[op]
    #[track_caller]
    pub fn shift_elements_right_dyn(self, n: usize, previous: impl Keep<T, W, S>) -> Self {
        if let Some(fill) = Keep::same(previous) {
            return if fill { !(!self).slide_up_lanes(n) } else { self.slide_up_lanes(n) };
        }
        self.slide_up_lanes(n) | Keep::as_mask(previous, self.s).slide_down_lanes(Self::LANES.saturating_sub(n))
    }
}

/// In `m.cast::<u8>()`, `R` follows from `U`. In `m.cast()`, `U` is `R`, as rustc tries the bounds of `Isa` and `Signed` before the impl.
#[cfg_attr(doc, doc(hidden))]
pub trait CastMask<T: Signed, R: Signed, W: Width, S: Isa> {
    /// The same booleans for lanes of another size.
    #[track_caller]
    fn cast</* as in m.cast::<u8>() */ U: Lane<Signed = R>>(self) -> crate::Mask<R, Scaled<T, U, W>, S>
    where
        S: MaskOfLanes<U, R>,
        R: MaskOfLanes<U, R>;
}
impl<T: Signed, R: Signed, W: Width, S: Isa> CastMask<T, R, W, S> for crate::Mask<T, W, S> {
    #[inline(always)]
    fn cast<U: Lane<Signed = R>>(self) -> crate::Mask<R, Scaled<T, U, W>, S> {
        self.rebind::<U>()
    }
}
pub trait MaskOfLanes<U, R> {}
impl<X, U, R> MaskOfLanes<U, R> for X {}
pub trait Masks: MaskOfLanes<i8, i8> + MaskOfLanes<i16, i16> + MaskOfLanes<i32, i32> + MaskOfLanes<i64, i64> {}
impl<S> Masks for S {}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// True where the lane is in `first..=last`. A range whose end is below its start is empty, and NaN is in none. It takes one instruction less if the
    /// compiler can tell that it isn't, from constants or from a test before the loop.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::from(b"a1z9").within(b'0'..=b'9').to_bitmask(), 0b1010);
    /// # } example()
    /// ```
    #[doc(alias("in_range", "contains", "between"))]
    #[inline(always)]
    pub fn within(self, range: RangeInclusive<impl Operand<T, W, S>>) -> MaskOf<T, W, S> {
        apart_unoptimized!(self.s, {
            let (first, last) = (self.like(*range.start()), self.like(*range.end()));
            return_if!(
                matches!(T::KIND, Kind::Float) || crate::Tag::<S, T, W>::PACKED,
                self.simd_ge(first) & self.simd_le(last)
            );
            return_if!(
                crate::Tag::<S, T::Unsigned, W>::PACKED,
                self.simd_max_relaxed(first).simd_eq(self.simd_min_relaxed(last))
            );
            let inside: MaskOf<T, W, S> = self.bitcast::<T::Unsigned>().in_range(first.bitcast(), last.bitcast());
            let ordered = match (Operand::number(*range.start()), Operand::number(*range.end())) {
                (Some(first), Some(last)) => first <= last,
                _ => first.raw.le(last.raw).all(),
            };
            if crate::arithmetic::known(ordered) {
                return inside;
            }
            // LLVM packs a mask that it moves out of a loop, and all those next to it.
            return_if!(
                (S::SSE41 || S::WASM) && !MaskOf::<T, W, S>::IS_BITS && T::BITS < 64,
                self.simd_max_relaxed(first).simd_eq(self.simd_min_relaxed(last))
            );
            return_if!((S::SSE41 || S::NEON) && !MaskOf::<T, W, S>::IS_BITS, self.simd_ge(first) & self.simd_le(last));
            return_if!(crate::X86 && MaskOf::<T, W, S>::IS_BITS, self.simd_ge(first) & self.simd_le(last));
            inside & first.simd_le(last)
        })
    }
}

/// For callers without the features of the target, as derives and the functions of slices are.
macro_rules! entered {
    ($e:expr) => {
        if const { S::COMPILED_FOR || !crate::OPTIMIZED } { $e } else { S::here().short_call(always!(|| $e)) }
    };
}
/// Whether all lanes are equal. `v == 0` is `AllBits0`, and `v == !0` is `AllBits1`.
impl<S: Isa, T: Lane, W: Width, O: Operand<T, W, S>> PartialEq<O> for Simd<T, W, S> {
    #[op]
    fn eq(&self, other: &O) -> bool {
        entered!(
            choose! { matches!(T::KIND, Kind::Float) => self.simd_eq(*other).all(), _ => (*self ^ *other).is_zero() }
        )
    }
}
impl<S: Isa, T: crate::Int, W: Width> Eq for Simd<T, W, S> {}
impl<S: Isa, T: crate::Signed, W: Width> PartialEq for crate::mask::Mask<T, W, S> {
    #[op]
    fn eq(&self, other: &Self) -> bool {
        entered!((*self ^ *other).none())
    }
}
impl<S: Isa, T: crate::Signed, W: Width> Eq for crate::mask::Mask<T, W, S> {}
