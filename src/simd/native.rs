//! The names of the target, once. rustc infers the parameter `S` from the where clause of the caller.
use crate::{Isa, Lane, Signed, Width};

/// The clause always holds. It guides inference: rustc takes a where clause of the caller before an impl. Without one, nothing tells S.
/// The names are for that message.
pub struct ThisFunction;
pub trait NeedsAttributeSimdOrKernel<S> {}
impl<S: Isa> NeedsAttributeSimdOrKernel<S> for ThisFunction {}
impl NeedsAttributeSimdOrKernel<crate::Outside> for ThisFunction {}
pub struct OrTheOneThatItCallsNeedsKernelOrShared;
impl NeedsAttributeSimdOrKernel<OrTheOneThatItCallsNeedsKernelOrShared> for ThisFunction {}
pub(crate) use {NeedsAttributeSimdOrKernel as On, ThisFunction as Code};
/// The name is for the message on `u8xN::load`.
pub trait KnownWithAttributeSimdOrKernel {
    type Native;
}
impl<S: Isa> KnownWithAttributeSimdOrKernel for S {
    type Native = S::Native;
}
#[cfg(doc)]
use Isa as Known;
#[cfg(not(doc))]
use KnownWithAttributeSimdOrKernel as Known;
/// For `has!`.
pub const fn target<S: Isa>() -> crate::Target
where
    Code: On<S>,
{
    S::WORDS
}
pub const fn bytes<S: Isa>() -> usize
where
    Code: On<S>,
{
    S::Native::BYTES
}
pub const fn has_word<S: Isa>(word: &str) -> bool
where
    Code: On<S>,
{
    S::WORDS.has_word(word)
}
/// No code is made for a type whose words are not those of the CPU. Constants may name it.
#[inline(always)]
pub const fn real<S: Isa>() {
    const WIDE: usize = <crate::ops::Portable as Isa>::Native::BYTES;
    if const { !S::LISTED.includes(S::WORDS) || S::PORTABLE && S::Native::BYTES != WIDE }
        && core::hint::black_box(false)
    {
        crate::only::other::<S, (), ()>()
    }
}
/// For `has!`. The name is for the message.
#[inline(always)]
pub const fn constants_and_const_fns_need_their_own_attribute<S: Isa>()
where
    Code: On<S>,
{
    real::<S>()
}
#[allow(clippy::should_implement_trait)]
impl<T: Lane, W: Width, S: Isa> crate::Simd<T, W, S> {
    crate::make::of_make!();
    crate::make::of_load!();
    crate::make::of_over!();
    crate::make::of_cast!();
    crate::make::of_low_bytes!();
    crate::make::of_planes!();
    crate::over::of_slices!();
}
impl<T: Signed, W: Width, S: Isa> crate::mask::Mask<T, W, S> {
    crate::masks::of_masks!();
}
impl<T: crate::Int, W: Width, S: Isa> Default for crate::PairSums<T, W, S> {
    #[inline(always)]
    fn default() -> Self {
        Self::new()
    }
}
impl<T: crate::Int, W: Width, S: Isa> crate::PairSums<T, W, S> {
    /// All sums are zero.
    #[inline(always)]
    pub fn new() -> Self
    where
        Code: On<S>,
    {
        Self::on(S::here())
    }
}
impl<W: Width, S: Isa> Default for crate::AbsDiffSums<W, S> {
    #[inline(always)]
    fn default() -> Self {
        Self::new()
    }
}
impl<W: Width, S: Isa> crate::AbsDiffSums<W, S> {
    /// All sums are zero.
    #[inline(always)]
    pub fn new() -> Self
    where
        Code: On<S>,
    {
        Self::on(S::here())
    }
}
impl<W: Width, S: Isa> crate::Xoshiro<W, S> {
    /// SplitMix64 starts at `seed` and gives each lane in turn its four words, so a lane is the same on all targets, and nearby seeds have nothing in common.
    #[inline(always)]
    pub fn new(seed: u64) -> Self
    where
        Code: On<S>,
    {
        W::make_xoshiro(crate::make::Own(S::here()), seed)
    }
}
macro_rules! states { ($($name:ident $words:ty),*) => {$(
    impl<S: Isa> crate::$name<S> {
        /// From the words `a`, `b` and so on.
        #[inline(always)]
        pub fn new(words: $words) -> Self where Code: On<S> { Self::on(S::here(), words) }
    }
)*}; }
states! { Sha1 [u32; 5], Sha256 [u32; 8], Sha512 [u64; 8], Sm3 [u32; 8] }

