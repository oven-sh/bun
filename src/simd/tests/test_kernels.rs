//! Kernels that are tests, or for tests.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]

#[bun_simd::simd]
mod m {
    use bun_simd::prelude::*;
    fn next(v: u8x16<S>) -> u8x16<S> {
        v + 1
    }
    #[cfg(test)]
    #[kernel]
    pub fn first(x: &[u8]) -> u8 {
        next(u8x16::load(x))[0]
    }
    #[cfg(test)]
    #[kernel]
    pub fn scalar<T: Copy>(x: T) -> T {
        x
    }
    #[test]
    #[kernel]
    fn a_test() {
        assert_eq!(next(u8x16::splat(1))[0], 2)
    }
    #[shared]
    fn same(x: u8) -> u8 {
        x
    }
    #[test]
    fn no_kernel() {
        assert_eq!(same(first(&[1; 16])), 2)
    }
    #[test]
    #[kernel(avx2, neon)]
    #[except(icelake)]
    fn restricted() {
        assert!(u8xN::splat(1).reduce_sum() <= 32 || cfg!(bun_simd_native = "64"))
    }
    mod picks {}
    #[kernel(avx2, neon)]
    #[test]
    fn picks() -> Result<(), u8> {
        pick! { avx2 => Ok(()), _ => Ok(()) }
    }
    #[test]
    #[should_panic]
    #[kernel]
    fn panics() {
        assert_eq!(next(u8x16::splat(1))[0], 1)
    }
}

#[test]
fn for_tests() {
    assert_eq!((m::first(&[1; 16]), m::scalar::baseline(3)), (2, 3))
}
