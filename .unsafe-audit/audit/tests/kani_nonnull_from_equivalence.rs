//! Kani proof harness — C-001 (NonNull::new_unchecked → NonNull::from) equivalence.
//!
//! Formal claim under proof (Pattern P1, C-NULLABLE subclass of cluster C-001):
//!
//!     For every non-null reference `r: &T` where T: Sized,
//!         unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) }
//!     and
//!         NonNull::from(r)
//!     produce a NonNull<T> with the same numeric address (.as_ptr() as usize).
//!
//!     Equivalently for `r: &mut T`:
//!         unsafe { NonNull::new_unchecked(core::ptr::from_mut(r)) }
//!     and
//!         NonNull::from(r)
//!     produce a NonNull<T> with the same address.
//!
//! This is a proposed Kani proof harness for the C-NULLABLE rewrites. It is
//! stronger than sampled unit tests for the address-equality claim if run
//! successfully, but this file is an audit artifact until `cargo kani` is
//! actually executed and the output is recorded.
//!
//! ===========================================================================
//! WHAT KANI VERIFIES HERE
//! ===========================================================================
//!
//! 1. Numeric address equality of the two `NonNull<T>` values for an arbitrary
//!    Sized `T` instantiated at u8, u32, u64, and a 3-field struct.
//! 2. No panic on either construction path under the kani abstract machine.
//!    Kani is not used here as a full Rust provenance / Stacked Borrows oracle;
//!    see "What kani does NOT verify" below.
//!
//! ===========================================================================
//! WHAT KANI DOES *NOT* VERIFY
//! ===========================================================================
//!
//! - Provenance equality at the Rust Abstract Machine level. Kani checks
//!   address; the RAM-level claim "both NonNulls share the same provenance
//!   tag" is asserted in the plan but proven by reading the std source
//!   (`impl<T: ?Sized> From<&T> for NonNull<T>` is documented as preserving
//!   provenance via `NonNull::from_ref`, which internally goes through
//!   `core::ptr::from_ref` + `.cast_mut()` — the exact transformation we are
//!   replacing). Miri is the precise oracle for provenance; kani's job here
//!   is to certify the address-level claim.
//! - !Sized cases (str, [u8], dyn Trait). NonNull::from is defined for
//!   T: ?Sized but Pattern P1 in C-001 only rewrites Sized sites (slice
//!   sites use NonNull::slice_from_raw_parts, see Pattern P3). Adding a
//!   wide-pointer harness is out of scope for this proof.
//! - Lifetime equality. Kani is type-erased at the harness level; the
//!   lifetime preservation claim ("NonNull::from(&T) shares the borrow's
//!   lifetime") is enforced by rustc's borrow checker on the call site, not
//!   here.
//!
//! ===========================================================================
//! HOW TO RUN
//! ===========================================================================
//!
//! Prerequisite (Rust ≥ 1.78, Python 3.8+, ~8 GB RAM):
//!
//!     cargo install --locked kani-verifier
//!     cargo kani setup
//!
//! From a crate that includes this file as a test target:
//!
//!     cargo kani --harness c001_p1_ref_equivalence_u8
//!     cargo kani --harness c001_p1_ref_equivalence_u32
//!     cargo kani --harness c001_p1_ref_equivalence_u64
//!     cargo kani --harness c001_p1_ref_equivalence_struct
//!     cargo kani --harness c001_p1_mut_ref_equivalence_u32
//!
//! Or run all harnesses in this file at once:
//!
//!     cargo kani --tests --filter c001_p1
//!
//! Expected output shape after this harness is wired into a crate and run:
//!
//!     VERIFICATION:- SUCCESSFUL
//!     Verification Time: <seconds>s
//!
//! ===========================================================================
//! CARGO.TOML FRAGMENT
//! ===========================================================================
//!
//! Drop this file into `<crate>/tests/kani_nonnull_from_equivalence.rs` or
//! `<crate>/proofs/kani_nonnull_from_equivalence.rs` and add:
//!
//!     [package.metadata.kani]
//!     # default-unwind = 1   # not needed; these proofs are loop-free
//!
//!     [[test]]
//!     name = "kani_nonnull_from_equivalence"
//!     path = "tests/kani_nonnull_from_equivalence.rs"
//!     harness = false       # kani drives its own harness
//!
//! No new runtime dependencies. Builds and runs under `cargo kani` only;
//! the `#![cfg(kani)]` gate makes `cargo build` / `cargo test` a no-op.
//!
//! ===========================================================================
//! SANITY-CHECK STUB (per skill methodology)
//! ===========================================================================
//!
//! To prove the harness is wired correctly:
//!   1. Replace `NonNull::from(r)` with `NonNull::dangling()` in any one
//!      harness below.
//!   2. Re-run `cargo kani --harness <that one>`.
//!   3. Verify kani reports VERIFICATION:- FAILED with a counter-example on
//!      the `assert_eq!(unchecked_addr, safe_addr)` line.
//!   4. Revert the deliberate break.
//!
//! Recording the sanity check makes the green proof meaningful (an all-green
//! harness that doesn't actually check anything is worse than no proof).

#![cfg(kani)]
#![allow(unused_unsafe)]

use core::ptr::NonNull;

// ---------------------------------------------------------------------------
// Pattern P1, immutable reference case: scalar element types.
// ---------------------------------------------------------------------------

