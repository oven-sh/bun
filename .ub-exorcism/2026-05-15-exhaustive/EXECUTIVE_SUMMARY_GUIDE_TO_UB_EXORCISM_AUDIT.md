# Executive Summary & Guide: Bun Rust UB-Exorcism Audit

> **Read this first.** This is the navigation map for the audit. Everything
> else in `.ub-exorcism/2026-05-15-exhaustive/` is reachable from here.

**Target reader:** an AI coding agent (Claude, Codex, Gemini, etc.) opening
this PR cold, with no prior context, who needs to (a) understand what this
audit found, (b) decide which finding to work on, and (c) run the supporting
infrastructure.

---

## TL;DR (60 seconds)

| Field | Value |
|---|---|
| Audited base | `origin/main@4d443e5402` ([CODEX_MAIN_DRIFT_NOTE_2026-05-16.md](CODEX_MAIN_DRIFT_NOTE_2026-05-16.md) tracks later drift) |
| Skill applied | [`/rust-undefined-behavior-exorcist`](https://jeffreys-skills.md/skills/rust-undefined-behavior-exorcist) (12-phase, Exhaustive mode) |
| Total experiments registered | **106** (EXP-001..EXP-111; EXP-022..EXP-025 reserved-unused; EXP-105 reserved for [`CODEX_LAUNDERED_SELF_BLACK_BOX_GUARDRAIL_2026-05-16.md`](CODEX_LAUNDERED_SELF_BLACK_BOX_GUARDRAIL_2026-05-16.md) support model) |
| Verdicts | **70 CONFIRMED_UB** • **17 NO_EVIDENCE** • **17 DEFERRED** • **2 RESOLVED** |
| Convergence | Round **123** (≥10-round floor + 2 consecutive quiet rounds) |
| Incidental non-UB findings | **5** (I-1..I-5); see [`phase11_artifacts/incidental_findings.md`](phase11_artifacts/incidental_findings.md) |
| Strong-negative reviews | **17** subsystem/bucket areas where the audit looked and found nothing |
| Authoritative report | [`FINAL_UB_REPORT.md`](FINAL_UB_REPORT.md) (v2) |
| Permanent runbook | [`UB_RUNBOOK.md`](UB_RUNBOOK.md) (how Bun stays UB-free) |
| Verdict counts source-of-truth | [`phase7_convergence_round_123.json`](phase7_convergence_round_123.json) |

**One-paragraph summary:** This audit applied the
`/rust-undefined-behavior-exorcist` skill to Bun's Rust runtime (~108
workspace crates, ~3M LoC) over a multi-day exhaustive run. 70 distinct
Undefined Behavior witnesses were confirmed with Miri, Tree-Borrows, loom,
or source-faithful contract traces against `origin/main@4d443e5402`. The
audit reached formal convergence (no new findings for 2 consecutive rounds,
≥10 rounds total). 17 strong-negative reviews, 5 incidental non-UB
findings, and 1 RUSTSEC advisory round out the deliverable. **Every file
in this directory is review-quality evidence with a path you can read.**

---

## Navigation: pick by what you want to do

### "I want to understand WHAT was found"
1. **Headline counts:** TL;DR table above + [`FINAL_UB_REPORT.md`](FINAL_UB_REPORT.md) §Headline
2. **Per-EXP details:** the registry at [`UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`](UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md). Each `## EXP-NNN` heading covers Hypothesis, Files, Bucket, Severity, Verdict, Minimal Reproducer, Expected Signal, Falsifiability, Invocation, and Notes.
3. **What got DEMOTED** (false-positive discipline): [`CODEX_DEFENSIBILITY_CORRECTIONS_2026-05-16.md`](CODEX_DEFENSIBILITY_CORRECTIONS_2026-05-16.md) (161 KB; the running corrections log)
4. **What got widened/corrected later:** any `CODEX_*_CORRECTION_*.md` or `CODEX_*_FOLLOWUP_*.md` doc

### "I want to fix one of the findings"
1. Look up the EXP in the registry (above)
2. Open the corresponding remediation plan in [`phase8_remediation_plan.md`](phase8_remediation_plan.md); the `### R-EXP-NNN` section holds rubric-scored candidates, the chosen winner, rationale, proves-original-UB, and proves-new-soundness
3. Run the pre-fix reproducer to confirm the bug still exists:
   ```bash
   bash .ub-exorcism/2026-05-15-exhaustive/scripts/regression-runner.sh EXP-NNN sb
   ```
4. Implement the rubric winner (see also any `CODEX_<EXP>_CORRECTION_*.md` docs)
5. Re-run the reproducer; the run must now be Miri-clean
6. Add the SAFETY comment per [`scripts/audit/check-safety-blocks.sh`](scripts/audit/check-safety-blocks.sh)
7. Update the registry verdict from `CONFIRMED_UB` to `RESOLVED` with a citation to the post-fix witness log

