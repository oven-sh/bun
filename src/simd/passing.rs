//! For speed: each argument comes as a closure, which borrows what is `Copy` unless it moves. So a wide vector is handed on by address, and not copied in pieces.
use crate::Isa;
use crate::gate::{Caller, Enter, Entering};

macro_rules! lent {
    ($(($($plain:ident $lent:ident),*; $args:tt))*) => {$( lent!(@three $args $($plain $lent)*); )*};
    (@three $args:tt $inlined:ident $a:ident $apart:ident $b:ident $cold:ident $c:ident) => {
        impl<S: Caller, const COPIED: bool, const CLOSURE: bool> Entering<S, COPIED, CLOSURE> {
            lent!(@one $inlined $a !S::Token::COMPILED_FOR, $args);
        }
        impl<S: Isa> Entering<S> {
            lent!(@one $apart $b true, $args);
            lent!(@one $cold $c true, $args);
        }
    };
    (@one $plain:ident $lent:ident $when:expr, [$($a:ident $A:ident)*]) => {
        #[inline(always)]
        #[allow(clippy::too_many_arguments)]
        pub fn $lent<R, $($A),*>($($a: impl FnOnce() -> $A,)* body: impl FnOnce($($A),*) -> R) -> R {
            if const { crate::OPTIMIZED && $when && ($(align_of::<$A>() > 16)||*) } {
                return Self::$plain($($a,)* #[inline(always)] move |$($a),*| body($($a()),*));
            }
            Self::$plain($($a(),)* body)
        }
    };
}
lent! {
    (inlined1 lent_inlined1, apart1 lent_apart1, cold1 lent_cold1; [a A0])
    (inlined2 lent_inlined2, apart2 lent_apart2, cold2 lent_cold2; [a A0 b A1])
    (inlined3 lent_inlined3, apart3 lent_apart3, cold3 lent_cold3; [a A0 b A1 c A2])
    (inlined4 lent_inlined4, apart4 lent_apart4, cold4 lent_cold4; [a A0 b A1 c A2 d A3])
    (inlined5 lent_inlined5, apart5 lent_apart5, cold5 lent_cold5; [a A0 b A1 c A2 d A3 e A4])
    (inlined6 lent_inlined6, apart6 lent_apart6, cold6 lent_cold6; [a A0 b A1 c A2 d A3 e A4 f A5])
    (inlined7 lent_inlined7, apart7 lent_apart7, cold7 lent_cold7; [a A0 b A1 c A2 d A3 e A4 f A5 g A6])
    (inlined8 lent_inlined8, apart8 lent_apart8, cold8 lent_cold8; [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7])
    (inlined9 lent_inlined9, apart9 lent_apart9, cold9 lent_cold9; [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7 i A8])
    (inlined10 lent_inlined10, apart10 lent_apart10, cold10 lent_cold10; [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7 i A8 j A9])
    (inlined11 lent_inlined11, apart11 lent_apart11, cold11 lent_cold11; [a A0 b A1 c A2 d A3 e A4 f A5 g A6 h A7 i A8 j A9 k A10])
}
