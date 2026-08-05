# Soundness Debt Dashboard — Bun — 2026-05-15

> Last updated: 2026-05-15 (UTC)
> Audit baseline: `428f61eb3486` (post-port-commit `23427db`, +30 hours)
> Drift cycles since baseline: 0 (single-snapshot baseline)

This dashboard summarises Bun's Rust soundness debt after Pass 4 risk-scoring. It is the stakeholder-facing companion to:

- [`audit/synthesis/PASS4-risk-scoring.md`](audit/synthesis/PASS4-risk-scoring.md) — per-finding risk scores.
- [`PASS3_FINDINGS_INDEX.md`](PASS3_FINDINGS_INDEX.md) — full finding index (post-Codex tiering).
- [`CODEX_PASS3_FINAL_REVIEW.md`](CODEX_PASS3_FINAL_REVIEW.md) — adversarial demotion log.
- [`AUDIT_SUMMARY.md`](AUDIT_SUMMARY.md) — top-level audit summary.

---

## At a glance

| Bucket | Count | Risk-points | Avg per site |
|--------|------:|------------:|-------------:|
| (A) STRICTLY_UNAVOIDABLE | ~9,800 | n/a (no per-site risk; hardened via SAFETY comments) | n/a |
| (B) PERF_ONLY (B-CANDIDATE) | ~27 | n/a (gated behind `safe-only` feature; not soundness debt) | n/a |
| (C) REFACTORABLE | ~110 firm | low (mechanical safe rewrites; per-site risk < 10) | n/a |
| **pre-existing-ub (current T1/T1-equivalent)** | **40** | **2,507** | **63** |
| Tier 2 unsafe-contract defects | ~32 | not scored here (qualitative tier; see PASS3_FINDINGS_INDEX) | n/a |
| Tier 3 watchlist | ~58 | not scored here | n/a |
| **Total open soundness/security debt (T1 + T2 + T3)** | **~130** | **2,507 (T1/T1-equivalent only)** | **— ** |

The T1 count is the corrected post-Codex total (see [`CODEX_PASS3_FINAL_REVIEW.md`](CODEX_PASS3_FINAL_REVIEW.md)) plus the Pass 4 semver/threading additions. The pre-Codex raw count was ~63 T1; the follow-up Codex correction pass moved H3, the libuv transmute, JSC contract hazards, WeakPtrData, JsCell/RacyCell, and several atomic-ordering claims out of T1. H5 is kept as an explicitly marked T1-equivalent security P0, not as Rust memory-UB.

### Risk distribution (T1/T1-equivalent dashboard only)

| Risk band | Entries | Risk-pts | Cumulative coverage |
|-----------|--------:|---------:|--------------------:|
| 60-125 (P0 critical) | 24 | 2,019 | 81% |
| 25-59 (P1 high) | 8 | 336 | 94% |
| 10-24 (P2 medium) | 8 | 152 | 100% |
| 1-9 (P3 low) | 0 | 0 | 100% |
| **Total T1/T1-equivalent** | **40** | **2,507** | — |

---

## Heat map: top 15 owners by T1 risk-points

| Rank | Owner | T1 entries/sites | Risk-pts | Trend (single snapshot) |
|-----:|-------|----------------:|---------:|-------------------------|
| 1 | `bun_install` | 8 | 756 | ▶ baseline |
| 2 | `bun_core` (string, fmt, BoundedArray, MutableString, Unaligned) | 6 | 388 | ▶ baseline |
| 3 | `bun_bundler` | 5 | 285 | ▶ baseline |
| 4 | `bun_semver` (packed lockfile strings) | 2 | 250 | ▶ baseline |
| 5 | `bun_http` + picohttp shim | 2 | 205 | ▶ baseline |
| 6 | `bun_runtime` (encoding, ffi_body, FFIObject) | 3 | 188 | ▶ baseline |
| 7 | `bun_sys` (writer overflow, dirent variants × 3) | 4 | 96 | ▶ baseline |
| 8 | `bun_ast` (StoreSlice<T>) | 1 | 80 | ▶ baseline |
| 9 | Multi-crate U2 dealloc/free-through-shared-provenance group | 8 | 48 | ▶ baseline |
| 10 | `bun_collections` (linear_fifo) | 1 | 45 | ▶ baseline |
| 11 | `bun_sourcemap` | 1 | 36 | ▶ baseline |
| 12 | `bun_threading` (`GuardedLock`) | 1 | 30 | ▶ baseline |
| 13 | `bun_io` (Request publish primitive) | 1 | 24 | ▶ baseline |
| 14 | `bun_shim_impl` (Windows) | 1 | 24 | ▶ baseline |
| 15 | `bun_standalone_graph` | 1 | 24 | ▶ baseline |