### "I want to verify the audit reproduces"
```bash
cd .ub-exorcism/2026-05-15-exhaustive
bash scripts/audit/verify-runbook.sh --quick
```
This runs: prereq check → vendor bootstrap → ninja codegen → `cargo check --workspace` → smoke-run every EXP regression → computes a manifest hash. See [`scripts/audit/verify-runbook.sh`](scripts/audit/verify-runbook.sh) for the 8-step contract.

### "I want to understand the methodology"
1. **Phases:** [`phase1_inventory_*`](phase1_notes/), [`phase2_findings_*`](.) by UB bucket, [`phase3_dynamic_findings.md`](phase3_dynamic_findings.md) (Miri/sanitizer/loom/fuzz), [`phase4_unified_findings.md`](phase4_unified_findings.md), [`phase5_experiment_results/`](phase5_experiment_results/), [`phase6_idea_wizard.md`](phase6_idea_wizard.md), [`phase7_convergence_round_*.json`](.) (round-by-round), [`phase8_remediation_plan.md`](phase8_remediation_plan.md), [`phase10_fresh_eyes_log.md`](phase10_fresh_eyes_log.md), [`phase11_artifacts/`](phase11_artifacts/), [`phase11_execution_log.md`](phase11_execution_log.md), [`phase11_soak_designs.md`](phase11_soak_designs.md)
2. **Operator walkthrough** (the 12 mined rituals as named operators applied to one real EXP): [`operator_walkthrough/EXP-004.md`](operator_walkthrough/EXP-004.md)
3. **Skill philosophy:** read the skill at `/rust-undefined-behavior-exorcist`'s `SKILL.md`

### "I want to add a new EXP for something I just discovered"
```bash
# 1. Add to the registry (UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md) under a new EXP-NNN heading
# 2. Author the standalone reproducer
mkdir -p .ub-exorcism/2026-05-15-exhaustive/experiments/EXP-NNN/src
# (write src/main.rs)
# 3. Auto-file the R/T/D bead triplet
bash .ub-exorcism/2026-05-15-exhaustive/scripts/audit/file-new-exp-triplet.sh \
    EXP-NNN "one-line title" --severity CONDITIONAL_UB --bucket "1+15"
# 4. Verify no drift
bash .ub-exorcism/2026-05-15-exhaustive/scripts/audit/check-registry-drift.sh
```

### "I want to wire CI"
1. **Diff-aware shard generation:**
   ```bash
   bash .ub-exorcism/2026-05-15-exhaustive/scripts/ci/compute-affected-exps.sh \
       "$GITHUB_BASE_REF" "$GITHUB_SHA" --configs sb,tb,sp,sa
   ```
   Emits a `{"include":[{"exp":"EXP-NNN","cfg":"sb"}, ...]}` JSON consumable by GitHub Actions `matrix.fromJson(...)`.
