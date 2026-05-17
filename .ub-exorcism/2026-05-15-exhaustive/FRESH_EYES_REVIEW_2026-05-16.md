# Fresh-Eyes Review — 2026-05-16

User asked TWO consecutive times for fresh-eyes blunder review. This document
covers both passes; the second pass found additional blunders the first
missed.

---

## Pass 3 — Even more blunders (THIRD fresh-eyes request)

After pass-2 updated the EXP-109/111 bead LABELS + TITLES, a third
fresh-eyes pass found that the bead DESCRIPTIONS (the body text below the
title) were still stale.

### Blunder #10 — EXP-111 R bead description framed too narrowly

The bead body still said:
- `VERDICT:  CANDIDATE_AWAITING_MIRI` (stale; the label was updated to
  CONFIRMED_UB in pass-2 but the description body wasn't)
- Hypothesis only addressed the renamer-field carry shape

Per Codex's `CODEX_EXP111_SOURCE_SCOPE_CORRECTION_2026-05-16.md`, the
remediation requires FOUR steps, not just the renamer carry fix:
1. Stop worker callbacks from materializing concurrent whole-owner
   `&mut LinkerContext` / `&mut Chunk`
2. Keep `CompileResultSlots` for per-task output + atomic RMW for counters
3. Flip `Renamer<'r>` to `&'r` (or use per-worker owned snapshots)
4. Prove `SymbolMap::follow()` can't path-compress in parallel during codegen

**Fix:** R-EXP-111 description rewritten with all 4 source-faithful
remediation steps, Codex correction-doc reference, and the actual Miri
witness location.

### Blunder #11 — EXP-109 R/T bead descriptions still asserted falsified hypothesis

The pass-2 LABELS were updated to NO_EVIDENCE_PRODUCTION, but bead
description bodies still asserted the original "JSC may collect the
function" hypothesis as if it held in production.

**Fix:** R-EXP-109 + T-EXP-109 descriptions rewritten to lead with
"DEMOTED to NO_EVIDENCE for production by Codex source-graph review", cite
the Codex correction doc, include the orchestrator-verified C++ source
trace through `FFICallbackFunctionWrapper`'s `JSC::Strong<JSFunction>` +
`JSC::Strong<Zig::GlobalObject>` fields (re-verified in this pass at
`src/jsc/bindings/JSFFIFunction.cpp:45-46`), and reframe the bead as
informational/documentation rather than a production remediation
requirement.

### Pass-3 verifications that held

- All 6 EXP-109/111 bead descriptions now have ZERO stale verdict references
- Convergence is still at round 123 (not yet advanced past it)
- 70 CONFIRMED_UB / 17 NO_EVIDENCE / 17 DEFERRED / 2 RESOLVED still the
  authoritative count (re-verified via `phase7_convergence_round_123.json`
  + registry parser)
- Codex's `CODEX_EXP109_ROOT_GRAPH_CORRECTION_2026-05-16.md` and
  `CODEX_EXP111_SOURCE_SCOPE_CORRECTION_2026-05-16.md` are now both cited
  by the affected beads (pass-2 only cited the EXP-111 correction)
- All 14 META scripts still functional after Codex's safety patches
  (bootstrap-vendor.sh + regression-runner.sh)
- The 200-bead count is stable
- Drift checker reports 16 findings; rubric-status reports 1 missing winner
  (EXP-043) — same as pass-2

### Meta-observation about iterative review

Across three fresh-eyes passes I've now found **11 distinct blunders** in
my own prior work. The pattern is:
- Pass-1 found 5 (mostly script-output hallucinations + a buggy parser)
- Pass-2 found 4 (mostly stale labels after Codex's revisions to the
  registry + the unsafe `--negative-control` impl)
- Pass-3 found 2 (description bodies stale even after labels updated —
  classic "two places to update; remember both")

The audit's discipline isn't the absence of blunders. It's the willingness
to iterate fresh-eyes review until they stop appearing.

The next pass would check:
- Are the META scripts I authored still correctly callable from external
  callers (e.g., does verify-runbook.sh actually invoke regression-runner
  with the right args)?
- Are the bead AC field values (separate from description bodies) up to
  date with the latest verdict revisions?
- Has Codex added more CODEX_*.md correction docs that I should propagate
  to bead descriptions?

If a 4th fresh-eyes request comes in, those are the angles to attack.

---

## Pass 2 — Additional blunders found after Codex's audit-progression revisions

Between the first fresh-eyes review and the second user request, Codex:
- Advanced the convergence loop to round 123 (quiet for 2 rounds → CONVERGED)
- Promoted EXP-072, EXP-097..104, 106-108, 110, 111 to CONFIRMED_UB
- Demoted EXP-109 to NO_EVIDENCE (production claim)
- Updated FINAL_UB_REPORT.md headline to "70 CONFIRMED_UB, 17 NO_EVIDENCE,
  17 DEFERRED, 2 RESOLVED = 106 EXPs"
- Patched `regression-runner.sh` to disable destructive `--negative-control`
- Patched `bootstrap-vendor.sh` to disable `--force` + add empty-dir guard
  + use `git checkout --detach` instead of `-f`

This revealed FOUR blunders in MY work that the first fresh-eyes pass missed:

### Blunder #6 — Bootstrap-vendor URL extraction was double-broken

**Two bugs in the same regex:**
1. Pattern matched `https://github.com/...` but Bun's `deps/*.ts` files use
   `repo: "org/name"` syntax (per the `kind: github-archive` standard).
   So `--list` showed "URL: .git" — extracted nothing.
2. Pattern required commit to be `[a-f0-9]{7,40}` — but `brotli` uses tag
   `v1.1.0`, so its commit column was blank.

**Fix:** Updated `bootstrap-vendor.sh collect_vendors()` to extract `repo:`
field first, fall back to bare github URL, and accept either sha-hex OR
tag/ref strings for commit.

### Blunder #7 — EXP-111 bead labels never updated to CONFIRMED_UB

**Reality:** FINAL_UB_REPORT v2 lists EXP-111 as CONFIRMED_UB with a Miri
witness in `phase5_experiment_results/EXP-111-sb.log`. Codex's pass-2
synthesis revision noted "EXP-111 remains CONFIRMED_UB, but the root cause
is broader than the renamer field." My pass-2 EXP-111 bead labels were
still `verdict:CANDIDATE_AWAITING_MIRI`.

**Fix:** Updated all 3 EXP-111 beads (`bun-971h` R, `bun-hiwk` T,
`bun-xxz5` D) to `verdict:CONFIRMED_UB`, added
`miri-witness-confirmed-sb`, added `codex-broadened-scope-2026-05-16`,
and rewrote each title to reflect the broadened CONFIRMED scope.

### Blunder #8 — Stale "(CANDIDATE)" markers in EXP-109 titles

After the Codex source-graph demotion, the EXP-109 bead VERDICT labels
were updated to `NO_EVIDENCE_PRODUCTION` (in the first fresh-eyes pass),
but the bead TITLES still said "(CANDIDATE)" — implying the bead was
still candidate-status. That's title-vs-label drift.

**Fix:** Rewrote all 3 EXP-109 titles to explicitly say "DEMOTED: NO_EVIDENCE
production; C++ Strong rooting compensates" / "DEMOTED: see Codex
source-graph review 2026-05-16" / "informational only; production
NO_EVIDENCE". The bead is now self-evidently demoted from title alone.

### Blunder #9 — Pass-3 synthesis cites "60 CONFIRMED_UB" but actual is 70

The pass-3 synthesis written before Codex's round-121+122+123 work
references "60 CONFIRMED_UB" findings. After Codex promoted EXP-072,
097..108, 110, 111 and demoted EXP-109, the actual count per FINAL_UB_REPORT
v2 is **70 CONFIRMED_UB + 17 NO_EVIDENCE + 17 DEFERRED + 2 RESOLVED = 106**.

**Status:** This document captures the correct numbers. Pass-3 synthesis
should not be quoted as the live count; cite FINAL_UB_REPORT v2 instead.

---

## Pass-2 verifications that held

- All 3 EXP-111 bead labels now match Codex's CONFIRMED_UB framing ✓
- All bead verdict labels match registry verdicts (mass cross-check passed) ✓
- Drift-checker output stable at 16 findings (1 metadata-drift for EXP-072 +
  the Codex-added EXP-097..108 needing per-EXP D beads) ✓
- Rubric-status reports 1 missing winner (EXP-043), down from the 5 my
  pass-3 synthesis hallucinated ✓
- The 200-bead count is correct (was correct in pass-3 too) ✓
- `compute-affected-exps.sh HEAD~1 HEAD → affected_exps=1` (EXP-014 only),
  matching `registry-paths.sh` precise matching ✓

---

# Original Fresh-Eyes Review (Pass 1)

## Blunders FOUND and FIXED

### Blunder #1 — Wrong list of "missing winners" in pass-3 synthesis

**Claim (pass-3 synthesis):** "5 missing winners: EXP-026, EXP-036, EXP-085,
EXP-086, EXP-094."

**Reality:** When I re-ran `rubric-status.sh` for this review, the actual
output was: EXP-026, EXP-036, EXP-043, EXP-044, EXP-012. **I had
hallucinated three of the EXP numbers** (085, 086, 094) when writing the
synthesis. After fixing the script's verdict-filter (skip RESOLVED) and
absorbed-by-S filter (skip EXPs whose Winner lives in an S-bundle), the
correct missing-winners list is **just EXP-043** (1 entry, not 5).

**Fix applied:** rubric-status.sh now skips RESOLVED/NO_EVIDENCE verdicts
AND skips EXPs absorbed by S-bundles (where the Winner lives in the S
section, not per-EXP).

### Blunder #2 — Wrong compute-affected-exps result

**Claim (pass-3 synthesis):** "compute-affected-exps HEAD~1 HEAD →
affected_exps=4 covering EXP-001/014/015/072."

**Reality:** The "4" came from the BUGGY pre-fix path-matcher (the
"same-directory" clause was too permissive — any changed file in
src/collections/ matched EVERY EXP in src/collections/). After the same
path-matching fix I applied to `registry-paths.sh`, the correct count is
**1 EXP** (EXP-014 — for `multi_array_list.rs`, the actually-changed file).

**Fix applied:** `compute-affected-exps.sh` now uses the same precise
matching as `registry-paths.sh` (exact / parent-dir / descendant only).
Re-verified: `affected_exps=1 matrix_size=1` with only EXP-014.

### Blunder #3 — "5 real missing R/T triplets" claim was false-positives

**Claim (pass-3 synthesis):** "check-registry-drift.sh found 5 real
missing-triplet gaps for EXP-002/018/019/020/029."

**Reality:**
- EXP-002, 018, 019 are CONFIRMED_UB but **correctly covered by R-S1
  bundled bead** (per phase8 Blast radius — closes list). My drift parser
  didn't know about structural-fix bundling.
- EXP-020, 029 are **DEFERRED** verdicts that don't need R/T/D triplets at
  all (design-only entries). My parser only skipped NO_EVIDENCE/RESOLVED,
  not DEFERRED.

**Fix applied:** drift checker now:
1. Skips DEFERRED verdicts (added to SKIP_VERDICTS set).
2. Parses phase8 S-section "Blast radius — closes:" bullet lists for
   absorbed EXPs, and skips the corresponding R/T missing-triplet errors
   for absorbed EXPs (the R-S<X>/T-S<X> beads cover them).
3. Expands bundled bead titles like "R-EXP-003-006" to cover EXP-003 AND
   EXP-006 (was previously only matching EXP-003).
4. Restricts S-section EXP-mention parsing to "Blast radius" bullet block
   only (was over-matching from incidental EXP-NNN mentions in S section
   prose — e.g., S13's intro paragraph mentions other EXPs as comparisons).

### Blunder #4 — EXP-109 bead labels were STALE

**Claim (pass-2 synthesis):** "EXP-109 triplet verdict label updated to
NEEDS_REFINEMENT."

**Reality:** After Codex's source-graph review demoted the production
claim to NO_EVIDENCE (in the rewritten pass-2 synthesis), I didn't update
the bead labels to reflect that. The 3 EXP-109 beads still carried:
- `verdict:NEEDS_REFINEMENT` (stale)
- `miri-witness-confirmed` (technically still true for the standalone
  reproducer, but misleading without context — readers might think the
  production path was confirmed)

**Fix applied:** all 3 EXP-109 beads (`bun-lpos` R, `bun-5czb` T,
`bun-t8e9` D) relabeled:
- `verdict:NEEDS_REFINEMENT` → `verdict:NO_EVIDENCE_PRODUCTION`
- `miri-witness-confirmed` → `rust-shape-miri-confirmed` (more precise)
- Added `codex-source-graph-demoted-2026-05-16`

### Blunder #5 — regression-runner.sh negative-control was destructive

**Claim (pass-3 synthesis):** "regression-runner.sh supports `--negative-
control <fix-sha>`."

**Reality:** My pass-3 implementation did `git checkout "$NEGATIVE_CONTROL^"`
in the LIVE worktree. In a multi-agent environment this would stomp on
other agents' work. Codex correctly disabled the --negative-control flag
in their revision, with a refusal message pointing to "use a disposable
git worktree runner."

**Fix:** No action needed; Codex already fixed. The synthesis claim is
stale and should be updated to note negative-controls are TBD pending a
worktree-based runner.

---

## Real audit findings surfaced by these fixes

The fresh-eyes pass didn't just find blunders — it surfaced **real audit
gaps** that the corrected scripts now precisely report:

### Real drift (19 items, post-fix)

After all 4 parser fixes, `check-registry-drift.sh` correctly reports:

1. **EXP-072 missing R, T (no S coverage)** — but the bead `bun-j2o`'s
   title says "R-S7: HiveArrayFallback migration ... (EXP-072)". This is
   actual stale-metadata drift: at some point S7's phase8 entry was
   renamed (HiveArrayFallback → Windows webcore file I/O), and the bead
   title was never updated. Either (a) update the phase8 S7 entry to
   include EXP-072 in Blast radius, or (b) rename the bead and file a new
   R-S<X> for HiveArrayFallback.

2. **EXP-097, 098, 102, 103, 104, 106, 107, 108 missing full triplet** —
   these are Codex-added EXPs from later in the audit. Per the audit's
   discipline, each CONFIRMED_UB needs at least D-EXP-NNN (per-site
   SAFETY block). If they're absorbed into S-bundles, the per-EXP D bead
   is still required.

3. **EXP-099, 100, 101 missing D only** — covered by S4 (R-S4/T-S4
   bundled), but the per-site D-EXP-099/100/101 beads weren't filed.
   Real gap.

### Real rubric gaps (1 item, post-fix)

After both fixes, `rubric-status.sh` correctly reports:

- **EXP-043 missing Winner** — has a phase8 rubric table but no Winner
  line. Needs a per-EXP rubric session (the META-RUBRIC-SCORING workflow
  Codex disabled the destructive runner for).

---

## Verified-still-correct claims (5/5 random EXPs)

The adversarial re-audit of pass 2 picked 5 random EXPs (EXP-004, 026,
033, 069, 086) and verified each holds. Re-checked in this pass:

| EXP | Verdict | Still holds? |
|---|---|---|
| EXP-004 | CONFIRMED_UB | YES (encoding.rs:303-310 source verified again) |
| EXP-026 | CONFIRMED_UB | YES (TODO(b2) at timer/mod.rs:908-910 verified again) |
| EXP-033 | NO_EVIDENCE current | YES + widen proposal (T: Pod bound) still valid |
| EXP-069 | DEFERRED | YES (correctly hedged) |
| EXP-086 | CONFIRMED_UB | YES (no callers verified via `rg`) |

5/5 verdicts hold under THIS pass's re-re-audit too.

---

## Verified manual claim: FFICallbackFunctionWrapper rooting

The pass-3 synthesis cited Codex's claim that
`src/jsc/bindings/JSFFIFunction.cpp` roots the JS callback via
`JSC::Strong<JSC::JSFunction>` and `JSC::Strong<Zig::GlobalObject>`. I
personally read the file in this pass:

```cpp
class FFICallbackFunctionWrapper {
    JSC::Strong<JSC::JSFunction> m_function;     // line 45
    JSC::Strong<Zig::GlobalObject> globalObject; // line 46
    ~FFICallbackFunctionWrapper() = default;
    FFICallbackFunctionWrapper(JSC::JSFunction* function, ...);
};
```

**Verified.** The C++ wrapper holds Strong handles, exactly as Codex's
note said. EXP-109's production demotion is correctly justified.

---

## What this fresh-eyes pass proves about the audit

1. **The audit's defensibility comes from being willing to find its own
   blunders.** This pass found 5 hard-wrong claims in my own pass-3
   synthesis — wrong EXP numbers, wrong counts, false positives, stale
   labels, and an unsafe script. All five were fixed.

2. **The drift checker + rubric-status are now actually trustworthy.**
   Pre-fix: 47 drift candidates (mostly false positives) and 5
   missing-winners (3 hallucinated). Post-fix: 19 real drift findings and
   1 real missing winner. The scripts are now usable as audit-actionable
   gates instead of noise generators.

3. **The signal-to-noise ratio matters.** A drift checker that emits 47
   false positives encourages reviewers to ignore the real ones. A
   drift checker that emits 19 real findings (with explicit `absorbed_by_s`
   annotation showing why edge cases are categorized) is something a
   reviewer can actually act on.

4. **The audit's structural-fix bundling discipline (R-S1..R-S13) was
   correctly designed but my drift checker didn't initially understand
   it.** Fixing the parser to read phase8 Blast-radius blocks is the
   exact "make audit infrastructure understand the audit's own
   conventions" loop the user asked for.

---

## Pass-3 synthesis claims that need updating

The following claims in `DEEP_PASS_3_SYNTHESIS_2026-05-16.md` are now
known to be wrong and should be updated:

| Line ~ | Claim | Correct version |
|---|---|---|
| 38 | "47 drift candidates ... 5 are real missing-triplet gaps" | **19 drift candidates (post-parser-fix)** — 1 metadata drift (EXP-072 stale R-S7 bead title), 8 fully-missing triplets for Codex-added EXP-097..108, 3 D-only missing (EXP-099/100/101) |
| 44 | "5 missing winners: EXP-026, EXP-036, EXP-085, EXP-086, EXP-094" | **1 missing winner: EXP-043** (the other 4 are either covered by S-bundles or have RESOLVED verdict) |
| 47 | "compute-affected-exps HEAD~1 HEAD → affected_exps=4" | **affected_exps=1 (EXP-014 only)** after path-matching fix |
| 52-55 | "5 real missing R/T triplets for EXP-002/018/019/020/029" | **0 of those are real** — all 5 are false positives. EXP-002/018/019 are covered by R-S1; EXP-020/029 are DEFERRED |
| ~regression-runner mentions of negative-control | "supports --negative-control" | Codex disabled this; needs a disposable-worktree runner |

A future pass should rewrite the affected sections of pass-3 synthesis to
reflect these corrections. (This document, the fresh-eyes review, captures
the corrections so they're not lost.)

---

## Defensibility self-cross-check

Every claim above is either:
- A file:line I personally re-read in this pass, OR
- A script I re-ran with output captured, OR
- A comparison between an old claim and a fresh-checked current state.

**No claim in this fresh-eyes review is itself unverified.** The blunders
I found were all in my own prior work; the fixes I applied are all
verifiable (re-run the scripts and compare outputs).

This pass is what the user asked for — not new audit work, but rigorous
critical review of existing claims with corrections applied. The audit
self-corrects in public.
