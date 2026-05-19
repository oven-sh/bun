# Phase 10 Fresh-Eyes Review — Run `2026-05-15-exhaustive`

Single-agent fresh-eyes pass over `phase4_unified_findings.md`,
`UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`, `phase3_dynamic_findings.md`,
the recursive `phase5_experiment_results/**/*.log` evidence set, and the on-disk
`experiments/EXP-*/src/main.rs` reproducers. Read-only on registry/findings
per role brief; recommended fixes are surfaced for the orchestrator,
not applied.

**Status update (Codex, 2026-05-16):** the blocking cross-artifact issues from
this fresh-eyes pass have now been applied to the registry, Phase 3, Phase 4,
and Phase 8. See `CODEX_REVIEW_PHASE3_PHASE4_PHASE8_TIGHTENING_2026-05-16.md`
for that checkpoint's applied corrections, and `FINAL_UB_REPORT.md` for the
current pinned-base totals. Treat the findings below as the historical review
input that triggered those edits, not as the current source of truth.

**Second status update (Codex, 2026-05-16):** later post-convergence cleanup
also removed the remaining stale placeholder/status wording from Phase-2,
Phase-4, and Phase-0 artifacts. Later corrections resolved the stale EXP-037
Windows watcher candidate and demoted EXP-039 under Bun's panic-abort policy.
At that checkpoint, the registry was quiet: 58 `CONFIRMED_UB`, 0 `OPEN`, 0
`NEEDS_REFINEMENT`, 15 `NO_EVIDENCE`, 16 `DEFERRED`, 2 `RESOLVED`. The
negative verdict at the end of this file is preserved only as the historical
Phase-10 review verdict, not as the current audit status. See
`CODEX_DEFENSIBILITY_CORRECTIONS_2026-05-16.md` for the applied cleanup trail.

## Gates skipped (per phase0_run.json constraints)

- `ubs` (not installed) — skipped
- `cargo check --all-targets` (blocked on clang-21 / lld-21) — skipped;
  recommend Phase 11 rch run on `worker-a/worker-b` (tagged `bun,go,rust`)
- `cargo clippy` / `cargo fmt` / `cargo +nightly miri test` (same blockers)
  — skipped
- Standalone-experiment build smoke-test: spot-checked
  `experiments/EXP-001`, `EXP-019`, `EXP-041` with `cargo build` — all three
  compile cleanly under the host nightly toolchain. Standalone reproducer
  scaffolding is healthy.

## Prompt A pass — fresh-eyes on what was written

A1. **EXP-022 vs EXP-028 ID drift between Phase 3 and the registry.**
`phase3_dynamic_findings.md:23` and `:57` reference `EXP-022` as the
DirectoryWatchStore experiment with verdict `NEEDS_REFINEMENT`. The
registry header at `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md:4` explicitly
states `EXP-022 through EXP-025 are intentionally unused after concurrent
Phase-1 edits were renumbered to keep later experiment IDs stable`, and the
DirectoryWatchStore finding lives under `EXP-028`
(`UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md:807-836`). The on-disk
`experiments/EXP-022/` contains the older-numbered reproducer
(`other = 43, _x = 2` clean run preserved at
`phase5_experiment_results/EXP-022_run.log`) and `experiments/EXP-028/`
contains a newer-shape reproducer with a `Lock` field. The two are not
identical witnesses — phase 3 should make the registry-renumbering
explicit, e.g. "EXP-028 (formerly EXP-022)".

A2. **`phase4_unified_findings.md:473` repeats the EXP-022 stale ID.**
Historical correction: the convergence note first needed `EXP-022 → EXP-028`
normalization. Later Phase-5 source audit further demoted EXP-028 to
`NO_EVIDENCE / stale-draft hygiene` because canonical
`dev_server::DirectoryWatchStore` already returns raw.

