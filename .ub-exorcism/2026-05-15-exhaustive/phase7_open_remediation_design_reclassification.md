# Phase 7 — Open Remediation-Design Reclassification

Date: 2026-05-16

## Decision

Reclassify EXP-061..EXP-071 from `OPEN` to `DEFERRED`.

These 11 entries are Phase-6 idea-wizard remediation / CI-design vehicles, not unresolved UB hypotheses:

- EXP-061 `#[bun_callback]` proc-macro
- EXP-062 `JsThreadAffine` marker trait
- EXP-063 `#[layout_locked]` derive
- EXP-064 `#[const_validate]` enum derive
- EXP-065 re-entrant-VM debug tripwire
- EXP-066 `BumpDrop<T>` arena wrapper
- EXP-067 `Ref::normalize()` accessor
- EXP-068 `bun_core::heap` chokepoint lint
- EXP-069 `from_field_ptr!` loom/shuttle torture harness
- EXP-070 `impl_streaming_writer_parent!` mode linter
- EXP-071 signal-handler async-signal-safety static analyzer

Their beneficiaries are already represented by concrete finding EXPs. Leaving the
remediation vehicles as `OPEN` made the tracker look as if 11 bug proofs were
still missing. That was not accurate.

## Evidence Standard

This is not a demotion of the underlying UB findings. It is a bookkeeping
correction:

- Confirmed UB findings remain `CONFIRMED_UB`.
- Strict-provenance release-gate migrations remain `DEFERRED`.
- Remediation / CI infrastructure proposals are `DEFERRED` until someone chooses
  to implement them.

The convergence tracker should measure unresolved UB hypotheses, not unstarted
implementation projects.

## Result

After this correction, the registry has no `OPEN` or `NEEDS_REFINEMENT` entries:

- `CONFIRMED_UB`: 50
- `NO_EVIDENCE`: 13
- `DEFERRED`: 16
- `RESOLVED`: 1

The run is registry-quiet once the tracker observes two consecutive quiet rounds.
This does **not** mean Phase-11 soak execution has happened; it only means the
experiment registry no longer contains unresolved proof obligations.
