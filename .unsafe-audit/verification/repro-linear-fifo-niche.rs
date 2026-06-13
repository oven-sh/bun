// Compile-time witness for the linear_fifo::assume_init_slice niche-T bug
// found in src/collections/linear_fifo.rs:68-80.
//
// Run with: rustc this_file.rs -o /tmp/repro_fifo && /tmp/repro_fifo
//
// Default mode proves the bad API shape compiles for a niche-bearing T. It
// does not read the invalid element, so it is not by itself a Miri-triggering
// UB reproduction. To turn it into a Miri witness, compile/run with
// `--cfg miri_trigger` under Miri and execute the gated element read below.
//
// The bug: assume_init_slice reinterprets &[MaybeUninit<T>] as &[T] over the
// ENTIRE backing buffer (incl uninitialized slots) for arbitrary T. If T has
// a niche (NonNull, NonZeroU32, Reference, enum with explicit discriminants),
// the uninitialized slots can hold invalid bit patterns → UB on slice access.
//
// Active hot paths in Bun: LinearFifo<RefDataValue, _> (test_runner ResultQueue)
// and LinearFifo<{Entry, PromisePair}, _> (Valkey client). Both use niche-bearing
// types — confirmed exploit potential.

use std::mem::MaybeUninit;

// Mirror of bun_collections::linear_fifo's assume_init_slice helper:
fn assume_init_slice<T>(s: &[MaybeUninit<T>]) -> &[T] {
    // SAFETY: see fn doc.
    unsafe { &*(std::ptr::from_ref::<[MaybeUninit<T>]>(s) as *const [T]) }
}

// A niche-bearing T (NonZeroU32 has a niche at value 0):
type NicheT = std::num::NonZeroU32;

fn main() {
    // Allocate a LinearFifo-style backing buffer:
    //   8 slots, all uninitialized (i.e., all zero or garbage).
    let buf: [MaybeUninit<NicheT>; 8] = [
        MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(),
        MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(), MaybeUninit::uninit(),
    ];

    // The buggy cast:
    let view: &[NicheT] = assume_init_slice(&buf);

    // Reading any element is UB because uninit MaybeUninit may contain a
    // zero (invalid NonZeroU32 discriminant) or garbage that isn't a valid
    // NonZeroU32 layout. Even reading the LENGTH might be fine; touching
    // an element is the boom.
    //
    // Below: reading view[0].get() *might* succeed if uninit memory
    // happens to be nonzero, or *might* fire an unreachable_unchecked-style
    // crash in release builds via niche optimization. The behavior is
    // unpredictable, which is exactly the failure mode UB produces.
    //
    // Conservative witness: just demonstrate that the cast compiles
    // for NicheT without any bound — that itself is sufficient evidence
    // of the soundness defect (a soundness fix would forbid this cast for
    // niche T at compile time).

    println!("assume_init_slice<NonZeroU32> compiled — API bug witness.");

    // Reading is UB; gated so the default witness remains safe to run.
    #[cfg(miri_trigger)]
    {
        // Miri should flag the read of uninitialized / invalid NonZeroU32.
        std::hint::black_box(view[0].get());
    }

    let _ = view.len();  // length is safe; element access is the trap.
}

// THE FIX: bound `T: ZeroableBitPattern` or similar, AND/OR narrow the slice
// to the initialized prefix only:
//
// fn assume_init_slice<T: bytemuck::AnyBitPattern>(s: &[MaybeUninit<T>]) -> &[T] {
//     // Now only valid for T where any bit pattern is a valid T.
//     unsafe { &*(std::ptr::from_ref::<[MaybeUninit<T>]>(s) as *const [T]) }
// }
//
// OR use MaybeUninit::slice_assume_init_ref over only the initialized prefix:
//
// pub fn slice_initialized<T>(s: &[MaybeUninit<T>], init_len: usize) -> &[T] {
//     unsafe { MaybeUninit::slice_assume_init_ref(&s[..init_len]) }
// }
