//! What differs by target in types, and what a function may assume of its target.
use crate::{Isa, Lane, Signed, Width};

pub struct True;
pub struct False;
pub trait Bool: Sized + crate::gate::Sealed {
    type And<B: Bool>: Bool;
    type If<A: Width, B: Width>: Width<Half = Self::If<A::Half, B::Half>, Twice = Self::If<A::Twice, B::Twice>>;
    type Either<A: Copy, B: Copy>: Copy;
    /// The same, for what messages show of an array whose length says S.
    type NeedsSimdByLevel<A: Copy, B: Copy>: Copy;
}
impl crate::gate::Sealed for True {}
impl Bool for True {
    type And<B: Bool> = B;
    type If<A: Width, B: Width> = A;
    type Either<A: Copy, B: Copy> = A;
    type NeedsSimdByLevel<A: Copy, B: Copy> = A;
}
impl crate::gate::Sealed for False {}
impl Bool for False {
    type And<B: Bool> = False;
    type If<A: Width, B: Width> = B;
    type Either<A: Copy, B: Copy> = B;
    type NeedsSimdByLevel<A: Copy, B: Copy> = B;
}

#[allow(non_camel_case_types)]
pub struct a_function_is_called_on_a_target_that_its_attribute_excludes_or_the_list_of_its_module_lacks<S, F>(
    u8,
    core::marker::PhantomData<(S, F)>,
);
/// An error, but only if code is made for it. A constant that fails would be one in dead branches too.
#[cold]
#[inline(never)]
pub const fn other<S, F, T>() -> T {
    type Error<S, F> =
        [a_function_is_called_on_a_target_that_its_attribute_excludes_or_the_list_of_its_module_lacks<S, F>;
            usize::MAX];
    let it: Option<Error<S, F>> = None; // Test by has! or pick!, add a twin, or take the list of the caller.
    core::hint::black_box(&raw const it as *const u8);
    unreachable!()
}

/// The same, at a place in the crate of the consumer.
pub type Missing<S> = Option<
    [a_function_is_called_on_a_target_that_its_attribute_excludes_or_the_list_of_its_module_lacks<S, ()>; usize::MAX],
>;
#[cold]
#[inline(never)]
pub fn missing<T>(error: impl FnOnce()) -> T {
    error();
    unreachable!()
}
pub fn keep(it: *const u8) {
    core::hint::black_box(it);
}

#[track_caller]
pub const fn length(same: bool) {
    assert!(same, "a length can depend on the width and on icelake, avx512, avx2, sse4 and neon, but on no other word")
}

/// Against the lint on dead code.
pub trait Uses<F> {
    fn it();
}