macro_rules! with {
    ($(#[$m:meta])* fn $name:ident [$($g:tt)*] ($($a:tt)*) -> $r:ty $b:block) => { $(#[$m])* #[inline(always)] pub fn $name<$($g)* S: crate::Isa>($($a)*) -> $r where super::Code: super::On<S> $b };
    ($doc:expr, type $name:ident = $t:ty) => { #[doc = $doc] #[allow(type_alias_bounds)]
        pub type $name<S: crate::Isa> = $t; // It is known in what has #[simd] or #[kernel].
    };
}
#[rules]
macro_rules! vectors { ($s:ident) => {
    macro_rules! aliases { ($$($$t:ident $$native:ident: $$($$w:ident $$n:literal $$alias:ident),+;)*) => {$$(
        with!(concat!("Lanes of `", stringify!($$t), "` that fill a register."), type $$native = crate::Simd<$$t, <$s as super::Known>::Native, $s>);
        $$(with!(concat!($$n, " lanes of `", stringify!($$t), "`."), type $$alias = crate::Simd<$$t, crate::$$w, $s>);)+
    )*}; }
    macro_rules! native_masks { ($$($$t:ident $$native:ident: $$($$w:ident $$n:literal $$alias:ident),+;)*) => {$$(
        with!(concat!("The mask of a register with lanes of the size of `", stringify!($$t), "`."), type $$native = crate::Mask<$$t, <$s as super::Known>::Native, $s>);
        $$(with!(concat!("The mask of ", $$n, " lanes of the size of `", stringify!($$t), "`."), type $$alias = crate::Mask<$$t, crate::$$w, $s>);)+
    )*}; }
    pub(crate) use {aliases, native_masks};
}; }
vectors!(S);

#[allow(non_camel_case_types)]
#[doc(hidden)]
pub mod names {
    #[allow(unused_imports)]
    use crate::gate::Enter;
    use crate::{bf16, f16};
    with!("The width of the registers.", type Native = <S as crate::Isa>::Native);
    #[doc(inline)]
    pub use crate::{
        Mask, MaskOf, Simd,
        crypto::{Sha1, Sha256, Sha512, Sm3},
        math::{AbsDiffSums, LinearMap, PairSums, Xoshiro},
    };
    /// Lanes of `T` that fill a register.
    pub type SimdN<T, S> = Simd<T, <S as crate::Isa>::Native, S>;
    /// The mask of a [`SimdN`].
    pub type MaskN<T, S> = MaskOf<T, <S as crate::Isa>::Native, S>;
    /// The width of the registers, but no more than `W`.
    pub type Upto<W, S> = <W as crate::width::Capped>::AtMostNative<S>;
    /// Half of `W`.
    pub type Half<W> = <W as crate::Width>::Half;
    /// Twice `W`.
    pub type Twice<W> = <W as crate::Width>::Twice;
    crate::make::shapes!(super::aliases);
    crate::masks::shapes!(native_masks);
    with!(#[doc(hidden)] fn isa []() -> S { <S as Enter>::here() });
    with!(#[doc = "A slice, a register at a time. See [`Over`](crate::Over)."] fn over [T: crate::Lane, E: crate::Readable<T>,](values: &[E]) -> crate::Over<'_, T, <S as crate::Isa>::Native, S, E> { crate::Over::new(<S as Enter>::here(), values) });
    with!(#[doc = "A slice that is changed in place, a register at a time. See [`OverMut`](crate::OverMut)."] fn over_mut [T: crate::Lane,](values: &mut [T]) -> crate::OverMut<'_, T, <S as crate::Isa>::Native, S> { crate::OverMut::new(<S as Enter>::here(), values) });
    with! {
        /// One step of the CRC-32 of gzip, over the bytes of `data`. It takes tables unless `has!(crc)`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let crc = b"123456789".iter().fold(!0, |crc, &byte| crc32(crc, byte));
        /// assert_eq!(!crc, 0xcbf4_3926);
        /// # } example()
        /// ```
        fn crc32 [T: crate::Unsigned,](state: u32, data: T) -> u32 { crate::WithToken::crc32(<S as Enter>::here(), state, data) }
    }
    with! {
        /// The same for CRC-32C. It takes tables unless `has!(crc32c)`.
        #[doc(alias("hash", "checksum"))]
        fn crc32c [T: crate::Unsigned,](state: u32, data: T) -> u32 { crate::WithToken::crc32c(<S as Enter>::here(), state, data) }
    }
    with! {
        /// The lowest of `bits` go to where `mask` has ones, in order. It is one instruction on x86-64 with `bmi`, but for Zen 1 and 2, and from `neon` on if the CPU has `fast_pdep` and the mask is no constant (bytes: on `sve2`, or with the word in the list). On other Arm CPUs the test costs up to a third in a loop over slices. Elsewhere it is
        /// a few for a constant mask, and about 60 to 150 for others.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(deposit_bits(0b101u8, 0b1101_0000), 0b1001_0000);
        /// assert_eq!(extract_bits(0b1001_0110u8, 0b1101_0000), 0b101);
        /// # } example()
        /// ```
        #[doc(alias("pdep", "bdep"))]
        fn deposit_bits [T: crate::Unsigned,](bits: T, mask: T) -> T { crate::WithToken::deposit_bits(<S as Enter>::here(), bits, mask) }
    }
    with! {
        /// The reverse: the bits where `mask` has ones go to the lowest places. It costs the same: from `neon` on, and below `avx512` without `fast_pdep` in the list, a test of the CPU can come first.
        #[doc(alias("pext", "bext"))]
        fn extract_bits [T: crate::Unsigned,](bits: T, mask: T) -> T { crate::WithToken::extract_bits(<S as Enter>::here(), bits, mask) }
    }
    with! {
        /// Bit `i` of the result is the exclusive or of the bits `0..=i`. It is a product if `has!(aes)`, and else six shifts.
        /// To go on in the next 64, `^` their result with `(last as i64 >> 63) as u64`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let quotes = u8x8::from(b"a\"bc\"d e").simd_eq(b'"').to_bitmask();
        /// assert_eq!(prefix_xor(quotes), 0b0000_1110);
        /// # } example()
        /// ```
        fn prefix_xor [](bits: u64) -> u64 { crate::WithToken::prefix_xor(<S as Enter>::here(), bits) }
    }
    with! {
        /// Writes `first + i` for each bit `i` that is set, in order, and returns how many. The sums wrap. `to` needs room for 64 values,
        /// and all of them can change. An [`Output`](crate::mem::Output) grows by those that count, and a slice or an array is written from its start.
        /// If most words are zero, test for that first. For an output of exact size there is [`filter_map_into`](crate::Columns::filter_map_into) after `enumerate`.
        #[doc(alias("push_bit_positions", "flatten_bits", "bitmap", "selection_vector"))]
        fn set_bit_positions [T: crate::Unsigned,](bits: u64, first: T, to: &mut (impl crate::Sink<T> + ?Sized)) -> usize { crate::WithToken::set_bit_positions(<S as Enter>::here(), bits, first, to) }
    }
}
impl<T: Lane, W: Width, S: Isa> crate::Simd<T, W, S>
where
    Code: On<S>,
{
    #[doc(hidden)]
    #[inline(always)]
    pub fn to_lanes<const N: usize>(self) -> [T; N] {
        require!("the array has to have as many values as lanes", N == Self::LANES && N > 0);
        crate::same::same(self.to_array())
    }
    #[doc(hidden)]
    #[inline(always)]
    pub fn from_lanes<const N: usize>(a: [T; N]) -> Self {
        require!("the array has to have as many values as lanes", N == Self::LANES && N > 0);
        Self::from_array(crate::same::same(a))
    }
}
impl<T: Signed, W: Width, S: Isa> crate::mask::Mask<T, W, S> {
    #[doc(hidden)]
    #[inline(always)]
    pub fn to_lanes<const N: usize>(self) -> [bool; N] {
        require!("the array has to have as many values as lanes", N == Self::LANES && N > 0);
        crate::same::same(self.to_array())
    }
}
/// A place where a closure can have an attribute.
#[inline(always)]
pub fn itself<F>(f: F) -> F {
    f
}
/// The targets of the kernels of this module that name none. It takes the words of [`simd`](macro@crate::simd).
/// Other files of the crate take them by `targets!(super)`, `targets!(crate)` or `targets!(crate::path)`, and else have the default list.
///
/// ```
/// use bun_simd::prelude::*;
/// targets!(avx2, sse4, neon);
///
/// #[kernel]
/// fn zeros(bytes: &[u8]) -> usize {
///     over(bytes).count(|v| v.simd_eq(0))
/// }
/// # fn main() {
/// assert_eq!(zeros(&[0, 1, 0]), 2);
/// # }
/// ```
#[macro_export]
macro_rules! targets {
    (super) => { $crate::targets! { @of super } };
    (crate) => { $crate::targets! { @of crate } };
    ($first:ident $(:: $rest:ident)+) => { $crate::targets! { @of $first $(:: $rest)+ } };
    (@of $($path:ident)::+) => {
        #[doc(hidden)]
        pub(crate) type __Targets = $($path::)+__Targets;
    };
    ($($words:tt)*) => {
        $crate::list! { $($words)* ; }
        $crate::list_of_targets! { __Targets $crate::resolve_targets! { {target [@all_of] []} $($words)* } }
    };
}
pub use crate::ops::like;
/// What the name of a constant of the target is as a value.
#[allow(non_camel_case_types)]
pub struct write_S_colon_colon_before_this_constant<const NOT_INFERRED: bool>;
/// For a glob, whose type gives way to the trait of that name. Messages can take this path.
#[allow(non_snake_case)]
pub mod write_S_colon_colon_before_this_constant_too {
    pub use super::write_S_colon_colon_before_this_constant as _IT;
}
#[deprecated = "this call dispatches again: name::here(..) stays on the target, and self::name(..) says that it is meant"]
pub struct KernelInMarkedCode;
