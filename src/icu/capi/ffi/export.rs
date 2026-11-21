//! The expansion of `#[capi]`.

use super::*;
use crate::common::utypes::UErrorCode;

/// Exports a safe function. The signature is trusted, as in an `unsafe extern` block. README.md has the syntax.
macro_rules! export {
    ($(#[$meta:meta])* $vis:vis fn $name:ident($($parameters:tt)*) $(-> $result:ty)? $body:block) => {
        $crate::capi::ffi::export! {
            @begin [$($parameters)*] [[$(#[$meta])*] $vis $name [$(-> $result)?] $body] $($parameters)*
        }
    };
    (@begin [cx: $($same:tt)*] $function:tt $cx:ident: $type:ty $(, $($rest:tt)*)?) => {
        $crate::capi::ffi::export! {
            @ $function [] [$cx: $type,] [$crate::capi::ffi::NewCx::new(&call),] [let call = ();]
            [$crate::capi::ffi::Cx<$type>,] $($($rest)*)?
        }
    };
    (@begin $same:tt $function:tt $($parameters:tt)*) => {
        $crate::capi::ffi::export! { @ $function [] [] [] [] [] $($parameters)* }
    };
    // Each arm moves a parameter to five lists: C parameters, those of `body`, its arguments, statements that build pairs, types.
    (@ $function:tt [$($c:tt)*] [$($own:tt)*] [$($given:tt)*] [$($join:tt)*] [$($types:tt)*]
        ($a:ident, $second:pat_param): $type:ty $(, $($rest:tt)*)?
    ) => {
        $crate::capi::ffi::export! { @ $function
            [$($c)* $a: <$type as $crate::capi::ffi::Pair>::First, second: <$type as $crate::capi::ffi::Pair>::Second,]
            [$($own)* $a: $type, $second: <$type as $crate::capi::ffi::Pair>::Second,]
            [$($given)* $a, second,]
            [$($join)* let $a = <$type as $crate::capi::ffi::Pair>::new($a, second);]
            [$($types)* $type,] $($($rest)*)?
        }
    };
    (@ $function:tt [$($c:tt)*] [$($own:tt)*] [$($given:tt)*] [$($join:tt)*] [$($types:tt)*]
        #[len($second:ident)] $a:ident: $type:ty $(, $($rest:tt)*)?
    ) => {
        $crate::capi::ffi::export! { @ $function
            [$($c)* $a: <$type as $crate::capi::ffi::Pair>::First,]
            [$($own)* $a: $type,]
            [$($given)* $a,]
            [$($join)* let $a = <$type as $crate::capi::ffi::Pair>::new($a, $second);]
            [$($types)* $type,] $($($rest)*)?
        }
    };
    (@ $function:tt [$($c:tt)*] [$($own:tt)*] [$($given:tt)*] $join:tt [$($types:tt)*]
        mut $a:ident: $type:ty $(, $($rest:tt)*)?
    ) => {
        $crate::capi::ffi::export! { @ $function
            [$($c)* $a: $type,] [$($own)* mut $a: $type,] [$($given)* $a,] $join
            [$($types)* $type,] $($($rest)*)?
        }
    };
    (@ $function:tt [$($c:tt)*] [$($own:tt)*] [$($given:tt)*] $join:tt [$($types:tt)*]
        $a:ident: $type:ty $(, $($rest:tt)*)?
    ) => {
        $crate::capi::ffi::export! { @ $function
            [$($c)* $a: $type,] [$($own)* $a: $type,] [$($given)* $a,] $join
            [$($types)* $type,] $($($rest)*)?
        }
    };
    (@ [[$($meta:tt)*] $vis:vis $name:ident [$($result:tt)*] $body:block]
        [$($c:tt)*] [$($own:tt)*] [$($given:tt)*] [$($join:tt)*] [$($type:ty,)*]
    ) => {
        $($meta)*
        /// # Safety
        /// The contract that the header states for this function.
        #[unsafe(export_name = concat!(stringify!($name), "_79"))]
        #[allow(unsafe_code, unused_unsafe, non_snake_case)]
        $vis unsafe extern "C" fn $name($($c)*) $($result)* {
            #[inline(always)]
            #[forbid(unsafe_code)]
            fn body($($own)*) $($result)* $body
            const _: () = {
                let contexts = 0 $(+ <$type as $crate::capi::ffi::Parameter>::IS_CONTEXT as usize)*;
                assert!(contexts <= 1, "a function has at most one status or `cx`");
            };
            // SAFETY: the signature states what the caller guarantees.
            unsafe {
                $($join)*
                body($($given)*)
            }
        }
    };
}
pub(crate) use export;

/// The types that `cx` may have.
pub(crate) trait NewCx<'a> {
    /// The borrow of a local variable limits `'a` to the call.
    ///
    /// # Safety
    /// The contract of `CallerMem::new` holds.
    unsafe fn new(call: &'a ()) -> Self;
}

impl<'a> NewCx<'a> for &'a CallerMem {
    unsafe fn new(_: &'a ()) -> Self {
        // SAFETY: the caller keeps the contract of `CallerMem::new`.
        unsafe { CallerMem::new() }
    }
}

impl<'a> NewCx<'a> for &'a mut CallerMem {
    unsafe fn new(_: &'a ()) -> Self {
        // SAFETY: the caller keeps the contract of `CallerMem::new`.
        unsafe { CallerMem::new() }
    }
}

/// A type that may appear in the signature of a `#[capi]` function.
///
/// # Safety
/// Safe code cannot dereference a pointer in the value without a `CallerMem`, except in a handle.
/// It cannot obtain the token from the value, unless `IS_CONTEXT` is set.
pub(crate) unsafe trait Parameter {
    /// Provides the `CallerMem`.
    const IS_CONTEXT: bool = false;
}

macro_rules! parameters {
    (values: $($value:ty),+; pointers: $($pointer:ident)+; handles: $($handle:ident)+;) => {
        // SAFETY: nothing dereferences a `Null`, and the others have no pointers.
        $(unsafe impl Parameter for $value {})+
        // SAFETY: only methods that take a token dereference the pointer. No signature has a `Ref`, a `Mut` or a token
        // in `T`.
        $(unsafe impl<T> Parameter for $pointer<'_, T> {})+
        // SAFETY: a handle is not in the memory that the token stands for.
        $(unsafe impl<H: Handle> Parameter for $handle<'_, H> {})+
    };
}

parameters! {
    values: i8, u8, u16, i32, u32, i64, f64, UErrorCode, Null;
    pointers: NulStr Text Array Dest Out;
    handles: Ref Mut Owned;
}

// SAFETY: the value gives access to `P` only.
unsafe impl<P: Parameter> Parameter for Retained<P> {}

// SAFETY: the value gives access to `P` only.
unsafe impl<P: Parameter, H> Parameter for MayAlias<P, H> {}

// SAFETY: `IS_CONTEXT` is set.
unsafe impl Parameter for ErrorCode<'_> {
    const IS_CONTEXT: bool = true;
}

/// Represents `cx` in the list of types, so that the token types themselves are not `Parameter`s.
pub(crate) struct Cx<C>(C);

// SAFETY: `IS_CONTEXT` is set.
unsafe impl Parameter for Cx<&CallerMem> {
    const IS_CONTEXT: bool = true;
}

// SAFETY: `IS_CONTEXT` is set.
unsafe impl Parameter for Cx<&mut CallerMem> {
    const IS_CONTEXT: bool = true;
}