A3. **Phase 4 cited two EXP-IDs that the registry declares unused.**
- `phase4_unified_findings.md:59` (F-A-6 row) cites `EXP-024 (lifetime cluster)`
- `phase4_unified_findings.md:168` (F-NF6-3 row) cites `EXP-024 (cluster)`
- `phase4_unified_findings.md:153` (F-21-8 row) cited an unused RequestContext placeholder ID
The registry declares `EXP-022..EXP-025` unused. These three citations
were later normalized to "(no EXP yet)" / "unregistered" language; keep this
section as historical review input.

A4. **Phase 4 invents an inline EXP-ID `EXP-A12`.**
`phase4_unified_findings.md:65` (F-A-12 row) cites `EXP-A12`, and line 264
references "the bundler `EXP-A12`". `EXP-A12` is not a registry ID
(the registry uses numeric IDs such as `EXP-001`; at the time of this
fresh-eyes note the max was `EXP-060`, and later passes expanded it to
`EXP-095`). The row notes the cluster is "covered under EXP-028 family /
Bucket-21 F-21-6", so the inline `EXP-A12` is a stray placeholder that should
be removed.

A5. **F-row count claim is wrong.**
`phase4_unified_findings.md:466` claims `Unified F-rows: 132`. Direct
count: 148 `^| F-` rows (including header) and 10 `^| NEW-` rows = 157
data rows + header. Counting unique row IDs (treating
`F-S-17..F-S-25` as one row): 134 `F-*` IDs + 10 `NEW-*` IDs = 144.
The 132 figure is a stale count from an earlier draft. The
`MUST-BE-UB: 21 rows (10 already CONFIRMED ... 11 new candidates)` line is
similarly stale: actual `MUST-BE-UB` matches in the table = 28.

A6. **EXP-001 line range minor mismatch.** Phase 4 row F-001 cites
`src/collections/linear_fifo.rs:62-80, 115-118, 127-172`; the registry
hypothesis cites `:67-71`; the actual `assume_init_slice<T>` lives at
`67-71` and the related `StaticBuffer` TODO/structure at `115-119`.
Phase 4's `:62-80` is a reasonable inclusive range (covers the
documentation block + both helpers); not a defect, just worth noting that
"62-80" implicitly bundles the two helpers in one citation.

A7. **EXP-002 line drift between registry hypothesis and Phase 4.** The
registry hypothesis says `src/errno/linux_errno.rs:175-188`; Phase 4 row
F-002 says `:192`; current source has the `transmute::<u16, E>` at line
192 (verified via `grep`). The registry hypothesis line range should be
updated to `:181-195` to match present source (the impl block starts at
181 with the unsafe transmute at 192).

