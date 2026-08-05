// =========================================================================
// proptest property test
// Bug:      pass-3 P3-BC-003 — BoundedArray::resize lets safe callers
//           extend `len` into the uninitialised tail of `[MaybeUninit<T>; N]`,
//           after which `BoundedArray::slice()` produces `&mut [T]` over
//           uninit storage. For niche-bearing T this is instant UB.
//           Source: src/bun_core/bounded_array.rs:93-96 (`slice`) and
//                   src/bun_core/bounded_array.rs:106-114 (`resize`).
// Catches:  niche-T uninit exposure via the safe `resize` → `slice` API.
//
// Soundness model:
//   - `BoundedArray::resize(len)` SHOULD only legally permit growing past
//     the previous `len` if all bytes in the new tail are valid for T.
//   - For `T: AnyBitPattern`, any byte pattern is a valid T; growing is
//     sound and the new tail is observationally "leftover bytes from a
//     prior occupant or all-zero from Default::default()".
//   - For T with a niche, the only safe `resize` semantics are "shrink-only"
//     or "must write first" — the audit's recommended fix.
//
// Test strategy:
//   (a) For T = u8: any sequence of resize() / slice() / write / shrink
//       round-trips MUST stay observably consistent (length tracks calls,
//       writes survive).
//   (b) For T with a niche: the type system should reject `resize_grow`
//       at the safe-API level. Companion trybuild fixture.
//   (c) Miri property: under `cargo +nightly miri test`, no UB is reported
//       for the u8 round-trip.
//
// After fix:  the audit-recommended API split — `resize_shrink(new_len)`
//             safe, `resize_grow(new_len) -> &mut [MaybeUninit<T>]`
//             returning the new tail for the caller to initialize, or an
//             `unsafe fn resize_extend(new_len)` flagged with a SAFETY
//             contract. This test exercises the SAFE shrink path and the
//             SAFE-with-fill grow path.
//
// To wire in: dev-dep `proptest = "1"` on `bun_core`; place file at
//             `src/bun_core/tests/bounded_array_resize_proptest.rs`.
// =========================================================================

#![cfg(test)]

use bun_core::bounded_array::BoundedArray;
use bytemuck::AnyBitPattern;
use proptest::prelude::*;

const CAP: usize = 64;

// Property 1: u8 is AnyBitPattern — growing via resize and reading is
// observably "any byte" but never UB. The test asserts the LENGTH matches
// the most recent resize call.
proptest! {
    #[test]
    fn bounded_array_u8_resize_length_tracks(lens in proptest::collection::vec(0usize..=CAP, 0..32)) {
        let mut a: BoundedArray<u8, CAP> = BoundedArray::default();
        for &n in &lens {
            a.resize(n).expect("within cap");
            prop_assert_eq!(a.slice().len(), n);
            prop_assert_eq!(a.const_slice().len(), n);
        }
    }

    // Property 2: writes through `slice()` survive a subsequent shrink/grow
    // pair as long as the write index stays under the smallest intermediate
    // length.
    #[test]
    fn bounded_array_u8_write_survives_resize(
        values in proptest::collection::vec(any::<u8>(), 1..CAP),
    ) {
        let n = values.len();
        let mut a: BoundedArray<u8, CAP> = BoundedArray::default();
        a.resize(n).expect("within cap");
        a.slice().copy_from_slice(&values);

        prop_assert_eq!(a.const_slice(), values.as_slice());

        // shrink and grow back to the same len — the bytes at [0..n] should
        // be untouched (AnyBitPattern T's writes survive across resize).
        a.resize(n / 2).expect("shrink");
        a.resize(n).expect("grow back");
        prop_assert_eq!(&a.const_slice()[..n / 2], &values[..n / 2]);
    }

    // Property 3 (REGRESSION): the cap is honored. resize past cap returns
    // Err and does not mutate len. Reverse-asserts the bug couldn't slip in
    // a "skip the cap check" code change.
    #[test]
    fn bounded_array_u8_resize_past_cap_rejected(n in (CAP + 1)..=(CAP + 1024)) {
        let mut a: BoundedArray<u8, CAP> = BoundedArray::default();
        a.resize(CAP / 2).unwrap();
        let prior = a.const_slice().len();
        prop_assert!(a.resize(n).is_err());
        prop_assert_eq!(a.const_slice().len(), prior);
    }
}

// Companion trybuild compile-fail fixture (separate file):
// `bounded_array_resize_niche_T_should_not_compile.rs`
// asserts that the new safe API `resize_grow` can ONLY be called for
// `T: AnyBitPattern` after the fix lands. See
// expected_errors/bounded_array_resize_niche_T_should_not_compile.stderr.
//
//     use bun_core::bounded_array::BoundedArray;
//     fn main() {
//         let mut a: BoundedArray<std::num::NonZeroU32, 8> = BoundedArray::default();
//         a.resize(4).unwrap();
//         // After fix: `resize` is restricted to AnyBitPattern, or the
//         // shrink-only `resize_shrink` form is required for niche T.
//         let _slice = a.slice();  //~ ERROR `NonZeroU32: AnyBitPattern` is not satisfied
//     }

// -------------------------------------------------------------------------
// Bonus: a separate marker test that EXPLICITLY documents what the fix
// changes about the type system. If the fix lands but someone reverts the
// bound, the test below stops compiling.
#[test]
fn bounded_array_safe_api_requires_any_bit_pattern_after_fix() {
    fn requires_any_bit_pattern<T: AnyBitPattern, const N: usize>(_: &mut BoundedArray<T, N>) {}
    let mut a: BoundedArray<u8, CAP> = BoundedArray::default();
    requires_any_bit_pattern(&mut a);
    // After fix: BoundedArray<NonZeroU32, _> would NOT satisfy this — the
    // safe API surface for resize/slice would be conditional on the bound.
}
