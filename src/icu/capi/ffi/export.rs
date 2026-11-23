//! The expansion of `#[capi]`.

use super::*;
use crate::common::utypes::UErrorCode;

/// Exports a safe function. The signature is trusted, as in an `unsafe extern` block. README.md has the syntax.
macro_rules! export {
    ($(#[$meta:meta])* $vis:vis fn $name:ident($($parameters:tt)*) $(-> $result:ty)? $body:block) => {
        $crate::capi::ffi::export! {
            @ [[$(#[$meta])*] $vis $name [$(-> $result)?] $body] [] [] [] [] $($parameters)*
        }
    };
    // Each arm moves a parameter to four lists: C parameters, those of `body`, its arguments, statements that build pairs.
    (@ $function:tt [$($c:tt)*] [$($own:tt)*] [$($given:tt)*] [$($join:tt)*]
        ($a:ident, $second:pat_param): $type:ty $(, $($rest:tt)*)?
    ) => {
        $crate::capi::ffi::export! { @ $function
            [$($c)* $a: <$type as $crate::capi::ffi::Pair>::First, second: <$type as $crate::capi::ffi::Pair>::Second,]
            [$($own)* $a: $type, $second: <$type as $crate::capi::ffi::Pair>::Second,]
            [$($given)* $a, second,]
            [$($join)* let $a = <$type as $crate::capi::ffi::Pair>::new($a, second);]
            $($($rest)*)?
        }
    };
    (@ $function:tt [$($c:tt)*] [$($own:tt)*] [$($given:tt)*] [$($join:tt)*]
        #[len($second:ident)] $a:ident: $type:ty $(, $($rest:tt)*)?
    ) => {
        $crate::capi::ffi::export! { @ $function
            [$($c)* $a: <$type as $crate::capi::ffi::Pair>::First,]
            [$($own)* $a: $type,]
            [$($given)* $a,]
            [$($join)* let $a = <$type as $crate::capi::ffi::Pair>::new($a, $second);]
            $($($rest)*)?
        }
    };
    (@ $function:tt [$($c:tt)*] [$($own:tt)*] [$($given:tt)*] $join:tt
        $a:ident: $type:ty $(, $($rest:tt)*)?
    ) => {
        $crate::capi::ffi::export! { @ $function
            [$($c)* $a: $type,] [$($own)* $a: $type,] [$($given)* $a,] $join $($($rest)*)?
        }
    };
    (@ [[$($meta:tt)*] $vis:vis $name:ident [$($result:tt)*] $body:block]
        [$($c:tt)*] [$($own:tt)*] [$($given:ident,)*] [$($join:tt)*]
    ) => {
        $($meta)*
        /// SAFETY: The contract that the header states for this function, and the rules for pointers in README.md.
        #[unsafe(export_name = concat!(stringify!($name), "_79"))]
        #[allow(unsafe_code, unused_unsafe, non_snake_case)]
        $vis unsafe extern "C" fn $name($($c)*) $($result)* {
            #[inline(always)]
            #[forbid(unsafe_code)]
            fn body($($own)*) $($result)* $body
            // SAFETY: the signature states what the caller guarantees.
            unsafe {
                $($join)*
                $($crate::capi::ffi::is_parameter(&$given);)*
                $crate::capi::ffi::borrows_nothing(body($($given),*))
            }
        }
    };
}
pub(crate) use export;

/// The types that C can pass whatever their bits are, or null.
pub(crate) trait Parameter {}

macro_rules! parameters {
    ($($value:ty),+; $($pointer:ident)+; $($handle:ty),+) => {
        $(impl Parameter for $value {})+
        $(impl<T> Parameter for $pointer<'_, T> {})+
        // Threads share handles.
        $(impl<H: Send + Sync + 'static> Parameter for Option<$handle> {})+
    };
}
parameters!(
    i8, u8, u16, i32, u32, i64, f64, UErrorCode, Null, ErrorCode<'_>;
    NulStr Text Array Dest Out;
    &H, &mut H, Box<H>
);

#[inline(always)]
pub(crate) fn is_parameter(_: &impl Parameter) {}

#[inline(always)]
pub(crate) fn borrows_nothing<T: 'static>(result: T) -> T {
    result
}