/// Whether the target has the word.
pub trait Word<S> {
    type Is: Bool;
}
/// The type of the pointers to the twins of a function, once.
pub trait Points {
    type It;
}
/// A function that takes it as known. The clause names what `Is` stands for: other functions only see that.
macro_rules! given { ($module:ident $of:ty: $tr:ident; $($word:ident)*) => {
    #[allow(non_snake_case)]
    pub mod $module {
        use super::*;
        $(pub mod $word {
            use super::*;
            pub trait Given<S: Isa, B> { type Pointer; fn of() -> Self::Pointer where $of: $tr<$word = B>; }
            pub trait By: Sized {
                fn has<S: Isa, F: Given<S, True>>() -> F::Pointer where $of: $tr<$word = Self> { other::<S, F, _>() }
                fn lacks<S: Isa, F: Given<S, False>>() -> F::Pointer where $of: $tr<$word = Self> { other::<S, F, _>() }
            }
            impl By for True { #[inline(always)] fn has<S: Isa, F: Given<S, True>>() -> F::Pointer where $of: $tr<$word = Self> { F::of() } }
            impl By for False { #[inline(always)] fn lacks<S: Isa, F: Given<S, False>>() -> F::Pointer where $of: $tr<$word = Self> { F::of() } }
            #[inline(always)]
            pub fn has<S: Isa, F: Given<S, True>>() -> F::Pointer { <$of as $tr>::$word::has::<S, F>() }
            #[inline(always)]
            pub fn lacks<S: Isa, F: Given<S, False>>() -> F::Pointer { <$of as $tr>::$word::lacks::<S, F>() }
        })*
    }
}; }
/// The same for the width of the registers.
pub trait GivenWidth<S, W> {
    type Pointer;
    fn of() -> Self::Pointer
    where
        S: Isa<Native = W>;
}
macro_rules! registers { ($($w:ident $is:ident [$($Is:ident = $b:ident)*])*; $($All:ident)*) => {
    pub trait Registers: Sized + crate::gate::Sealed {
        $(type $All: Bool + of_width::$All::By;)*
        $(fn $is<S: Isa<Native = Self>, F: GivenWidth<S, crate::$w>>() -> F::Pointer { other::<S, F, _>() })*
    }
    $(impl crate::gate::Sealed for crate::$w {}
    impl Registers for crate::$w {
        $(type $Is = $b;)*
        #[inline(always)]
        fn $is<S: Isa<Native = Self>, F: GivenWidth<S, Self>>() -> F::Pointer { F::of() }
    }
    #[inline(always)]
    pub fn $is<S: Isa, F: GivenWidth<S, crate::$w>>() -> F::Pointer { S::Native::$is::<S, F>() })*
    given!(of_width S::Native: Registers; $($All)*);
    $(impl<S: Isa> Word<S> for word::$All { type Is = <S::Native as Registers>::$All; })*
}; }
registers! {
    B16 is16 [B16 = True B32 = False B64 = False] B32 is32 [B16 = False B32 = True B64 = False] B64 is64 [B16 = False B32 = False B64 = True];
    B16 B32 B64
}

#[allow(non_camel_case_types)]
mod none {
    macro_rules! none { ($($word:ident)*) => { $(pub type $word = super::False;)* }; }
    crate::words::all_words!(none);
}
#[allow(non_camel_case_types)]
pub(crate) mod yes {
    macro_rules! yes { ($($word:ident)*) => { $(pub type $word = super::True;)* }; }
    crate::words::all_words!(yes);
}
macro_rules! words { ($($word:ident)*) => {
    /// The words as types.
    #[allow(non_camel_case_types)]
    pub mod word { pub use crate::{B16, B32, B64}; $(pub struct $word;)* }
    #[allow(non_camel_case_types)]
    pub trait Words { $(type $word: Bool + of_target::$word::By;)* }
    given!(of_target S: Words; $($word)*);
    // What no target of the architecture has is known to be false.
    mod native {
        use super::{*, none::*};
        const _: () = {
            use crate::gate::native_words::*;
            $(impl<S: Words> Word<S> for word::$word { type Is = <$word as Bool>::And<S::$word>; })*
        };
    }
    macro_rules! implement { () => { $(type $word = own::$word;)* }; }
    pub(crate) use implement;
}; }
crate::words::all_words!(words);
pub(crate) mod no_word {
    pub(crate) use super::none::*;
}
macro_rules! of_token { ([$($g:tt)*] $token:ident $(<$M:ident>)? [$($word:ident)*]) => { const _: () = {
    #[allow(non_camel_case_types, unused_imports)]
    mod own { pub(crate) use crate::only::no_word::*; $(pub(crate) type $word = crate::only::True;)* }
    impl<$($g)*> crate::only::Words for $token $(<$M>)? { crate::only::implement!(); }
}; }; }
pub(crate) use of_token;

/// What [`Pick`](crate::Pick) can choose from.
#[diagnostic::on_unimplemented(
    message = "`Pick!` can't choose between `{A}` and `{Self}`",
    note = "it is for widths, and for vectors or masks with one type of lanes. `Either!` takes other types"
)]
pub trait Or<A> {
    type If<C: Bool>;
}
#[diagnostic::do_not_recommend]
impl<A: Width, B: Width> Or<A> for B {
    type If<C: Bool> = C::If<A, B>;
}
impl<T: Lane, A: Width, B: Width, S: Isa> Or<crate::Simd<T, A, S>> for crate::Simd<T, B, S> {
    type If<C: Bool> = crate::Simd<T, C::If<A, B>, S>;
}
impl<T: Signed, A: Width, B: Width, S: Isa> Or<crate::mask::Mask<T, A, S>> for crate::mask::Mask<T, B, S> {
    type If<C: Bool> = crate::mask::Mask<T, C::If<A, B>, S>;
}

