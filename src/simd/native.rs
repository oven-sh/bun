//! Shared by x86-64 and AArch64.
use crate::{Int, Isa, SharedOutU8, SharedU8, Vector, portable, vector::to_array};
use bun_simd_trusted::shared::{load4, load8, load16, store4, store8, store16};
use bun_simd_trusted::{from_array, opaque16};
use core::simd::{Simd, u8x64};

/// Panics unless `bytes` has `K * N` bytes.
#[inline(always)]
pub(crate) fn as_group<B, const N: usize, const K: usize>(bytes: &[B]) -> &[[B; N]; K] {
    bytes.as_chunks().0.as_array().unwrap()
}

#[inline]
#[cfg_attr(target_arch = "x86_64", target_feature(enable = "sse2"))]
#[cfg_attr(target_arch = "aarch64", target_feature(enable = "neon"))]
pub(crate) fn load_shared<A, const K: usize, const AT: usize>(from: &[SharedU8]) -> u8x64 {
    match const { size_of::<A>() } {
        16 => load16::<K, AT>(as_group(from)).resize(0),
        8 => from_array(load8::<K, AT>(as_group(from)).to_ne_bytes()).resize(0),
        4 => from_array(load4::<K, AT>(as_group(from)).to_ne_bytes()).resize(0),
        _ => portable::load_shared::<A, K, AT>(from),
    }
}

#[inline]
#[cfg_attr(target_arch = "x86_64", target_feature(enable = "sse2"))]
#[cfg_attr(target_arch = "aarch64", target_feature(enable = "neon"))]
pub(crate) fn store_shared<const N: usize, const K: usize, const AT: usize>(
    v: Simd<u8, N>,
    to: &[SharedOutU8],
) {
    match N {
        16 => store16::<K, AT>(v.resize(0), as_group(to)),
        8 => store8::<K, AT>(u64::from_ne_bytes(to_array(v.resize(0))), as_group(to)),
        4 => store4::<K, AT>(u32::from_ne_bytes(to_array(v.resize(0))), as_group(to)),
        _ => portable::store_shared::<N, K, AT>(v, to),
    }
}

#[inline(always)]
pub(crate) fn opaque_lanes<T: Int<N>, const N: usize, I: Isa>(
    v: Vector<T, N, I>,
) -> Vector<T, N, I> {
    Vector::from_first_bytes::<16>(opaque16(v.first_bytes()))
}

#[repr(align(32))]
pub(crate) struct Aligned<T>(pub(crate) T);

/// For `compress`: where part `i` of a vector comes from, with `parts` in each lane.
pub(crate) const fn kept_part(mut bits: usize, i: usize, parts: usize) -> usize {
    let mut lane = 0;
    while lane < i / parts {
        (bits, lane) = (bits & bits.wrapping_sub(1), lane + 1);
    }
    bits.trailing_zeros() as usize % 4 * parts + i % parts
}

/// The 256-bit ops of a target with 128-bit registers.
macro_rules! x256_in_halves {
    ($feature:literal) => {
        crate::native::x256_in_halves! {
            $feature
            U8::lookup(self: U8, indices: U8) -> U8
            U8::lookup2(self: U8, upper: U8, indices: U8) -> U8
            U8::pack(first: I16, second: I16) -> U8
            I8::pack(first: I16, second: I16) -> I8
            U16::sums_of_2(bytes: U8) -> U16
            I16::pack(first: I32, second: I32) -> I16
            I16::mul_q15(self: I16, other: I16) -> I16
            I16::mul_high(self: I16, other: I16) -> I16
            I16::mul_sign(self: I16, sign: I16) -> I16
            I16::saturating_pairwise_dot(a: U8, b: I8) -> I16
            I32::pairwise_dot(a: I16, b: I16) -> I32
            U64::sums_of_8(bytes: U8) -> U64
            F32::to_i32(self: F32) -> I32
            F32::mul_add(self: F32, a: F32, b: F32) -> F32
        }

        impl x256::U64 {
            #[inline]
            #[target_feature(enable = $feature)]
            pub fn compress(self, bits: usize) -> Self {
                use {crate::native::{Aligned, kept_part}, core::array::from_fn};
                // The third and the fourth lane that are kept come from the second half.
                static BYTES: Aligned<[[u8; 32]; 16]> = Aligned(from_fn(const |bits| {
                    from_fn(const |i| kept_part(bits, i, 8) as u8 % if i < 16 { 32 } else { 16 })
                }));
                let [first, second] = self.bitcast::<x256::U8>().halves();
                let [a, b] = x256::U8::from_array(BYTES.0[bits % 16]).halves();
                x256::U8::from_halves([first.lookup2(second, a), second.lookup(b)]).bitcast()
            }
        }

        impl x256::U8 {
            #[inline]
            #[target_feature(enable = $feature)]
            pub fn saturating_narrow(first: x256::I16, second: x256::I16) -> Self {
                let ([a, b], [c, d]) = (first.halves(), second.halves());
                Self::from_halves([x128::U8::pack(a, b), x128::U8::pack(c, d)])
            }
        }
    };
    ($feature:literal $($T:ident::$op:ident($($v:ident: $V:ident),*) -> $R:ident)+) => {$(
        impl x256::$T {
            #[inline]
            #[target_feature(enable = $feature)]
            pub fn $op($($v: x256::$V),*) -> x256::$R {
                x256::$R::from_halves([
                    x128::$T::$op($($v.halves()[0]),*),
                    x128::$T::$op($($v.halves()[1]),*),
                ])
            }
        }
    )+};
}
pub(crate) use x256_in_halves;
