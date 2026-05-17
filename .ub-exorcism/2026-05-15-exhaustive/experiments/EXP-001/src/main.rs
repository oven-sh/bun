// EXP-001: linear_fifo::assume_init_slice<T> for niche-bearing T
// Mirror of src/collections/linear_fifo.rs:67-71 in Bun.

use std::mem::MaybeUninit;
use std::num::NonZeroU32;

fn assume_init_slice<T>(s: &[MaybeUninit<T>]) -> &[T] {
    // Same shape: cast &[MaybeUninit<T>] to &[T] for the whole buffer.
    unsafe { &*(std::ptr::from_ref::<[MaybeUninit<T>]>(s) as *const [T]) }
}

fn main() {
    let buf: [MaybeUninit<NonZeroU32>; 4] = [
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
        MaybeUninit::uninit(),
    ];
    let view: &[NonZeroU32] = assume_init_slice(&buf);
    println!("view.len() = {}", view.len()); // safe
    let _ = view[0].get(); // UB: reads uninit niche
}
