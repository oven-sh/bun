# Phase 3 DYNAMIC SWEEP — Findings

## Scope split

Phase 3 is split into three paths based on local-build constraints:
- **Path (a) Standalone reproducers** — completed locally. Cargo standalone projects under `experiments/<EXP-ID>/` with `[workspace]` stub. No dependency on `bun bd` / clang-21 / lld-21.
- **Path (b) Per-leaf-crate Miri** — deferred to Phase 5/11. Some leaf crates (bun_collections, bun_semver, bun_safety) can be tested under Miri without the full `bun bd` chain; others depend on bun_core's generated `build_options.rs` which needs `bun bd --configure-only` (blocked locally on clang-21/lld-21).
- **Path (c) Full-workspace Miri matrix + sanitizers + loom + fuzz** — deferred to Phase 11 SOAK. Requires either local clang-21+lld-21 install (~500MB apt download) OR rch worker delivery (worker-a/worker-b are tagged `bun,go,rust` and presumably have the toolchain).

## Path (a) Standalone reproducer verdicts

| EXP-ID | Status | Miri config | Signal observed |
|--------|--------|-------------|-----------------|
| EXP-001 | CONFIRMED_UB | strict-provenance | `reading memory at alloc119[0x0..0x4], but memory is uninitialized` (verbatim match to prior witness) |
| EXP-002 | CONFIRMED_UB | strict-provenance | `constructing invalid value of type SystemErrno: at .<enum-tag>, encountered 0x0086, but expected a valid enum tag` |
| EXP-003 | CONFIRMED_UB | strict-provenance | `enum value has invalid tag: 0x2a` |
| EXP-004 | CONFIRMED_UB | symbolic-alignment-check | allocator-layout mismatch on `Vec::<u16>::drop` |
| EXP-005 | CONFIRMED_UB | strict-provenance + ignore-leaks | `Uninitialized memory occurred at alloc211[0x0..0x4]` |
| **EXP-006** | **CONFIRMED_UB** (new) | strict-provenance | invalid enum tag 0xa5 (same shape as EXP-003 with `Origin` enum) |
| **EXP-007** | **CONFIRMED_UB** (new) | default Miri | unchecked attacker-controlled dependency index reaches `get_unchecked`; Miri reports ``assume` called with `false`` |
| **EXP-008** | **CONFIRMED_UB** (new) | strict-provenance --release | OOB via `core::slice::index::get_offset_len_noubcheck` — debug-assertion stripped in release, get_unchecked fires |
| **EXP-009** | **CONFIRMED_UB** (new) | strict-provenance --release | same OOB shape as EXP-008 in `eql` path |
| **EXP-020** | **DEFERRED** | strict-provenance | `unsupported operation: integer-to-pointer casts and ptr::with_exposed_provenance are not supported with -Zmiri-strict-provenance`; concrete strict-provenance gate failure, not counted as default-Miri/runtime UB. Later registry cleanup reclassified strict-provenance-only findings as release-gate migrations, not unresolved proof gaps. |
| **EXP-028** (formerly on-disk `EXP-022`) | **NO_EVIDENCE** | tree-borrows + source audit | Miri clean on the raw-pointer-throughout repro. Later source audit found the TODO-marked `DirectoryWatchStore` is a Phase-A draft module; the canonical `dev_server::DirectoryWatchStore` already returns `*mut DevServer` and no draft-type call sites were found. |
| **EXP-045** | **CONFIRMED_UB** (new, Codex 2026-05-16) | default Miri | faithful `JsCell<T>` model (`UnsafeCell<T>` + safe `get() -> &T`) permits `static JsCell<Cell<u32>>` cross-thread; Miri reports a `Cell` data race |
| **EXP-058** | **CONFIRMED_UB** (new, Codex 2026-05-16) | tree-borrows | faithful `source_writer_escape` model calls `writer()` twice; second `&'static mut` tag is disabled by the first write |
| **EXP-073** | **CONFIRMED_UB** (new, Codex 2026-05-16) | default Miri + tree-borrows | faithful `CopyFileWindows.event_loop: &EventLoop` model casts shared reference to `*mut EventLoop` and mutates `entered_event_loop_count`; default Miri reports SharedReadOnly → SharedReadWrite retag failure |
| **EXP-074** | **CONFIRMED_UB** (new, Codex 2026-05-16) | default Miri + tree-borrows | faithful `TimerObjectInternals::parent_ptr(&self)` model recovers parent via `from_ref(self).cast_mut()` and writes plain `EventLoopTimer.state`; default Miri reports SharedReadOnly-derived write; Tree Borrows reports Frozen-tag write |
| **EXP-075** | **CONFIRMED_UB** (new, Codex 2026-05-16) | default Miri + tree-borrows | faithful `DevServer` model stores `std::ptr::from_ref(self)` in a deferred request and later mutates `deferred_request_pool` through `.cast_mut()`; default Miri reports SharedReadOnly-derived write; Tree Borrows reports Frozen-tag write |
| **EXP-076** | **CONFIRMED_UB** (new, Codex 2026-05-16) | default Miri + tree-borrows | faithful `WindowsNamedPipeContext` model stores `&'static VirtualMachine`, recovers `*mut VirtualMachine` with `ptr::from_ref(...).cast_mut()`, and calls `enqueue_task(&mut self)`; default Miri rejects the receiver retag and Tree Borrows rejects the nested event-loop write |
| **EXP-077** | **CONFIRMED_UB** (new, Codex 2026-05-16) | default Miri | faithful CSS result-type model transmutes arena-backed `CssModuleExports` / `CssModuleReferences` to `'static`; Miri reports a dangling reference / use-after-free when the safe API result is constructed/read after the backing arena is dropped |
| **EXP-078** | **CONFIRMED_UB** (new, Codex 2026-05-16) | default Miri | faithful `ArrayLike::set_len_and_slice` model exposes a safe `&mut [bool]` over `Vec` capacity immediately after `set_len`; forced read reports uninitialized memory |
| **EXP-079** | **CONFIRMED_UB** (new, Codex 2026-05-16) | tree-borrows | faithful `Transpiler::env_mut(&self) -> &'a mut Loader<'a>` model calls the safe method twice on `Transpiler<'static>`; Tree-Borrows reports a write through a disabled tag |

