//! The list `no_downclock`.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![cfg(not(any(bun_simd_native = "16", bun_simd_native = "32", bun_simd_native = "64")))]
use bun_simd::prelude::*;
use bun_simd::target::{Target, cpu, reset_cpu, set_cpu};

#[kernel(no_downclock)]
fn alone() -> (usize, bool) {
    (Native::<S>::BYTES, has!(icelake))
}
#[kernel]
fn usual() -> (usize, bool) {
    (Native::<S>::BYTES, has!(icelake))
}
#[kernel(neon82 + sha3, no_downclock, sse2 + "popcnt")]
fn among_others() -> usize {
    Native::<S>::BYTES
}
#[simd(no_downclock, sse2 + "popcnt")]
mod module {
    use bun_simd::prelude::*;
    #[only(B64)]
    fn twin(v: u8xN<S>) -> usize {
        u8x64::<S>::to_array(v).len()
    }
    #[only(B32)]
    fn twin(v: u8xN<S>) -> usize {
        u8x32::<S>::to_array(v).len()
    }
    #[only(B16)]
    fn twin(v: u8xN<S>) -> usize {
        u8x16::<S>::to_array(v).len()
    }
    #[only(icelake)]
    fn level() -> bool {
        true
    }
    #[except(icelake)]
    fn level() -> bool {
        false
    }
    #[kernel]
    pub fn both() -> (usize, bool) {
        (twin(u8xN::zero()), level())
    }
}
mod file {
    use bun_simd::prelude::*;
    targets!(no_downclock);
    #[only(icelake | narrow)]
    fn yes() -> bool {
        true
    }
    #[kernel]
    pub fn both() -> (usize, bool) {
        (pick! { B64 => 64, B32 => 32, _ => 16 }, pick! { icelake | narrow => yes(), _ => false })
    }
}

/// In one test, as the choice holds for all threads.
#[test]
fn the_width_follows_the_cpu() {
    for it in Target::ALL.iter().copied().chain([cpu()]) {
        for (it, wide) in [(it.without("fast_zmm"), 32), (it.with("fast_zmm"), 64)] {
            if set_cpu(it) {
                let want = (usual().0.min(wide), usual().1);
                assert_eq!(
                    (alone(), module::both(), file::both(), among_others()),
                    (want, want, want, want.0),
                    "{it:?}"
                );
            }
        }
    }
    reset_cpu();
}
