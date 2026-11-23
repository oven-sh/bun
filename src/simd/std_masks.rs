//! What `std::simd::Mask` has, and is made of other operations.

use crate::mask::Mask;
use crate::multiply::fns;
use crate::raw::{Raw, RawOf, same};
use crate::{Bools, Isa, Lane, Scaled, Signed, Tag, Width};

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    #[op]
    pub(crate) fn mask_from_array(self, lanes: Bools<T, W>) -> crate::MaskOf<T, W, S> {
        return_if!(Self::LANES == 1, self.set_mask(lanes[0]));
        let bytes = self.simd().fixed::<u8, Scaled<T, u8, W>>().from_fn(
            #[inline(always)]
            |i| lanes[i] as u8,
        );
        same(bytes.simd_eq(1).rebind::<T::Signed>())
    }
}

impl<S: Isa, T: Signed, W: Width> Mask<T, W, S> {
    const AS_BITS: bool = Self::IS_BITS && Self::LANES <= 64;
    /// The way through vectors takes six to eight steps on one port.
    const BY_PDEP: bool =
        Self::IS_BITS && cfg!(target_arch = "x86_64") && size_of::<T>() <= 2 && W::BYTES >= 16 && W::BYTES <= 64;

    /// Makes lane `i` true or false. Panics if there is no such lane.
    #[op]
    #[track_caller]
    pub fn set(&mut self, i: usize, value: bool) {
        assert!(i < Self::LANES);
        *self = if const { Self::AS_BITS } {
            *self ^ (*self ^ self.tag().set_mask(value)) & self.tag().mask_from_bits(1 << i)
        } else {
            Self::from_full(self.to_vector().with_lane_dyn(i, T::from_i64(-(value as i64))))
        }
    }
    /// Cuts the mask, or extends it with lanes that are false.
    #[op]
    #[track_caller]
    pub fn resize<X: Width>(self) -> Mask<T, X, S> {
        return_if!(W::BYTES == X::BYTES && W::BYTES > 32, crate::raw::same(self));
        return_if!(Self::AS_BITS && Mask::<T, X, S>::AS_BITS, |this: Self = self| {
            this.s.fixed::<T, X>().mask_from_number(crate::regs::word(this.own_bits()))
        });
        Mask::from_full(self.to_vector().resize())
    }
    /// Toward lane 0. The first `K` lanes become the last.
    #[op]
    pub fn rotate_elements_left<const K: usize>(self) -> Self {
        return_if!(Self::AS_BITS, self.rotate_bits(K % Self::LANES));
        Self::from_full(self.to_vector().rotate_elements_left::<K>())
    }
    /// Away from lane 0. The last `K` lanes become the first.
    #[op]
    pub fn rotate_elements_right<const K: usize>(self) -> Self {
        return_if!(Self::AS_BITS, self.rotate_bits((Self::LANES - K % Self::LANES) % Self::LANES));
        Self::from_full(self.to_vector().rotate_elements_right::<K>())
    }
    #[op]
    fn rotate_bits(self, n: usize) -> Self {
        if n == 0 { self } else { self.slide_down_lanes(n) | self.slide_up_lanes(Self::LANES - n) }
    }
    /// Lane `i` is lane `source(i)`. See [`Simd::swizzle`](crate::Simd::swizzle).
    #[doc(alias("swizzle_mask"))]
    #[op]
    pub fn swizzle(self, source: impl Fn(usize) -> usize) -> Self {
        Self::from_full(self.to_vector().swizzle(source))
    }

    fns! {
        /// A `bool` for each lane.
        fn to_array(self) -> Bools<T, W> {
            return_if!(Self::LANES == 1, RawOf::<T, W>::bools(#[inline(always)] |_| self.any()));
            let bytes = (self.rebind::<i8>().to_simd::<u8>() & 1).to_array();
            RawOf::<T, W>::bools(#[inline(always)] |i| bytes[i] & 1 != 0)
        }
        /// The lanes from the last to the first.
        fn reverse(self) -> Self {
            let v = self.to_vector();
            // LLVM reverses the bits of `to_bitmask` instead.
            return_if!(S::A64 && W::BYTES == 16 && T::BITS > 8, Self::from_full(crate::Simd::<T, W, S>::new(v.s, v.raw.shuffle::<_, { crate::pattern::REVERSE }, 0>(v.raw))));
            Self::from_full(v.reverse())
        }
        /// Alternating lanes of `self` and `other`: first from their lower halves, and then from the upper ones.
        fn interleave(self, other: Self) -> [Self; 2] {
            return_if!(Self::BY_PDEP, |this: Self = self, other: Self = other| {
                let (s, a, b, even) = (this.isa(), this.to_bitmask(), other.to_bitmask(), 0x5555_5555_5555_5555 >> (64 - Self::LANES));
                let from = always!(|i: usize| Self::from_bits(s, s.deposit(a >> i, even) | s.deposit(b >> i, even << 1)));
                [from(0), from(Self::LANES / 2)]
            });
            let [lower, upper] = self.to_vector().interleave(other.to_vector());
            [Self::from_full(lower), Self::from_full(upper)]
        }
        /// The even lanes of `self` and then of `other`, and the odd ones.
        fn deinterleave(self, other: Self) -> [Self; 2] {
            return_if!(Self::BY_PDEP, |this: Self = self, other: Self = other| {
                let (s, a, b, even) = (this.isa(), this.to_bitmask(), other.to_bitmask(), 0x5555_5555_5555_5555 >> (64 - Self::LANES));
                let these = always!(|at: u64| Self::from_bits(s, s.extract(a, at) | s.extract(b, at) << (Self::LANES / 2)));
                [these(even), these(even << 1)]
            });
            let [even, odd] = self.to_vector().deinterleave(other.to_vector());
            [Self::from_full(even), Self::from_full(odd)]
        }
    }
}