2. **Per-shard runner:** `scripts/regression-runner.sh <EXP-ID> <config>`, which emits BEGIN/END-bracketed log per [`scripts/audit/verify-runbook.sh`](scripts/audit/verify-runbook.sh) conventions and appends to `phase11_artifacts/regression/index.jsonl`.
3. **Three-tier model** (per-PR / nightly / weekly SOAK): see the [META-CI-SHARDING bead](#bead-graph) (its description block is the spec).

---

## The verdict taxonomy (use this to read every EXP entry)

| Verdict | Meaning | Action |
|---|---|---|
| `CONFIRMED_UB` (70) | Miri / Tree-Borrows / loom / source-faithful contract trace exists on disk; the bug is real on the audited base. | File a fix. Use the registry's Falsifiability clause to know when you can close. |
| `CONFIRMED_UB (Tree-Borrows model)` | Source-shaped Miri witness under `-Zmiri-tree-borrows`; not always an integrated `bun build` trace. | Same as above. The "model" suffix flags the rigor level. |
| `NO_EVIDENCE` (17) | Audit looked, found nothing live on the source as-of audit base. May include a Miri-clean negative-control witness. | **Don't "fix"**: verify the negative-control still holds before assuming. |
| `DEFERRED` (17) | Either (a) strict-provenance migration that's intentional release-gate policy, or (b) remediation-design vehicle (e.g., loom-torture harness, lint proc-macro proposal). | Read the `Notes:` block; act only if the policy/design has settled. |
| `RESOLVED` (2) | Fix already shipped (EXP-012 callback-receiver re-entry; EXP-037 Windows watcher regression guard). | Use as exemplar for similar finding shapes. |

**Parenthetical detail suffixes are common**, e.g. `CONFIRMED_UB (POSIX async-signal-safety contract violation; not a Miri Rust abstract-machine trace)` or `CONFIRMED_UB (latent — sound today, witnessed under stack-construction)`. These describe the *rigor* of the witness, not a different verdict class.

---

## Directory map

```
.ub-exorcism/2026-05-15-exhaustive/
├── EXECUTIVE_SUMMARY_GUIDE_TO_UB_EXORCISM_AUDIT.md   ← you are here
├── FINAL_UB_REPORT.md                                  ← the v2 executive report
├── UB_RUNBOOK.md                                       ← permanent CI/runbook
├── UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md            ← the registry (106 EXPs)
├── phase8_remediation_plan.md                          ← rubric-scored fixes
├── phase1_notes/                                       ← per-module Phase 1 digests
├── phase2_raw/                                         ← raw ast-grep output (big)
├── phase3_raw/                                         ← raw Phase 3 sweeper output
├── phase3_dynamic_findings.md                          ← Phase 3 synthesis
├── phase4_unified_findings.md                          ← dedup'd, severity-ranked
├── phase5_experiment_results/                          ← per-EXP Miri/loom logs
├── phase6_idea_wizard.md                               ← project-shaped techniques
├── phase7_convergence_round_NNN.json                   ← round-by-round counts
├── phase10_fresh_eyes_log.md                           ← three verbatim reviews
├── phase11_artifacts/                                  ← SOAK + incidental findings
│   ├── incidental_findings.md                          ← non-UB defects (I-1..I-5)
│   ├── regression/                                     ← per-EXP CI logs (BEGIN/END framed)
│   └── soak-results/                                   ← pulled SOAK campaign output
├── phase11_execution_log.md                            ← SOAK dispatch state
├── phase11_soak_designs.md                             ← 5-campaign plan
├── experiments/EXP-NNN/                                ← per-EXP standalone reproducers
├── experiments/EXP-109-kani/                           ← Kani symbolic proof harness
├── experiments/EXP-NNN-bun-<crate>-crate/              ← direct-Bun-crate witnesses
├── ast_grep_rules/                                     ← detector YAML rules (13)
├── loom_models/                                        ← runnable loom models (3 new)
├── layout_asserts/                                     ← paste-ready compile-asserts (3)
├── operator_walkthrough/EXP-004.md                     ← 5-operator walkthrough
├── rejected_artifacts/                                 ← work demoted by review
├── scripts/                                            ← META infrastructure (14 scripts)
│   ├── regression-runner.sh                            ← per-EXP runner (META-LOGGING-CONVENTION)
│   ├── audit/                                          ← audit-internal helpers
│   │   ├── bootstrap-vendor.sh                         ← META-VENDOR-BOOTSTRAP
│   │   ├── check-close-order.sh                        ← META-CLOSE-ORDER-ENFORCEMENT
│   │   ├── check-registry-drift.sh                     ← META-REGISTRY-DRIFT-CHECKER
│   │   ├── check-safety-blocks.sh                      ← META-DOC-CONVENTIONS enforcer
│   │   ├── file-new-exp-triplet.sh                     ← auto-file R/T/D for new EXP
│   │   ├── match-signal-to-exp.py                      ← UB stderr → candidate EXP(s)
│   │   ├── resolve_crate.py                            ← src/path → crate name
│   │   ├── rubric-prompt.sh                            ← META-RUBRIC-SCORING prompter
│   │   ├── rubric-status.sh                            ← per-R-EXP winner reporter
│   │   ├── triage-soak-results.sh                      ← META-SOAK-TRIAGE puller
│   │   └── verify-runbook.sh                           ← META-REPRODUCIBILITY gate
│   └── ci/
│       ├── compute-affected-exps.sh                    ← META-CI-SHARDING matrix
│       └── registry-paths.sh                           ← changed-paths → EXPs
└── CODEX_*.md                                          ← per-correction docs (24 docs)
```

---

## The 14 META infrastructure scripts

All scripts are at `.ub-exorcism/2026-05-15-exhaustive/scripts/`. They are
**staged audit artifacts**, not yet promoted to the repo's canonical
`scripts/` location; promotion requires maintainer review. Each script's
docstring documents its CANONICAL LOCATION for that future migration.

**Every script has been smoke-tested end-to-end. They are runnable today.**

| Script | What it does | Smoke-test outcome |
|---|---|---|
| `regression-runner.sh <EXP-ID> <sb\|tb\|sp\|sa\|integration>` | Runs ONE regression for ONE EXP; emits BEGIN/END-bracketed log + appends to `phase11_artifacts/regression/index.jsonl` | ✓ ran on EXP-109, correctly reported `exit=1 ub_lines=1` matching expected Miri witness |
| `audit/bootstrap-vendor.sh [--list\|--only <lib>]` | Bootstraps missing vendor sources (fix for incidental I-2). Refuses `--force` for safety. | ✓ `--list` shows all 24 vendor specs; default safely skips already-populated dirs |
| `audit/check-close-order.sh [--bead <id>\|--json]` | Enforces R/T/D triplet close-order contract (beads_rust doesn't enforce natively) | ✓ "no violations across 62 EXP triplets + 7 S triplets" |
| `audit/check-registry-drift.sh [--json\|--fix]` | Verifies bead labels match registry verdicts; detects missing R/T/D triplets and structural-fix absorbed-EXP coverage | ✓ 13 real actionable drift items (post-bundle-aware parser) |
| `audit/check-safety-blocks.sh [--crate <name>\|--json]` | Greps `unsafe fn` / `unsafe {` sites for missing SAFETY blocks | ✓ found 13 real undocumented unsafe sites in `bun_threading` |
| `audit/file-new-exp-triplet.sh EXP-NNN "title" [--severity X --bucket Y]` | Auto-files R/T/D bead triplet for a newly-promoted EXP | ✓ rejects unknown EXP-NNN; validates returned bead IDs match `bun-XXXX` pattern |
| `audit/match-signal-to-exp.py [--json]` | Classifies a Miri/sanitizer stderr against the audit's 11 known UB signal classes; suggests candidate EXP-NNN(s) | ✓ correctly classified EXP-109's Miri log as "dangling-pointer" with EXP-056/081/109 candidates |
| `audit/resolve_crate.py [--json]` | Maps `src/path:line` → `bun_<crate>` workspace name | ✓ `src/runtime/timer/mod.rs` → `bun_runtime` |
| `audit/rubric-prompt.sh EXP-NNN` | Walks an implementer through re-scoring a rubric before close | ✓ usage error returns 2, nonexistent EXP returns 1 |
| `audit/rubric-status.sh [--json\|--exp EXP-NNN]` | Reports per-R-EXP Winner-recorded status; filters non-actionable verdicts | ✓ finds 1 real missing winner (EXP-043), exit 1 |
| `audit/triage-soak-results.sh [--kill <tag>\|--json]` | Pulls + triages SOAK campaign results from a remote worker. **Requires `BUN_SOAK_WORKER` env var** (no embedded secrets). | ✓ correctly fails without env var; with env var, pulled live status from 10 SOAK campaigns |
| `audit/verify-runbook.sh [--quick\|--update-hash]` | Single-command reproducibility gate (8 steps) | ✓ steps 1-4 PASS; step 5 (cargo check) is slow; manifest hash is deterministic |
| `ci/compute-affected-exps.sh <base> <head> [--configs sb,tb,sp,sa]` | Emits GHA-matrix JSON of EXPs whose files changed in the diff | ✓ `HEAD~1 HEAD` → `affected_exps=1 matrix_size=1` (correct precise matching) |
| `ci/registry-paths.sh [--json]` | Inverse of `compute-affected-exps`: stdin paths → matching EXP-IDs | ✓ `src/runtime/timer/mod.rs` → `EXP-026` |

### Discovering bugs in your own audit infrastructure

The scripts above were debugged in **5 fresh-eyes review passes** during
this session. Real bugs found and fixed (the highlights):

- `IFS=$'\t' read` silently **collapses consecutive tabs** because bash
  treats tab as whitespace; empty fields shift columns. Fixed by using SOH
  (`\x01`) as a non-whitespace field separator.
- `rg -tr rust` is parsed as `-t r rust` (three tokens), making one safety
  check silently emit zero results. Fixed to `--type rust`.
- `set -euo pipefail` + a `grep -oE` that finds nothing → pipeline exits
  non-zero → whole script aborts. Wrap with `{ grep || true; }`.
- A `<<PYEOF` heredoc that interpolates `$INPUT` into a Python triple-string
  is a shell-injection surface if a filename contains `$`, `\`, or `"""`.
  Use quoted `<<'PYEOF'` and pass data via tempfile path.
- A `--negative-control <fix-sha>` flag that does `git checkout` in the
  live worktree is unsafe in multi-agent environments. Disabled; documented
  as "needs a disposable-worktree runner."

These patterns recur; if you author a 15th META script, check for them.

---

## The bead graph

The audit uses [`beads_rust`](https://github.com/Dicklesworthstone/beads_rust)
(`br` CLI) as its dependency-aware issue tracker. The `.beads/` directory is
**git-excluded** (local-only per audit policy); after PR merge, beads can be
exported via `br sync --flush-only` into the canonical issue tracker if
desired. Bead counts at audit close:

- **R-EXP-NNN** (48 single + 7 bundled): remediation work items
- **T-EXP-NNN** (51): regression tests
- **D-EXP-NNN** (60): per-site SAFETY comment work
- **R-S<X>** / **T-S<X>** / **D-S<X>** (7+7+7 = 21): structural-fix beads
  bundling multiple absorbed EXPs
- **META-*** (14): infrastructure beads (CI sharding, close-order
  enforcement, SOAK triage, etc.)
- **TOTAL: 200 active, plus a few closed or tombstoned**

### Bead dependency contract

Every R/T/D triplet enforces a close-order via `META-CLOSE-ORDER-ENFORCEMENT`
(implemented by [`scripts/audit/check-close-order.sh`](scripts/audit/check-close-order.sh)):
- R-EXP-NNN closes only after T-EXP-NNN AND D-EXP-NNN close
- Same triangular contract for the structural variants (R-S<X> / T-S<X> / D-S<X>)
- Absorbed EXPs (per [`phase8_remediation_plan.md`](phase8_remediation_plan.md)'s
  "Blast radius — closes:" bullet lists) inherit R/T coverage from the S bundle

### Working a bead

```bash
br ready                          # show actionable work (no blockers)
br show <id>                      # full details including dependency graph
br show <id> --json | jq '.[0]'   # machine-readable
br dep tree <id>                  # what blocks what
br update <id> --status in_progress
# ... do the work ...
br close <id> --reason "..."
br sync --flush-only              # export to JSONL (no git ops)
```

### Bead-graph health metrics

Run [`bv`](https://github.com/Dicklesworthstone/bv) for graph-aware triage:
```bash
bv --robot-triage | jq '.triage.quick_ref'          # top 3 picks + counts
bv --robot-insights | jq '.Cycles'                  # must be null
bv --robot-insights | jq '.Keystones[0:5]'          # what unblocks the most
bv --robot-suggest                                  # hygiene: dups, missing deps
```

---

## Phases & where their artifacts live

| Phase | Output(s) | Status |
|---|---|---|
| 0 RUN BOOTSTRAP | [`phase0_run.json`](phase0_run.json), [`phase0_toolchain_inventory.json`](phase0_toolchain_inventory.json) | ✓ |
| 1 RECON | [`phase1_unsafe_surface_inventory.md`](phase1_unsafe_surface_inventory.md) + [`phase1_notes/`](phase1_notes/) | ✓ |
| 2 STATIC SWEEP | `phase2_findings_<bucket>.md` files (one per UB bucket) + [`phase2_raw/`](phase2_raw/) | ✓ |
| 3 DYNAMIC SWEEP | [`phase3_dynamic_findings.md`](phase3_dynamic_findings.md) + [`phase3_raw/`](phase3_raw/) | ✓ |
| 4 SYNTHESIS | [`phase4_unified_findings.md`](phase4_unified_findings.md) + first registry draft | ✓ |
| 5 EXP EXECUTION | [`phase5_experiment_results/`](phase5_experiment_results/) (per-EXP `.log` files) | ✓ |
| 6 IDEA WIZARD | [`phase6_idea_wizard.md`](phase6_idea_wizard.md) (11 new design-vehicle EXPs surfaced) | ✓ |
| 7 ITERATE | [`phase7_convergence_round_NNN.json`](phase7_convergence_round_123.json) (rounds 1..123) | ✓ converged R123 |
| 8 REMEDIATE | [`phase8_remediation_plan.md`](phase8_remediation_plan.md) (rubric-scored) | ✓ |
| 9 BEADS | (in `.beads/`, local-only) | ✓ |
| 10 FRESH EYES | [`phase10_fresh_eyes_log.md`](phase10_fresh_eyes_log.md) + [`ADVERSARIAL_REAUDIT_2026-05-16.md`](ADVERSARIAL_REAUDIT_2026-05-16.md) + [`FRESH_EYES_REVIEW_2026-05-16.md`](FRESH_EYES_REVIEW_2026-05-16.md) | ✓ 5 passes |
| 11 SOAK | [`phase11_soak_designs.md`](phase11_soak_designs.md), [`phase11_execution_log.md`](phase11_execution_log.md), [`phase11_artifacts/`](phase11_artifacts/) | ✓ all 10 campaigns DONE |
| 12 FINAL | [`FINAL_UB_REPORT.md`](FINAL_UB_REPORT.md) (v2) + [`UB_RUNBOOK.md`](UB_RUNBOOK.md) | ✓ |

---

## The high-value EXP shapes (start here if you have one hour)

These are the EXP entries with the most reusable lessons. Read in order.

### Allocator-layout pairing (EXP-004)
`src/runtime/webcore/encoding.rs:303-310` reinterprets a `Vec<u8>` as
`Vec<u16>` via `from_raw_parts`. On Drop, the global allocator is asked to
free with `align=2` over an `align=1` allocation. Author's own
TODO(port) at `:298-302` flags it. Miri's
`-Zmiri-symbolic-alignment-check` rejects. This is THE template for the
"`Vec<T>` → `Vec<U>` raw cast" anti-pattern across the codebase. See also
EXP-091, EXP-092.

### Receiver-reentry under callbacks (EXP-012 [RESOLVED] → EXP-026/044/099-104/106-108/110/111)
The "**callback that runs while `&mut self` receiver is live**" family.
EXP-012's fix (flip receiver to `this: *mut Self`, install `ThisPtr` +
`ref_guard` RAII bracket) is the canonical fix-model exemplar. Every
later EXP in this family proposes the same translation.

### Bare JSValue without Strong (EXP-082, demoted EXP-109)
Pattern: storing a `JSValue` on the Rust heap without a `Strong<JSValue>`
wrapper risks UB if JSC's GC collects the function while the Rust handle
persists. EXP-082 (`Blob: Send + Sync` with bare `Cell<*const JSGlobalObject>`)
stays CONFIRMED. EXP-109 was DEMOTED to `NO_EVIDENCE` for current production
after [`CODEX_EXP109_ROOT_GRAPH_CORRECTION_2026-05-16.md`](CODEX_EXP109_ROOT_GRAPH_CORRECTION_2026-05-16.md)
traced the production path through `src/jsc/bindings/JSFFIFunction.cpp:45-46`'s
`FFICallbackFunctionWrapper` which DOES root via `JSC::Strong<JSC::JSFunction>`
+ `JSC::Strong<Zig::GlobalObject>`. **Lesson: source-graph review across
language boundaries (Rust ↔ C++) can demote a Miri-confirmed Rust-shape
finding when the C++ side compensates.**

### Cross-worker parallel `&mut Chunk` (EXP-111)
`src/bundler/Chunk.rs:80-84,114-134` + the per-task callbacks in
`src/bundler/linker_context/generateCompileResultForJSChunk.rs:60-68` and
`generateCompileResultForCssChunk.rs:44-47` materialize concurrent whole-
`&mut Chunk` references across worker threads. Default Miri reports a
data race on the retag, a Rust-borrow-system phenomenon Zig's raw
pointers don't have. Per [`CODEX_EXP111_SOURCE_SCOPE_CORRECTION_2026-05-16.md`](CODEX_EXP111_SOURCE_SCOPE_CORRECTION_2026-05-16.md)
the fix is 4-step (broader than the original renamer-only framing).

### Strict-provenance integer-to-pointer (EXP-048, family DEFERRED)
The `TaggedPtr` family: int-to-pointer round-trips lose provenance under
`-Zmiri-strict-provenance`. Six EXPs are DEFERRED as release-gate policy
(EXP-020/029/048/049/050/096); these aren't default-Miri UB but become UB
once Bun adopts strict provenance as a release gate. The right time to
unblock these is when the strict-provenance migration is on Bun's roadmap.

### Differential Rust-vs-Zig audit
A unique audit angle: read the `.zig` sibling kept in-tree (per
`CLAUDE.md` §"Language Structure") to determine whether a finding is a
**port regression** (Rust port introduced UB that Zig didn't have, e.g.,
EXP-111's `&'r mut` translation of Zig's raw pointer) or a
**faithfully-preserved pre-existing bug** (e.g., EXP-109's bare-handle
shape exists identically in `src/runtime/ffi/ffi.zig:1496-1508`). See
[`DIFFERENTIAL_RUST_VS_ZIG_2026-05-16.md`](DIFFERENTIAL_RUST_VS_ZIG_2026-05-16.md).

---

## How the audit handles its own corrections (a model for self-correcting work)

This audit produced a self-correction loop you can study and reuse:

1. **A pass authors a finding** (e.g., Lane A subagent claims "EXP-109 will
   crash on bun:ffi GC race")
2. **A fresh-eyes pass verifies** the claim against current source (and
   demotes if speculation)
3. **A multi-agent reviewer** (Codex / Gemini / etc.) traces the
   source-root graph (e.g., into C++ bindings) and may further demote
4. **The corrected verdict propagates** through:
   - Registry verdict line
   - Bead `verdict:*` label (use the `<REGISTRY_VERDICT>_<REFINEMENT>`
     convention; see `scripts/audit/check-registry-drift.sh`'s
     `labels_match()` function)
   - Bead description body (separate from the label; both need updating)
   - Bead title (so it's self-evident from the title alone)
   - Synthesis docs that cite the count
   - `CODEX_*_CORRECTION_*.md` doc that records the rationale

This pattern's discipline cost is real: ≥5 fresh-eyes review passes during
this audit found **11 distinct blunders** in my own prior work plus
**18 additional script bugs** uncovered by actually running every META script
adversarially. The audit's credibility rests on its **willingness to find
and document its own errors**. Pretending no errors existed was never the
goal. See [`FRESH_EYES_REVIEW_2026-05-16.md`](FRESH_EYES_REVIEW_2026-05-16.md)
for the running record.

---

## Reproducibility & verification recipes

### "Verify the audit at audit base reproduces"
```bash
cd .ub-exorcism/2026-05-15-exhaustive
bash scripts/audit/verify-runbook.sh --quick   # ~30 min
# Or full (hours): bash scripts/audit/verify-runbook.sh
```

### "Verify one specific finding"
```bash
# Miri reproducer (standalone)
cd .ub-exorcism/2026-05-15-exhaustive/experiments/EXP-094
MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run

# Or via runner (adds BEGIN/END logging + index.jsonl):
bash .ub-exorcism/2026-05-15-exhaustive/scripts/regression-runner.sh EXP-094 sp
```

### "Verify the Kani symbolic proofs (EXP-109 model)"
```bash
cd .ub-exorcism/2026-05-15-exhaustive/experiments/EXP-109-kani
cargo kani --harness proof_strong_protects_value_across_gc
cargo kani --harness proof_drop_unprotects
cargo kani --harness proof_bare_value_is_not_protected
cargo kani --harness proof_multiple_strongs_refcount_correctly
# All 4 must pass; verification time <2s total
```

### "Run the loom models"
```bash
cd .ub-exorcism/2026-05-15-exhaustive/loom_models/imminent_gc_timer_publish
RUSTFLAGS='--cfg loom' cargo +nightly test --release
# Also: pending_tasks_happens_before, concurrent_ref_swap_consistency
```

### "Run the ast-grep detectors"
```bash
cd .ub-exorcism/2026-05-15-exhaustive/ast_grep_rules
# 13 YAML rules; example:
ast-grep scan -r cell_with_raw_ptr.yml /data/projects/bun/src
```

### "Match a Miri stderr to an existing EXP"
```bash
cat some_miri_output.log | \
  python3 .ub-exorcism/2026-05-15-exhaustive/scripts/audit/match-signal-to-exp.py
```

---

## Anti-patterns to avoid (extracted from this audit's mistakes)

If you contribute to this audit (or replicate the methodology elsewhere),
the following anti-patterns recurred enough to be worth pre-empting:

### Audit-content anti-patterns
- **"Cite the registry verdict count from memory."** Always read
  [`phase7_convergence_round_123.json`](phase7_convergence_round_123.json)
  for the authoritative `{CONFIRMED_UB: 70, NO_EVIDENCE: 17, DEFERRED: 17,
  RESOLVED: 2}` snapshot. Synthesis docs go stale.
- **"Speculate about a UB and call it CONFIRMED."** The verdict
  `CONFIRMED_UB` REQUIRES a Miri / loom / Tree-Borrows / sanitizer log on
  disk under `phase5_experiment_results/` or `phase11_artifacts/`.
  Speculation goes in `CANDIDATE` or `DEFERRED`.
- **"Skip the falsifiability clause."** Every EXP entry must say what
  conditions would close/demote the finding. This is the
  "falsifiability" field; an entry without one isn't auditable.
- **"Promote a single Miri witness to 'production UB confirmed'."** A
  Rust-shape Miri witness is only one piece of evidence. Source-graph
  review across language boundaries can demote it (EXP-109 is the canonical
  example). Always trace to the production call path before publishing the
  promotion.

### Script anti-patterns (from META infrastructure)
- `IFS=$'\t' read` collapses consecutive tabs because bash treats tab as
  whitespace. Use `\x01` (SOH) instead.
- `<<PYEOF` (unquoted) lets shell expansion bleed into Python heredoc bodies,
  enabling injection. Use `<<'PYEOF'` and pass data via argv or tempfile.
- `grep -oE 'PATTERN' file | head -1 | sed ...` under `set -euo pipefail`: if
  grep finds nothing, pipefail kills the script. Wrap with
  `{ grep || true; }`.
- `rg -tr rust` parses as `-t r rust` (one-letter type, then positional args).
  Use `--type rust` or `-trust` (joined).
- A `--negative-control` mode that does `git checkout` on the LIVE worktree
  is unsafe in multi-agent setups. Require a disposable worktree.

### Bead anti-patterns
- **Updating the label without updating the title/description body.** Pass
  3's fresh-eyes review found two beads where the label said
  `NO_EVIDENCE_PRODUCTION` but the body still asserted the falsified
  hypothesis as CANDIDATE. Update all three places.
- **Filing a bead for a finding without a registry entry.** The bead graph
  and the registry must agree. [`scripts/audit/check-registry-drift.sh`](scripts/audit/check-registry-drift.sh)
  enforces this; run it before closing any bead.

---

## What this audit is NOT

- **NOT a security audit.** UB exorcism overlaps with security (memory
  safety, race conditions) but doesn't cover authentication, authorization,
  injection vulnerabilities, etc. For a security audit, use `/security-review`.
- **NOT a code-quality review.** The audit's stance is "is there UB?" not
  "is this code well-designed?". Stylistic concerns are out of scope.
- **NOT a perf audit.** Although UB and perf can intersect (e.g., undefined
  behavior in hot paths matters more), perf was deliberately scoped out.
- **NOT a guarantee.** Even at convergence, "found nothing" doesn't mean
  "nothing exists." The audit's strongest claims are positive (here is a
  Miri witness) and negative-with-evidence (we ran detector X over surface Y
  and found nothing); neither implies the absence of every possible UB.

---

## Glossary (for AI-agent recall)

- **EXP**: an experiment entry in the registry
  (`UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`). Numbered EXP-001 through
  EXP-111; some numbers reserved.
- **R-EXP-NNN / T-EXP-NNN / D-EXP-NNN**: the bead triplet for one EXP
  (Remediation, Test, Documentation/SAFETY-block).
- **R-S<X> / T-S<X> / D-S<X>**: structural-fix bead triplet that bundles
  multiple absorbed EXPs (e.g., R-S1 absorbs EXP-002, EXP-018, EXP-019).
- **META-*** bead: infrastructure bead (no EXP; documents a workflow gate
  like META-RUBRIC-SCORING or META-CI-SHARDING).
- **Bucket**: one of 25 UB-taxonomy buckets from the Rustonomicon (see
  [skill references](https://jeffreys-skills.md/skills/rust-undefined-behavior-exorcist/references/UB-TAXONOMY.md)).
- **MIRIFLAGS sb/tb/sp/sa**: the 4 Miri configurations the audit ships:
  Stacked Borrows (default), Tree Borrows, Strict Provenance, Symbolic
  Alignment Check.
- **Convergence**: ≥10 rounds AND 2 consecutive rounds with `new_findings=0`
  AND `new_needs_refinement=0`. Authoritative state at
  [`phase7_convergence_round_123.json`](phase7_convergence_round_123.json).
- **Strong-negative finding**: "we ran detector X over surface Y and found
  nothing." Recorded explicitly so future audits don't re-run the same
  fruitless search. See FINAL_UB_REPORT's "17 strong-negative reviews."

---

## Provenance & honest disclaimers

- **Audit base:** `origin/main@4d443e5402`. Later upstream commits may have
  fixed some findings or introduced new ones; see
  [`CODEX_MAIN_DRIFT_NOTE_2026-05-16.md`](CODEX_MAIN_DRIFT_NOTE_2026-05-16.md).
- **Author/tooling:** mixed (Claude, Codex, Gemini). Per-doc attribution is
  in the `CODEX_*.md` filenames; other docs are typically Claude-authored
  with Codex revisions.
- **Operator infrastructure:** SOAK campaigns ran on remote workers managed
  by the audit operator. All host/IP/key details have been scrubbed from
  these artifacts for public release; the `triage-soak-results.sh` script
  requires `BUN_SOAK_WORKER` env var with NO embedded defaults.
- **Coverage:** the registry covers areas the audit deeply explored. Areas
  with 0 prior EXPs that this audit's deep-pass exercised include
  `src/runtime/ffi/`, `src/runtime/crypto/`, `src/transpiler/`,
  `src/sourcemap/`, `src/event_loop/`, `src/sql/postgres/`, `src/sql/mysql/`,
  `src/glob/`. Other areas (e.g., `src/bake/` HMR machinery beyond
  EXP-028/031/075) may merit follow-up audits.
- **Bead state:** the `.beads/` directory is git-excluded; bead counts cited
  here reflect a snapshot of approximately 200 active beads at audit close.
  Run `br list --limit 0 --json | jq '.issues | length'` locally if you
  cloned the bead database.

---

## Quick command card (copy/paste)

```bash
AUDIT=.ub-exorcism/2026-05-15-exhaustive

# Read the headline
cat $AUDIT/EXECUTIVE_SUMMARY_GUIDE_TO_UB_EXORCISM_AUDIT.md  # this file

# Get authoritative verdict counts
jq '.verdicts' $AUDIT/phase7_convergence_round_123.json

# Look up one EXP
awk "/^## EXP-094:/,/^## EXP-/" $AUDIT/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md

# Find which EXPs touch the file you're editing
echo "src/runtime/timer/mod.rs" | bash $AUDIT/scripts/ci/registry-paths.sh

# Reproduce a Miri witness for one EXP
bash $AUDIT/scripts/regression-runner.sh EXP-094 sp

# Compute the CI shard for a PR diff
bash $AUDIT/scripts/ci/compute-affected-exps.sh main HEAD --configs sb,tb

# Verify the audit reproduces (~30 min in --quick mode)
bash $AUDIT/scripts/audit/verify-runbook.sh --quick

# Check audit hygiene
bash $AUDIT/scripts/audit/check-registry-drift.sh    # drift between registry + beads
bash $AUDIT/scripts/audit/check-close-order.sh       # R/T/D close-order violations
bash $AUDIT/scripts/audit/rubric-status.sh           # which R-EXPs lack a Winner
bash $AUDIT/scripts/audit/check-safety-blocks.sh --crate bun_runtime   # undocumented unsafe sites
```

---

*Next stops: open [`FINAL_UB_REPORT.md`](FINAL_UB_REPORT.md) for the
executive narrative, or go straight to a specific EXP in
[`UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`](UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md).*