**Path (a) net:** **18 EXP entries are CONFIRMED_UB with reproducible Miri traces** in this standalone set: the 5 prior-audit-anchored witnesses plus EXP-006/007/008/009/045/058/073/074/075/076/077/078/079. EXP-020 is a concrete strict-provenance gate failure, now tracked separately as `DEFERRED` release-gate work; EXP-028 is now `NO_EVIDENCE` after canonical-vs-draft source audit.

## Path (b) Per-leaf-crate Miri — deferred

Candidate leaf crates for Phase 5 (no/low FFI dependency):
- `bun_collections` — would exercise EXP-001 and EXP-014 in-tree
- `bun_semver` — would exercise EXP-008 and EXP-009 in-tree
- `bun_safety` — sanity-check (Phase 1 reports zero unsafe outside ASan gates)
- `bun_wyhash` / `bun_base64` / `bun_hash` — SIMD-leaf crates per Section N

Blocker: even leaf crates pull in `bun_core` transitively for trait derives / macros, and `bun_core::build.rs` needs `bun bd --configure-only` to materialize `build_options.rs`. Workarounds:
1. Install clang-21+lld-21 locally and run `bun bd --configure-only`.
2. Mock `build_options.rs` for the Miri test target only (Phase-3 Miri shim per skill MIRI-SHIMS.md).
3. Offload to rch worker-b (healthy worker) with the `bun` tag.

## Path (c) Full-workspace dynamic matrix — deferred to Phase 11