#[kani::proof]
fn c001_p1_ref_equivalence_u8() {
    let x: u8 = kani::any();
    let r: &u8 = &x;

    // The "before" form: exactly the source pattern the plan replaces.
    let unchecked: NonNull<u8> =
        unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) };

    // The "after" form: the proposed safe rewrite.
    let safe: NonNull<u8> = NonNull::from(r);

    // Address equality. Kani explores every value of x; any divergence is a
    // counter-example.
    assert_eq!(unchecked.as_ptr() as usize, safe.as_ptr() as usize);

    // Both pointers must dereference to the same byte (defensive — catches
    // accidental provenance forks that change *what* the pointer reads).
    let a = unsafe { *unchecked.as_ptr() };
    let b = unsafe { *safe.as_ptr() };
    assert_eq!(a, b);
    assert_eq!(a, x);
}

#[kani::proof]
fn c001_p1_ref_equivalence_u32() {
    let x: u32 = kani::any();
    let r: &u32 = &x;

    let unchecked: NonNull<u32> =
        unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) };
    let safe: NonNull<u32> = NonNull::from(r);

    assert_eq!(unchecked.as_ptr() as usize, safe.as_ptr() as usize);
    assert_eq!(unsafe { *unchecked.as_ptr() }, unsafe { *safe.as_ptr() });
}

#[kani::proof]
fn c001_p1_ref_equivalence_u64() {
    let x: u64 = kani::any();
    let r: &u64 = &x;

    let unchecked: NonNull<u64> =
        unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) };
    let safe: NonNull<u64> = NonNull::from(r);

    assert_eq!(unchecked.as_ptr() as usize, safe.as_ptr() as usize);
    assert_eq!(unsafe { *unchecked.as_ptr() }, unsafe { *safe.as_ptr() });
}

// ---------------------------------------------------------------------------
// Pattern P1, immutable reference case: composite (multi-field) type.
//
// Demonstrates that field layout / alignment doesn't perturb the equivalence:
// `&Composite` produces the same address through both wrappings.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
#[repr(C)]
struct Composite {
    a: u8,
    b: u32,
    c: u16,
}

impl kani::Arbitrary for Composite {
    fn any() -> Self {
        Composite {
            a: kani::any(),
            b: kani::any(),
            c: kani::any(),
        }
    }
}

#[kani::proof]
fn c001_p1_ref_equivalence_struct() {
    let x: Composite = kani::any();
    let r: &Composite = &x;

    let unchecked: NonNull<Composite> =
        unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) };
    let safe: NonNull<Composite> = NonNull::from(r);

    assert_eq!(unchecked.as_ptr() as usize, safe.as_ptr() as usize);

    // Field-wise readback equivalence — guards against a hypothetical
    // miscompilation that changes the pointer's interpretation of layout.
    let u = unsafe { &*unchecked.as_ptr() };
    let s = unsafe { &*safe.as_ptr() };
    assert_eq!(u.a, s.a);
    assert_eq!(u.b, s.b);
    assert_eq!(u.c, s.c);
}

// ---------------------------------------------------------------------------
// Pattern P1, mutable reference case.
//
// The plan's `&mut T` rewrite is `NonNull::from(&mut x)`, replacing
// `unsafe { NonNull::new_unchecked(core::ptr::from_mut(r)) }` (or the
// equivalent `r as *mut _` spelling). This harness proves the address
// equality for that form.
// ---------------------------------------------------------------------------

#[kani::proof]
fn c001_p1_mut_ref_equivalence_u32() {
    let mut x: u32 = kani::any();
    let r: &mut u32 = &mut x;

    // We can't take two simultaneous &mut to compare, so take the pointer
    // first (which downgrades the borrow), then construct both wrappers
    // from raw / from the reborrowed &mut. The legal sequence is:
    //
    //   1. p = core::ptr::from_mut(r)     // *mut u32, r is reborrowed-out
    //   2. unchecked = NonNull::new_unchecked(p)
    //   3. r2: &mut u32 = unsafe { &mut *p }  // reuse the same address
    //   4. safe = NonNull::from(r2)
    //
    // Step 3 is sound because we never use `r` after step 1, and the &mut
    // lifetimes do not overlap. Kani checks the assertion against the
    // entire u32 input space.

    let p: *mut u32 = core::ptr::from_mut(r);
    let unchecked: NonNull<u32> = unsafe { NonNull::new_unchecked(p) };

    let r2: &mut u32 = unsafe { &mut *p };
    let safe: NonNull<u32> = NonNull::from(r2);

    assert_eq!(unchecked.as_ptr() as usize, safe.as_ptr() as usize);
    assert_eq!(unchecked.as_ptr() as usize, &x as *const u32 as usize);
}

// ---------------------------------------------------------------------------
// Pattern P1 corollary: `.cast_mut()` is a numeric no-op on a from_ref pointer.
//
// The plan documents that `.cast_mut()` in the source pattern is cosmetic —
// `NonNull<T>` is invariant in T and exposes `.as_ptr() -> *mut T` regardless
// of how the underlying pointer was tagged. This harness pins that claim:
// the address coming out of `from_ref(r).cast_mut()` is bit-identical to the
// address coming out of `from_ref(r)` (cast to usize).
// ---------------------------------------------------------------------------

#[kani::proof]
fn c001_p1_cast_mut_is_address_noop_u32() {
    let x: u32 = kani::any();
    let r: &u32 = &x;

    let const_addr = core::ptr::from_ref(r) as usize;
    let mut_addr = core::ptr::from_ref(r).cast_mut() as usize;

    assert_eq!(const_addr, mut_addr);
    assert_eq!(mut_addr, NonNull::from(r).as_ptr() as usize);
}