**Trend.** Because this is a single-snapshot baseline (one audit at one commit), all trend arrows are ▶ baseline. Future drift cycles will populate the trend column from the deltas in `drift/clean-streak.log`.

### Top 6 remediation-owner concentration

The top 6 remediation owners account for `756 + 388 + 285 + 250 + 205 + 188 = 2,072` of 2,507 total risk-points (**83%**). Concentrating remediation work in those crates clears the bulk of the audit's findings.

A different framing: the lockfile/install pipeline (`bun_install` + `bun_semver`) is 1,006 risk-points across 10 entries, or 40% of all dashboard risk. This is where the canonical Zig-to-Rust translation gap (`@enumFromInt` → `transmute<u8, Enum>`) and the Pass 4 packed-string trust gap both live, and it is the most user-reachable subsystem in Bun.

---

## Top 10 highest-risk items

| Rank | Site | Class | Risk | Cluster | Execution |
|-----:|------|-------|-----:|---------|-----------|
| 1 | PUB-INSTALL-1 `Meta::has_install_script` | (C) refactorable to `TryFrom`/`match` | 125 | install-niche-enum | Fix today |
| 2 | PUB-INSTALL-2 `Meta::origin` | (C) refactorable | 125 | install-niche-enum | Same patch family |
| 3 | PUB-INSTALL-3 yarn.rs dependency array uninit | (C) refactorable | 125 | install-uninit-slice | Fix today |
| 4 | PUB-INSTALL-4 Tree.rs `get_unchecked` over attacker ID | (C) refactorable to `.get(...).ok_or(...)` | 125 | install-bounds | Fix today |
| 5 | F-NEW-1 `bun_semver::String::slice` unchecked packed offset/length | (C) checked lockfile string validation | 125 | install-semver-packed-string | Fix today |
| 6 | F-NEW-2 `bun_semver::String::eql` unchecked packed offset/length | (C) checked comparison path | 125 | install-semver-packed-string | Same patch family |
| 7 | H9 picohttp NUL-write through shared slice | (C) refactorable to owned mutable buffer | 125 | http-shared-mut | Fix today |
| 8 (tie) | pre-existing-ub-002 StoreSlice<T> Send/Sync | (C) bound `T: Send`/`Sync` | 80 | ast-laundering | Fix today |
| 8 (tie) | PUB-INSTALL-5/6 `read_array<T>` alignment | (C) typed Vec or `read_unaligned` | 80 | install-alignment | Fix today |
| 8 (tie) | H5 `request_content_len_buf` overflow | (C) buffer sizing; security P0, not Rust memory-UB | 80 | http-content-length | Fix today |
| 8 (tie) | pre-existing-ub-10 FFI closeCallback membership | (A→C migration) validation | 80 | ffi-close | Fix today |
| 8 (tie) | P3-BC-001 fmt::Raw UTF-8 contract | (C) `from_utf8_lossy` or panic | 80 | bun_core-utf8 | Fix today |

These highest-risk entries account for `125×7 + 80×5 = 1,275` risk-points, i.e., **51% of all current dashboard debt**. They are the first tranche for today's fix run.

---

## Baseline State

| State | Count | Risk-points |
|-------|------:|------------:|
| Open at audit baseline | 40 | 2,507 |
| Closed by source fixes so far | 0 | 0 |