Per skill PHASES.md §Phase 3:
- 4 Miri configs (default SB / tree-borrows / strict-provenance / symbolic-alignment-check + check-number-validity) × the full Bun test suite — multi-day campaign offloaded via `rch exec --tag ub-exorcism-2026-05-15-exhaustive-miri-<config>`
- 4 sanitizers (ASan / TSan / MSan / LSan) × the Bun test suite — separate builds, ASan + TSan can coexist in parallel
- Loom models for the 4 concurrency hubs flagged in Phase 1+2: bundler parallel-callback (EXP-010 — needs hand-scheduled), WebWorker Cell-cross-thread (F-DR-5/11 from Bucket 7), Channel<T,B>/UnboundedQueue/ThreadPool::Queue (Section P watchlist + F-DR-1/2/3 from Bucket 7), WatcherAtomics (Section G + F-DR-4 from Bucket 7).
- Fuzz: cargo-fuzz on the prior audit's `fuzz-lockfile` + `fuzz-inverse` campaigns (already authored under `.unsafe-audit/fuzz-*/`) + new targets for Bucket-4 lockfile sparse-enum cluster (`ResolutionTag`, `DependencyVersionTag`).

## Dependency on Phase 11

The Path-(c) work is the same set of campaigns that Phase 11 SOAK is supposed to run in Exhaustive mode. Recommending they be merged: launch the dynamic matrix as Phase-11 soak campaigns rather than running Phase 3 separately. Synthesizer should treat current Phase 3 as "standalone reproducers complete; matrix-pass deferred to Phase 11 soak" rather than blocking the convergence loop on Phase 3 completion.

## Raw logs

- `phase5_experiment_results/EXP-001_preflight.log` .. `EXP-005_preflight.log` (initial path-a preflight)
- `phase5_experiment_results/EXP-006_run.log`, `EXP-007.log`, `EXP-008_run.log`, `EXP-009_run.log`, `EXP-020_run.log` (new path-a runs)
- `phase5_experiment_results/EXP-008_release.log`, `EXP-009_release.log` (release-mode runs)
- `phase5_experiment_results/EXP-022_run.log` (legacy on-disk DirectoryWatchStore trace; canonical registry entry is EXP-028, now `NO_EVIDENCE` after canonical-vs-draft source audit)
- `phase5_experiment_results/EXP-045.log`, `EXP-058.log` (Codex 2026-05-16 standalone confirmations)
- `phase5_experiment_results/EXP-073-default-miri.log`, `EXP-073-tree-borrows.log` (Codex 2026-05-16 `CopyFileWindows.event_loop` confirmation)
- `phase5_experiment_results/EXP-074-default-miri.log`, `EXP-074-tree-borrows.log` (Codex 2026-05-16 `TimerObjectInternals::parent_ptr` / `EventLoopTimer.state` confirmation)
- `phase5_experiment_results/EXP-075-default-miri.log`, `EXP-075-tree-borrows.log` (Codex 2026-05-16 `DevServer` deferred-request backref confirmation)
- `phase5_experiment_results/EXP-076-default-miri.log`, `EXP-076-tree-borrows.log` (Codex 2026-05-16 `WindowsNamedPipeContext` VM backref confirmation)
- `phase5_experiment_results/EXP-076-fix-event-loop-ptr-default-miri.log`, `EXP-076-fix-event-loop-ptr-tree-borrows.log` (Codex 2026-05-16 remediation-shape sanity check; Miri-clean)
- `phase5_experiment_results/EXP-077-default-miri.log` (Codex 2026-05-16 CSS module lifetime-erasure safe-API confirmation)
- `phase5_experiment_results/EXP-078-default-miri.log` (Codex 2026-05-16 `ArrayLike::set_len_and_slice` safe-API uninit confirmation)
- `phase5_experiment_results/EXP-079.log` (Codex 2026-05-16 `Transpiler::env_mut` safe-API two-call Tree-Borrows confirmation)
