//! Functions with target features of their own, for `core::arch`.
//!
//! rustc doesn't promise to inline such a function. But it can return a closure, which may use the features and is always inlined.
use crate::{Isa, Named, Target};
pub use core::ops::FnOnce;

pub trait Once<R>: FnOnce() -> R {}
impl<R, F: FnOnce() -> R> Once<R> for F {}

/// A closure that consumes this is called without a function in between, which would not always be inlined.
pub struct Moved;

/// `featured!` implements it.
///
/// # Safety
/// `get` needs `FEATURES` and nothing else.
#[allow(unsafe_code)]
pub unsafe trait Featured {
    type Token: Isa;
    const FEATURES: &[&str];
    /// # Safety
    /// The CPU has `FEATURES`.
    unsafe fn get() -> impl Sized;
}
pub type Names = &'static [&'static str];
/// The same type.
pub type Same<T> = T;

/// An instance that names the token runs on its target.
pub const fn has_all<F: Featured>() -> bool {
    let these = Target::of(Named::Portable, F::FEATURES);
    F::Token::LISTED.includes(these) && (cfg!(miri) || !these.has("fp16"))
}

/// rustc makes such a pointer only of what is safe but for features that the caller has.
#[inline(always)]
pub fn call<R>(f: fn() -> R) -> R {
    f()
}

/// It captures all lifetimes, also in crates of older editions.
#[doc(hidden)]
#[macro_export]
macro_rules! once {
    (-> $result:ty) => { impl $crate::featured::Once<$result> };
    (<$($life:lifetime,)*> ($($type:ty,)*) -> $result:ty) => { impl for<$($life),*> $crate::featured::FnOnce($($type),*) -> $result };
}

#[doc(hidden)]
#[macro_export]
macro_rules! featured {
    ([$($generics:tt)*] $it:ty [$($clause:tt)*] $token:ty [$($feature:literal)+] <$($life:lifetime,)*> ($($type:ty,)*) -> $result:ty) => {
        // The head of the `impl` below.
        #[cfg(false)]
        struct Head<$($generics)*>() where $($clause)*;
        // SAFETY: get has the features of the constant, and only calls a safe pointer.
        unsafe impl<$($generics)*> $crate::featured::Featured for $it where $($clause)* {
            type Token = $token;
            const FEATURES: $crate::featured::Names = &[$($feature),+];
            #[inline]
            $(#[target_feature(enable = $feature)])+
            unsafe fn get() -> impl for<$($life),*> $crate::featured::FnOnce($($type),*) -> $crate::featured::Same<$result> {
                $crate::featured::call(Self::featured)
            }
        }
    };
    // A function would hide the type of the result.
    () => {
        if const { $crate::featured::has_all::<Self>() } {
            // SAFETY: the target of the token includes the features, and an instance that names the token runs on it (gate.rs, points 4 and 5).
            unsafe { <Self as $crate::featured::Featured>::get() }
        } else {
            $crate::only::other::<<Self as $crate::featured::Featured>::Token, Self, _>()
        }
    };
}