This is a baseline snapshot. The audit was authored without source edits. The next dashboard update should be generated after today's source-fix run and should show the remaining risk, not a calendar projection.

---

## Trend / single-snapshot baseline

Bun is post-port-commit `23427db` (~30 hours before the Pass-1 audit ran). Every T1 finding in this dashboard is post-23427db — i.e., the Rust unsafe surface is brand new. The single-snapshot baseline is the right framing.

Future cadence:

- **Initial baseline.** This document. Captures T1/T1-equivalent risk-points = 2,507 across 40 entries.
- **After today's fix run.** Re-score the remaining T1/T1-equivalent set from source, then update this dashboard with actual closed/open counts.
- **Per drift-cron snapshot.** When `verify.sh` detects a new unsafe site or a newly-unsound API contract, increment "drift" count and append to `drift/clean-streak.log`.

```
Risk pts: 2600 ─┐
                │ █
                │ █          baseline before today's fixes
                │ █
        2400 ──┘ █
                  baseline
                  2026-05-15
```

---

## Harness state

| Check | State | Notes |
|-------|-------|-------|
| Last `verify.sh` run | 2026-05-15 (baseline) | Per `verification-log.md` |
| Result | YELLOW (partial) | 7 of 23 attempted crates passed miri with real tests; 12 vacuous (no tests); 2 pre-existing assertion failures; 1 miri-unsupported (FFI); 1 test-code compile error |
| Geiger | Not yet baselined | Tooling detected but no per-site Geiger run executed in this pass |
| Cumulative miri runtime | ~unknown (small) | Per-crate runs are fast; full-suite miri is infeasible (JS engine, network, filesystem) |
| Cross-target cargo check | Not yet run | Recommended `bun run rust:check-all` for any platform-specific T1 fix |

Verification rigor will increase as the first PRs land and the per-PR `verify.sh` gate is exercised.

---

## Open `pre-existing-ub` beads (T1 only)

See [`beads-to-create.md`](beads-to-create.md) for the full bead set. Listed here are the 40 current T1/T1-equivalent entries grouped by remediation cluster.

| Cluster | Beads | Severity | Filed | Status |
|---------|------:|----------|-------|--------|
| install-niche-enum (PUB-INSTALL-1, -2) | 2 | P0 | 2026-05-15 | open |
| install-uninit-slice (PUB-INSTALL-3) | 1 | P0 | 2026-05-15 | open |
| install-bounds (PUB-INSTALL-4) | 1 | P0 | 2026-05-15 | open |
| install-semver-packed-string (F-NEW-1, F-NEW-2) | 2 | P0 | 2026-05-15 | open |
| install-alignment (PUB-INSTALL-5, -6) | 2 | P0 | 2026-05-15 | open |
| install-uninit-row (PUB-INSTALL-7) | 1 | P0 | 2026-05-15 | open |
| http-shared-mut (H9) | 1 | P0 | 2026-05-15 | open |
| http-content-length (H5) | 1 | P0 | 2026-05-15 | open |
| bundler-renamer-shared (B1) | 1 | P0 | 2026-05-15 | open |
| bundler-linker-aliased (B2, B3, B5) | 3 | P0 | 2026-05-15 | open |
| bundler-chunk-aliased (B4) | 1 | P0 | 2026-05-15 | open |
| bun_core-utf8 (P3-BC-001) | 1 | P0 | 2026-05-15 | open |
| bun_core-uninit-tail (P3-BC-002, -004, -005) | 3 | P0 | 2026-05-15 | open |
| bun_core-niche-T (P3-BC-003) | 1 | P0 | 2026-05-15 | open |
| ffi-close-uaf (pre-existing-ub-9) | 1 | P0 | 2026-05-15 | open |
| ffi-close-callback-membership (pre-existing-ub-10) | 1 | P0 | 2026-05-15 | open |
| ast-laundering (StoreSlice<T>) | 1 | P0 | 2026-05-15 | open |
| threading-guardedlock (TH-1) | 1 | P1 | 2026-05-15 | open |
| ptr-cast-dealloc (U2.×8) | 1 (8 sites) | P1 | 2026-05-15 | open |
| ptr-mut-from-shared (U1) | 1 | P1 | 2026-05-15 | open |
| webcore-encoding-roundtrip (UB-RT-001) | 1 | P1 | 2026-05-15 | open |
| collections-niche (F-1 linear_fifo) | 1 | P1 | 2026-05-15 | open |
| unaligned-cast (pre-existing-ub-ptr-2) | 1 | P0 | 2026-05-15 | open |
| writer-overflow (pre-existing-ub-ptr-4) | 1 | P1 | 2026-05-15 | open |
| sourcemap-bound (pre-existing-ub-ptr-6) | 1 | P1 | 2026-05-15 | open |
| standalone-graph-bound (pre-existing-ub-ptr-1) | 1 | P2 | 2026-05-15 | open |
| io-publish-volatile (pre-existing-ub-ptr-3) | 1 | P2 | 2026-05-15 | open |
| windows-shim-bound (pre-existing-ub-ptr-5) | 1 | P2 | 2026-05-15 | open |
| sys-linux-getdents (sys-T1-3) | 1 | P2 | 2026-05-15 | open |
| sys-macos-namlen (sys-T1-2) | 1 | P2 | 2026-05-15 | open |
| sys-windows-unicode-string (sys-T1-4) | 1 | P2 | 2026-05-15 | open |
| errno-enum-checked (pre-existing-ub-001) | 1 | P2 | 2026-05-15 | open |
| libuv-shutdown-release-assert (uws-libuv-F2) | 1 | P2 | 2026-05-15 | open |

