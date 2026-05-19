# Phase 0 Preflight — Anchored Witness Reproducers

Standalone Miri preflight runs validating that the 5 seeded `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md` reproducers actually reproduce the prior-audit witness signal. These are **pattern-level** verifications; they confirm the witness shape is UB under Miri but do **not** yet prove the current Bun source still uses each shape. That re-verification is the job of Phase 1 section subagents (current source matches the pattern?) and Phase 5 experiment-executors (run against current Bun tree).

| EXP | Reproducer | Status | Miri error (truncated) | Notes |
|-----|------------|--------|------------------------|-------|
| EXP-001 | `experiments/EXP-001/src/main.rs` (linear_fifo assume_init_slice<NonZeroU32>) | ✓ UB | `reading memory at alloc119[0x0..0x4], but memory is uninitialized` | matches prior witness verbatim |
| EXP-002 | `experiments/EXP-002/src/main.rs` (GetErrno transmute u16→SystemErrno) | ✓ UB | `constructing invalid value of type SystemErrno: at .<enum-tag>, encountered 0x0086, but expected a valid enum tag` | matches prior witness verbatim |
| EXP-003 | `experiments/EXP-003/src/main.rs` (HasInstallScript from lockfile byte 0x2a) | ✓ UB | `enum value has invalid tag: 0x2a` | matches prior witness verbatim |
| EXP-004 | `experiments/EXP-004/src/main.rs` (Vec<u8>→Vec<u16> drop) | ✓ UB | allocator-layout mismatch on `Vec::<u16>::drop` | matches prior witness |
| EXP-005 | `experiments/EXP-005/src/main.rs` (yarn.rs &mut [Dependency] over uninit Vec capacity) | ✓ UB | `Uninitialized memory occurred at alloc211[0x0..0x4]` | required niche-bearing field (NonZeroU32) to fire; matches prior; needs `-Zmiri-ignore-leaks` flag |

## Toolchain validation results

- `rustc 1.97.0-nightly (f53b654a8 2026-04-30)` ✓
- `cargo +nightly miri` ✓
- The `[workspace]` stub pattern works for detaching experiment reproducers from Bun's parent workspace — every standalone repro needs `[workspace]` (empty table) in its Cargo.toml or `cargo metadata` fails workspace-discovery.
- MIRIFLAGS matrix per anchored witness:
  - aliasing / niche / validity → `-Zmiri-strict-provenance`
  - allocator-layout → `-Zmiri-symbolic-alignment-check`
  - intentional leaks (forget()) → add `-Zmiri-ignore-leaks`

Do **not** add the stale `-Zmiri-check-number-validity` flag on this machine's
nightly (`1.97.0-nightly f53b654a8`): Miri rejects it as an unknown unstable
option. Plain Miri already reports invalid enum/niche values for the seeded
validity witnesses.

## What this means for Phase 5

The 5 anchored witnesses are now confirmed reproducible at the pattern level on this machine with the current nightly. When Phase 5 re-runs them against the current Bun source tree, the only open question per witness is **does the source still match the pattern?** Section O / L / A / P / R Phase-1 subagents will return that answer.

If a section subagent reports "shape changed" or "RESOLVED", the corresponding EXP's verdict transitions:
- pattern unchanged + section confirms current source still matches → `CONFIRMED_UB`
- pattern unchanged + section reports source has been patched → `RESOLVED` (record patch commit in Notes)
- pattern changed in subtle way → `NEEDS_REFINEMENT` (refine repro to match current shape)

## Raw logs

Per-EXP raw Miri output: `phase5_experiment_results/EXP-00{1..5}_preflight.log`.
