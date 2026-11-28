//! Products for arithmetic with many limbs, and for hashes.

use crate::{Isa, Operand, Simd, Width};

impl<S: Isa, W: Width> Simd<u64, W, S> {
    /// The two halves of the product, each with 52 bits.
    #[op]
    fn mul52(self, other: Self) -> (Self, Self) {
        let both = always!(|| {
            let mask = (1u64 << 26) - 1;
            let mul = always!(|a: Self, b: Self| a.bitcast::<u32>().widening_mul_even(b.bitcast()));
            let (a0, a1, b0, b1) = (self & mask, self >> 26 & mask, other & mask, other >> 26 & mask);
            let middle = mul(a0, b1) + mul(a1, b0);
            let lower = mul(a0, b0) + ((middle & mask) << 26);
            (lower & ((1u64 << 52) - 1), mul(a1, b1) + (middle >> 26) + (lower >> 52))
        });
        // On x86, this makes longer code.
        cfg_select! {
            target_arch = "aarch64" => apart!(self.s, both()),
            _ => both(),
        }
    }
    /// Multiplies the lower 52 bits of `self` and `mul`, and adds the lower 52 bits of the product to `add`.
    /// It is one instruction if `has!(ifma)`, as on `icelake`. Elsewhere both halves take about 20: try `u128`, or `widening_mul_even` with digits of 26 to 32 bits.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let v = u64x2::from([3, 1 << 51]);
    /// assert_eq!((v.mul52_low_add(4, 1).to_array(), v.mul52_high_add(4, 1).to_array()), ([13, 1], [1, 3]));
    /// # } example()
    /// ```
    #[op]
    #[doc(alias("mul_add52_lower", "vpmadd52luq"))]
    pub fn mul52_low_add(self, mul: impl Operand<u64, W, S>, add: impl Operand<u64, W, S>) -> Self {
        let (mul, add) = (self.like(mul), self.like(add));
        if_here!(S::HAS_MUL52, {
            return self.with_bytes(self.s.mul_add52_lower::<W>(self.bytes(), mul.bytes(), add.bytes()));
        });
        add + self.mul52(mul).0
    }
    /// The same with the upper 52 of the 104 bits of the product.
    #[op]
    #[doc(alias("mul_add52_upper", "vpmadd52huq"))]
    pub fn mul52_high_add(self, mul: impl Operand<u64, W, S>, add: impl Operand<u64, W, S>) -> Self {
        let (mul, add) = (self.like(mul), self.like(add));
        if_here!(S::HAS_MUL52, {
            return self.with_bytes(self.s.mul_add52_upper::<W>(self.bytes(), mul.bytes(), add.bytes()));
        });
        add + self.mul52(mul).1
    }
}

impl<S: Isa, W: Width> Simd<u32, W, S> {
    /// The products of the even lanes of `self` and the odd lanes of `other`, as in XXH3 and HighwayHash.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u32x4::from([2, 0, 3, 0]).widening_mul_even_odd(u32x4::from([0, 10, 0, 100])), [20, 300]);
    /// # } example()
    /// ```
    #[op]
    #[doc(alias("mul_even_odd"))]
    #[track_caller]
    pub fn widening_mul_even_odd(self, other: impl crate::Operand<u32, W, S>) -> Simd<u64, W, S> {
        let other = crate::Operand::vector(other, crate::Tag::new(self.s));
        require!("this takes two lanes or more", W::BYTES >= 8);
        self.with_bytes(self.s.mul_even_odd_u32::<W>(self.bytes(), other.bytes()))
    }
}
