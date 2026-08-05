# Guide to the Bun Unsafe-Code-Exorcist Audit Findings

> **Audience.** Coding agents (and humans) digesting the `.unsafe-audit/` artifacts. Read this first.
> **Goal.** Maximally rapid orientation — what's where, what to trust, what to skip, in what order, with cross-references.
> **Standard.** Codex-grade defensibility. High-priority claims have file:line citations; miri-backed findings include their `cargo +nightly miri run` traces; findings that need Loom, scheduling, integration, or call-graph evidence are labelled as such.

This audit was produced by [`/rust-unsafe-code-exorcist`](https://jeffreys-skills.md/skills/rust-unsafe-code-exorcist) across **five passes**, each adding a different lens. The companion fix PR landing alongside this audit applies the highest-confidence remediations with isomorphism / semantic-repair evidence.

---

## 30-second orientation

| You want to | Read this |
|-------------|-----------|
| The headline numbers + executive narrative | [`.unsafe-audit/AUDIT_SUMMARY.md`](.unsafe-audit/AUDIT_SUMMARY.md) |
| The defensible final bug count and tier discipline | [`.unsafe-audit/PASS4_FINDINGS_INDEX.md`](.unsafe-audit/PASS4_FINDINGS_INDEX.md) |
| The 5 miri-backed runtime UB witnesses | [`.unsafe-audit/verification/miri-confirmed-summary.md`](.unsafe-audit/verification/miri-confirmed-summary.md) |
| The quantified prioritization (BLAST × LIKELIHOOD × DISCOVERABILITY) | [`.unsafe-audit/audit/synthesis/PASS4-risk-scoring.md`](.unsafe-audit/audit/synthesis/PASS4-risk-scoring.md) |
| How Bun's own commit history corroborates the findings | [`.unsafe-audit/audit/synthesis/PASS4-soundness-archeology.md`](.unsafe-audit/audit/synthesis/PASS4-soundness-archeology.md) |
| The PR-landing order for fixes | [`.unsafe-audit/PASS4_FINDINGS_INDEX.md` § "Pass-4 PR landing order"](.unsafe-audit/PASS4_FINDINGS_INDEX.md) |
| The Codex-tightened classification rules (what survived adversarial review) | [`.unsafe-audit/CODEX_PASS3_FINAL_REVIEW.md`](.unsafe-audit/CODEX_PASS3_FINAL_REVIEW.md) |

If you're triaging in 5 minutes: read `AUDIT_SUMMARY.md` + `PASS4_FINDINGS_INDEX.md` + `verification/miri-confirmed-summary.md`. You'll have the headline ten times over.

---

## The tier system (read once, internalize)

Findings are classified into tiers with explicit per-tier evidentiary bars. The user (and Codex review) demoted aggressively to keep the audit defensible.

| Tier | Bar | Evidence required |
|------|-----|-------------------|
| **P0** / security-triage candidate | Untrusted input reachable through ordinary user commands → UB or concrete security impact. Use "CVE-class" only when the impact story survives source review. | File:line + adversarial-input proof + (where applicable) miri trace |
| **T1** | Confirmed/high-confidence patchable memory-safety bug. A live caller exists today, OR a `pub` API admits the violation without an additional `unsafe` block. | File:line + source-verified mechanism + (miri trace where reproducible) |
| **T2** | Unsafe public-contract / architecture defect. Safe Rust admits an invalid state through the API, but no live call path was proved today. | File:line + the missing contract / over-strong signature |
| **T3** | Latent / threat-model-dependent / fragile-invariant watchlist. Future-proofing. | File:line + the fragility |

**Demoted findings are listed explicitly** in [`CODEX_PASS3_FINAL_REVIEW.md`](.unsafe-audit/CODEX_PASS3_FINAL_REVIEW.md). Read that file before quoting any "T1 count" — the raw agent totals were larger than the post-Codex defensible count.

The final defensible public tally: **40 T1/T1-equivalent entries, including 6 ceiling-score supply-chain entries, plus ~32 T2 + ~58 T3**. The 40-entry dashboard keeps strict memory-safety findings and explicitly-labelled non-UB security defects separate; critical crash-reliability items are tracked outside this T1 risk table. Do not quote it as "40 memory-safety bugs."

---

## Directory map (top-level)

```
.unsafe-audit/
├── AUDIT_SUMMARY.md                   ← Start here. Executive narrative.
├── PASS{2,3,4}_FINDINGS_INDEX.md      ← Per-pass consolidated indexes.
├── PASS2_FINAL_REVIEW.md              ← Codex tightening of pass-2.
├── CODEX_PASS2_SUMMARY.md             ← Codex adversarial pass 2.
├── CODEX_PASS3_SUMMARY.md             ← Codex adversarial pass 3.
├── CODEX_PASS3_FINAL_REVIEW.md        ← READ THIS for tier discipline.
├── REVIEWER_RESPONSES.md              ← Maintainer-empathy review.
├── SECURITY-public-ready.md           ← Scrubbed SECURITY.md proposal for maintainer review.
├── soundness-debt-dashboard.md        ← Stakeholder-facing dashboard.
├── beads-to-create.md                 ← Bead commands (not yet filed).
├── ci-matrix.yml                      ← Proposed CI matrix entry.
├── verify.sh                          ← Composite verification harness.
├── unsafe-inventory.jsonl             ← 11,044 sites, normalized + categorized.
├── phase0_*                           ← Bootstrap artifacts (scope decision, tool inventory).
├── audit/
│   ├── classification/                ← Tier rollups + master classification.
│   ├── plans/                         ← 40 per-cluster / per-crate plan docs (largest dir).
│   ├── synthesis/                     ← Cross-cutting analyses (invariants, archeology, etc.).
│   └── tests/                         ← Rust compile-fail, proptest, Kani, and regression fixtures.
├── verification/                      ← 5 miri-backed witness entries (4 detail files + 1 summary-only trace).
└── phase1/cluster-summary.json        ← Phase-1 enumeration summary.
```

**File size discipline:** the audit dir is intentionally text-only. The 2,000+ phase-1 ast-grep JSON fragments are gitignored; only `cluster-summary.json` and the consolidated `unsafe-inventory.jsonl` ship. See `.unsafe-audit/.gitignore`.

---

## Reading orders (pick one based on your goal)

### "I'm a Bun maintainer about to land the fix PR"

1. `AUDIT_SUMMARY.md` (the narrative)
2. `PASS4_FINDINGS_INDEX.md` § "Pass-4 PR landing order" (what to land first)
3. For each PR you're considering: open the linked plan doc in `audit/plans/`
4. `verification/miri-confirmed-summary.md` (the strongest evidence)
5. `REVIEWER_RESPONSES.md` (the maintainer-empathy review — your tier-pushback questions are likely answered here)
6. The companion fix PR (this branch's sibling) for the actual patches

### "I'm an auditor reproducing the bugs"

1. `verification/miri-confirmed-summary.md` (the 5 miri reproducers)
2. For each: open the per-bug detail file. Each contains a minimal cargo project, the source, and the verbatim miri trace.
3. Reproduce locally: `mkdir /tmp/repro && cd /tmp/repro && cargo new --bin repro` etc.

### "I want to verify the audit's classifications hold up"

1. `CODEX_PASS3_FINAL_REVIEW.md` (the demotions — what was promoted/demoted and why)
2. `audit/synthesis/codex-pass2-adversarial-reclassification.md` (the earlier adversarial pass)
3. `audit/synthesis/fresh-eyes-review.md` (Phase 7 fresh-eyes)
4. `audit/synthesis/PASS3-reachability-and-test-coverage.md` (the call-graph + test-coverage scaffolding)
5. Pick a T1 finding at random, follow it from `PASS4_FINDINGS_INDEX.md` → plan doc → source file. Check.

### "I'm a security researcher hunting for unaudited similar patterns"

1. `audit/synthesis/PASS4-soundness-archeology.md` (the 2,989 unsafe blocks the maintainers already removed — pattern catalog)
2. `audit/synthesis/PASS3-macro-template-audit.md` (macros that emit unsafe — uncovered surface in `bun_runtime`)
3. `audit/synthesis/PASS3-reachability-and-test-coverage.md` (which unsafe-heavy crates lack tests)
4. The companion `audit/tests/clippy_lint_from_ref_cast_mut/` (the lint that catches the U2 pattern)
5. `audit/plans/PASS5-async-cancel-reentry.md` if present — the one bug class pass-1-through-4 missed (audited in pass 5)

### "I'm new to Bun and want to understand the unsafe surface architecturally"

1. `audit/synthesis/invariants.md` (15 named invariants the unsafe code upholds)
2. `audit/synthesis/soundness-surface.md` (what unsafe is reachable from JS API)
3. `audit/synthesis/deliberate-design-evidence.md` (why most of the unsafe IS load-bearing)
4. `audit/synthesis/PASS3-macro-template-audit.md` (the macros that produce most unsafe in expansion)
5. `audit/synthesis/codex-pass2-architecture-map.md` (workspace dependency tiers)

### "I'm running the same skill on a different project"

1. Skip everything Bun-specific.
2. The methodology IS the skill: [`/rust-unsafe-code-exorcist`](https://jeffreys-skills.md/skills/rust-unsafe-code-exorcist) → SKILL.md → references/methodology/.
3. The artifacts here are the OUTPUT shape of the skill. Replicate the structure under your project's `.unsafe-audit/`.

---

## The 5 miri-backed UB witnesses (skim these first)

Each has a verbatim `cargo +nightly miri run` error message. Four currently have dedicated detail files with minimized reproduction scaffolding; the PUB-INSTALL-3 yarn trace is summary-only in `verification/miri-confirmed-summary.md` and should be split out before using the miri corpus as a standalone public artifact.

| # | Bug | Source | Miri error |
|---|-----|--------|------------|
| 1 | `linear_fifo::assume_init_slice<T>` niche-T | `src/collections/linear_fifo.rs:67-71` | `reading memory ... but memory is uninitialized` |
| 2 | `linux_errno::impl GetErrno for usize` transmute | `src/errno/linux_errno.rs:175-188` | `enum value has invalid tag: 0x0086` |
| 3 | PUB-INSTALL-1 (`HasInstallScript`) supply-chain | `src/install/lockfile/Package/Meta.rs:38-46` | `enum value has invalid tag: 0x2a` |
| 4 | UB-RT-001 (`encoding.rs` Vec<u8>→Vec<u16>) | `src/runtime/webcore/encoding.rs:303-310` | `incorrect layout on deallocation` |
| 5 | PUB-INSTALL-3 (yarn.rs uninit Dependency) | `src/install/yarn.rs:918-925` | `reading uninitialized memory` |

Detail files: `verification/miri-confirmed-*.md` plus the summary-only PUB-INSTALL-3 entry in `verification/miri-confirmed-summary.md`.

---

## The 6 ceiling-score supply-chain primitives

All 6 are reachable via a malicious `bun.lockb` (or `yarn.lock`) planted in a repo a developer then clones and runs `bun install` against. These are the highest-risk install/lockfile findings (risk 125). Additional install findings such as PUB-INSTALL-5/6/7 are tracked in the dashboard with lower risk scores.

| ID | Location | Mechanism | Fix |
|----|----------|-----------|-----|
| PUB-INSTALL-1 | `src/install/lockfile/Package/Meta.rs:38-46` | `transmute<u8, HasInstallScript>` on lockfile byte; 3 valid values, 253 invalid | `match`/`TryFrom` |
| PUB-INSTALL-2 | `src/install/lib.rs` `Meta::origin` | Same shape, `Origin` enum | Same fix |
| PUB-INSTALL-3 | `src/install/yarn.rs:918-925` | `&mut [Dependency]` over uninit Vec capacity; `DependencyVersionTag` is niche-bearing | `Vec::resize_with` or proper init |
| PUB-INSTALL-4 | `src/install/lockfile/Tree.rs:1020` | `deps.get_unchecked(attacker_id)` | `.get(...).ok_or(Malformed)` |
| F-NEW-1 | `src/semver/lib.rs:613` `String::slice` | `(off, len)` from `[u8; 8]` lockfile bytes → `get_unchecked(off..off+len)` OOB up to ~6 GiB | Bounds-check before slicing |
| F-NEW-2 | `src/semver/lib.rs:536-537` `String::eql` | Same shape, two simultaneous OOB reads | Same fix |

These should land FIRST in any remediation PR sequence.

---

## Plan documents — what's in `audit/plans/`

40 files. Group by prefix:

| Prefix | What it is |
|--------|-----------|
| `C-001`, `C-002`, `C-003` | The 3 original "REFACTORABLE" cluster plans from pass 1 (NonNull from-reference, transmute-to-enum, Send/Sync). |
| `A-001`, `A-002`, `A-003` | "STRICTLY_UNAVOIDABLE" hardening plans (Zig-port `*mut Self`, `bun_core::heap` roundtrips, FFI shim crates). |
| `B-001-and-B-002` | "PERF_ONLY" cluster (`unreachable_unchecked`, `get_unchecked`) with `safe-only` feature design. |
| `bench-targets.md` | Bench mapping for B-cluster verification. |
| `CODEX-P2-*` | Codex pass 2 focused plans (Windows waker placeholder). |
| `CODEX-P3-*` | Codex pass 3 architectural findings (cross-thread task traits, `&'static mut` writers). |
| `PASS2-*` | Pass-2 multi-agent deep-dives (atomic ordering, bun_runtime, ptr_cast, ptr_intrinsic, slice_from_raw, maybe_uninit, TODO-hunt, JSC invariants, Pin+Drop, custom-invariants). |
| `PASS3-*` | Pass-3 deep-dives on specific large crates (bun_install, bun_jsc, bun_uws_sys+bun_libuv_sys, bun_http+bun_http_jsc, bun_bundler, bun_core, bun_sys, cross-cutting). |
| `PASS4-*` | Pass-4 deep-dives on the unaudited surface (adversarial parsers, shell parser, CSS+JS parsers, config parsers, PipeWriter+threading, cryptography, dyn Trait, spawn+crash+sql). |
| `PASS5-*` | Pass-5 closure work (async cancellation re-entry, etc.). |
| `PR2-isomorphism-evidence.md` | Per-fix evidence for the fix PR, including isomorphism where applicable and explicit semantic repair where the old behavior was UB. |

Open the file that matches the finding you care about. Each plan ends with **recommended PR landing order** and **per-site tables** with file:line citations.

---

## Synthesis documents — what's in `audit/synthesis/`

Cross-cutting analyses. Read these to understand the AUDIT, not specific bugs.

| File | What it is |
|------|-----------|
| `invariants.md` | 15 named soundness invariants (I-001..I-015) the unsafe surface upholds. |
| `soundness-surface.md` | What unsafe is reachable through JS API tiers. |
| `refactor-clusters.md` | Phase-3 cluster groupings of the inventory. |
| `deliberate-design-evidence.md` | Why most unsafe in Bun IS load-bearing — exhibits A through G. |
| `fresh-eyes-review.md` | Phase-7 spot-check of proposed rewrites. |
| `phase1_inventory_summary.md` | Phase-1 totals. |
| `macro-expanded-unsafe-survey.md` | Pass-2 macro-expansion survey (bun_alloc 299 expanded vs 273 source). |
| `codex-pass2-architecture-map.md` | Workspace tier map. |
| `codex-pass2-phase-gap-analysis.md` | Pass-2 skill-compliance review. |
| `codex-pass2-adversarial-reclassification.md` | Pass-2 corrections. |
| `codex-pass2-safety-comment-gap.md` | Reproducible SAFETY-comment coverage heuristic (9,450 / 11,044 covered). |
| `codex-pass3-higher-severity-findings.md` | Pass-3 architectural findings. |
| `PASS3-macro-expanded-deep-dive.md` | Pass-3 expansion across 8 crates. |
| `PASS3-macro-template-audit.md` | Audit of the MACROS (not their emissions) — `bun_jsc::host_fn`, `generate-classes.ts`, etc. |
| `PASS3-reachability-and-test-coverage.md` | Crate-by-crate test coverage matrix; 63 of 84 crates have zero Rust unit tests. |
| `PASS4-soundness-archeology.md` | Git-history mining — 2,989 unsafe blocks already removed by maintainers in tagged commits. |
| `PASS4-risk-scoring.md` | Quantified per-T1 scoring (BLAST × LIKELIHOOD × DISCOVERABILITY). |

---

## Verification documents — what's in `verification/`

Every file in here is a concrete, reviewable artifact for a specific finding.

| File | What |
|------|------|
| `miri-confirmed-summary.md` | Index of the 5 miri-backed UB witnesses. |
| `miri-confirmed-linear-fifo-niche-ub.md` | F-1 reproducer + miri trace. |
| `miri-confirmed-linux-errno-transmute.md` | pre-existing-ub-001 reproducer + miri trace. |
| `miri-confirmed-pub-install-1.md` | P0 supply-chain reproducer + miri trace. |
| `miri-confirmed-encoding-vec-layout.md` | UB-RT-001 reproducer + miri trace. |
| `repro-storeslice-send.rs` | Standalone `rustc` reproducer (compile witness). |
| `repro-linear-fifo-niche.rs` | Standalone `rustc` reproducer (miri-trigger gated). |

To reproduce any of these: copy the source from the `.md` file into a minimal cargo project and run `MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run`. Each takes ~30 seconds.

---

## Tests + lints — what's in `audit/tests/`

Real, compilable regression catchers.

| File | What |
|------|------|
| `README.md` | Integration recipe — where to drop each fixture in Bun's tree, what dev-dep to add, what CI step to wire. |
| `storeslice_send_compilefail.rs` | trybuild fixture — compiles today (bug), fails to compile after fix. |
| `jscell_send_compilefail.rs` | Same shape for `JsCell<T>`. |
| `racycell_sync_compilefail.rs` | Same for `RacyCell<T>`. |
| `concurrent_promise_task_send_compilefail.rs` | Same for `ConcurrentPromiseTask`. |
| `blob_sync_compilefail.rs` | Same for `Blob`. |
| `expected_errors/*.stderr` | Expected compile errors for trybuild. |
| `linear_fifo_proptest.rs` | proptest fixture verifying `T: AnyBitPattern` is the right bound. |
| `bounded_array_resize_proptest.rs` | Same for `BoundedArray::resize`. |
| `dirent_parser_regression.rs` | 14 standalone-passing tests for the Linux/macOS/FreeBSD dirent-parser bugs. |
| `clippy_lint_from_ref_cast_mut/` | ast-grep YAML rule + dylint crate scaffold + positive/negative test corpora. |

The ast-grep rule fires on the 2 real Bun U2 sites (`src/http/AsyncHTTP.rs:117`, `src/http/lib.rs:176`) with **zero false positives in the tested corpus**.

---

## How to cite an audit finding in a PR / issue / CVE

Each finding has a STABLE ID prefix from the audit:
- `PUB-INSTALL-N` — install/lockfile findings; PUB-INSTALL-1..4 are in the ceiling-score supply-chain set, while later PUB-INSTALL entries carry their own dashboard risk scores
- `pre-existing-ub-N` — pass-2 latent UBs
- `UB-RT-N` — bun_runtime findings
- `H1..H17` — HTTP-stack findings
- `U1`, `U2.×8`, `U3.×11` — ptr_cast deep-dive findings
- `bundler-B1..B5` — bundler Renamer cascade
- `F-1`, `F-2`, `F-NEW-1..2` — maybe_uninit / semver findings
- `P3-BC-001..005` — bun_core pass-3
- `CRASH-T1-1..2`, `TH-1` — pass-4 crash-handler + threading findings

Cite as: `[audit ID] (path/file.rs:N — see .unsafe-audit/audit/plans/PLANNAME.md for details)`.

---

## Maintainer-empathy stance

`REVIEWER_RESPONSES.md` answers, per cluster, "would I land this as the Bun maintainer?" That doc deliberately steel-mans pushback on the major claims it covers. Read it before discounting a finding.

Bun's maintainers have ALREADY removed **2,989** unsafe blocks in tagged commits (per `PASS4-soundness-archeology.md`). Most major Tier-1 finding classes map to maintainer commit classes; exceptions are called out in the archeology table instead of hidden. This audit isn't novel-bug-finding from outsiders — it's the NEXT BATCH of bugs in classes the project's own remediation campaign has already treated as real.

The audit's tone throughout is calibrated to that reality. Findings that overreach are explicitly demoted. The Codex review docs (`CODEX_PASS2_SUMMARY.md`, `CODEX_PASS3_FINAL_REVIEW.md`) document the important demotions with evidence.

---

## Common pushbacks and their answers

| Pushback | Answer |
|----------|--------|
| "Most of the unsafe is in `*_sys` FFI crates — those are forced unsafe." | Yes; the audit explicitly classifies those as STRICTLY_UNAVOIDABLE and recommends **hardening** (SAFETY-comment quality), not removal. See `audit/plans/A-003-ffi-shim-hardening.md` + `audit/plans/PASS3-uws-libuv-deep-dive.md`. |
| "The `*mut Self` pattern looks ugly but is needed for Stacked Borrows." | The audit is the FIRST to point this out for an external reader. See `audit/synthesis/deliberate-design-evidence.md` Exhibit A. The 1,610 `*mut Self` sites are classified (A), not (C). |
| "These bugs are all latent — no live caller." | Six are NOT: PUB-INSTALL-1..4 + F-NEW-1/2 are reachable through `bun install` on a malicious lockfile. Five have miri traces. The "latent-but-pub" ones (linux_errno, etc.) ship as public API and a future caller will hit them. |
| "The macro-expanded count is inflated by `TrivialClone`." | The audit explicitly deflates for this. 78% of macro-emitted `unsafe impl` is the compiler's `#[derive(Clone, Copy)]` output. Headline counts are post-deflation. See `audit/synthesis/PASS3-macro-expanded-deep-dive.md`. |
| "Bun isn't `static_assertions`-free; you can't recommend it." | Codex pass-2/3 caught this. The C-003 assertion sweep uses Bun's existing zero-dep auto-trait-ambiguity trick (`src/runtime/shell/subproc.rs` style), not `static_assertions`. |
| "`debug_assert!` is fine in release builds because we run extensive testing." | Not for attacker-controlled input. PUB-INSTALL-4 and the standalone-graph slice_to bugs are gated only by `debug_assert!`; release-build attackers bypass these. |

---

## What to do next (if you're the maintainer)

1. Read `AUDIT_SUMMARY.md` and `PASS4_FINDINGS_INDEX.md`.
2. Decide on tier policy: which T1s to fix now, which T2s to file as beads, which T3s to ignore.
3. Land the companion fix PR (PR #2 from this audit drop) which already implements the highest-confidence remediations with isomorphism / semantic-repair evidence.
4. For findings NOT in the fix PR, see `beads-to-create.md` for the bead commands.
5. Consider integrating the fixtures in `audit/tests/` into Bun's existing test suite. Each fixture has a wiring recipe in `audit/tests/README.md`.
6. Consider wiring `verify.sh` into Bun's CI matrix (or adopting `ci-matrix.yml` as a starting point).
7. (Optional) Audit the one bug class the audit missed and Pass-5 covered: async cancellation re-entry. See `audit/plans/PASS5-async-cancel-reentry.md`.

---

## What to do next (if you're applying this skill to another project)

1. Install [`/rust-unsafe-code-exorcist`](https://jeffreys-skills.md/skills/rust-unsafe-code-exorcist).
2. Run `/rust-unsafe-code-exorcist /path/to/your-project`.
3. Wait for the 10-phase loop to complete.
4. The output will mirror this directory structure under your project's `.unsafe-audit/`.
5. Read your project's GUIDE (the skill emits one) the same way you read this one.

---

## Skill capabilities exercised in this audit

For the curious: the audit exercises many of the skill's major capabilities across one large, hostile-to-tooling Rust workspace.

- 10-phase loop ✓ (enumerate → per-site write-up → synthesize → classify → plan → adversarial reclassify → fresh-eyes review → bead conversion → harness → maintainer review)
- Operating modes ✓ (`audit-only` → `audit-and-refactor` for the demo PR)
- Polish bar verification ✓
- Operators ✓ (the 17 cognitive operators applied per cluster)
- Anti-pattern catalog ✓
- Verification-first ✓ (5 miri traces, real cargo+nightly runs)
- Source-corpus mining ✓ (archeology)
- Macro-expanded inventory ✓ (8 crates expanded)
- Reachability + test-coverage analysis ✓
- Risk scoring ✓ (40 T1 / 2,507 risk-points quantified)
- Soundness debt dashboard ✓
- SECURITY.md generation ✓
- Audit-driven test generation ✓ (9 Rust test/proof fixtures + lint)
- Clippy lint authoring ✓ (ast-grep + dylint)
- Cross-crate Send/Sync contract analysis ✓
- Multi-pass adversarial reclassification ✓ (Codex P2 + P3 + Pass 4 closure)
- 5 passes total, with artifact history preserved in the contributor branch and the current reviewable artifacts in this PR

The skill is designed to support an end-to-end audit workflow, not a checklist. This audit shows what that looks like at scale on a 108-crate workspace with ~11,044 unsafe sites.

---

## Final note on accuracy

Throughout this audit, the user (and Codex review passes) demoted aggressively to keep claims defensible. **A T1 finding in this audit has survived multiple rounds of "would I land this if I were the maintainer" scrutiny.** Specific demotions (with evidence) are catalogued in `CODEX_PASS3_FINAL_REVIEW.md`.

If you find a claim in this audit that seems wrong, the right move is:
1. Open the linked plan doc for the finding's source-line citation
2. Read 20-30 lines of context at that file:line on current `HEAD`
3. If the claim doesn't hold up — file an issue or PR against the audit dir. The audit is itself in a `git`-tracked subtree; corrections are welcome.

The audit is intentionally over-documented because the standard is high-confidence, reviewer-defensible evidence rather than hand-waving. Priority findings cite source locations; reproducers either run or are explicitly labeled as not yet standalone.