`WeakPtrData`, `JsCell<T>`, and `RacyCell<T>` are intentionally absent from this T1 table; they moved to the Tier-2 contract-defect backlog after the Codex final review.

**Open bead count: 34 cluster-beads covering 40 T1/T1-equivalent entries.** (Some clusters bundle multiple sites for a single PR.)

---

## Pre-existing Tier 2 / Tier 3 backlog (informational)

These are not in the T1 risk-table because Codex demoted them, but they are tracked for follow-up:

| ID | From | Reason demoted |
|----|------|----------------|
| H3 (WebSocket deflate) | Pass 3 T1 | Not unbounded 4 GiB; bounded amplification only; T2 hardening |
| UvHandle::close transmute | Pass 3 T1 | Not variadic on supported targets; T3 portability comment |
| 4× `pass3-ub-*` JSC items | Pass 3 T1 | Architecture defects, no demonstrated production UB; T2 |
| ThreadSafeRefCount::ref_ revival | Pass 3 T1 | No bad caller shown; primitive itself is unsafe and requires live T; T2 hardening (add `try_ref`) |
| FetchTasklet::abort_task Relaxed | Pass 3 T1 | Relaxed is sufficient for a standalone cancel flag; no published payload shown; T2/T3 |
| pending_tasks ordering | Pass 3 T1 | Queue state is mutex-protected; counter is completion metric; T2/T3 |
| 5× install pipeline atomic ordering | Pass 3 T1 | Mirrors Zig pattern; queue state protected; T2/T3 cleanup |
| jsc-contract-2/3/4 (Send/Sync over Promise/Blob/VM) | Pass 3 cross-thread | T2 contract defects; current call sites disciplined |
| `bun_libarchive_sys` orphan (45 sites) | Pass 3 cleanup | Stale-crate hygiene, not a soundness bug |
| Watcher::shutdown ownership race (L-001) | Pass 2 T2 | High-confidence ownership race; T2 architecture defect |
| CODEX-P3 cross-thread task traits | Pass 3 cross-thread | T2 contract defect; refactor direction in CODEX-P3-* plans |
| CODEX-P3 writer static-mut aliasing | Pass 3 cross-thread | T2 safe-API defect; closure-API migration |
| CODEX-P3 scratch-buffer lifetime | Pass 3 cross-thread | T2 safe-API defect; caller-buffer migration |
| 11× strict-provenance migration | Pass 2 perf-only | Migration debt, not active UB; per-site mechanical |

