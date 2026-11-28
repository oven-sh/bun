// Helpers for tests of loops.
use bun_simd::{generic::*, target::*};

const SOME: Targets = Targets(&[
    target!(icelake),
    target!(avx512 + aes),
    target!(avx2 + aes),
    target!(sse4),
    target!(sve2 + aes + sha3),
    target!(neon),
    target!(wasm),
]);
/// All targets take minutes to compile.
fn on_each(mut run: impl FnMut()) {
    static ONE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _one = ONE.lock();
    for &target in SOME.0.iter().chain([&Target::Portable]) {
        if set_cpu(target) {
            run()
        }
    }
    reset_cpu()
}
fn values<T: Lane>(n: usize, seed: u64) -> Vec<T> {
    (0..n as u64).map(|i| T::from_u64((i + seed).wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 40 | 2)).collect()
}
/// From a multiple of 128 bytes on.
fn aligned<T>(all: &mut [T]) -> &mut [T] {
    let skip = all.as_ptr().addr().wrapping_neg() % 128 / size_of::<T>();
    &mut all[skip..]
}
