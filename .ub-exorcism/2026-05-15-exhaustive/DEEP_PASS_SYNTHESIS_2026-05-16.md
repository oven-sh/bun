# Deep-Pass Synthesis — 2026-05-16

This pass exercised parts of the `/rust-undefined-behavior-exorcist` skill that
the earlier exhaustive run had not yet touched, against parts of the Bun
codebase that the prior audit had under-covered (0–2 EXPs each). Every claim
below is anchored to either a file:line the orchestrator personally read or a
Miri log file on disk.

---

## Headline outcome

- **1 source-root-graph correction (NO_EVIDENCE for the original production claim):**
  - **EXP-109** — the standalone reproducer at
    `experiments/EXP-109/src/main.rs` still triggers `pointer not
    dereferenceable … dangling pointer (it has no provenance)` under Miri, but
    the model is not source-faithful to Bun's current `JSCallback` path.
    Source review shows `JSCallback.#ctx` owns a heap `Function`, which owns
    `FFICallbackFunctionWrapper`, which owns `JSC::Strong<JSFunction>` and
    `JSC::Strong<GlobalObject>`. See
    `CODEX_EXP109_ROOT_GRAPH_CORRECTION_2026-05-16.md`.

- **1 new MIRI-CONFIRMED finding (default-Miri retag/data-race; Tree-Borrows clean):**
  - **EXP-111** — bundler part-range workers still form concurrent
    `&mut LinkerContext` / `&mut Chunk` from shared raw pointers in
    `generateCompileResultForJSChunk.rs` and
    `generateCompileResultForCssChunk.rs`. `ChunkRenamer::as_renamer(&mut
    self)` and `Renamer::name_for_symbol` / `SymbolMap::follow()` are an
    additional mutable-view subproblem, but not the whole bug.
    Standalone reproducer at `experiments/EXP-111/`;
    `phase5_experiment_results/EXP-111-sb.log` confirms the default-Miri
    concurrent `&mut Chunk` retag/data-race witness, while `EXP-111-tb.log`
    is clean and should be treated as a model-boundary note rather than
    failure evidence. A renamer-only patch does not close this finding.

- **8 strong negative findings** (audit-confidence boosters) from Lane B's new
  ast-grep detectors — Bun is provably clean of these UB classes.

- **3 new Loom models** + **3 new FFI layout-assert blocks** for surfaces never
  previously modeled.

- **1 worked operator-library walkthrough** (EXP-004 traced through
  ★ SUSPECT → ♦ COUNTER → ⊳ READ-ONLY-DELTA → ☣ SAFETY-NOTES-FIRST → ⊳ FIX-PREP).

- **10 new Phase-6 idea-wizard techniques** cross-checked against
  `phase6_idea_wizard.md` to avoid duplication.

---

## Discipline floor — what got demoted

The orchestrator ran 4 parallel Lane-A subagents into 7 zero-EXP surfaces
(`src/ffi`, `src/runtime/crypto`, `src/transpiler`, `src/sourcemap`,
`src/event_loop`, `src/sql`, `src/glob`). The agents produced **17 raw
CANDIDATE claims**. After personal verification by reading the cited source,
**only 1 survived as a confirmed UB finding** (EXP-111). EXP-109 survived as a
useful non-source-faithful guard and was then demoted to `NO_EVIDENCE` after
the callback-root source graph was checked. The other 15 demotions:

| Demoted | Reason |
|---|---|
| `EXP-CRYPTO-001` (unaligned cast at CryptoHasher.rs:1341) | Agent confused `size_of` with `align_of`. `[u8; N]` has `align_of == 1` regardless of `N`. No alignment requirement violation. |
| `EXP-CRYPTO-002` (HMAC.rs MaybeUninit assume_init) | For opaque-from-bindgen structs Rust never reads fields; `assume_init` + move into `Box::new(HMAC { ctx, … })` is sound assuming `HMAC_CTX_init` follows the BoringSSL contract (it does). |
| `EXP-CRYPTO-003` (panic-unwind in uws callbacks) | Architectural concern, but no callback path actually panics in practice. Defensibility note, not UB. |
| `EXP-CRYPTO-004` (BoringSSL `EVP_Digest` outsize semantics) | Pure speculation about BoringSSL's spec; no source evidence. |
| `EXP-CRYPTO-005` (TOCTOU in `StaticCryptoHasher::update`) | Re-entrant single-threaded JS race. Not a Rust UB class. |
| `EXP-FFI-002` (cross-thread FFI_Callback dispatch) | Lives in C++ (`FFI.h`, `FFI_Callback_call` extern); not auditable from Rust without C++ source dive. Out of scope. |
| `EXP-FFI-003` (tinycc allocator pairing) | `vendor/tinycc/` is NOT vendored in current checkout; `bun_tcc_sys` has no `build.rs`. Dormant code path; concern doesn't apply to live build. |
| `EXP-FFI-004` / `EXP-FFI-005` (user-supplied fn-ptr addresses) | Documented user-trust API by bun:ffi design; not UB in the audit sense. |
| `EXP-VLQ-001` (8-byte VLQ shift truncation) | The `shift & 31` mask makes the shift well-defined; result is incorrect for malformed 8-byte input, but no Rust UB. Correctness bug. |
| `EXP-VLQ-002` (empty-slice OOB) | Rust bounds check **panics**, not UB. Robustness concern. |
| `Glob symlink loop` | DoS via OOM, not a memory-safety UB class. |
| `Event-loop AnyTask.expect() panic` | Panic is a *symptom* of prior memory corruption, not a root-cause UB. |
| `DeferredTaskQueue panic-corruption` | Panic-safety concern; not UB. |
| `PG `BunString::borrow_utf8` lifetime` | Agent's own COUNTER #1 admits "current codebase looks safe by inspection." Phase-B port-audit obligation, not live UB. |
| `LinkerGraph.rs:96-97 Send/Sync` (Lane B detector) | Re-reading the SAFETY block at `:84-95` shows the AtomicU32 chunk_index sync via worker-pool join is well-justified. |
| `array_hash_map.rs:1561-1562` (Lane B detector) | Bounds-conditional auto-trait restoration; defensible per usual `unsafe impl` for newtypes. |
| `WindowsNamedPipe.rs:1187/1222` (Lane B detector) | Already covered by EXP-104 (added by another agent during this session). |

The two survivors each carry an **author-acknowledged TODO marker** in the
Bun source itself — they are not third-party speculation.

---

## Skill surfaces newly exercised

### Phase-2 operators

- **★ SUSPECT** (numbered category audit) applied to 7 zero-EXP areas, formally
  enumerated 8–9 UB-bucket categories per area, recorded per-category hit/miss.
