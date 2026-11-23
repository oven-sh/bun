//! A value of a type that generic code knows by two names.

use core::any::TypeId;

/// Panics if the types differ. By way of `Any`, each call leaves a branch that LLVM only removes after inlining, in quadratic time.
#[inline(always)]
pub fn same<A: Copy + 'static, B: Copy + 'static>(value: A) -> B {
    if const { size_of::<A>() == size_of::<B>() } && {
        let (a, b) = (const { &TypeId::of::<A>() }, const { &TypeId::of::<B>() });
        // Without optimization, this saves a call.
        cfg!(bun_simd_unoptimized) && a as *const TypeId == b as *const TypeId || *a == *b
    } {
        // SAFETY: it is one type.
        #[allow(unsafe_code)]
        return unsafe { *(&raw const value as *const B) };
    }
    unreachable!()
}
