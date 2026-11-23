//! Gets long operations simplified once, before they are copied.
//!
//! LLVM simplifies a function by itself and then inlines it, but the pass that copies what is `#[inline(always)]` comes first. It leaves out those that
//! call themselves. rustc doesn't inline calls of a constant pointer, which are direct calls for LLVM.

/// LLVM finds out once it has inlined `differ`, which is when it looks at the closure.
#[inline(always)]
pub(crate) fn never() -> bool {
    #[inline]
    fn differ(a: *const u8, b: *const u8) -> bool {
        a != b
    }
    let here = 0;
    (const { differ as fn(*const u8, *const u8) -> bool })(&here, &here)
}

#[inline(always)]
pub(crate) fn only_call<F: FnOnce() -> R, R>(f: F) -> R {
    #[inline(always)]
    fn caller<F: FnOnce() -> R, R>(f: F) -> R {
        if never() { caller(f) } else { f() }
    }
    (const { caller::<F, R> as fn(F) -> R })(f)
}

#[inline(always)]
pub(crate) fn apart<S: crate::Isa, A, R>(s: S, f: impl FnOnce(A) -> R, args: A) -> R {
    let f = crate::native::itself(
        #[inline(always)]
        move || f(args),
    );
    s.only_call(f)
}

/// The attributes don't see all closures, and a loop calls its closure in many places. This has the features of the target, and is inlined.
/// Replaces `f`, which takes these arguments.
macro_rules! inlined_here { ($s:expr $(, $f:ident($($arg:ident),*))+) => {
    let s = $s;
    $(let $f = crate::native::itself(#[inline(always)] move |$($arg),*| crate::gate::Enter::only_call(s, #[inline(always)] || $f($($arg),*)));)+
}; }
/// The same for `FnMut`.
macro_rules! inlined_mut { ($s:expr, $f:ident: $F:ty, ($($arg:ident),*)) => {
    let (s, mut $f) = ($s, $f);
    let mut $f = crate::native::itself(#[inline(always)] move |$($arg),*| crate::gate::Enter::only_call(s, #[inline(always)] || $f($($arg),*)));
}; }
pub(crate) use {inlined_here, inlined_mut};
