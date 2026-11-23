// What over.rs and over_ints.rs share.
use bun_simd::{mem::*, target::*, text::*, *};
use core::{cell::Cell, mem::MaybeUninit, sync::atomic::AtomicU8};

fn random(len: usize, mut seed: u64) -> impl Iterator<Item = u64> {
    (0..len).map(move |_| {
        seed = seed.wrapping_mul(0x5851_f42d_4c95_7f2d).wrapping_add(0x1405_7b7e_f767_814f);
        seed >> 33
    })
}
/// On the default targets only: all of them take minutes to compile.
fn on_each(run: impl Fn()) {
    static ONE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _one = ONE.lock();
    for &target in Targets::DEFAULT.0.iter().chain([&Target::Portable]) {
        if set_cpu(target) {
            run()
        }
    }
    reset_cpu()
}