**Tier 2 + Tier 3 total:** ~32 + ~58 = ~90 items. These accrue debt at a slower interest rate than T1 but should still be tracked.

---

## Immediate Fix Queue

### Batch 1 — Risk-125 Cluster

1. **PUB-INSTALL-1, -2** — replace `transmute<u8, Enum>` with `match`/`TryFrom`. ~20 LOC per fix. One PR; same review pattern.
2. **PUB-INSTALL-3** — replace `&mut [Dependency]` over reserved capacity with `Vec::push` loop or `MaybeUninit::write_slice`.
3. **PUB-INSTALL-4** — replace `get_unchecked(dep_id as usize)` with `.get(dep_id as usize).ok_or(...)`.
4. **F-NEW-1, F-NEW-2** — validate semver packed-string offset/length pairs loaded from `bun.lockb` before `slice()`/`eql()` can form unchecked ranges.
5. **H9** — replace `cast_mut()` through shared slice with owning-Vec or `&mut [u8]` parameter. Tighten picohttp shim's mutability contract.

Cumulative risk-points cleared if this batch lands today: 875 (35% of current dashboard debt).

### Batch 2 — Risk-80/64/30 Cluster

6. **StoreSlice<T> Send/Sync bounds** — 2 LOC.
7. **PUB-INSTALL-5, -6** — typed `Vec<T>` allocation or `read_unaligned` path.
8. **H5** — bump `[u8; 11]` to `[u8; 21]` and use `core::fmt::Write` with a length-checking adapter. Track as security P0, not Rust memory-UB.
9. **pre-existing-ub-10** — add membership check to `closeCallback`; consider registry validation.
10. **P3-BC-001** — `from_utf8_lossy` (or panic on invalid input).
11. **pre-existing-ub-ptr-2 / P3-BC-207** — promote `Unaligned::slice_align_cast` alignment check to runtime.
12. **TH-1** — add a non-Send marker to `GuardedLock` and a compile-fail witness matching `MutexGuard`.

Cumulative risk-points cleared if this batch lands today: 1,449 (58% of dashboard debt).

### Batch 3 — Risk-60 Cluster

13. **Bundler B-1..B-4** — uniform `*mut LinkerContext` refactor + `follow_all()` proof before parallel codegen.
14. **P3-BC-002..005** — uninit-tail and niche-T fixes in StringBuilder, BoundedArray, MutableString.
15. **pre-existing-ub-9** — invalidate `JSFFIFunction` wrappers on `FFI.close`.

Cumulative risk-points cleared if this batch lands today: 2,094 (84% of dashboard debt) — i.e., complete elimination of P0 tier and most P1 risk.

### Backlog (T1 P1 and P2)

16. **U2.×8 group** — uniform retain-original-owner pattern across 8 sites. One PR.
17. Remaining P1/P2 items at risk 16-48.

---

## How to read this

- **Risk-pts** = `BLAST × LIKELIHOOD × DISCOVERABILITY` per [`audit/synthesis/PASS4-risk-scoring.md`](audit/synthesis/PASS4-risk-scoring.md).
- **(A) STRICTLY_UNAVOIDABLE sites are obligations** — they stay; we harden their SAFETY comments and add clippy lints where the obligation is lintable.
- **(B) PERF_ONLY sites are gated** behind the `safe-only` Cargo feature once it exists; downstream users can opt in.
- **(C) REFACTORABLE sites are work-in-progress** — refactor into safe Rust with property-test equivalence.
- **Trend arrows** = ▶ stable (baseline), ▼ decreasing (good — debt cleared), ▲ increasing (drift, needs investigation).
- **Risk bands** map to bead priority: 60-125 = P0, 25-59 = P1, 10-24 = P2, 1-9 = P3.

---

## Anti-pattern flags for this dashboard

This dashboard intentionally avoids:

