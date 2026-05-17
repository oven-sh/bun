# Codex Unchecked-Intrinsics Sweep — 2026-05-16

Scope: targeted `/rust-undefined-behavior-exorcist` follow-up for unchecked
impossible-state APIs: `unreachable_unchecked`, `unwrap_unchecked`,
`assert_unchecked`/`assume`, unchecked indexing, and unchecked UTF-8.

## Raw Search

```bash
rg -n --glob '*.rs' 'unwrap_unchecked|unreachable_unchecked|hint::assert_unchecked|core::intrinsics::assume|std::intrinsics::assume|assume\(' /data/projects/bun/src
rg -n --glob '*.rs' 'get_unchecked|get_unchecked_mut|from_utf8_unchecked|from_utf8_unchecked_mut|from_raw_parts|set_len\(|assume_init' /data/projects/bun/src
```

The existing registry already covered the major live families:

- EXP-007 / EXP-008 / EXP-009: attacker-controlled `get_unchecked` paths.
- EXP-084: `VirtualMachine` safe TLS-backed `unwrap_unchecked` trap.
- EXP-085: safe `fmt::Raw` / `fmt::s` invalid-UTF-8 path.
- NEW-V-4: active `unreachable_unchecked` exhaustiveness watchlist for
  dispatch, bundle-completion, and generated JSC tagged unions.
- Phase-2 Bucket 5: `MaybeUninit` / `set_len` / `assume_init` hazards.

## New Promotion: EXP-086

`src/bun.rs:1582-1586` defines:

```rust
pub fn unsafe_assert(condition: bool) {
    if !condition {
        unsafe { core::hint::unreachable_unchecked() };
    }
}
```

This helper is currently dormant:

```text
rg -n 'unsafe_assert\(' /data/projects/bun/src --glob '*.rs'
/data/projects/bun/src/bun.rs:1582:pub fn unsafe_assert(condition: bool) {
```

But as a Rust API contract it is still unsound: a safe function accepts a
caller-controlled boolean and invokes UB for `false`. The name says "unsafe",
but the type signature does not. I promoted this to EXP-086 and added a Miri
witness:

```text
error: Undefined Behavior: entering unreachable code
 --> src/main.rs:5:18
  |
5 |         unsafe { core::hint::unreachable_unchecked() };
  |                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ Undefined Behavior occurred here
```

Correct framing: **safe helper contract defect, no current production
reachability claim**.

## Reviewed But Not Promoted

- `src/bundler/transpiler.rs:1926`: outer loader match proves the five loader
  arms before the fallback; keep as watchlist/hardening, not confirmed UB.
- `src/event_loop/MiniEventLoop.rs:311`: `None` arm is after writing `Some`
  into the same slot through `addr_of_mut!`; defensible local assertion.
- `src/install/PackageManagerTask.rs:284,542`: enum destructuring after local
  construction / status guards; brittle but source-local.
- `src/install/lockfile/Tree.rs:1131`: `AS_DEFINED == false` generic branch
  means the `Err` return site is statically unreachable; keep with lockfile
  tests, no new EXP.
- `src/jsc/generated.rs:409,464,494,622` and dispatch/bundle completion sites:
  already tracked by NEW-V-4.
- `src/jsc/event_loop.rs` `unwrap_unchecked` on `virtual_machine` / `global`:
  internal initialized fields; distinct from EXP-084 because these methods are
  not themselves the cross-thread safe API trap. Keep as review targets if
  initialization order changes.
- `src/bun_core/atomic_cell.rs:317`: macro-generated atom-width dispatch backed
  by compile-time width assertions; no bad width source path found.

## Artifact Updates

- Added `experiments/EXP-086/`.
- Added `phase5_experiment_results/EXP-086.log`.
- Appended EXP-086 to `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`.
- Added `NEW-V-6` to `phase4_unified_findings.md`.
- Added `R-EXP-086` to `phase8_remediation_plan.md`.
- Added EXP-086 to `FINAL_UB_REPORT.md` and `UB_RUNBOOK.md`.

## Remediation

Best fix while the helper has no call sites: delete it.

If maintainers want to keep it for a future hot path, replace the false branch
with `panic!` / `unreachable!`. Making it `unsafe fn` is type-correct, but
inferior to deletion or safe panic because it preserves a footgun whose only
benefit is avoiding panic-format pages in a helper nobody calls.

## Validation

```text
[OK] /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md — all blocks well-formed
CONVERGED after round 49 (>=10 rounds, two consecutive quiet).
```

Round 49 verdict totals at the time of this sweep: 52 `CONFIRMED_UB`, 0
`OPEN`, 0 `NEEDS_REFINEMENT`, 13 `NO_EVIDENCE`, 16 `DEFERRED`, 1 `RESOLVED`.
Later follow-ups continued through EXP-092 / round 56; use
`FINAL_UB_REPORT.md` for live totals.
