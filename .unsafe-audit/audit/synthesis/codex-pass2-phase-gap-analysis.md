# Codex pass 2 phase-gap analysis

This is a skill-compliance review of the existing audit artifacts against the `rust-unsafe-code-exorcist` phases. It is deliberately stricter than the marketing summary: the goal is to identify what must still happen before the audit can claim a "polish-bar pass."

## Phase status table

| Phase | Existing state | Codex pass-2 verdict | Required next step |
| --- | --- | --- | --- |
| Phase 0 — intake/bootstrap | Present: scope decision, nested audit repo, tool inventory, crate list. | Good. Toolchain inventory was stale; pass 2 updated it. | Keep `phase0_toolchain.json` current after every tool install/check. |
| Phase 1 — enumerate unsafe | Strong AST inventory: 11,044 sites across 108 crates. | Good but not complete-total. `cargo expand` / geiger artifacts mostly failed and macro-generated unsafe is not fully integrated. | Add explicit "macro-generated unsafe missing" caveat to final claims, or get expansion working for representative macro-heavy crates. |
| Phase 2 — localize proofs | Cluster-level proof notes exist. | Partial. Major clusters have proofs, but there is no per-site proof table for all 11,044 sites. | Use cluster-scoped proof templates plus a "sites still unlocalized" count; do not imply every site has been read. |
| Phase 3 — invariants & surface | Strong invariants doc and soundness-surface doc. | Good. Codex pass 2 adds architecture map and source-line backing for higher-risk surfaces. | Tie each P0/P1 issue to an invariant ID in the main summary. |
| Phase 4 — classify | Cluster-level A/B/C classification exists. | Useful but overbroad. Some first-pass labels need corrections: C-001 const site, C-002 dependency, C-003 assertion dependency, B bucket measurements. | Treat pass 2 as Phase 6 adversarial reclassification and update Phase 4 counts after corrections. |
| Phase 5 — refactor plans | Detailed plans for six clusters. | Strong, but some plans are stale relative to reviewer feedback. | Add "plan amendments" before Phase 11 rather than editing history silently. |
| Phase 6 — adversarial reclassification | Intended future Codex/GPT-5 pass. | This document set is the first adversarial reclassification pass. | Run one more quiet pass after amendments; convergence criterion is no P0/P1 changes and <5% cluster-count flips. |
| Phase 7 — fresh-eyes review | Existing spot-check doc plus maintainer review. | Good start. Needs source-backed review for the Windows waker and bundler chunk TODO. | Add targeted review results when those plans are implemented. |
| Phase 8 — beads | `beads-to-create.md` prepared, not executed. | Good but stale in details. It still mentions `num_enum` and `static_assertions`. | Update bead text before filing. Do not file until user authorizes. |
| Phase 9 — verification | `verify.sh` and CI matrix drafted. | Not executed. No miri/bench/careful logs exist for proposed patches. | Do not make soundness/perf claims stronger than "plan" until commands run. |
| Phase 10 — maintainer-empathy review | Strong reviewer responses document. | Good. It already caught several issues Codex confirmed. | Fold Codex pass-2 corrections into the final PR order. |
| Phase 11 — approval gate | Not executed. | Correct. No source edits authorized. | Ask user before source edits, bead creation, branch creation, or GitHub push. |

## Major polish-bar gaps

### Gap 1: Phase 1 totality is "AST source totality", not "expanded Rust totality"

The inventory is excellent for handwritten `.rs` files and Bun's unusual crate-root layout. It is not a full macro-expanded Rust inventory. The existing audit should keep the distinction clear:

- Valid: "11,044 source-level unsafe sites were enumerated."
- Too strong: "every unsafe that rustc sees was enumerated."

### Gap 2: Classification is cluster-level for most sites

The first pass gave high-quality cluster plans but not a per-site proof for every unsafe block. That is a reasonable scale compromise, but the artifact should use language like "cluster-classified" and "sampled" unless a table contains every site in the cluster.

### Gap 3: (B) requires performance evidence

The skill rubric is explicit: (B) PERF_ONLY must include the safe rewrite, benchmark command, measured delta, and threshold. The existing B plan designs that machinery, but does not show run logs. Until it does:

- `B-PROVEN-HOT` should be renamed to `B-CANDIDATE-HOT`.
- `B-UNMEASURED` should be treated as `(C pending measurement)`.
- `safe-only` remains a good plan, not proof.

### Gap 4: The demo PR queue mixes "fix now" and "nice refactor"

The highest-signal order after pass 2:

1. `StoreSlice<T>` bounds.
2. Linux errno checked conversion.
3. Windows `BundleThread` placeholder branch, if a Windows check confirms the one-line replacement.
4. `bun_jsc/generated.rs` `unreachable_unchecked` bindgen-drift fix.
5. C-001 non-const safe rewrites only.
6. C-003 assertion/removal rewrites using Bun's no-dependency trait trick or an explicitly accepted new dependency.

### Gap 5: SAFETY-comment coverage needs an index

The first pass estimated ~80% comment coverage. Codex pass 2's heuristic scan found **1,594 of 11,044** unsafe sites without a nearby `SAFETY`/`Safety`/`# Safety`/`INVARIANT` marker in a small context window. That heuristic is imperfect, but it is a reproducible baseline and gives the hardening work a target.

## Convergence recommendation

Before marketing this as a "complete" application of the skill, run one final quiet pass with these stop conditions:

- All P0/P1 findings have a source-backed plan and either a patch or a deliberately deferred rationale.
- Every corrected first-pass claim is reflected in `AUDIT_SUMMARY.md`, `beads-to-create.md`, and the relevant plan file.
- The B bucket has at least one benchmark log per representative hot-path family.
- `verify.sh` is run for whichever clusters are actually edited.
- A second pass over `TODO(ub-audit)` comments produces no new P0/P1 issues.