- **Inflating the count by mixing safe-API contract defects (T2) into T1.** The pre-Codex Pass-3 raw "63 T1" framing did this; the post-Codex + Pass 4 corrected 40-entry dashboard is the defensible number.
- **Counting `bun:ffi` raw-pointer capability contracts (FFI-CONTRACT-ADDR-LEN, FFI-CONTRACT-FINALIZER) as Bun bugs.** These are documented as out-of-contract by design.
- **Counting stale-crate hygiene (`bun_libarchive_sys` orphan) as a soundness finding.** Codex demoted this to repo hygiene; we follow.
- **Calling findings "CVE-class" without an exploit story.** Per Codex's editorial rules, avoid "CVE-class" unless untrusted-input reachability and concrete impact survive maintainer review. PUB-INSTALL-1..4, F-NEW-1/F-NEW-2, and H9 are the strongest security-triage candidates in this audit, but the report should let maintainers decide advisory handling.
- **Vanity metrics.** Site count alone is gameable. This dashboard tracks risk-points-per-site to make trivial-fix concentrations visible.

---

## Per-stakeholder views

| Audience | What to read |
|----------|--------------|
| Bun maintainers | This dashboard; full PASS4-risk-scoring.md; PASS3_FINDINGS_INDEX.md |
| Security team | This dashboard's Top-10 + open beads + Codex review |
| Customers / Bun users | The "At a glance" + risk distribution; the to-be-published SECURITY.md |
| Internal reviewers | Per-cluster status + Codex review correction log |
| External auditors | All of the above plus per-finding plans under `audit/plans/` |

A single source-of-truth file with multiple consumers.

---

## Same-Day Burn-Down Target

If today's fix run lands the three batches above, the dashboard drops:

| State | Risk-points | Delta |
|-------|------------:|------:|
| Baseline | 2,507 | — |
| After Batch 1 | 1,632 | -35% |
| After Batch 2 | 1,058 | -58% |
| After Batch 3 | 413 | -84% |

The remaining 413 risk-points are the P1/P2 tail. The report should not project them into a future calendar schedule; it should track whether today's source work closes them or leaves a justified remainder.

---

## Methodological notes for stakeholders

### Why "Tier 1" is not the same as "P0"

The audit uses two orthogonal scales:

- **Tier (T1/T2/T3)** classifies *what kind of bug* the finding is. T1 = patchable memory-safety bug; T2 = unsafe-contract / architecture defect (no current live UB path, but the safe API can express an invalid state); T3 = latent / threat-model-dependent watchlist.
- **Risk band (P0/P1/P2/P3)** classifies *how urgently to fix it*. Computed from BLAST × LIKELIHOOD × DISCOVERABILITY.

A T1 finding can sit at any risk band (the Linux SystemErrno bug is T1 at P2 because the bad call path is dead today). A T2 finding is never P0 by construction (no current live UB).

The dashboard's "open beads" table is grouped by tier first, then by risk band within tier. The "Top 10 highest-risk" table is grouped by risk band only.

### Why we don't count `bun:ffi` as soundness debt

`bun:ffi` is the runtime's privileged escape hatch. It accepts raw addresses, length pairs, and function pointers from JavaScript callers. The contract is documented (the caller is responsible for the validity of the pointers), but the implementation forms `&mut [u8]`, `&[u8]`, and callable function pointers from those addresses.

Treating this as Bun's soundness debt would inflate the count without telling the team anything actionable. A `bun:ffi` user who passes a garbage address has violated the contract; Bun cannot have prevented it without making `bun:ffi` slower, which would defeat its purpose.

The contracts are tracked separately as `FFI-CONTRACT-ADDR-LEN` and `FFI-CONTRACT-FINALIZER` in the Pass-2 findings index. The audit's recommended hardening is documentation + optional registry validation for safer modes, *not* removing the unsafe surface.

### Why Codex demotions matter for the dashboard total

The pre-Codex Pass-3 raw count was 39 T1 + 4 P0 = 43, on top of Pass-2's 18 and Pass-1's 2. That ~63 figure was the "marketing number" produced by the multi-agent deep dive, and it appeared in early drafts of this dashboard.

Codex's adversarial pass-3 review demoted 11 distinct entries with specific source evidence:

