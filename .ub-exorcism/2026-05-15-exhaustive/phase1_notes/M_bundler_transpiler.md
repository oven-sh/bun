# Section M: bundler-and-transpiler

## Purpose

Catalog every `unsafe` surface in `src/bundler/`, `src/bundler_jsc/`,
`src/standalone_graph/`, and `src/transpiler/` for the
`2026-05-15-exhaustive` UB-exorcism run. Tag bucket(s), SAFETY-comment
quality, macro-vs-source. No edits, no remediations. Anchor finding is
EXP-010 (the bundler parallel-callback aliasing cluster) plus EXP-014
exploiter trace.

## Unsafe-surface tally (vs prior 576)

| crate                  | sites prior | sites now | Δ   | files |
| ---------------------- | ----------- | --------- | --- | ----- |
| `bun_bundler`          | ~530        | 536       | +6  | 30    |
| `bun_bundler_jsc`      | ~14         | 26        | +12 | 1     |
| `bun_standalone_graph` | ~32         | 57        | +25 | 1     |
| `bun_transpiler`       | 0           | 0         | 0   | 1 (re-export) |
| **Section M total**    | **~576**    | **619**   | **+43** | 33 |

The `+43` delta breakdown (sample-confirmed via spot reads, full Phase-2
diff pending):
* `bundler_jsc/analyze_jsc.rs` (+12) — new JSC `JSModuleRecord` /
  `IdentifierArray` glue for the bytecode analyzer; nearly all FFI thunks.
* `standalone_graph/StandaloneModuleGraph.rs` (+25) — exe-format
  (Mach-O/PE/ELF) section readers expanded; `slice_to*` primitives plus
  unaligned `read_unaligned` over self-extracted module graph bytes.
* `bundler/bundle_v2.rs` net positive — new `bun_ptr::RawSlice` /
  `detach_lifetime` helpers for plugin-callback boundaries.

`src/transpiler/` is a 16-line re-export crate; all "transpiler" sites count
under `bun_bundler/transpiler.rs` and `bun_bundler/ParseTask.rs`.

## EXP-010 anchor status — bundler parallel-callback aliasing cluster

**Verdict: STILL APPLIES verbatim. Not changed since prior audit.**

The five sites flagged HIGH (UB-by-construction) by the prior Pass-3 deep
dive are identical in file:line and shape on audited base
`origin/main@4d443e5402`. A W4 spot-check against latest fetched
`origin/main@e750984db6` still shows the same `&mut LinkerContext` /
`&mut Chunk` reborrow shape in the JS chunk worker path, although later
cleanup commits changed comments and may shift line numbers.

| Anchor | Prior file:line                                                          | Current file:line                                          | Shape | Status      |
| ------ | ------------------------------------------------------------------------ | ---------------------------------------------------------- | ----- | ----------- |
| **B-1** | `bundler/Chunk.rs:130-132` (`TODO(ub-audit)` on `Renamer<'r>`)           | `Chunk.rs:130-132`                                         | Per-chunk renamer reborrow `&'r mut {Number,Minify}Renamer` aliased N-way across part-range tasks for the same chunk. The source TODO says the printer never writes through it, but the parallel codegen path still calls `SymbolMap::follow()`, which performs path compression through `Cell` unless `follow_all()` made it a store-free lookup. | UNCHANGED |
| **B-2** | `bundler/LinkerContext.rs:1657` (`GenerateChunkCtx::c() → &mut LinkerContext`) | `LinkerContext.rs:1657-1663`                          | `each_ptr(chunk_contexts[0], LinkerContext::generate_chunk, chunks_to_do)` (line 330 of `generateChunksInParallel.rs`) fans out one task per chunk; each task calls `ctx.c()` → `assume_mut()` → aliased `&mut LinkerContext` per worker. | UNCHANGED |
| **B-3** | `bundler/linker_context/generateCompileResultForJSChunk.rs:61-62`        | `generateCompileResultForJSChunk.rs:61-62`                 | `let c_mut: &mut LinkerContext = unsafe { &mut *c_ptr }; let chunk_mut: &mut Chunk = unsafe { &mut *chunk_ptr };` inside the per-part-range worker. SAFETY comment now explicitly *acknowledges* peer aliasing ("Peer tasks still hold their own `&mut` views"). | UNCHANGED |
| **B-4** | `bundler/linker_context/generateCompileResultForCssChunk.rs:45-46`       | `generateCompileResultForCssChunk.rs:45-46`                | Same template as B-3 for CSS chunks.                      | UNCHANGED |
| **B-5** | `bundler/linker_context/prepareCssAstsForChunk.rs:77-78`                 | `prepareCssAstsForChunk.rs:76-80`                          | `prepare_css_asts_for_chunk_impl(unsafe { &mut *linker }, unsafe { &mut *chunk }, …)` — `&mut *chunk` is unique per CSS chunk (single task per CSS chunk, see `generateChunksInParallel.rs:118-134`); `&mut *linker` aliases across all CSS-chunk tasks. | UNCHANGED |

