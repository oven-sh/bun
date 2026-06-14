# Codex Review — Phase 3 / Phase 4 / Phase 8 Tightening

Date: 2026-05-16
Scope: `phase3_dynamic_findings.md`, `phase4_unified_findings.md`,
`phase8_remediation_plan.md`, and the experiment registry.

## Corrections Applied

1. **Canonical verdict labels restored.**
   The registry now passes the UB-exorcist linter. Non-canonical verdicts such
   as `CONFIRMED-UB` and `CONFIRMED-PANIC-SAFETY-BUG` were replaced with the
   allowed registry values.

2. **Strict-provenance failures are no longer counted as default runtime UB.**
   EXP-020 (`URL::host_with_path`) and EXP-029 (`EnvStr`) remain important, but
   they are `STRICT_PROVENANCE_FAIL / NEEDS_REFINEMENT`, not ordinary
   `CONFIRMED_UB` traces.

3. **Phase-3 stale IDs fixed.**
   DirectoryWatchStore is now described as `EXP-028` with a legacy note that the
   old on-disk trace is `EXP-022_run.log`. EXP-007 was added to the standalone
   confirmed-UB set.

4. **Phase-4 table synced with the registry.**
   Updated stale rows for EXP-007, EXP-013, EXP-016, EXP-017, EXP-020,
   EXP-030, EXP-031, EXP-033, EXP-034, EXP-035, EXP-036, EXP-037, and EXP-038.
   Removed phantom IDs `EXP-A12`, `EXP-024`, and `EXP-025` from table rows
   where no registry experiment exists.

5. **Phase-4 counts refreshed.**
   Current table state is 157 rows: 147 `F-*` and 10 `NEW-*`. The stale
   "132 rows / 21 MUST-BE-UB" count was replaced with the current counted
   totals were later refreshed again after the 2026-05-16 evidence pass:
   28 `MUST-BE-UB`, 16 `STRICT_PROVENANCE*`, 57 `LIKELY-*`, 17
   `CONTRACTUAL-BUT-DEFENSIBLE`, 4 `SUSPICIOUS`, 15 `CLEAN`, and 44
   `REVIEWED` rows.

6. **Phase-8 remediation language narrowed.**
   EXP-038 is now `NO_EVIDENCE` for current Bun profiles: the standalone witness applies only to `panic = "unwind"`, while Bun `dev`, `release`, and `shim` profiles use `panic = "abort"` and abort before unwinding starts. This pass later
   promoted EXP-039 back to `CONFIRMED_UB`, but Codex correction 50 supersedes that: EXP-039 is also `NO_EVIDENCE` for current production UB under the same panic-abort policy, with a two-site unwind-regression witness retained.
   EXP-020/029 remediation is now framed as a strict-provenance release-gate
   improvement, not proof of default-Miri UB.

## Current Registry Distribution

After this tightening pass:

| Verdict | Count |
|---------|------:|
| `CONFIRMED_UB` | 32 |
| `NEEDS_REFINEMENT` | 13 |
| `NO_EVIDENCE` | 4 |
| `OPEN` | 18 |
| `RESOLVED` | 1 |

The registry linter reports:

```text
[OK] .ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md — all blocks well-formed
```

## Remaining Watchpoints

- EXP-032 remains `OPEN`: loom found no runtime race in the modeled
  `WebWorker` Cell discipline, but the type-system / Tree-Borrows question is
  still not fully discharged.
- EXP-039 is **superseded by a later Phase-5 run**: the registry now marks it
  `CONFIRMED_UB` with a source-faithful panic-window witness
  (`phase5_experiment_results/EXP-039-Listener.log`). Keep this bullet as
  historical context only.
- Phase 10's fresh-eyes log intentionally still records the pre-correction
  issues it found. Treat this file as historical review input; the patched
  registry / Phase 3 / Phase 4 / Phase 8 files are the current source of truth.
