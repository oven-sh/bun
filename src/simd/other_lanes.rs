//! What rustc says of a method that only other lanes or types have. No vector has these traits: rustc finds the name, and prints the message of the bound.

use crate::{HasSign, Isa, Lane, Mask, Output, Signed, Simd, Unsigned, Width};

macro_rules! only { ($all:ident $t:ident $bound:ident; $($of:ident $has:ident $($message:literal $note:literal)?: $($name:ident)*;)*) => {
    $(
        $(
            #[diagnostic::on_unimplemented(message = $message, label = "not for `{Self}`", note = $note)]
            #[doc(hidden)]
            pub trait $of {}
        )?
        #[doc(hidden)]
        #[allow(clippy::wrong_self_convention)]
        pub trait $has { $(fn $name(&self) {})* }
        impl<T: $bound, W: Width, S: Isa> $has for $t<T, W, S> where Self: $of {}
    )*
    pub mod $all { $(#[doc(hidden)] pub use super::$has as _;)* }
}; }
#[diagnostic::on_unimplemented(
    message = "an `Output` is not a slice",
    label = "only for slices",
    note = "`filled()` and `filled_mut()` are what was written. `push`, `try_push`, `push_one` and `push_array` add to it",
    note = "in any order: write to a slice, also of `MaybeUninit`, or to `streams`"
)]
#[doc(hidden)]
pub trait OfSlice {
    type Never;
    fn never(self) -> !;
}
#[doc(hidden)]
impl<T: Copy, I: OfSlice> core::ops::Index<I> for Output<'_, T> {
    type Output = I::Never;
    fn index(&self, at: I) -> &I::Never {
        at.never()
    }
}
/// rustc prints the names.
macro_rules! named { ($($name:ident)*) => { $(#[doc(hidden)] pub trait $name {})* }; }
named!(CallExactOrPaddedFirst ForFloatsSubtractAndTakeAbs TakeAsCellsAndOverAndMapInto TakeSaturatingNarrowOrWrappingNarrow);
macro_rules! iterated { ($($t:ty),*) => {$(
    #[doc(hidden)]
    impl<T: Lane, W: Width, S: Isa, E> Iterator for $t where Self: CallExactOrPaddedFirst {
        type Item = Simd<T, W, S>;
        fn next(&mut self) -> Option<Self::Item> { None }
    }
)*}; }
iterated!(crate::Over<'_, T, W, S, E>, crate::Columns<T, W, S, E>);
#[doc(hidden)]
pub trait ForShared {
    fn exact(&self) {}
    fn interleaved(&self) {}
    fn padded(&self) {}
    fn zip_scaled(&self) {}
}
impl<T: Lane, W: Width, S: Isa> ForShared for crate::OverMut<'_, T, W, S> where Self: TakeAsCellsAndOverAndMapInto {}
only! { of_masks Mask Signed;
    OfVectors ForVectors "this is a method of vectors" "`m.to_simd::<u8>()` has all bits or none in each lane, and `m.select(a, b)` other values":
        bitcast reduce_and reduce_or reduce_sum store store_at store_partial;
    OfCompared ForCompared "masks have operators for this" "equal: `!(a ^ b)`. Selected: `m & a | !m & b`. The last `n`: `!Mask::first_n(LANES - n)`": last_n select_mask simd_eq simd_ne;
}
only! { of_vectors Simd Lane;
    OfNumbers ForNumbers "the operators of vectors wrap" "write `+`, `-`, `*`, `<<` or `>>`":
        wrapping_add wrapping_mul wrapping_neg wrapping_shl wrapping_shr wrapping_sub;
    OfMasks ForMasks "this is a method of masks" "a comparison such as `simd_ne(0)` or `is_negative()` makes one, and so does `to_mask()`":
        first_set last_set none select to_bitmask;
    TakeSaturatingNarrowOrWrappingNarrow ForFloats: narrow;
    ForFloatsSubtractAndTakeAbs ForIntegers: abs_diff;
}
only! { all Simd Lane;
    OfU8 ForU8 "this method is only for lanes of `u8`" "`bitcast::<u8>()` keeps the bits, and `cast::<u8>()` converts the values":
        aes_decrypt aes_decrypt_and aes_encrypt aes_encrypt_and aes_inv_mix_columns aes_key_gen_assist aes_last_round aes_last_round_inv
        aes_round aes_round_inv ascii from_minifloat galois_affine galois_affine_inverse galois_mul saturating_dot;
    OfI16 ForI16 "this method is only for lanes of `i16`" "`bitcast::<i16>()` keeps the bits, and `cast::<i16>()` converts the values":
        cast_mul_q15_add mul_q15 mul_q15_add mul_q15_add_relaxed mul_q15_relaxed saturating_dot_add;
    OfI32 ForI32 "this method is only for lanes of `i32`" "`bitcast::<i32>()` keeps the bits, and `cast::<i32>()` converts the values":
        mul_q31 mul_q31_add mul_q31_add_relaxed mul_q31_relaxed;
    OfFixed ForFixed "this method is only for lanes of `i16` and `i32`" "`cast_signed()` keeps the bits": mul_high_doubled mul_high_doubled_relaxed;
    OfU32 ForU32 "this method is only for lanes of `u32`" "`bitcast::<u32>()` keeps the bits, and `cast::<u32>()` converts the values":
        gather_windows sm4_next_keys sm4_rounds4 widening_mul_even_odd;
    OfU64 ForU64 "this method is only for lanes of `u64`" "`bitcast::<u64>()` keeps the bits, and `cast::<u64>()` converts the values":
        bit_shuffle carryless_dot_add carryless_mul_even carryless_mul_odd mul52_high_add mul52_low_add rotate_bytes_from transpose_bits;
    OfBf16 ForBf16 "this method is only for lanes of `bf16`" "`mat_mul_add` is for bytes": mat_mul_add_relaxed;
    OfDot ForDot "this method is only for lanes of `u8`, `i8`, `i16` and `bf16`" "`dot_add` takes more": dot_add_relaxed;
    Unsigned ForUnsigned:
        bit_planes bit_width borrowing_sub carrying_add deposit_bits div_ceil eq_ignore_ascii_case extract_bits funnel_shl funnel_shr is_ascii
        is_ascii_alphabetic is_ascii_alphanumeric is_ascii_control is_ascii_digit is_ascii_graphic is_ascii_hexdigit is_ascii_lowercase
        is_ascii_octdigit is_ascii_punctuation is_ascii_uppercase is_ascii_whitespace is_power_of_two lookup lookup_or lookup_relaxed low_bytes
        next_power_of_two saturating_add_signed saturating_sub_signed store_low_bytes to_ascii_lowercase to_ascii_uppercase;
    Signed ForSigned: is_positive neg_if_negative_relaxed saturating_abs saturating_add_unsigned saturating_neg saturating_sub_unsigned unsigned_abs;
    HasSign ForHasSign: abs is_negative max_magnitude min_magnitude neg_if_negative signum;
}