**`&mut LinkerContext` flow analysis** for B-2..B-5:

1. `generate_chunks_in_parallel(c: &mut LinkerContext, chunks: &mut [Chunk], …)`
   takes the canonical mutable borrow.
2. `GenerateChunkCtx { c: ParentRef::from_raw_mut(std::ptr::from_mut(c)), … }`
   captures it as a raw `*mut` (write provenance preserved).
3. `worker_pool.each_ptr(ctx, LinkerContext::generate_{chunk,js_renamer}, …)`
   schedules many worker tasks sharing the same `ctx`.
4. Each worker calls `ctx.c() → self.c.assume_mut() → &mut LinkerContext` and
   then makes that the receiver of `generate_chunk` / passes it to
   `post_process_*_chunk`. Peer workers hold their own `&mut LinkerContext`
   to the same allocation in parallel — Stacked / Tree Borrows violation.
5. Behaviour may be benign in practice because most writes target
   per-chunk-disjoint fields (`chunk.intermediate_output`,
   `chunk.isolated_hash`, etc.), but the *reference shape* is UB. Do not call
   this strictly read-only: `generate_compile_result_for_*` and
   `generateCodeForFileInChunkJS` reach `c.graph.symbols.follow(...)`, and
   `SymbolMap::follow()` does path compression by writing `Symbol::link` through
   `Cell` (`src/ast/symbol.rs:706-727`) unless a prior `follow_all()` pass made
   all later calls store-free.

The reference *correct* template lives in two siblings:

* `linker_context/doStep5.rs:43-58` — `unsafe fn do_step5(this: *mut
  LinkerContext<'_>, source_index_: Index, _: usize)` keeps `this: *mut
  LinkerContext` and only ever derefs to `&LinkerContext`. SoA writes go
  through `split_raw()` per-row pointers (root provenance).
* `linker_context/renameSymbolsInChunk.rs:43` — same template; even has a
  multi-line `# Safety` block plus the `let symbols: *mut symbol::Map =
  unsafe { &raw mut (*c).graph.symbols };` discipline note explaining why
  the `*mut` deref must come *before* the `&LinkerContext` shadow.

Pass 3 already flagged that B-2..B-5 should adopt this template; the work
is unstarted. B-1 needs the visible `Renamer<'r>` borrow changed away from
aliased `&'r mut`, **and** the symbol-following path needs a separate proof:
either `follow_all()` must be proven to fully compress every ref before
parallel codegen, or the parallel printer/codegen path needs a no-compress
read-only `follow` variant.

**Has any of B-1..B-5 been changed since prior audit?** No.
`git log --oneline -- <each file>` shows only the original Rust-port
commit `23427dbc12`. The Pass-3 contract PR is unfiled.

## LinkerGraph::load + bundle_v2 EXP-014 (`Slice<T>: Copy`) exploiters

The Section-O Phase-1 note named `LinkerGraph::load` and `bundle_v2` as the
two cited live exploiters of the documented `Slice<T>: Copy` soundness gap
in `src/collections/multi_array_list.rs:564-568`. Both are confirmed
present:

