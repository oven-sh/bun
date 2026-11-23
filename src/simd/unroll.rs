//! `unroll!`.

macro_rules! text { () => { "A loop that is always unrolled, and whose index is a constant.

The index is a `usize`. The start is a literal or a constant, also a `const` parameter, and the end a literal up to 64 or a constant up to 16. A list of literals below 64, such as `[6, 4, 2]`, is for other steps. The compiler unrolls other loops only if they are short, and arrays
of vectors that a loop indexes stay in memory if it does not. The body is repeated, so `break` and `continue` in it mean the loop around this one.
As the index is a constant, a closure, `let`, `for` or pattern in the body needs another name for what it binds.
With a constant as the start or the end, the rounds outside of the range are compiled too, and an index out of bounds is a panic, not an error of the compiler.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
let (v, mut sum) = (u32x4::iota(1), u32x4::zero());
unroll!(for i in 0..4 { sum += v.splat_lane::<i>() });
unroll!(for i in 2..4 { sum += v.splat_lane::<{ i - 1 }>() });
assert_eq!(sum, 15);
# } example()
```" }; }
#[cfg(doc)]
#[doc = text!()]
#[macro_export]
macro_rules! unroll {
    (for $i:tt in $($range_and_body:tt)*) => {{}};
}

#[rules]
macro_rules! define {
    ([$($arms:tt)*] [$($done:tt)*] $next:tt $name:ident $end:tt $($rest:tt)*) => {
        #[doc(hidden)]
        #[allow(non_upper_case_globals)]
        pub const $name: usize = $next; // The index of unroll! has this name: take another.
        define! { [$($arms)* ($next $end [$($done)* $name])] [$($done)* $name] $end $($rest)* }
    };
    ([$(($before:tt $end:tt [$($k:tt)*]))*] $done:tt $last:tt) => {
        #[cfg(not(doc))]
        #[doc = text!()]
        #[macro_export]
        macro_rules! unroll {
            (for _ in $$($$rest:tt)*) => { $$crate::unroll!(for __unroll_index in $$($$rest)*) };
            (for $$i:ident in [$$($$at:tt),+ $$(,)?] $$body:block) => {{ $$(let () = $$crate::unroll!(for $$i in $$at..=$$at $$body);)+ }};
            $((for $$i:ident in 0..$end $$body:block) => {{$({
                use $$crate::__index::$k as $$i;
                $$body
            })*}};)*
            $((for $$i:ident in $$start:tt..$end $$body:block) => { $$crate::unroll!(@from $$start [$($k)*] $$i [] $$body) };)*
            (for $$i:ident in $$start:tt..$$end:tt $$body:block) => {{
                const { $$crate::__core::assert!($$end <= 16, "the end of `unroll!` is a literal up to 64, or a constant up to 16, and each index is less") };
                $$crate::unroll!(@from $$start [i0 i1 i2 i3 i4 i5 i6 i7 i8 i9 i10 i11 i12 i13 i14 i15] $$i [$$end] $$body)
            }};
            $((for $$i:ident in $$start:tt..=$before $$body:block) => { $$crate::unroll!(for $$i in $$start..$end $$body) };)*
            (for $$i:ident in $$start:tt..=$$end:tt $$body:block) => { $$crate::unroll!(for $$i in $$start..($$end + 1) $$body) };
            // Longer expressions get parentheses.
            (for $$i:ident in $$start:tt..$$($$rest:tt)*) => { $$crate::unroll!(@end [$$i in $$start..] [] $$($$rest)*) };
            (for $$i:ident in $$start:tt..=$$($$rest:tt)*) => { $$crate::unroll!(@end [$$i in $$start..=] [] $$($$rest)*) };
            (for $$i:ident in $$($$rest:tt)*) => { $$crate::unroll!(@start $$i [] $$($$rest)*) };
            (@start $$i:ident [$$($$start:tt)+] ..$$($$rest:tt)*) => { $$crate::unroll!(for $$i in ($$($$start)+)..$$($$rest)*) };
            (@start $$i:ident [$$($$start:tt)+] ..=$$($$rest:tt)*) => { $$crate::unroll!(for $$i in ($$($$start)+)..=$$($$rest)*) };
            (@start $$i:ident [$$($$start:tt)*] $$next:tt $$($$rest:tt)*) => { $$crate::unroll!(@start $$i [$$($$start)* $$next] $$($$rest)*) };
            (@end [$$i:ident in $$start:tt $$to:tt] [$$($$end:tt)+] $$body:block) => { $$crate::unroll!(for $$i in $$start $$to ($$($$end)+) $$body) };
            (@end $$head:tt [$$($$end:tt)*] $$next:tt $$($$rest:tt)+) => { $$crate::unroll!(@end $$head [$$($$end)* $$next] $$($$rest)+) };
            $((@from $end [$($k)* $$($$rest:ident)*] $$i:ident $$to:tt $$body:block) => { $$crate::unroll!(@from 0 [$$($$rest)*] $$i $$to $$body) };)*
            (@from 0 [$$($$all:ident)*] $$i:ident [] $$body:block) => {{$$({
                use $$crate::__index::$$all as $$i;
                $$body
            })*}};
            (@from $$start:tt $$all:tt $$i:ident [] $$body:block) => { $$crate::unroll!(@from $$start $$all $$i [64] $$body) };
            (@from $$start:tt $$all:tt $$i:ident [$$end:tt] $$body:block) => { $$crate::unroll!(@between $$start, $$end; $$all $$i $$body) };
            // The lints look at the rounds outside of a range of generic parameters. The index can hide a name that is in the range.
            (@between $$start:expr, $$end:expr; [$$($$all:ident)*] $$i:ident $$body:block) => {{$$({
                #[allow(clippy::out_of_bounds_indexing, unconditional_panic, arithmetic_overflow)]
                if const { $$crate::__index::$$all >= $$start && $$crate::__index::$$all < $$end } {
                    use $$crate::__index::$$all as $$i;
                    $$body
                }
            })*}};
            ($$($$other:tt)*) => {
                $$crate::__core::compile_error!("`unroll!` takes `for i in start..end { .. }`, with constants. Other steps: literals, as in `for i in [6, 4, 2]`, or `2 * i` in the body")
            };
        }
    };
}
// An import needs no allow(..) for its name, which forbid(..) of the consumer would refuse.
define! { [] []
    0 i0 1 i1 2 i2 3 i3 4 i4 5 i5 6 i6 7 i7 8 i8 9 i9 10 i10 11 i11 12 i12 13 i13 14 i14 15 i15 16 i16 17 i17 18 i18
    19 i19 20 i20 21 i21 22 i22 23 i23 24 i24 25 i25 26 i26 27 i27 28 i28 29 i29 30 i30 31 i31 32 i32 33 i33 34 i34
    35 i35 36 i36 37 i37 38 i38 39 i39 40 i40 41 i41 42 i42 43 i43 44 i44 45 i45 46 i46 47 i47 48 i48 49 i49 50 i50
    51 i51 52 i52 53 i53 54 i54 55 i55 56 i56 57 i57 58 i58 59 i59 60 i60 61 i61 62 i62 63 i63 64
}