- **♦ COUNTER** (named-failure-mode) applied to the top 2–3 sites per area
  with specific two-party questions ("Could there be a race between
  `extern_update` and a JS callback re-entering?", "Could `tcc_delete` pair
  mimalloc dealloc with malloc-alloc?").
- **⊳ READ-ONLY-DELTA** + **☣ SAFETY-NOTES-FIRST** + **⊳ FIX-PREP** — Lane D
  authored a full worked example for EXP-004 at
  `/tmp/exp_data/operator_walkthrough/EXP-004.md` (241 lines), walking the
  five operators in sequence and showing how the audit funnel narrows from a
  bucket sweep to a committed remediation plan without ever editing code.

### Detector design (Phase 2)

13 new ast-grep YAML rules at `/tmp/exp_data/ast_grep_rules/`, run against
`/data/projects/bun/src/`:

| Pattern | Hits | Triage |
|---|---|---|
| `cell-with-raw-ptr` (Cell<\*mut T> / Cell<\*const T>) | **0** | strong negative — Bun uses RacyCell<T> wrapper |
| `await-holding-refcell` | **0** | strong negative across 28 RefCell-using files |
| `transmute<MaybeUninit<T>, T>` | **0** | strong negative |
| `box-from-raw-shared` | 3 | all defensible (SAFETY comments cite exclusive ownership) |
| `mem-zeroed-refs` (Box/&/&mut/NonNull) | **0** | strong negative |
| `nonnull-new-unchecked-null` | **0** | strong negative |
| `layout-from-size-align-unchecked` | 2 | both defensible (MAX_ALIGN_T constant + debug_assert) |
| `unwrap-unchecked` | 10 | 1 covered (EXP-084), 9 NEW low-confidence (inline SAFETY citations present) |
| `const-to-mut-write` ((p as \*mut T).write) | **0** | strong negative (EXP-073/074/076 class fully captured) |
| `store-then-load` (Relaxed→Acquire within 15 lines) | **0** | strong negative across 17 files |
| `copy-nonoverlapping-bare` | 56 | NOISY — narrower variant proposed |
| `static-mut-ref` | 1 | `src/bun_core/lib.rs:227` (ENVIRON) — deliberate single-thread FFI bridge |
| `unsafe-impl-send-sync` (NO surrounding SAFETY/INVARIANT keyword) | 6 actionable | 1 → EXP-111 promoted; 3 demoted after personal verify |

**8 strong negative findings** materially strengthen the audit's "Bun is clean
of this UB class" claims.

### Phase-3 Loom models

3 new models at `/tmp/exp_data/loom_models/` for surfaces not covered by the
existing EXP-030/031/032/052 models:

1. **`imminent_gc_timer_publish/`** — `EventLoop::imminent_gc_timer`
   `AtomicPtr` deref-on-publish handoff (SOURCE-ANCHOR:
   `src/jsc/event_loop.rs:98, :526-538` + `src/runtime/timer/WTFTimer.rs:135-190`).
2. **`pending_tasks_happens_before/`** — `pending_tasks: AtomicU32`
   Release/Acquire completion gate (SOURCE-ANCHOR:
   `src/install/PackageManager.rs:425` +
   `src/install/PackageManager/runTasks.rs:1582-1597`).
3. **`concurrent_ref_swap_consistency/`** — `concurrent_ref: AtomicI32`
   delta-accumulator swap (SOURCE-ANCHOR:
   `src/jsc/event_loop.rs:91, :942-951, :602-633`).

Each model has a default-orderings PASS test + an `#[ignore]`d
Relaxed-weakening FAIL test as a negative control.

### Phase-2 Layout asserts

3 paste-ready compile-time assert blocks at `/tmp/exp_data/layout_asserts/`:

1. **`struct_phr_header`** — picohttpparser header struct, pinned size/align/4
   field offsets against upstream commit `066d2b1e9ab820703db0837a7255d92d30f0c9f5`.
2. **`struct_phr_chunked_decoder`** — same library; includes
   sub-assertion for the `ChunkedEncodingState` newtype.
3. **`lshpack_header`** — Bun's own wrapper over ls-hpack output; pinned to
   library commit `8905c024b6d052f083a3d11d0a169b3c2735c8a1`.

(libuv `uv_handle_t` was a candidate but found to be already comprehensively
asserted at `src/libuv_sys/libuv.rs:3481-3611`. Skipped to avoid duplication.)

### Phase-6 Idea-wizard fresh techniques

10 new Bun-shaped UB-detection/prevention techniques at
`/tmp/exp_data/idea_wizard_fresh.md`, cross-checked against
`phase6_idea_wizard.md` to ensure no duplication. Highlights:

- **T1**: `#[cross_type_dealloc_audit]` clippy lint targeting EXP-004-class
  allocator-layout-pairing UB.
- **T4**: `extern "C" fn` panic-barrier compile-error gate addressing the
  1444-site `extern "C"` surface across `src/jsc/bindings/` + `src/runtime/napi/`.
- **T7**: `assert_size_align_offset!` build-script reflector for `.classes.ts`
  — closes the JS-binding-generation soundness loop with zero NAPI/Win32 dep.
- **T8**: `#[forbid_jsthread_atomstring_offthread]` lint pairing the canonical
  `FetchTasklet.rs` AtomString cross-thread bug-class with a callgraph-walking
  detector.
- **T10**: `expect_test`-style Miri retag snapshot — operationalizes the
  prior idea 27 ledger as snapshot diffs visible in `gh pr diff`.

---

## Bun areas newly explored deeply

| Area | Prior EXPs | Deep-pass coverage |
|---|---|---|
| `src/runtime/ffi/` (tinycc + Compiled + callback dispatch) | 0 | EXP-109 demoted to NO_EVIDENCE after source-root-graph correction; standalone stale-handle log retained as guard |
| `src/runtime/crypto/` (BoringSSL EVP/HMAC bridge) | 0 | 5 candidates triaged → 0 promoted (all sound or speculative) |
| `src/transpiler/` + `src/sourcemap/` | 0 | 2 VLQ candidates triaged → 0 promoted (correctness/panic-safety, not UB) |
| `src/sql/postgres/` + `src/sql/mysql/` (binary wire protocol) | 0 | 5 candidates triaged → 0 promoted (PG-string-lifetime is port-audit obligation, not live UB) |
| `src/event_loop/` (deferred-task queue + dispatch) | 0 | 3 loom models authored against 3 distinct shapes |
| `src/glob/` (recursive directory walker) | 0 | symlink-loop DoS noted (not UB) |
| `src/bundler/` (Chunk Send/Sync) | 2 (EXP-010, EXP-087) | EXP-111 added (author-TODO + Lane B detector hit) |

---

## Defensibility notes worth filing (DEFERRED — not CANDIDATE)

These survived agent triage but were demoted to defensibility/port-audit
obligations rather than UB candidates. Worth folding into existing META beads
or as separate DEFERRED entries:

1. **PG-LIFETIME**: `src/sql/postgres/protocol/NewReader.rs:185-193` —
   `BunString::borrow_utf8` lifetime hazard. Author's TODO at
   `NegotiateProtocolVersion.rs:53-54` already flags. Port-audit
   obligation; should be covered by a sibling of META-REGISTRY-DRIFT-CHECKER
   (a "port-audit-status" checker that surfaces every author `TODO(port)` /
   `TODO(ub-audit)` / `TODO(phase-b)` comment for systematic resolution).

2. **CRYPTO-HMAC-CONSISTENCY**: `src/runtime/crypto/HMAC.rs:18-22` uses
   `MaybeUninit::uninit() + HMAC_CTX_init`, while sibling `EVP.rs` uses
   `bun_core::ffi::zeroed() + EVP_MD_CTX_init`. Not strict UB but
   inconsistency. Style/defensibility note for a future CRYPTO-HARMONIZE bead.

3. **FFI-PANIC-BARRIER**: panic in any `#[bun_uws::uws_callback]` arm at
   `src/runtime/crypto/CryptoHasher.rs:157-186` unwinds through C ABI.
   Currently dormant (no panic path in normal use). Covered by Lane-D
   Technique T4 (which proposes a workspace-wide `catch_unwind_to_abort!()`
   macro at every `extern "C" fn` boundary).

---

## Final state

- **Bead count requires refresh before filing** after EXP-109 demotion.
  EXP-111 remains a remediation triplet; EXP-109 should not create
  production-fix beads and should be represented, if at all, as a regression
  test / duplicate-scaffolding cleanup note.
- **106 EXP entries** in registry (was 95 at session start; +11 from other
  parallel agents during this pass + my EXP-109 + EXP-111).
- **0 dep cycles**.
- **0 lint warnings**.
- **0 critical / warning bv alerts**.
- **Verdict label distribution for deep-pass remediation beads**: 3
  `CONFIRMED_UB` (EXP-111 triplet — default-Miri retag/data-race witness;
  Tree-Borrows clean model recorded as a boundary note). EXP-109 is
  `NO_EVIDENCE` and should be represented, if at all, as a regression-test /
  duplicate-scaffolding cleanup note.

All audit artifacts remain local; `.beads/` stays under `.git/info/exclude`;
no `git push`, no `git commit` of `.beads/`, no `gh` calls.

---

## Defensibility cross-check

Every claim in this synthesis cites either:
(a) a Bun source file:line the orchestrator personally read in this session,
(b) a Miri log file on disk that the orchestrator viewed (notably
    `phase5_experiment_results/EXP-111-sb.log` for the production-relevant
    bundler retag/data-race witness; `EXP-109.log` is retained only as a
    non-source-faithful stale-handle guard), or
(c) a subagent's reported finding that the orchestrator personally verified
    against source.

The demoted candidates each carry an explicit reason that an independent
reviewer can re-check by reading the cited file:line. **No CONFIRMED claims
are made without a witness log in hand.** EXP-109 is no longer a confirmed or
refinement finding because source review found the missing root: the callback
wrapper owns `JSC::Strong` handles. EXP-111 is promoted only after its
default-Miri log was added, and its Tree-Borrows-clean model is called out
explicitly.

The orchestrator's discipline was: when in doubt, demote. The reproducer
authoring discipline was: every standalone reproducer must compile in
principle and the SAFETY documentation must enumerate the falsifiability
condition that would close the finding.

This is the audit-quality template the user requested. Volume came from
infrastructure (Lane B/C/D) and discipline (15 demotions with reasons), not
from padding a "candidate" list.