A8. **EXP-037 vs on-disk EXP-038 numbering — and EXP-038 vs on-disk
EXP-039 — already documented in registry notes but creates ongoing
confusion.** Registry EXP-037
(`UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md:1124-1159`) has its
reproducer at `experiments/EXP-038/src/main.rs`; registry EXP-038 has
its reproducer at `experiments/EXP-039/src/main.rs`. The registry
explicitly acknowledges this ("on-disk experiment directory is `EXP-038/`
per the Phase-5 executor sweep numbering"), but Phase 11 / 12 readers
will hit this trap. Recommend either renaming on-disk dirs to match
registry IDs or adding a single ID-mapping table at the top of the
registry.

## Prompt B pass — fresh-eyes against the actual codebase

B1. **EXP-001 (`linear_fifo::assume_init_slice<T>`).** Source verified at
`src/collections/linear_fifo.rs:67-71`; reproducer at
`experiments/EXP-001/src/main.rs` mirrors the cast verbatim. CLEAN.

B2. **EXP-002 (`linux_errno::impl GetErrno for usize`).** Source verified
at `src/errno/linux_errno.rs:181-194` with the `transmute::<u16, E>(int as
u16)` at line 192. Reproducer correctly mimics the signed/unsigned dance.
CLEAN (modulo line-number drift noted in A7).

B3. **EXP-003 (`Meta::has_install_script`).** Source verified at
`src/install/lockfile/Package/Meta.rs:34, 39-46`. `HasInstallScript` is
declared `#[repr(u8)]` with three variants (`Old=0, False, True` — relying
on default discriminant assignment for the latter two so they are
implicitly 1 and 2). 3/256 valid bit patterns matches the registry claim.
CLEAN.

B4. **EXP-005 (`yarn.rs` `&mut [Dependency]`).** Source verified at
`src/install/yarn.rs:916-925` (slice formed) and `:1401-1402` (`set_len`).
Reproducer mirrors the shape. CLEAN.

B5. **EXP-007 (`Tree.rs` `get_unchecked`).** Source verified at
`src/install/lockfile/Tree.rs:1020`: `let dep = unsafe {
deps.get_unchecked(dep_id as usize) };` — `dep_id` is a `DependencyID`
read directly from the lockfile bytes via `*this_deps_ptr.add(i)`.
Phase 4 row F-007 cites `:1020`; registry cites `:1014-1020` (a bigger
range). Both correct. CLEAN.

B6. **EXP-019 (`StoreSlice<T>` Send/Sync).** Source verified at
`src/ast/nodes.rs:339-340`:
```
unsafe impl<T> Send for StoreSlice<T> {}
unsafe impl<T> Sync for StoreSlice<T> {}
```
Note that the **sibling** type `StoreRef<T>` at lines 39-40 already has
the bounded form (`unsafe impl<T: Send> Send for StoreRef<T> {}` and
`unsafe impl<T: Sync> Sync for StoreRef<T> {}`). So the bounded fix
template is right next door in the same file — the registry's
"one-line fix" claim is verified at the source. CLEAN.

B7. **EXP-029 (`shell::EnvStr` int-to-pointer).** Source verified at
`src/runtime/shell/EnvStr.rs:76-82, 188-200`. The packed `EnvStr(u128)`
representation, `to_ptr` packing, and `cast_slice` reconstruction all
match the registry hypothesis. CLEAN.

B8. **EXP-041 (`WebSocketServerContext::active_connections_*`).** Source
verified at `src/runtime/server/WebSocketServerContext.rs:73-96`. Both
`active_connections_saturating_add` and `active_connections_saturating_sub`
do `let p = core::ptr::addr_of!(self.active_connections).cast_mut(); *p =
...`. The TODO `convert active_connections to Cell<usize>` is present
(line 78). CLEAN.

B9. **EXP-039 (Listener.rs `ptr::read` / `mem::forget`).** Superseded by
Codex correction 50. Source re-check found the original four-site wording
overcounted: only `src/runtime/socket/Listener.rs:235` and `:317` have the
allocation-prone `take_protos()` call before `mem::forget`. The connect-path
sites (`:1069` / shifted `:1296`) do `Option::take()` before `mem::forget`
and call `take_protos()` later. Combined with Bun's `panic = "abort"` policy,
EXP-039 is now a `NO_EVIDENCE` unwind-regression guard rather than current
production UB.

## Prompt C pass — cross-agent consistency

C1. **The three documented multi-agent disagreements
(`phase4_unified_findings.md:280-301`) all check out.** I re-walked
Section L vs Bucket 4 (Disagreement 1), Section G + author TODO vs
Phase 3 clean repro (Disagreement 2), and Bucket-23 vs Section C
(Disagreement 3). Synthesizer's verdicts are well-reasoned and
internally consistent.

C2. **The EXP-022 / EXP-028 numbering bleed (A1, A2 above) is a
multi-agent disagreement that the synthesizer did NOT flag.** Phase 3 (a
prior subagent) used the pre-renumbering ID `EXP-022`; the registry was
renumbered after Phase 3 ran; Phase 4 inherited the stale ID in one
location (`:473`). This is a fourth documented-disagreement-class
inconsistency.

C3. **Phase 4 line 286 self-referentially flags an inconsistency that
remains in the table.** Disagreement 1 explicitly says: "the registry's
actual EXP-019 is `StoreSlice<T>` Send/Sync (Bucket 8), unrelated to
`read_array`. Do not renumber EXP-019 or claim it covers `read_array`".
This is correct guidance, but Phase 4 row F-019 itself is consistent
(it correctly attributes EXP-019 to `StoreSlice`). However Phase 4's
"Cluster B" in §"Cross-section pattern clusters" (line 321-339) lumps
StoreSlice/JsCell/SendPtr under a heading that could read as
implying EXP-019 covers all four; the body text is correct. Marginal,
not a fix-worthy defect.

C4. **EXP-022 on-disk reproducer has a clean Miri output but no
explicit `verdict` line.** `phase5_experiment_results/EXP-022_run.log`
just shows `other = 43, _x = 2` — no `error: Undefined Behavior`. Phase
3 correctly reports this as `NEEDS_REFINEMENT` (Miri did not fire). The
log itself does not document the witness shape directly; the
interpretation lives only in `phase3_dynamic_findings.md:23`. Future
log readers would benefit from a `# verdict: NEEDS_REFINEMENT` comment
appended to the log file, but that is best-practice polish, not a defect.

C5. **CONFIRMED counts in registry vs Phase 4 are consistent.** Registry
has 24 `Verdict: CONFIRMED` lines (counting all flavors:
`CONFIRMED_UB`, `CONFIRMED_UB (...)`, `CONFIRMED-UB`, `CONFIRMED-PANIC-...`).
Phase 4 reports "10 already CONFIRMED in registry" — that wording refers
to the prior-audit anchor set (EXP-001..EXP-005 + EXP-019 + a few
others), distinct from the broader "all-time CONFIRMED" total. Not a
contradiction, but the wording is easy to misread.

C6. **`EXP-019 (Buffers.rs structural fix)` framing in Phase 1 prompts
was a separate, prior orchestrator-prompt error.** Phase 2 Bucket-4
sweeper (`phase2_findings_04_validity.md:25-32, 244-285`) correctly
flagged this and Phase 4 documented it as Disagreement 1. The current
artifacts are consistent on this point.

C7. **Phase 4 references `EXP-A12` as if it were a registry ID** (see
A4). This ID never enters the registry. The cluster is correctly tracked
under EXP-028 / F-21-6, but readers will look for `EXP-A12` and find
nothing.

## Historical recommended corrections for orchestrator

**Status after Codex 2026-05-16 artifact hardening:** the Phase-4 count block
and the unused-EXP placeholder rows have been corrected in current artifacts.
Keep this table as the historical review trail, not as a live to-do list.

| Doc | Location | Issue | Suggested fix |
|---|---|---|---|
| `phase3_dynamic_findings.md` | line 23, line 57 | Cites `EXP-022` for the DirectoryWatchStore experiment, but registry renumbered to `EXP-028` | Change to `EXP-028` and add parenthetical "(formerly EXP-022 on disk)" if preserving the on-disk path |
| `phase4_unified_findings.md` | historical line 473 | Convergence note still said `EXP-022 → NEEDS_REFINEMENT` | Superseded: normalized to EXP-028, then demoted to `NO_EVIDENCE` after canonical-vs-draft source audit |
| `phase4_unified_findings.md` | historical line 59 (F-A-6 row), line 168 (F-NF6-3 row) | EXP-ID column cited the unused EXP-024 placeholder | Superseded: normalized to "(no EXP yet)" / "unregistered" language |
| `phase4_unified_findings.md` | historical line 153 (F-21-8 row) | Cited an unused RequestContext placeholder ID | Superseded: normalized to "(no EXP yet)" / "unregistered" language |
| `phase4_unified_findings.md` | line 65 (F-A-12 row), line 264 | Inline ID `EXP-A12` is not a registry-format ID | Remove `EXP-A12`; keep the existing "(covered under EXP-028 family / Bucket-21 F-21-6)" cross-ref |
| `phase4_unified_findings.md` | line 466-471 ("Final counts") | "Unified F-rows: 132" is stale; actual unique F-row IDs ≈ 134 (or 144 with NEW-*); MUST-BE-UB total is 28 not 21 | Recount and refresh the "Final counts" block before Phase 12 |
| `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md` | EXP-002 hypothesis (line 82), EXP-018 invocation block (line 626) | Line range `175-188` predates current source (transmute now at `:192`); registry should match Phase 4 | Update EXP-002 hypothesis line range to `181-195` and confirm EXP-018 source line numbers haven't drifted |
| `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md` | EXP-037 / EXP-038 (lines 1124, 1163) and elsewhere | On-disk reproducer dirs `EXP-038`, `EXP-039` map to design-doc IDs `EXP-037`, `EXP-038` | Add a single ID-mapping table at the top of the registry, OR rename `experiments/EXP-038` → `EXP-037` and `experiments/EXP-039` → `EXP-038` so naming aligns; preserve the renumbering note |
| `phase5_experiment_results/EXP-022_run.log` | header / footer | Bare Miri output with no verdict annotation | Append a one-line `# verdict: NEEDS_REFINEMENT (Miri clean on raw-pointer-throughout repro)` comment for future readers (low priority) |

## Historical convergence verdict (superseded)

**Historical verdict:** the Phase-10 reviewer asked the orchestrator to resolve
blocking artifact issues before Phase 12 final artifacts.

**Current status:** superseded. These fixes have been applied or converted
into explicit historical notes in the final artifacts. The current registry
has 0 `OPEN` and 0 `NEEDS_REFINEMENT` entries, and convergence round 78 is
the current quiet state (`CONFIRMED_UB=58`, `NO_EVIDENCE=15`,
`DEFERRED=16`, `RESOLVED=2`).

The registry / Phase 4 unified findings are substantively correct: every
spot-checked CONFIRMED_UB finding traces to real source lines, the
reproducers compile and (per their logged Miri output) fire the
hypothesised UB, and the three documented multi-agent disagreements are
adjudicated reasonably. The cross-doc inconsistencies surfaced above
(stale EXP-022 IDs in Phase 3 and Phase 4; phantom EXP-024 / EXP-025 /
EXP-A12 IDs in Phase 4; stale F-row count; on-disk vs registry EXP-037 /
EXP-038 numbering bleed; minor source-line drift on EXP-002) are all
**document-hygiene** defects rather than soundness defects. None of
them invalidate any UB finding. They will, however, materially confuse
the Phase 12 "marketing-grade report" reader and the Phase 11 soak agent
trying to look up `EXP-022`. Fixing them is a 30-minute pass for the
orchestrator and should land before Phase 12 generates the final
artifacts.

## Historical top 3 recommended corrections (highest leverage)

1. **Resolve the EXP-022 / EXP-028 ID drift.** Renumber Phase 3 line 23
   and 57 + Phase 4 line 473 to use `EXP-028`. Also fix Phase 4 line 59 /
   153 / 168's `EXP-024` / `EXP-025` placeholder citations: either
   register real EXP entries or relabel as "(no EXP yet)".
2. **Refresh "Final counts" at `phase4_unified_findings.md:464-473`.**
   Recount F-rows, NEW- rows, and MUST-BE-UB totals with the current
   table state. The 132 figure is stale and the MUST-BE-UB count is off
   by 7.
3. **Add an EXP-ID ↔ on-disk-directory mapping table to the top of
   `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`.** Cover the
   `EXP-037`/dir `EXP-038`, `EXP-038`/dir `EXP-039` mismatches plus the
   `EXP-022..EXP-025` unused range and the on-disk `EXP-022/`
   directory's status (preserved-but-renumbered to `EXP-028`).