/// The first width, vector or mask whose words the target has: `Pick![S: avx512 | neon => u32x16<S>, _ => u32x8<S>]`.
/// Words for tuning, such as `fast_zmm`, and features in quotes are for [`has!`](crate::has).
#[macro_export]
macro_rules! Pick {
    ($($all:tt)+) => { $crate::pick_type![Pick $($all)+] };
}
/// The same for any types that are `Copy`. Functions with `#[only]` and `#[except]` know which it is, and the others can pass it on.
#[macro_export]
macro_rules! Either {
    ($($all:tt)+) => { $crate::pick_type![Either $($all)+] };
}
#[doc(hidden)]
#[macro_export]
macro_rules! pick_type {
    (@one ByLevel $is:ty, $it:ty, $other:ty) => { <$is as $crate::only::Bool>::NeedsSimdByLevel<$it, $other> };
    (@one Pick $is:ty, $it:ty, $other:ty) => { <$other as $crate::only::Or<$it>>::If<$is> };
    (@one Either $is:ty, $it:ty, $other:ty) => { <$is as $crate::only::Bool>::Either<$it, $other> };
    ($m:ident $s:ident: _ => $last:ty $(,)?) => { $last };
    ($m:ident $s:ident: fast_pdep => $($rest:tt)*) => { $crate::pick_type![@no] };
    ($m:ident $s:ident: fast_gather => $($rest:tt)*) => { $crate::pick_type![@no] };
    ($m:ident $s:ident: fast_zmm => $($rest:tt)*) => { $crate::pick_type![@no] };
    ($m:ident $s:ident: fast_compress_store => $($rest:tt)*) => { $crate::pick_type![@no] };
    ($m:ident $s:ident: full_zmm => $($rest:tt)*) => { $crate::pick_type![@no] };
    ($m:ident $s:ident: fast_sha3 => $($rest:tt)*) => { $crate::pick_type![@no] };
    ($m:ident $s:ident: fast_clmul => $($rest:tt)*) => { $crate::pick_type![@no] };
    ($m:ident $s:ident: $word:ident => $it:ty, $($rest:tt)+) => { $crate::pick_type![@one $m <$crate::only::word::$word as $crate::only::Word<$s>>::Is, $it, $crate::pick_type![$m $s: $($rest)+]] };
    ($m:ident $s:ident: $word:ident | $($more:ident)|+ => $it:ty, $($rest:tt)+) => { $crate::pick_type![$m $s: $word => $it, $($more)|+ => $it, $($rest)+] };
    ($m:ident $s:ident: $word:ident + $next:ident $(+ $more:ident)* => $it:ty, $($rest:tt)+) => { $crate::pick_type![$m $s: $word => $crate::pick_type![$m $s: $next $(+ $more)* => $it, $($rest)+], $($rest)+] };
    // In a length, the error keeps others from following.
    (@no) => { [(); $crate::__core::compile_error!("a type can't depend on a word for tuning: give a function the parameter `W: Width`, and choose by `if has!(..)`")] };
    ($($other:tt)*) => { [(); $crate::__core::compile_error!("the form is `[S: avx512 | neon => A, avx2 + gfni => B, _ => C]`, without quotes, and with `|` or `+` in an arm")] };
}
