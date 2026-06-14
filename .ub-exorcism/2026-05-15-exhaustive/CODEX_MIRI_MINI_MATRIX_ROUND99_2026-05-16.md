# Codex Miri Mini-Matrix — Round 99 / 2026-05-16

Scope: small source-linked Miri matrix over three direct Bun-crate witnesses
after the round-99 syn-walker calibration. This is not the full Phase-11 soak;
it is a targeted confidence pass over witnesses that are cheap enough to rerun
locally and strong enough to matter in a public report.

Raw log:

```text
phase5_experiment_results/CODEX-miri-mini-matrix-round99-2026-05-16.log
```

## Cases

| Experiment | Mode | Result |
|---|---|---|
| EXP-080 direct `bun_dispatch` proc-macro witness | default Miri | UB: null-pointer access in generated dispatcher thunk |
| EXP-080 direct `bun_dispatch` proc-macro witness | `-Zmiri-tree-borrows` | same UB: null-pointer access |
| EXP-085 direct `bun_core::fmt::s(&[0xff])` witness | default Miri | UB: invalid UTF-8 reaches `str` iteration (`entering unreachable code`) |
| EXP-085 direct `bun_core::fmt::s(&[0xff])` witness | `-Zmiri-strict-provenance` | same UB; not provenance-dependent |
| EXP-089 direct `bun_core::PathBuffer::uninit()` witness | default Miri | UB: constructs uninitialized integer array as initialized `PathBuffer` |
| EXP-089 direct `bun_core::PathBuffer::uninit()` witness | `-Zmiri-symbolic-alignment-check -Zmiri-check-number-validity` | tool failure: current nightly rejects obsolete `miri-check-number-validity` flag |
| EXP-089 direct `bun_core::PathBuffer::uninit()` witness | `-Zmiri-symbolic-alignment-check` | same UB as default: invalid uninitialized integer array |

## Tooling Correction

The skill's `run-miri-matrix.sh` still contains this axis:

```bash
MIRIFLAGS="-Zmiri-symbolic-alignment-check -Zmiri-check-number-validity"
```

Current nightly rejects `-Zmiri-check-number-validity` as an unknown unstable
option. That does **not** weaken EXP-089; the same direct Bun-crate witness
fails under default Miri and under `-Zmiri-symbolic-alignment-check`. It does
mean future matrix runs on this host should use a current Miri flag set and not
copy the stale preset blindly.

## Registry Impact

- New EXP entries: **0**
- Verdict changes: **0**
- New raw phase-5 log: **1** (`CODEX-miri-mini-matrix-round99-2026-05-16.log`)
- Convergence checkpoint after this pass: `phase7_convergence_round_100.json`
  was quiet with `OPEN=0`, `NEEDS_REFINEMENT=0`, `CONFIRMED_UB=59`,
  `NO_EVIDENCE=15`, `DEFERRED=17`, `RESOLVED=2`. Later passes supersede this
  count; use `FINAL_UB_REPORT.md` for the current pinned-base totals.

This is useful corroboration, not count inflation. EXP-080, EXP-085, and
EXP-089 each remain source-linked, direct Bun-crate UB witnesses under at least
one standard Miri axis; EXP-080 and EXP-085 survive a second axis unchanged,
and EXP-089 exposes a stale skill-tooling flag while still reproducing under
the supported symbolic-alignment axis.