- H3 WebSocket deflate is not a 4 GiB unbounded allocation primitive (zlib fallback checks size after each growth chunk).
- UvHandle::close transmute is not variadic-ABI UB on supported Bun targets.
- 4× `pass3-ub-*` JSC items are architecture defects without proven production UB paths.
- ThreadSafeRefCount::ref_, FetchTasklet::abort_task, and pending_tasks ordering are either disciplined or no published payload was shown.
- 5 install-pipeline atomic-ordering items mirror Zig's monotonic pattern and queue state is mutex-protected.
- `bun_libarchive_sys` orphan is stale-crate hygiene, not a soundness bug.

Demoting these (plus the additional pass-3 final demotions of `WeakPtrData`, `JsCell<T>`, and `RacyCell<T>` to T2 contract-defect status) and then adding the Pass 4 semver/threading findings leaves the dashboard at 40 T1/T1-equivalent entries. The discipline matters because **a dashboard with 63 entries that includes over-tiered items is a less useful tool than a dashboard with 40 entries that have a defensible evidence bar**. The point of the audit is to be acted on; over-counting wastes engineer attention.

### Why no fuzz targets yet

The audit baseline does not include fuzz targets. The recommendation from the audit is:

- **`cargo fuzz` target for `bun.lockb` parsing** — would catch PUB-INSTALL-1, -2, -3, -4 if it had been in place before the port commit.
- **`cargo fuzz` target for HTTP/1.1 request parsing** — would catch H9 and H5.
- **`cargo fuzz` target for `bun pack` tarball ingestion** — would catch U1 and surrounding code.

These targets are recommended in the audit's PR landing order but not yet authored. They are the highest-leverage hardening investment after the T1 fixes land — once a fuzz target exists, the corresponding LIKELIHOOD score for finding new T1 issues in that subsystem drops, and the dashboard's "open beads / drift" rate becomes meaningful.

---

## Glossary

| Term | Definition |
|------|------------|
| BLAST_RADIUS | 1-5 score for "how bad is the worst case." For Bun: 5 = every `bun install`/`bun serve` user; 4 = JS-API-reachable; 3 = build-tool-only; 2 = CLI-only; 1 = internal. |
| LIKELIHOOD | 1-5 score for "how likely is this site currently unsound." For Bun (post-port-commit): 5 = adversarially confirmed; 4 = canonical translation gap with no/stale SAFETY; 3 = stale or missing SAFETY; 2 = Codex demoted; 1 = recently reviewed. |
| DISCOVERABILITY | 1-5 score for "how easy to trigger." 5 = popular pub API on untrusted input, no fuzz; 4 = pub API, &[u8]/&str; 3 = pub API, constrained type; 2 = feature/platform-gated; 1 = internal helper, constrained input. |
| RISK_SCORE | BLAST × LIKELIHOOD × DISCOVERABILITY. Range 1-125. |
| Tier 1 (T1) | Confirmed or high-confidence patchable memory-safety bug. |
| Tier 2 (T2) | Unsafe-contract / architecture defect; safe Rust can express an invalid state. No current live UB call path proven. |
| Tier 3 (T3) | Latent or threat-model-dependent watchlist. |
| P0 / security-triage candidate | In the risk dashboard, P0 means risk score 60-125. Use "CVE-class" only if maintainers agree the untrusted-input-triggered UB or concrete security impact warrants advisory treatment. The strongest security-triage examples are PUB-INSTALL-1..4, F-NEW-1/F-NEW-2, and H9. H5 is a security P0 but not Rust memory-UB. |
| (A) STRICTLY_UNAVOIDABLE | Unsafe site whose obligation is genuinely load-bearing (FFI, JSC handle thread affinity, Stacked Borrows discipline, etc.). |
| (B) PERF_ONLY | Unsafe site that exists for performance; can be gated behind a `safe-only` feature for downstream opt-in. |
| (C) REFACTORABLE | Unsafe site that has a mechanical safe replacement (e.g., `NonNull::new_unchecked(&r)` → `NonNull::from(&r)`). |
