// EXP-033: bun_threading::Channel::{try_read_item, read_item} materialize
// a &mut [T] over [MaybeUninit<T>; 1].
//
// Mirrors src/threading/channel.rs:121-142, 208-242 in Bun.
//
// The real code path:
//
//     let mut items: [MaybeUninit<T>; 1] = [MaybeUninit::uninit()];
//     let slice = unsafe { &mut *items.as_mut_ptr().cast::<[T; 1]>() };
//
// Important source-faithfulness constraint: Bun's Channel impl is currently
// `impl<T: Copy, B: LinearFifoBuffer<T>>`, so the witness must use a Copy type.
// `Copy` does not mean "all byte patterns, including uninitialized bytes, are
// valid T values." `bool` is Copy and has a strict validity invariant.
//
// The UB is the creation of a `&mut [bool; 1]` whose referent is still
// uninitialized. A correct implementation should keep this storage typed as
// MaybeUninit<T> until the slot has actually been written.

use core::mem::MaybeUninit;

fn channel_read_items_shape() {
    // Step 1: mirror the Channel buffer.
    let mut items: [MaybeUninit<bool>; 1] = [MaybeUninit::uninit()];

    // Step 2: mirror the unsound cast in try_read_item / read_item:
    //     let slice = unsafe { &mut *items.as_mut_ptr().cast::<[T; 1]>() };
    let slice: &mut [bool; 1] = unsafe { &mut *items.as_mut_ptr().cast::<[bool; 1]>() };

    // If Miri permits the reference materialization, force a read so the
    // invalid uninitialized bool is observed.
    if std::hint::black_box(slice[0]) {
        std::hint::black_box(());
    }
}

fn main() {
    channel_read_items_shape();
}