* **`LinkerGraph::load`** (`src/bundler/LinkerGraph.rs:495-700`) — five
  `.slice()` calls:
  * line 502 `server_component_boundaries.slice()` (read-only).
  * line 513 `let mut files_slice = self.files.slice(); let files_cols =
    files_slice.split_mut();` — emits `&mut [entry_point::Kind]` plus
    aliasing peers from a `Copy` `Slice`. Sound *here* because no second
    `Slice` copy of `self.files` is held simultaneously.
  * line 535 `let mut ep_slice = self.entry_points.slice(); let ep_cols =
    ep_slice.split_mut();` — same shape on `entry_points`.
  * lines 631 / 668 — read-only iteration.
  The PORT NOTE at line 509-512 names the gap explicitly: *"Slice<T> caches
  raw column pointers and does not borrow self.files, so the split_mut()
  borrows … can stay live across other &mut self.* accesses below"*.

* **`BundleV2::*`** (`src/bundler/bundle_v2.rs`) — four
  `Slice`-snapshot-then-`split_mut/raw` sites:
  * line 1997 — `let mut ast_slice = self.graph.ast.slice(); …
    ast_slice.split_mut().import_records;` (find_reachable_files).
  * line 2062 — same template on `input_files`.
  * line 2170 — same template on `ast`, second pass.
  * line 5270-5283 — uses `.slice() + split_raw()` for column writes,
    avoiding `split_mut()` overlap.

All four `bundle_v2` sites are single-threaded (called from
`find_reachable_files` and `scan_imports_and_exports` rebuild paths). The
gap is *not weaponized into UB* in current source: no two `Slice` copies
of the same MultiArrayList live with overlapping `split_mut()` outputs at
the same time. But the type permits it, and a future patch that takes
`let s1 = x.slice(); let s2 = x.slice(); let a = s1.split_mut().a; let b =
s2.split_mut().a;` would compile and produce two `&mut`s into the same
column.

## Parallel-dispatch enumeration (cross-thread `&mut`?)

Five distinct fan-outs in this section:

1. **`generateChunksInParallel.rs:84-86`** — `each_ptr(ctx,
   generate_js_renamer, chunks)`. Per-chunk callback. Touches B-1
   (renamer `&'r mut`).
2. **`generateChunksInParallel.rs:118-134`** — manual `Batch` of
   `PrepareCssAstTask` (one per CSS chunk). Touches B-5.
3. **`generateChunksInParallel.rs:330`** — `each_ptr(chunk_contexts[0],
   generate_chunk, chunks_to_do)`. Touches B-2.
4. **`bundle_v2.rs` plugin path** — `unsafe { &mut *self.bv2 }` /
   `(*self.bv2).enqueue_on_js_loop_for_plugins(task)` reborrow `&mut
   BundleV2` from a JS-loop trampoline (lines 1216, 1227, 1362, 1376).
   This crosses the JS-thread / worker-thread boundary; the `&mut
   BundleV2` reborrow is the same UB shape class as B-2 but on the
   *parent* type. Currently relies on `BundleV2` quiescence during plugin
   ticks — encoded in comments, not the type system.
5. **`BundleThread.rs:155-278`** — the bundler's owned worker thread.
   `BundleThread::{spawn, enqueue, thread_main}` are `unsafe fn`; the
   `Send`/`Sync` is on `Instance` (a `NonNull<()>`) and a local `SendPtr`.
   No `&mut` of a borrowed type crosses; only raw pointers.

Inside the worker callback, ParseTask uses `unsafe impl Send` on raw
fields (e.g. `&'a GenerateChunkCtx<'a>` whose pointee is `unsafe impl Send +
Sync`). The chain is:

* `LinkerContext: Send + Sync` (LinkerContext.rs:239-240).
* `Chunk: Send + Sync` (Chunk.rs:133-134).
* `LinkerGraph: Send + Sync` (LinkerGraph.rs:96-97).
* `ThreadPool: Send + Sync` (ThreadPool.rs:77-78).
* `SourceMapDataTask: Send` (LinkerContext.rs:1379).
* `PrepareCssAstTask: Send` (prepareCssAstsForChunk.rs:41).
* `CompletionHandle: Send + Sync` (bundle_v2.rs:1543-1544).
* `DevServerHandle: Send + Sync` (bundler/lib.rs:341-342).
* `ImportPathsListPtr: Send + Sync` (linker.rs:106-107).
* `BundleThread::Instance: Send + Sync` (BundleThread.rs:389-390).
* `StandaloneModuleGraph: Send + Sync` (standalone_graph:189-190).
* `CompileResultSlots: Sync` (Chunk.rs:152) — *new since prior audit*;
  encodes the disjoint-slot publication via `UnsafeCell` (the right shape
  but doesn't fix B-3/B-4's surrounding `&mut Chunk`).

Every Send/Sync impl has a multi-line SAFETY comment except
`bundler_jsc/analyze_jsc.rs`, which has no Send/Sync impls of its own.

## Notable patterns

* **Two coexisting templates for parallel callbacks.** The "correct"
  template (`*mut Self` + `&Self` deref + `split_raw()` for column writes)
  is used in `do_step5` and `rename_symbols_in_chunk`. The "broken"
  template (`*mut Self` + `&mut Self` reborrow per worker) is used in B-2
  through B-5. Both shapes coexist in `linker_context/`, separated only by
  whether the file was rewritten Pass-3-style.
* **`bun_ptr::detach_lifetime{,_ref}` proliferation.** ~20 sites total;
  most are arena-borrow laundering and are *behaviourally* sound (arenas
  outlive the workers), but a handful annotate themselves only as
  "upheld by caller per fn contract" without restating what the contract
  is. `bundle_v2.rs:1594-1604` is the worst example.
* **`unsafe impl Send for SendPtr<T>`** declared inline inside
  `BundleThread::spawn` (line 173). Tiny scope but worth flagging as a
  pattern (versus a top-level newtype with documentation).
* **`bundler_jsc/analyze_jsc.rs` is a SAFETY-comment desert.** 26
  unsafe sites, only 7 SAFETY comments — by far the lowest density in
  Section M. Every body is a thin FFI thunk (`unsafe {
  JSC__VariableEnvironment__add(self, vm, identifier_array,
  identifier_index) }`); the file pattern is "extern decl + safe wrapper
  that's still `unsafe fn`". Acceptable for FFI but inconsistent with the
  rest of the section.
* **`StandaloneModuleGraph.rs::read_unaligned` on
  embedded-binary bytes** (lines 287-345). Section claims bun-emitted
  bytes can be trusted, but a tampered standalone binary feeds adversarial
  input to these readers. Bound checks are present; alignment is
  explicitly handled. No SAFETY comment in scope flags the
  "tampered-binary input" model — this is a Phase-3 surface.

## Open questions

1. Is the EXP-010 fix tracked anywhere (issue, PR, bead) since the prior
   audit was published? No commit on B-1..B-5 in the interim suggests
   "open / unfiled".
2. Is `follow_all()` sufficient to make every later parallel
   `SymbolMap::follow()` call store-free? If not, B-1/B-3/B-4 fixes need a
   no-compress/read-only follow path in addition to changing `Renamer<'r>`.
3. EXP-014: the soundness gap is exploited but unweaponized. Is the
   right Phase-2 action (a) close the gap in `multi_array_list` (Section
   O), (b) sweep Section M for any future-weaponization risk, or (c)
   both?
4. The `bundle_v2.rs:1216-1391` `&mut BundleV2` reborrow from the JS-loop
   trampoline — does the JS thread truly never re-enter `BundleV2`
   between the reborrow and its drop? The comment says yes; the type
   system is silent.

## Anchor cross-refs

* **EXP-010** — `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md` § the bundler
  parallel-callback hypothesis. Phase 5 now has a hand-scheduled
  Tree-Borrows model witness for the aliased-`&mut` pattern; a Loom/Shuttle
  model can still document scheduling overlap, but Loom is not an aliasing
  oracle.
* **EXP-014** — `phase1_notes/O_alloc_collections.md` (Section O) names
  the `Slice<T>: Copy` documented gap; this section traces the named
  exploiters.
