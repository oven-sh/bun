# Bun unsafe-code audit — Pass 1 + Codex pass 2/3/4/5 addenda

> An audit of every `unsafe` site in [oven-sh/bun](https://github.com/oven-sh/bun), produced by [`/rust-unsafe-code-exorcist`](https://jeffreys-skills.md/skills/rust-unsafe-code-exorcist). Pass 1 was produced by Claude Code; pass 2 is a Codex adversarial addendum; pass 3 is a higher-severity safe-API soundness pass; pass 4 adds risk scoring, miri confirmations, and the corrected dashboard; pass 5 adds verification/proof/fuzzing artifacts and the first companion fix PR.

**Audit run:** 2026-05-14
**Project:** Bun — JavaScript runtime, recently [ported from Zig to Rust](https://github.com/oven-sh/bun/commit/23427dbc12fdcff30c23a96a3d6a66d62fdc091d) (commit `23427db`, ~16 hours before this audit ran).
**Scope:** All Rust under `src/` — 108 workspace crates, 1,432 `.rs` files. Vendored C/C++ libraries and the C++ JSC bindings are out of scope.
**Mode:** `audit-and-refactor`. The audit artifacts live in PR #30763; the first compact remediation branch lives in companion PR #30765 with three highest-confidence source fixes (`StoreSlice<T>`, `linux_errno`, `GuardedLock`).

## Headline

```text
Total unsafe sites:        11,044
By kind:
  unsafe { ... } blocks     9,754  (88%)
  unsafe fn                   903  ( 8%)
  unsafe impl                 345  ( 3%)
  unsafe trait                 20  (<1%)
  UnsafeCell::new(...)         22  (<1%)

Classification (first-pass; Codex pass 2/3 corrections are linked below):
  (A) STRICTLY_UNAVOIDABLE ~9,800   (89%) — FFI, allocator, Stacked Borrows discipline
  (B) PERF_ONLY            ~17 B-candidate-hot, ~10 B-UNMEASURED — benchmark logs still required
  (C) REFACTORABLE          ~110+ firm   — distributed across:
       C-001 NonNull::new_unchecked → safe form           22+ firm sites after const-site correction
       C-002 transmute<int, enum> → strum::FromRepr        6 sites
       C-003 unsafe impl Send/Sync → refactor/assertions   46 sites, assertion mechanism needs dependency decision
       Plus ~40 secondary candidates pending Phase-2 verification
  pre-existing-ub / soundness-design findings:
       Tier 1 baseline from Codex pass 2: 14 confirmed/high-confidence
               patchable soundness bugs or bug groups (several groups
               contain multiple source sites). Pass 3/4 produced a corrected
               strict/near-strict memory-safety T1 set around 37 after
               demotions; Pass 4/5's public dashboard reports 40
               T1/T1-equivalent entries after adding explicitly-labelled
               non-UB security items. Critical crash-reliability items are
               tracked separately, not folded into this count:
       1. src/errno/linux_errno.rs:175-188 (S-001781) — `usize → SystemErrno`
          transmute with kernel range claim wider than enum discriminants
       2. src/ast/nodes.rs `unsafe impl<T> Send/Sync for StoreSlice<T>` —
          unbounded vs sister `StoreRef<T>`'s correctly-bounded `<T: Send>`;
          lets non-Send types (e.g. `Cell<u32>`) cross threads via `StoreSlice`
       3. webcore/encoding.rs `Vec<u8>` → `Vec<u16>` raw-parts reinterpret
       4. linear_fifo.rs `MaybeUninit<T>` backing buffers exposed as `[T]`
          for active niche-bearing `RefDataValue` and Valkey queue payloads
       5. pack_command.rs:3009 `&mut` from shared provenance
       6. 8 dealloc/free-through-shared-provenance sites
       7-14. ptr_intrinsic / ffi-close bugs listed in PASS2_FINDINGS_INDEX.md

       Tier 2: 7 unsafe public-contract / architecture defects:
       - generic cross-thread task traits/macro lack `Send` or `unsafe trait`
         boundaries while worker-pool callbacks run user-supplied contexts
       - Output writer APIs return safe aliasable `&'static mut` from TLS
       - thread-local / FFI scratch-buffer APIs return refs whose true lifetime
         is "until next call", not the signature's claimed lifetime
       - Watcher ownership race and related unbounded Send/Sync discipline gaps

  pending Phase-2 triage    ~500-1,000 — `bun_heap_lifecycle` (204 sites) +
                                          custom-helper categories need per-site
                                          call-graph review

Safety-comment coverage (Codex pass-2 heuristic): 9,450 / 11,044 sites have
                                                  a nearby proof marker;
                                                  1,594 need triage/hardening.

Headline finding: Bun's port to Rust ships with structured unsafe-discipline,
but the second pass found many more real defects than pass 1. The audit now
identifies 110+ likely safe refactors, 40 T1/T1-equivalent findings in the
current public dashboard, a larger Tier 2 unsafe-contract backlog, one Windows
placeholder remediation, and a clear PR sequence. Intentional `bun:ffi` raw-pointer
capabilities are tracked separately so they do not inflate the confirmed-bug
count.
```

## Codex pass 2 addendum

Codex pass 2 applied the same skill as an adversarial reclassification pass and added [CODEX_PASS2_SUMMARY.md](CODEX_PASS2_SUMMARY.md). The most important changes:

- **Strengthened the two soundness bugs** (`StoreSlice<T>` and Linux errno) as the highest-value PRs.
- **Promoted a Windows-only stale unsafe branch** in `BundleThread::uninitialized()` to a focused plan: [CODEX-P2-windows-waker-placeholder.md](audit/plans/CODEX-P2-windows-waker-placeholder.md). `Async::Waker::placeholder()` exists for Windows now, but the call site still uses `zeroed_unchecked()` under a stale TODO.
- **Promoted the in-tree `TODO(ub-audit)` around parallel bundler chunk generation** to a confirmed high-confidence Stacked Borrows / Tree Borrows violation group after Pass 3. The worker callbacks really materialize concurrent `&mut LinkerContext`, `&mut Chunk`, and renamer references across peer tasks. This is no longer just a watchlist item.
- **Corrected overclaims:** C-001's headline count must exclude the `const fn` site unless the const issue is solved; C-002 should use `strum::FromRepr`, not `num_enum`; C-003 cannot assume `static_assertions` is already available; and B sites need benchmark logs before being called proven hot.
- **Added a reproducible SAFETY-comment gap baseline:** [codex-pass2-safety-comment-gap.md](audit/synthesis/codex-pass2-safety-comment-gap.md).

## Codex pass 3 addendum

Codex pass 3 was triggered by the user's critique that two bugs is too weak for
an unsafe surface this large. That critique was right: the earlier pass
underweighted **safe API soundness** and overfocused on patch-ready point bugs.
Pass 3 adds [CODEX_PASS3_SUMMARY.md](CODEX_PASS3_SUMMARY.md) and promotes three
larger findings:

- **Cross-thread task abstractions lack a truthful Send boundary.**
  `AnyTaskJobCtx`, `ConcurrentPromiseTaskContext`, `WorkTaskContext`,
  `CryptoJobCtx`, and `owned_task!` all allow generic contexts to be run on
  worker threads without requiring `Send` or making the context trait `unsafe`.
  Current implementations often rely on "JS-affine fields are inert on the
  worker" discipline; that is an unsafe contract and should be encoded as one.
  [Plan](audit/plans/CODEX-P3-cross-thread-task-send-boundaries.md).
- **Output writer APIs return safe aliasable `&'static mut`.** The source calls
  this a "known-unsound shim"; the APIs are widely used. The remediation is a
  closure-based writer API plus migration. [Plan](audit/plans/CODEX-P3-static-mut-lifetime-and-writer-aliasing.md).
- **Thread-local / FFI scratch-buffer refs escape as normal Rust refs.**
  Representative APIs include `ModKey::hash_name`, `HPACK::decode`,
  `Repository::try_ssh` / `try_https`, and `resolve_path::normalize_string`.
  Many current call sites copy immediately, but the APIs themselves are too
  strong. [Synthesis](audit/synthesis/codex-pass3-higher-severity-findings.md).

Pass 3 also promotes three high-risk watchlist items:
`PackageFilterIterator` is a movable self-referential type, package-manager
resolve tasks store `&'static mut NetworkTask` across a worker boundary, and
`CopyFile<'a>` explicitly carries an unsound `&JSGlobalObject` lifetime across
threads.

## Codex review of Claude Pass 3 FINAL

Claude's Pass 3 materially improved the report, especially in `bun_install`,
`bun_core`, and the bundler. Codex reviewed the final Pass 3 artifacts against
the source on 2026-05-15 and added [CODEX_PASS3_FINAL_REVIEW.md](CODEX_PASS3_FINAL_REVIEW.md).
The review keeps the real findings forceful, but corrects over-tiering:

- The **four install P0s remain high-confidence**. They are ordinary
  `bun install` / lockfile / migration inputs reaching invalid enum values,
  uninitialized `Dependency` slices, or unchecked dependency IDs.
- The **bundler B-1..B-5 group is promoted** from older watchlist wording to a
  confirmed high-confidence reference-shape UB group. The key caveat for the
  fix plan is that `SymbolMap::follow()` mutates path-compression links through
  `Cell`; merely changing renamer fields from `&mut` to `&self` is incomplete
  unless the plan proves `follow_all()` fully compressed before parallel
  codegen or adds a read-only/no-compress follow path.
- The **JSC `pass3-ub-*` items are real unsafe-contract defects**, but not all
  are confirmed live production UB. `JsRef::Weak`, blanket task `Send`,
  `Blob: Send + Sync`, and `VirtualMachine: Send + Sync` belong in Tier 2
  unless a concrete current bad call path is shown.
- The **libuv `UvHandle::close` function-pointer transmute is demoted** to
  portability / SAFETY-comment hardening. It is not variadic, and the Apple
  variadic ABI concern in the original text does not apply.
- The **WebSocket deflate H3 claim is demoted**. Source review shows
  `libdeflate::decompress_to_vec` writes only into existing spare capacity and
  the zlib fallback checks after each growth chunk; keep it as bounded
  memory-amplification hardening, not "5-byte input -> 4 GiB allocation before
  the 128 MiB check."
- The **`pending_tasks` and `FetchTasklet::abort_task` atomic-ordering claims
  are not proven T1s**. They should be documented as policy/hardening items
  unless the artifact shows a non-atomic payload whose visibility depends on
  those flags.
- **WeakPtrData, JsCell<T>, and RacyCell<T> are not counted as current T1**
  without a concrete bad caller. They remain Tier 2 unsafe-contract defects:
  real hardening work, but not dashboard-counted live UB.

## Claude pass-2 multi-agent deep-dive — additional findings

After the user's "MUCH BETTER" critique, a second wave of parallel deep-dive agents (10 in parallel, each scoped to a specific unanalyzed category) produced substantially more findings. The defensible count is now **14 confirmed/high-confidence patchable soundness bug groups**, **7 unsafe public-contract defects**, and additional latent/watchlist/perf findings. The full tiered index is [PASS2_FINDINGS_INDEX.md](PASS2_FINDINGS_INDEX.md).

### High-severity and migration-critical new findings (Claude pass 2)

1. **`Vec<u8>` → `Vec<u16>` reinterpret in `src/runtime/webcore/encoding.rs:303-310`** (`UB-RT-001`) — violates `Vec::from_raw_parts` allocator-layout contract. **Reachable from JS via `Buffer.from(x).toString("ucs2")`.** [Detail](audit/plans/PASS2-bun-runtime-deep-dive.md).

2. **8 dealloc-through-`SharedReadOnly`-provenance sites** in `http/AsyncHTTP.rs:117`, `http/lib.rs:176`, `runtime/node/node_fs.rs:2397`, `bun_alloc/lib.rs:3267`, `bun_core/string/mod.rs:1765`, `jsc/lib.rs:2022` (was `:2013` pre-`fe2635b460` cargo fmt; Pass-5 accuracy sweep), `jsc/ZigString.rs:70,102`. All call `Box::from_raw` / `heap::destroy` / `mi_free` through a `*mut T` derived from `core::ptr::from_ref(slice).cast_mut()`. **Bun's own `src/CLAUDE.md` warns about this exact bug class at the high level (Invariant I-001) — the audit found 8 places where the syntactic variant is used and the SAFETY comments don't catch the provenance issue.** [Detail](audit/plans/PASS2-ptr-cast-deep-dive.md) finding U2.

3. **`pack_command.rs:3009` `&mut T` from `*const T`** (finding `U1`) — `unsafe { &mut *std::ptr::from_ref(ctx.command_ctx).cast_mut() }`. UB under both Stacked Borrows AND Tree Borrows.

4. **6 more UB-risk sites from `ptr_intrinsic` cluster** ([Detail](audit/plans/PASS2-ptr-intrinsic-deep-dive.md)):
   - `standalone_graph::slice_to_*` — `debug_assert!`-only bounds on **attacker-controlled offsets from embedded `__BUN`/`.bun`/ELF section**
   - `bun_core::Unaligned::slice_align_cast` — `debug_assert!`-only alignment, **reachable from JS via `ArrayBuffer::as_u16/as_u32`**
   - `bun_io::Request::store_callback_seq_cst` — `write_volatile` + SeqCst fence as cross-thread publish primitive (violates Rust memory model — should be `AtomicPtr` `Release`/`Acquire`)
   - `SysQuietWriterAdapter::adapter_write_all` — `pos + bytes.len()` overflow → `copy_nonoverlapping` writes past buffer
   - Windows-shim `ptr::copy(spawn_command_line, dst, len + 1)` — `debug_assert!`-only bound on shim metadata
   - `SerializedSourceMap::header()` — sibling accessors call without `len()` check

5. **11 strict-provenance offender sites** — ThreadPool tagged-pointer stack, QuietWriter fd-in-pointer-slot, sigaction fn-ptr-as-usize, `bun_core` pointer-as-bytes serialization, `prctl(PR_SET_NAME, ptr as usize)`, libuv `reserved[0] as usize`. Each fails under `-Zmiri-strict-provenance`. Mechanical refactor to `core::ptr::with_addr` / `expose_provenance`. These are migration blockers for strict provenance, not all immediate memory-safety exploits.

6. **`bun_collections::linear_fifo::assume_init_slice{,_mut}`** (line 68, 77) — reinterprets `&[MaybeUninit<T>]` as `&[T]` over the entire backing buffer before slicing to the initialized region. The maintainer's doc comment says this is sound only when any bit pattern is a valid `T`, but the function is generic and active users include niche-bearing `RefDataValue`, Valkey `Entry`, and Valkey `PromisePair`. This is a real UB bug on hot paths (`bun test` result queue and Valkey command queues). Plus latent variants in `bun_threading::Channel` and `BoundedArray::add_many_as_slice`. [Detail](audit/plans/PASS2-maybe-uninit-deep-dive.md).

### Medium-severity Claude pass-2 findings

1. **2 new bounded leaks** — `DependencyVersionValue::npm`'s `ManuallyDrop<NpmInfo>` is never reclaimed (per-install memory leak; constructors at `dependency.rs:1306`, `PackageManagerResolution.rs:274`); `Editor::open` Windows-only `MiniEventLoop + uv_loop_t` leak (author-flagged `FIXME(windows-leak)`).

2. **Atomic-ordering: 0 too-weak, ~115 too-strong** — the atomic audit found ZERO confirmed happens-before bugs (Bun's `bun_core::atomic_cell` discipline is excellent). However, **~115 sites use `SeqCst` where `AcqRel` would suffice** — concentrated in `bun_ptr::ref_count` (8), `WTFTimer` (9), `RwLock` (15), `event_loop` (6). All are (B) PERF candidates.

3. **bun_runtime fragility findings** — `RequestContext::as_response` returns `&'static mut Response` without encoding the GC-protect requirement; `node/path_watcher.rs:108` `unsafe impl Sync` over `Cell<Fd>` sound only via `std::thread::spawn`'s publish edge but invisible to the type system; `jsc_hooks.rs:2324` invisible `'static` widening.

### Real verification — miri runs

23 crate-level miri attempts were run under `cargo +nightly miri test -Zmiri-strict-provenance`. Seven crates passed with real tests (`bun_errno`, `bun_ast`, `bun_alloc`, `bun_ptr`, `bun_threading`, `bun_wyhash`, `bun_md`) for **43 tests in fully passing crates**. Twelve more crates passed vacuously with zero unit tests. `bun_paths` and `bun_base64` have pre-existing assertion failures that also fail outside miri; `bun_collections` has a test-code compile error; `bun_io` is miri-unsupported because it calls simdutf FFI. Full log in [verification-log.md](verification-log.md).

The vendor-deps blocker that prevented pass-1 cargo geiger / cargo expand / miri was bypassed by stubbing `vendor/lolhtml/c-api`; this stub is now committed to the audit dir and noted as audit-only.

## The story

Bun's port from Zig to Rust drew significant public criticism for its unsafe surface — "thousands of `unsafe` blocks, AI-generated, low-quality." This audit engages with that criticism and finds:

**Most of Bun's unsafe is load-bearing.** ~9,800 sites (89%) are (A) STRICTLY_UNAVOIDABLE: FFI bindings to vendored C libraries (uWebSockets, libuv, mimalloc, BoringSSL, etc.), allocator implementations, JSC interop, and — critically — the **Zig-port `*mut Self` pattern** that's necessary under Rust's Stacked Borrows aliasing model when a C callback may free `self`.

This last point is documented explicitly in Bun's own `src/CLAUDE.md`:

> If a callback may free `self` (close, error, GC finalize), do **not** materialize `&self`/`&mut self` at the boundary — a `&self`-derived raw pointer carries `SharedReadOnly` provenance, and `Box::from_raw`/dealloc through it is UB. Pass and dispatch off `*mut Self` until the body proves ownership.

The `impl_streaming_writer_parent!` macro in `src/io/PipeWriter.rs` encodes three modes (`mut`/`shared`/`ptr`) for exactly this discipline. A grep-based critique that flags every `unsafe { &mut *this }` as a smell is wrong about a load-bearing invariant.

The audit's A-001 deep-analysis pass sampled 122 sites stratified across 33 crates and identified **8 distinct (A) subclasses** (A-FFI-FREE-CALLBACK ~38%, A-FFI-NO-FREE ~14%, A-REENTRANT ~17%, A-LIFETIME-ERASURE ~11%, A-INTRUSIVE ~9%, A-PROCESS-LIFETIME ~5%, A-OPAQUE-FFI-HANDLE ~3%, plus the small ~3% (C-PURE-RUST) tail concentrated in `bun_exe_format::pe.rs`). Each subclass gets a hardened SAFETY-comment template. No anti-pattern UB was found in the sample. Two watchlist sites (`h2_frame_parser.rs:3429`'s HashMap-stored `*mut Stream` aliasing; `WindowsNamedPipe.rs:1432`'s `borrow = mut` macro-mode choice) deserve a targeted miri harness in Phase 9. [Plan](audit/plans/A-001-zig-port-mut-self.md).

**~2% of sites are safely refactorable.** The audit identifies three concrete clusters totaling ~120-250 sites:

- **C-001** — `NonNull::new_unchecked` where the source is a Rust reference. **22+ of 40 sites** remain firm safe rewrites after excluding the `StoreRef::from_static` `const fn` site from the headline batch. [Plan](audit/plans/C-001-nonnull-from-reference.md), [Codex correction](audit/synthesis/codex-pass2-adversarial-reclassification.md).
- **C-002** — `mem::transmute<int, enum>` where the input is bounded. **3 sites** refactor to checked `strum::FromRepr`, **3 more** become checked/unchecked constructor pairs, and **1 site is latent UB** that should be fixed before any future caller lands. [Plan](audit/plans/C-002-transmute-to-enum.md), [Codex correction](audit/synthesis/codex-pass2-adversarial-reclassification.md).
- **C-003** — `unsafe impl Send`/`Sync` cluster. **46 of 157** manual Send/Sync impls (29%) are candidate refactors under four patterns. Codex pass 2 confirms the `StoreSlice<T>` bug but notes that the assertion sweep needs either Bun's existing no-dependency auto-trait proof pattern or an explicit new dependency; `static_assertions` is not currently in the workspace. [Plan](audit/plans/C-003-send-sync-impls.md), [Codex correction](audit/synthesis/codex-pass2-adversarial-reclassification.md).

**~30 sites are PERF_ONLY candidates.** Across 17 `unreachable_unchecked` sites + 13 `get_unchecked` sites, the plan identifies hot-path candidates and designs the `safe-only` Cargo feature. Codex pass 2 treats these as B-candidates until the benchmark logs exist. Plus 4 sites in `bun_jsc/generated.rs` should become unconditional `unreachable!()` because the safe form catches bindgen drift instead of UB'ing on it. [Plan](audit/plans/B-001-and-B-002-perf-only.md). [Bench targets](audit/plans/bench-targets.md).

**Patch-ready soundness fixes found, plus broader pass-3 defects.**

1. **`impl GetErrno for usize` in `src/errno/linux_errno.rs:175-188`** (site `S-001781`). Transmutes `(int as u16) → SystemErrno` where the SAFETY comment claims the kernel errno range is `[0, 4096)` — but the Linux `SystemErrno` enum only has dense discriminants `0..=133`. Currently zero live callers, but the function is `pub` and any future Zig-style port path (`@as(usize, @bitCast(rc))` → `getErrno`) will hit it. **Fix: ~6-line patch** — replace transmute with `E::from_repr(raw).unwrap_or(E::SUCCESS)` via `strum::FromRepr`.
2. **`unsafe impl<T> Send/Sync for StoreSlice<T>` in `src/ast/nodes.rs`.** Unconditional Send and Sync over `T`. Sister type `StoreRef<T>` immediately above is correctly bounded `<T: Send>`/`<T: Sync>`. The unconditional impl lets a `StoreSlice<Cell<u32>>` cross threads — and `Cell` is `!Sync`. The bug appears to be a typo in the port (one of two adjacent impls was correctly bounded; the other was not). **Fix: ~2-line patch** — add the matching `<T: Send>`/`<T: Sync>` bound.

Those two remain the smallest first PRs, but they are no longer the whole story.
Pass 2 added patchable bugs in `encoding.rs`, `linear_fifo.rs`,
`pack_command.rs`, the shared-provenance dealloc/free sites, release-only bounds
checks, volatile publication, `SerializedSourceMap::header()`, and `bun:ffi`
close/callback lifetime handling. The landing order below reflects that.

The pass-3 defects are different: they are not single-line fixes. They are
architecture-level Rust contract problems. They should be tracked as P0/P1
design beads because they affect the boundary where safe Rust callers meet
worker pools, TLS globals, and borrowed scratch buffers.

**Safety-comment hardening.** Codex pass 2's reproducible heuristic found **1,594 of 11,044** source-level unsafe sites without a nearby proof marker. This is a triage index, not a final verdict, but it is a better baseline than the original rough percentage. [Gap index](audit/synthesis/codex-pass2-safety-comment-gap.md).

## What the audit does NOT claim

This is a pass-1 audit; we're explicit about its limits. The maintainer-empathy review in [REVIEWER_RESPONSES.md](REVIEWER_RESPONSES.md) raised most of these concerns directly.

1. **`cargo geiger` is still not a reliable full-workspace baseline.** Bun's vendored C deps and build-time fetched pieces make whole-workspace cargo tooling fragile. Pass 2 worked around enough of this to run targeted miri and sampled `cargo expand`, but the audit still lacks a clean complete geiger drift baseline.

2. **`cargo expand` now ran for sampled crates, not the entire workspace.** The `bun_alloc` sample grew from 273 source-level unsafe-ish hits to 299 macro-expanded hits (+9.5%). Later Pass 3 macro work expanded eight crates, including `bun_jsc`; the old "~200-300 net macro-only sites" headline only applies before `bun_jsc`. Including `bun_jsc`, the added macro-only surface is larger and still needs deduping against source-level unsafe. Macro expansion did change the priority story by supporting the bundler/JSC reviews, so older "classifications unchanged" wording is superseded by the Pass 3 correction doc.

3. **No rustdoc JSON.** Soundness-surface (reachability from `pub` API) is computed with a coarse per-file-visibility heuristic, not a precise call graph.

4. **End-to-end `cargo +nightly miri test` is infeasible.** Bun's test suite touches the JS engine, filesystem, network, and JSC's GC heavily; miri's isolation cannot accommodate it. **Mitigation:** the verify harness (`verify.sh`) runs miri PER-CRATE on the rewrite-touched code only.

5. **Miri coverage is targeted, not exhaustive.** Later passes added five
   miri-backed UB witnesses and a Kani proof artifact, but no whole-Bun miri
   run is feasible. The remaining remediation PRs still need targeted tests for
   each source fix or contract migration.

6. **The "11,044 sites" count is per-reborrow-site, not per-function.** A single `unsafe fn` body that does five `unsafe { &mut *this }` reborrows counts as 5 sites in this audit. The headline ratios ("~98% justified, ~2% refactorable") are accurate for the per-site framing but should not be read as "98% of unsafe **functions** are justified." Subsequent passes that aggregate per-function (or per-`pub fn` API surface) will produce a different — likely smaller — denominator and the (C) percentage will rise correspondingly.

7. **Phase 6 adversarial reclassification is now materially stronger.** Codex pass 2 corrected stale claims; Codex pass 3 found broader safe-API contract defects. A final quiet pass is still needed for convergence, but the audit should no longer frame the result as "only two bugs."

8. **C-005 (Pure-Rust `Self::xxx(this)` refactors) deferred.** Without rustdoc JSON's call graph, we can't reliably distinguish "called only from pure Rust" from "called from an FFI callback path." This is the highest-value remaining cluster after C-001/C-002/C-003; subsequent passes should tackle it.

These gaps are explicit so future passes (especially the user's planned multi-harness comparison) address them without surprise.

## Demonstration / remediation PRs

**Current state:** companion PR #30765 already lands the first compact set:
`StoreSlice<T>` Send/Sync bounds, the `linux_errno` checked conversion, and the
`GuardedLock` `!Send` marker. The remaining recommended landing order is:

1. **`encoding.rs` `Vec<u8>` -> `Vec<u16>` fix** — remove raw-parts reinterpret.
2. **`linear_fifo` MaybeUninit fix** — stop exposing full backing buffers as `[T]`; operate on `MaybeUninit<T>` storage and assume-init only initialized windows.
3. **`pack_command.rs:3009` fix** — thread true mutable/raw ownership through the call chain.
4. **8 shared-provenance dealloc/free fixes** — retain original owner pointer instead of freeing through shared slices.
5. **`standalone_graph::slice_to_*` checks** — release-mode bounds before slice formation.
6. **`Unaligned::slice_align_cast` checks** — runtime checked alignment API.
7. **`bun_io::Request` callback publication** — replace volatile+fence with atomic pointer publication.
8. **`SysQuietWriterAdapter` overflow fix** — checked arithmetic before copy.
9. **Windows shim metadata bound check** — real release guard before `ptr::copy`.
10. **`SerializedSourceMap::header()` length check** — checked accessor before `read_unaligned`.
11. **`bun:ffi` close hardening** — invalidate `JSFFIFunction` wrappers on `FFI.close`; validate `closeCallback` membership.
12. **Windows waker placeholder** — replace stale `zeroed_unchecked()` branch with the existing placeholder.
13. **Pass-3 contract PRs** — bundler B-1..B-5 reference-shape refactor, task-trait `Send`/`unsafe trait` migration, output writer closure API, and scratch-buffer non-escaping APIs.

The first several remaining items are small point fixes or tightly-scoped bug
groups. The pass-3 contract migrations are larger and should be split by
subsystem. Keep code fixes out of the audit-artifact PR and land them as
separate source PRs like #30765.

The remaining clusters (C-001 PR-2 13-site batch, C-003 PR-2/3/4, B-001/B-002 `safe-only` feature, A-001/A-002/A-003 hardening) file as beads for incremental landing.

## Audit artifacts

```text
.unsafe-audit/
├── AUDIT_SUMMARY.md                       ← you are here
├── phase0_scope_decision.md               ← what's in / out / why
├── phase0_skill_inventory.json            ← skill bootstrap state
├── phase0_toolchain.json                  ← tool inventory
├── phase0_crates.txt                      ← 108 workspace crates
├── unsafe-inventory.jsonl                 ← 11,044 sites, normalized + categorized
├── verify.sh                              ← composite verification harness
├── ci-matrix.yml                          ← proposed CI matrix entry
├── beads-to-create.md                     ← Phase 8 bead commands (not yet executed)
├── REVIEWER_RESPONSES.md                  ← Phase 10 maintainer-empathy review (cluster-by-cluster)
├── PASS2_FINDINGS_INDEX.md                ← tiered pass-2/3 findings index
├── PASS2_FINAL_REVIEW.md                  ← review of Claude `3dd091e` maybe_uninit final commit
├── CODEX_PASS2_SUMMARY.md                 ← Codex adversarial pass-2 summary
├── CODEX_PASS3_SUMMARY.md                 ← Codex safe-API soundness pass
├── audit/
│   ├── synthesis/
│   │   ├── phase1_inventory_summary.md    ← counts, top patterns, categories
│   │   ├── invariants.md                  ← 15 invariants Bun's unsafe upholds
│   │   ├── soundness-surface.md           ← what's reachable from JS API
│   │   ├── refactor-clusters.md           ← cluster-by-cluster verdicts
│   │   ├── deliberate-design-evidence.md  ← exhibits showing Bun's unsafe is structured
│   │   ├── fresh-eyes-review.md           ← Phase 7 spot-check of proposed rewrites
│   │   ├── codex-pass2-architecture-map.md
│   │   ├── codex-pass2-phase-gap-analysis.md
│   │   ├── codex-pass2-adversarial-reclassification.md
│   │   ├── codex-pass2-safety-comment-gap.md
│   │   └── codex-pass3-higher-severity-findings.md
│   ├── classification/
│   │   └── master-classification.md       ← Phase 4 A/B/C summary + falsifiable
│   │                                         justifications + adversarial questions
│   └── plans/
│       ├── CODEX-P2-windows-waker-placeholder.md
│       ├── CODEX-P3-cross-thread-task-send-boundaries.md
│       ├── CODEX-P3-static-mut-lifetime-and-writer-aliasing.md
│       ├── C-001-nonnull-from-reference.md  ← 40 sites, 22+ refactorable after const correction
│       ├── C-002-transmute-to-enum.md       ← 30 sites, 6 refactor, 1 latent-UB
│       ├── C-003-send-sync-impls.md         ← 345 sites, 46 refactor, 1 latent-UB
│       ├── PASS2-maybe-uninit-deep-dive.md  ← LinearFifo niche-T UB + Channel/BoundedArray latent variants
│       ├── A-001-zig-port-mut-self.md       ← 1,610 sites, 8 (A) subclasses + ~3% (C) tail
│       ├── A-003-ffi-shim-hardening.md      ← 4 *_sys crates with hardened SAFETY templates
│       ├── B-001-and-B-002-perf-only.md     ← 30+ sites, safe-only Cargo feature design
│       └── bench-targets.md                 ← B-cluster perf measurement mapping
└── phase1/
    ├── *.json (per-crate ast-grep outputs)
    ├── cluster-summary.json
    └── ... (geiger/expand failed; see Phase 1 limitations)
```

## Reviewer confidence

| Cluster | Plan quality | Risk | Demo-PR ready |
|---------|:---:|:---:|:---:|
| C-001 | High | Low | Yes after excluding/solving const site |
| C-002 | High | Low–Med | Yes with checked conversion (`SystemErrno::init` in PR #30765; `FromRepr` remains a viable plan shape elsewhere) |
| C-003 | High | Med | Yes after assertion-mechanism decision |
| CODEX-P2 Windows waker | High | Low | Yes, pending Windows check |
| CODEX-P3 cross-thread task boundaries | High | Med-High | Design PR needed; not a one-line fix |
| CODEX-P3 static mut / scratch lifetimes | High | Med | Closure/buffer API migration needed |
| A-001 | High | n/a | n/a — 8 subclass templates; ~3% (C) tail in `bun_exe_format::pe.rs` (~14 sites) |
| A-003 | High | n/a | n/a — 4 per-crate hardened SAFETY templates (uws_sys, libuv_sys, libarchive_sys, mimalloc_sys) |
| B-001/B-002 | Plan high | Low | Not proof-ready until benchmarks are attached |

## What's next

1. **Keep PR #30763 audit-only.** Future pushes there should be limited to accuracy, hygiene, verification, and reviewer-response updates.
2. **Keep PR #30765 source-only.** It currently carries the first three compact fixes; do not mix audit artifacts or lockfile churn into it.
3. **Land the remaining compact point fixes as separate source PRs** before the larger pass-3 contract migrations.
4. **Optional: file beads via `br create`** in `.beads/` for incremental landing. Commands prepared in `beads-to-create.md`.

## About this skill

This audit was produced by [`/rust-unsafe-code-exorcist`](https://jeffreys-skills.md/skills/rust-unsafe-code-exorcist), one of a catalog of agent-coding skills available at [jeffreys-skills.md](https://jeffreys-skills.md). The skill runs a structured 10-phase loop (enumerate → cluster → classify → plan → adversarial reclassify → fresh-eyes review → bead conversion → harness → maintainer review → remediation offer) on any Rust project, producing a defensible per-cluster classification with falsifiable justifications.

Per-cluster classification is the unique value-add: a grep-based critique cannot distinguish "necessary unsafe upholding Stacked Borrows discipline" from "mechanical unsafe that could be refactored away." This audit does, with named clusters and verifiable rewrites.
