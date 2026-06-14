# Current Status Readme — UB Exorcist Run `2026-05-15-exhaustive`

Read this before quoting numbers from this directory.

## Source Of Truth

The current source-of-truth artifacts are:

- `FINAL_UB_REPORT.md`
- `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`
- `UB_RUNBOOK.md`
- `CODEX_MAIN_DRIFT_NOTE_2026-05-16.md`
- `CODEX_W4_LATEST_MAIN_REFRESH_2026-05-16.md`

Older `CODEX_*`, `phase1_*`, `phase2_*`, `phase7_*`, `phase9_*`, and
`phase10_*` files preserve checkpoint history. They are useful for audit
traceability, but their counts may be historical.

## Current Pinned-Base Counts

These counts are for audited base `origin/main@4d443e5402`, not for latest
`origin/main`:

```text
106 canonical registry experiments
70 CONFIRMED_UB
17 NO_EVIDENCE
17 DEFERRED
2 RESOLVED
0 OPEN
0 NEEDS_REFINEMENT
182 Phase-4 unified rows = 170 F-* + 12 NEW-*
171 recursive phase5_experiment_results/**/*.log files
```

`EXP-022..EXP-025` are intentionally unused after registry renumbering.
`EXP-105` is a non-counted support-model slot for the `LaunderedSelf` /
`black_box` guardrail.

## Safe Public Wording

Use:

> The UB exorcist run found 70 confirmed UB-class findings against
> `origin/main@4d443e5402`. Upstream main has since advanced, including a broad
> hardening commit; the W4 refresh confirms several high-priority findings are
> still live, but a full per-EXP replay is required before quoting an exact
> latest-main count.

Avoid:

> Latest Bun main still has exactly 70 confirmed UB findings.

Avoid older checkpoint numbers such as 58, 59, 60, or 68 unless you are
explicitly describing a historical convergence round.

## Process Caveat

This was a broad Standard+/Exhaustive-intent application of
`/rust-undefined-behavior-exorcist`. Phase 11 soak campaigns were designed and
some path-b / direct witness work was run, but the multi-day soak campaign
execution was not run.

## Common Misreadings To Avoid

- Do not claim `EXP-109` is production-confirmed. It is `NO_EVIDENCE` for the
  original `JSCallback` GC-root-loss hypothesis after source-root review.
- Do not describe `EXP-111` as a renamer-only bug. The defect is the bundler
  part-range fan-out materializing concurrent whole-owner `&mut LinkerContext`
  / `&mut Chunk`; the renamer mutability is only one incomplete sub-fix.
- Do not say `Buffers::read_array<T>` closes `EXP-003` / `EXP-006`. It closes
  `EXP-036`; `EXP-003` / `EXP-006` close at the `Package::load_fields` /
  checked-`Meta` decoding boundary.
- Do not call `EXP-036` an enum transmute. It is a validity-bearing lockfile
  byte-materialization bug with a `bool` bit-pattern witness.
- Do not treat strict-provenance entries (`EXP-020`, `EXP-029`, `EXP-048`,
  `EXP-049`, `EXP-050`, `EXP-096`) as missing production-UB proofs. They are
  `DEFERRED` release-gate / representation-migration work.
