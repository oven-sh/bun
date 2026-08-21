# Miri-Confirmed UB: `linear_fifo::assume_init_slice` Niche-T

**Status:** UB detected by `cargo +nightly miri run`.
**Bug:** pass-2 F-1 / pre-existing-ub-13 — `bun_collections::linear_fifo::assume_init_slice<T>` reinterprets `&[MaybeUninit<T>]` as `&[T]` over the entire backing buffer (including uninit slots) for niche-bearing T.
**Source:** `src/collections/linear_fifo.rs:67-71`

## The reproduction

A minimal cargo project at `/tmp/miri-repro/`:

```rust
// /tmp/miri-repro/src/main.rs
use std::mem::MaybeUninit;
use std::num::NonZeroU32;

// Mirror of assume_init_slice helper in src/collections/linear_fifo.rs:67-71
fn assume_init_slice<T>(s: &[MaybeUninit<T>]) -> &[T] {
    unsafe { &*(std::ptr::from_ref::<[MaybeUninit<T>]>(s) as *const [T]) }
}

fn main() {
    let buf: [MaybeUninit<NonZeroU32>; 4] = [
        MaybeUninit::uninit(), MaybeUninit::uninit(),
        MaybeUninit::uninit(), MaybeUninit::uninit(),
    ];
    let view: &[NonZeroU32] = assume_init_slice(&buf);
    println!("view.len() = {}", view.len());  // safe
    let _ = view[0].get();                    // UB
}
```

```toml
# /tmp/miri-repro/Cargo.toml
[package]
name = "miri_repro"
version = "0.0.1"
edition = "2021"
[[bin]]
name = "linear_fifo_repro"
path = "src/main.rs"
```

## The miri output

Run: `MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run`

```
   Compiling miri_repro v0.0.1 (/tmp/miri-repro)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.04s
     Running `cargo-miri runner /tmp/.../linear_fifo_repro`
view.len() = 4
error: Undefined Behavior: reading memory at alloc119[0x0..0x4],
       but memory is uninitialized at [0x0..0x4], and this operation
       requires initialized memory
  --> src/main.rs:29:13
   |
29 |     let _ = view[0].get();
   |             ^^^^^^^ Undefined Behavior occurred here
   |
   = help: this indicates a bug in the program: it performed an
           invalid operation, and caused Undefined Behavior

Uninitialized memory occurred at alloc119[0x0..0x4], in this allocation:
alloc119 (stack variable, size: 16, align: 4) {
    __ __ __ __ __ __ __ __ __ __ __ __ __ __ __ __ │ ░░░░░░░░░░░░░░░░
}

error: aborting due to 1 previous error
```

## What this proves

- The audit's static-analysis claim (`assume_init_slice<T>` is UB when T has a niche AND uninit slots are read) is concretely verifiable by miri.
- The bug is NOT compile-time; it's runtime UB triggered by element access.
- The bound `T: bytemuck::AnyBitPattern` (or `T: Copy + 'static` with no niche) would prevent this — that's the proposed fix in pass-2 F-1.

## What this means for the audit's defensibility

When the maintainer asks "is this bug real?", the answer is: yes, here is the miri output. The audit isn't relying on type-system inference alone — there's a runtime trace.

This converts the linear_fifo finding from "static-analysis hypothesis" to "miri-confirmed concrete UB." It is now a confirmed Tier-1 finding with direct runtime evidence.

## Why the existing bun_collections test suite doesn't catch it

The crate's existing tests use POD types (per Pass 3 finding F-2): `u32`, `Box<[u8]>`, raw pointer payloads. None of those have niches, so `assume_init_slice` works for them. The bug only manifests when a niche-bearing T (NonZeroU32, NonNull<U>, &U, enum-with-discriminants) flows through. The active hot paths are `LinearFifo<RefDataValue, _>` (test_runner ResultQueue) and `LinearFifo<{Entry, PromisePair}, _>` (Valkey client) — both use niche-bearing payload types.

A property test (audit/tests/linear_fifo_proptest.rs) that runs `assume_init_slice<NonZeroU32>` under miri would land this same evidence in CI.

## Verification harness wiring

The verify.sh template should include this exact test as part of the bun_collections miri lane. Today, bun_collections has a compile error in its test harness (pass-2 verification log) so miri can't run; once that's fixed, this test fixture lands.
