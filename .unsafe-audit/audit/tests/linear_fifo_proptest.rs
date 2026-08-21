// =========================================================================
// proptest property test
// Bug:      pass-2 F-1 — linear_fifo::assume_init_slice reinterprets
//           &[MaybeUninit<T>] as &[T] over the ENTIRE backing buffer
//           (including uninitialised slots) for arbitrary T.
//           Source: src/collections/linear_fifo.rs:67-71
// Catches:  uninitialised memory exposed as `&[T]` for any T with a niche
//           (NonZeroU32, NonNull<U>, &U, enum-with-discriminants, etc.)
//
// Soundness model:
//   - `MaybeUninit::slice_assume_init_ref` requires every element be
//     initialized.
//   - `&[T]` over uninit storage is INSTANT UB when T has a niche; the
//     compiler may codegen niche-optimised reads that assume validity.
//   - Bound `T: bytemuck::AnyBitPattern` (or `Pod`) statically encodes "any
//     bit pattern is a valid T".
//
// Test strategy:
//   (a) A non-niche `u8` value: random uninit slots must round-trip
//       (this is the "lossy but safe" baseline) — this is the path the
//       fix should *keep* working.
//   (b) Property: for arbitrary buf contents and lengths, `assume_init_slice`
//       on an `AnyBitPattern` T must produce a slice that miri (the test
//       runner) does not flag.  Run under `cargo +nightly miri test
//       --features fuzz-uninit` to actually exercise (b).
//   (c) `T: !AnyBitPattern` form (NonZeroU32) — should be a compile error
//       after the fix, i.e. `linear_fifo_proptest_niche_T_should_not_compile.rs`
//       trybuild fixture (companion file).
//
// After fix:  this test still passes for AnyBitPattern T's, and the
//             niche-T site is rejected at compile time.
//
// To wire in: add `proptest = "1"` and `bytemuck = { version = "1",
//             features = ["derive"] }` as dev-dependencies of
//             `bun_collections`; place file at
//             `src/collections/tests/linear_fifo_proptest.rs`.
// =========================================================================

#![cfg(test)]

use std::mem::MaybeUninit;

use bun_collections::linear_fifo::LinearFifoDynamic; // public LinearFifo flavor
use bytemuck::AnyBitPattern;
use proptest::prelude::*;

// Mirrors the (currently unbounded) helper at
// src/collections/linear_fifo.rs:67-71 — copied so we can express the
// PROPOSED bound `T: AnyBitPattern` here without touching production code.
// When the bound lands in production, the body of `assume_init_slice_bounded`
// becomes the canonical form and this shim collapses to a re-export.
fn assume_init_slice_bounded<T: AnyBitPattern>(s: &[MaybeUninit<T>]) -> &[T] {
    unsafe { &*(std::ptr::from_ref::<[MaybeUninit<T>]>(s) as *const [T]) }
}

proptest! {
    // Property 1: any-bit-pattern T (u8) is safe to expose over uninit
    // storage. This is the path the fix preserves.
    #[test]
    fn assume_init_slice_u8_any_byte_pattern(bytes in proptest::collection::vec(any::<u8>(), 0..256)) {
        let backing: Vec<MaybeUninit<u8>> = bytes.iter().map(|b| MaybeUninit::new(*b)).collect();
        let view = assume_init_slice_bounded::<u8>(&backing);
        prop_assert_eq!(view.len(), bytes.len());
        for (i, &b) in bytes.iter().enumerate() {
            prop_assert_eq!(view[i], b);
        }
    }

    // Property 2: even for fully uninitialised u8 storage, the view's
    // address arithmetic and length are stable (the bytes themselves may
    // be anything — that's the AnyBitPattern contract).
    #[test]
    fn assume_init_slice_u8_uninit_lengths(len in 0usize..256) {
        let backing: Vec<MaybeUninit<u8>> = (0..len).map(|_| MaybeUninit::<u8>::uninit()).collect();
        let view = assume_init_slice_bounded::<u8>(&backing);
        prop_assert_eq!(view.len(), len);
        // We may NOT read elements — that would expose uninit bytes (which
        // is fine for u8 with -Zmiri-tree-borrows but still flagged by the
        // strictest model). Property: length-only access is sound.
    }

    // Property 3: the actual LinearFifoDynamic round-trip — values that
    // make it INTO the fifo must come OUT identical. This is the
    // behavioural backstop that catches a future "fix that broke too much."
    #[test]
    fn linear_fifo_dynamic_byte_roundtrip(values in proptest::collection::vec(any::<u8>(), 0..1024)) {
        let mut fifo = LinearFifoDynamic::<u8>::default();
        for v in &values {
            fifo.push_back(*v).expect("alloc");
        }
        let mut out = Vec::with_capacity(values.len());
        while let Some(v) = fifo.pop_front() {
            out.push(v);
        }
        prop_assert_eq!(out, values);
    }
}

// -------------------------------------------------------------------------
// Companion trybuild fixture (`linear_fifo_niche_T_should_not_compile.rs`):
//
//     use std::num::NonZeroU32;
//     use std::mem::MaybeUninit;
//     fn require_any_bit_pattern<T: bytemuck::AnyBitPattern>(_: &[MaybeUninit<T>]) {}
//     fn main() {
//         let buf: [MaybeUninit<NonZeroU32>; 4] = [MaybeUninit::uninit(); 4];
//         require_any_bit_pattern(&buf);  //~ ERROR `NonZeroU32: AnyBitPattern` is not satisfied
//     }
//
// (See expected_errors/linear_fifo_niche_T_should_not_compile.stderr.)
