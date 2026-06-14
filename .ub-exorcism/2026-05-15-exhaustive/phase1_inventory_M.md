# Phase 1 Inventory — Section M: bundler-and-transpiler

Run: `2026-05-15-exhaustive`. Scope: `src/bundler/`, `src/bundler_jsc/`,
`src/standalone_graph/`, `src/transpiler/`.

## Mapper tallies (audited base `origin/main@4d443e5402`)

| crate                  | files (rs) | `unsafe` keyword sites | SAFETY: comments |
| ---------------------- | ---------- | ---------------------- | ---------------- |
| `bun_bundler`          | 30         | 536                    | 480              |
| `bun_bundler_jsc`      | 1          | 26                     | 7                |
| `bun_standalone_graph` | 1          | 57                     | 47               |
| `bun_transpiler`       | 1 (re-export only — see below) | 0  | 0                |
| **Section M**          | 33         | **619**                | **534**          |

Site-count prior was 576; current 619 ⇒ **+43**. The delta is concentrated in
`bundle_v2.rs` (114 vs prior ~72 — new HMR/dev-server bridges, more
`bun_ptr::detach_lifetime*` and `RawSlice`-helper sites) and the
`linker_context/` per-step files (template flips between `*mut Self` raw and
`&mut Self` reborrows). `src/transpiler/lib.rs` is a 16-line re-export of
`bun_bundler::transpiler` — every Section-M site lives in `bun_bundler` itself.

SAFETY-comment density: 534 explicit `// SAFETY:` comments across 619 sites
(~86 %) — high coverage. Quality varies; see EXP-010 row for a class where the
SAFETY comment names the wrong invariant.

`unsafe` kind breakdown: 27 `unsafe fn`, 33 `unsafe impl`, 12 `unsafe extern`,
0 `unsafe trait`, 547 `unsafe { … }` blocks.

## Per-file unsafe distribution (top contributors)

| file                                                                             | unsafe sites | SAFETY: comments |
| -------------------------------------------------------------------------------- | ------------ | ---------------- |
| `src/bundler/bundle_v2.rs`                                                       | 114          | 105              |
| `src/bundler/LinkerContext.rs`                                                   | 75           | 64               |
| `src/bundler/ParseTask.rs`                                                       | 58           | 54               |
| `src/standalone_graph/StandaloneModuleGraph.rs`                                  | 57           | 47               |
| `src/bundler/BundleThread.rs`                                                    | 26           | 21               |
| `src/bundler_jsc/analyze_jsc.rs`                                                 | 26           | 7                |
| `src/bundler/transpiler.rs`                                                      | 25           | 27               |
| `src/bundler/ThreadPool.rs`                                                      | 23           | 20               |
| `src/bundler/linker_context/findImportedFilesInCSSOrder.rs`                      | 19           | 5                |
| `src/bundler/linker_context/doStep5.rs`                                          | 16           | 15               |
| `src/bundler/analyze_transpiled_module.rs`                                       | 16           | 10               |
| `src/bundler/linker_context/prepareCssAstsForChunk.rs`                           | 15           | 12               |
| `src/bundler/HTMLScanner.rs`                                                     | 13           | 13               |
| `src/bundler/linker_context/scanImportsAndExports.rs`                            | 12           | 12               |
| `src/bundler/linker_context/generateCodeForFileInChunkJS.rs`                     | 12           | 10               |
| `src/bundler/LinkerGraph.rs`                                                     | 11           | 6                |

Tail (≤9 sites/file): 17 more files in `linker_context/` plus `linker.rs`,
`Chunk.rs`, `cache.rs`, `OutputFile.rs`, `lib.rs`, `barrel_imports.rs`, etc.

## High-signal site table (EXP-010 cluster + EXP-014 exploiters + Send/Sync surface)

| file:line                                                                  | site_kind        | bucket(s)                                       | safety_status                                | macro_status   | prior_id          | notes                                                                                              |
| -------------------------------------------------------------------------- | ---------------- | ----------------------------------------------- | -------------------------------------------- | -------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `src/bundler/Chunk.rs:130-132`                                             | TODO(ub-audit)   | aliasing-parallel-callback (B-1 anchor)         | in-tree TODO + acknowledgement comment       | source-direct  | prior B-1 cite    | **EXP-010 anchor B-1, UNCHANGED.** `Renamer<'r>` still borrows `&'r mut {Number,Minify}Renamer`; per-chunk renamer is reborrowed mutably from each part-range task. The TODO says the printer never writes through it, but current-source review must also account for `SymbolMap::follow()` path compression through `Cell` in the codegen path. |
| `src/bundler/Chunk.rs:133-134`                                             | unsafe_impl      | Send/Sync                                       | strong (32-line CONCURRENCY block above)     | source-direct  | S-prior           | `Chunk: Send + Sync` — sound only if every parallel use of the renamer/symbol map is genuinely store-free or internally synchronized. `Renamer`'s `&mut` alias is the visible bug; `SymbolMap::follow()`'s interior mutation is the easy-to-miss second proof obligation. |
| `src/bundler/Chunk.rs:147,152`                                             | UnsafeCell + unsafe_impl Sync | aliasing (per-slot interior mut)   | strong                                       | source-direct  | NEW since prior   | `CompileResultSlots(Box<[UnsafeCell<CompileResult>]>)` — disjoint-slot output buffer; replaces the prior `&mut [CompileResult]` alias hazard from B-3/B-4 *for the slot write* but leaves the surrounding `&mut Chunk` reborrow intact. |
| `src/bundler/LinkerContext.rs:1657-1663`                                   | unsafe_block     | aliasing-parallel-callback (B-2 anchor)         | weak (cites disjoint *chunk row*, ignores N-way `&mut LinkerContext`) | source-direct  | prior B-2 cite    | **EXP-010 anchor B-2, UNCHANGED.** `GenerateChunkCtx::c()` returns `&mut LinkerContext<'a>` from `self.c.assume_mut()`. Each `each_ptr` worker thread holds an aliased `&mut` to the same `LinkerContext` for the duration of the post-process call. |
| `src/bundler/LinkerContext.rs:239-240`                                     | unsafe_impl      | Send/Sync                                       | strong (8-line SAFETY)                       | source-direct  | S-000671/2 prior  | `LinkerContext: Send + Sync` — intentionally permits the B-2..B-5 aliasing; SAFETY comment justifies via "disjoint SoA slots", which only holds when callbacks follow the `*mut Self` template (do_step5 / rename_symbols_in_chunk). |
| `src/bundler/LinkerContext.rs:1379`                                        | unsafe_impl Send | Send                                            | strong                                       | source-direct  | S-prior           | `SourceMapDataTask: Send` — task moved to worker; sound.                                           |
| `src/bundler/linker_context/generateCompileResultForJSChunk.rs:61-62`      | unsafe_block     | aliasing-parallel-callback (B-3 anchor)         | weak (claims "scoped to impl call" — but peer tasks are inside their own impl call simultaneously) | source-direct  | prior B-3 cite    | **EXP-010 anchor B-3, UNCHANGED.** `let c_mut: &mut LinkerContext = unsafe { &mut *c_ptr };` and `let chunk_mut: &mut Chunk = unsafe { &mut *chunk_ptr };` materialize aliased `&mut` peers across worker threads. The body also calls `c.graph.symbols.follow(...)`; `follow()` mutates links through `Cell` unless prior `follow_all()` makes it store-free. |
| `src/bundler/linker_context/generateCompileResultForCssChunk.rs:45-46`     | unsafe_block     | aliasing-parallel-callback (B-4 anchor)         | weak (same template as B-3)                  | source-direct  | prior B-4 cite    | **EXP-010 anchor B-4, UNCHANGED.** Same shape as B-3 for CSS chunks.                               |
| `src/bundler/linker_context/prepareCssAstsForChunk.rs:76-80`               | unsafe_block     | aliasing-parallel-callback (B-5 anchor)         | mixed (chunk: ok, linker: still aliased)     | source-direct  | prior B-5 cite    | **EXP-010 anchor B-5, UNCHANGED.** `prepare_css_asts_for_chunk_impl(unsafe { &mut *linker }, unsafe { &mut *chunk }, …)` — the `&mut *chunk` is per-task disjoint (one task per CSS chunk), but `&mut *linker` aliases across CSS chunks. |
| `src/bundler/linker_context/prepareCssAstsForChunk.rs:41`                  | unsafe_impl Send | Send                                            | ok                                           | source-direct  | S-prior           | `PrepareCssAstTask: Send`.                                                                         |
| `src/bundler/linker_context/renameSymbolsInChunk.rs:43`                    | unsafe_fn (correct template) | aliasing (B-10 row-overlap)         | strong (29-line CONCURRENCY+Safety block)    | source-direct  | prior B-10 cite   | **B-10 follow-on, UNCHANGED.** Uses *correct* template: `*mut LinkerContext` raw + `&LinkerContext` reads + `split_raw()` for column writes. Row-overlap on `ast.module_scope[i]` / `ast.parts[i]` under code-splitting still benign-but-aliased. |
| `src/bundler/linker_context/renameSymbolsInChunk.rs:56,64,73-74`           | unsafe_block     | aliasing, ptr_intrinsic                         | strong                                       | source-direct  | prior cite        | The reference template the B-2..B-5 fixes should follow.                                           |
| `src/bundler/linker_context/doStep5.rs:43-58`                              | unsafe_fn (correct template) | aliasing                            | strong (24-line `# Safety` + CONCURRENCY)    | source-direct  | prior cite        | **The Pass-3-recommended template.** `do_step5(this: *mut LinkerContext, source_index_, _)` derefs to `&LinkerContext` only and writes per-row through `split_raw()` raw column pointers. |
| `src/bundler/linker_context/generateChunksInParallel.rs:84-86`             | each_ptr dispatch | parallel-fan-out                               | n/a (safe call) — but feeds B-2 / B-1        | source-direct  | n/a               | `c.worker_pool().each_ptr(ctx, LinkerContext::generate_js_renamer, chunks)` — fans renamer task per chunk. The claimed read-only discipline must include both `Renamer<'r>` and any symbol-following calls reached by the printer/codegen path. |
| `src/bundler/linker_context/generateChunksInParallel.rs:118-134`           | task-build loop  | parallel-fan-out                               | n/a                                          | source-direct  | n/a               | One `PrepareCssAstTask` per CSS chunk — guarantees the per-task `&mut *chunk` in B-5 is unique (the *linker* reborrow is the live UB). |
| `src/bundler/linker_context/generateChunksInParallel.rs:330`               | each_ptr dispatch | parallel-fan-out                               | n/a — feeds B-2                              | source-direct  | n/a               | `c.worker_pool().each_ptr(chunk_contexts[0], LinkerContext::generate_chunk, chunks_to_do)` — the B-2 entrypoint. |
| `src/bundler/LinkerContext.rs:1023-1036`                                   | each_ptr callback | aliasing-parallel-callback                     | weak (one-line)                              | source-direct  | n/a               | `generate_chunk(ctx: &GenerateChunkCtx, chunk: *mut Chunk, chunk_index: usize)` — body invokes `ctx.c()` (the B-2 alias). |
| `src/bundler/LinkerContext.rs:1052-…`                                      | each_ptr callback | aliasing-parallel-callback                     | weak                                         | source-direct  | n/a               | `generate_js_renamer(ctx, chunk: *mut Chunk, _)` — the B-1 entrypoint per chunk; calls into `rename_symbols_in_chunk` (correct template) but holds `Renamer<'r>` alias outside it. |
| `src/bundler/LinkerContext.rs:1611-1647`                                   | docstring + raw-ptr fields of `GenerateChunkCtx` | aliasing                  | strong (PORT NOTE rationalises raw ptrs)     | source-direct  | n/a               | `GenerateChunkCtx` raw-ptr fields exist precisely because `each_ptr` requires `Ctx: Sync + Copy`. The aliasing leaks out via `c()` (B-2). |
| `src/bundler/LinkerGraph.rs:96-97`                                         | unsafe_impl      | Send/Sync                                       | strong                                       | source-direct  | S-prior           | `LinkerGraph: Send + Sync`.                                                                        |
| `src/bundler/LinkerGraph.rs:502,513,535,631,668`                           | safe `.slice()` calls | EXP-014 exploiter (`Slice<T>: Copy`)       | n/a (the unsafety lives in `multi_array_list` Section O) | source-direct  | n/a (EXP-014)     | **EXP-014 anchor: `LinkerGraph::load` exploiter.** Five `.slice()` snapshots taken; `files_slice.split_mut()` (line 514) and `ep_slice.split_mut()` (line 536) hand out aliasing-prone column refs from a `Copy` `Slice`. Sound *here* because each snapshot's `split_mut()` is consumed before another snapshot is taken; the documented soundness gap is what allows it to compile. |
| `src/bundler/bundle_v2.rs:1997-1999, 2062-2063, 2170-2172, 5270-5283`      | safe `.slice()` + `split_mut/raw` | EXP-014 exploiter (`Slice<T>: Copy`)   | strong (PORT NOTE re value-type Slice)       | source-direct  | n/a (EXP-014)     | **EXP-014 anchor: `bundle_v2` exploiter.** Each call site takes `let mut slice = self.graph.X.slice(); let cols = slice.split_mut(); …`. The pattern is single-threaded (find_reachable_files / scanImportsAndExports rebuild) so no two `Slice` copies are *simultaneously* live with overlapping column refs — the soundness gap is unweaponized but exists. |
| `src/bundler/bundle_v2.rs:5279-5291`                                       | unsafe_block     | aliasing, ptr_intrinsic                         | strong (15-line PORT NOTE)                   | source-direct  | S-prior           | `split_raw()` + per-index `&mut *col.add(index)` — root-provenance template applied inside the EXP-014 site to avoid the `Slice<T>: Copy` overlap. |
| `src/bundler/bundle_v2.rs:1543-1544`                                       | unsafe_impl      | Send/Sync                                       | strong (cross-thread call note)              | source-direct  | S-prior           | `CompletionHandle: Send + Sync` — vtable across the JS-loop boundary.                              |
| `src/bundler/bundle_v2.rs:1594-1604`                                       | unsafe_fn        | lifetime-laundering                             | weak ("upheld by caller per fn contract.")   | source-direct  | S-000398-400      | `interned_slice` / `into_static` — `bun_ptr::detach_lifetime`. SAFETY comment is the absolute minimum; caller contract isn't restated.|
| `src/bundler/bundle_v2.rs:1216-1391`                                       | unsafe_block ×7  | raw_method_call (callback path)                 | mixed                                        | source-direct  | S-000386-393      | Plugin-callback dispatch into `BundleV2`: `(*self.bv2).enqueue_on_js_loop_for_plugins(…)` and `unsafe { &mut *self.bv2 }`. Cross-thread `&mut BundleV2` reborrow from a JS-side trampoline — same shape class as B-2 but on the bundler's own root. |
| `src/bundler/bundle_v2.rs:1684`                                            | unsafe_block     | aliasing                                        | weak                                         | source-direct  | S-000402          | `unsafe { Transpiler::for_worker(this_transpiler, arena, this_transpiler.log) }` — worker materialises a `Transpiler` re-borrow per worker thread. Documented elsewhere. |
| `src/bundler/bundle_v2.rs:7596-7604`                                       | unsafe extern "C" fn | FFI callback                                | strong                                       | source-direct  | S-prior           | External-free callback FFI signature.                                                              |
| `src/bundler/bundle_v2.rs:793, 1472, 1486`                                 | unsafe extern    | FFI                                             | ok                                           | source-direct  | n/a               | Three FFI declaration blocks: HMR enable thunk, JS-loop bridges.                                   |
| `src/bundler/lib.rs:341-342`                                               | unsafe_impl      | Send/Sync                                       | strong                                       | source-direct  | S-prior           | `DevServerHandle: Send + Sync`.                                                                    |
| `src/bundler/linker.rs:106-107`                                            | unsafe_impl      | Send/Sync                                       | strong                                       | source-direct  | S-prior           | `ImportPathsListPtr: Send + Sync`.                                                                 |
| `src/bundler/ThreadPool.rs:77-78`                                          | unsafe_impl      | Send/Sync                                       | strong                                       | source-direct  | S-prior           | `ThreadPool: Send + Sync`.                                                                         |
| `src/bundler/ThreadPool.rs:595-622`                                        | unsafe_fn        | refcount-lifecycle (Worker::deinit)             | strong                                       | source-direct  | S-prior           | `Worker::deinit(this: *mut Worker)` — destroys arena, ManuallyDrop bracket, then `heap::destroy`.  |
| `src/bundler/ThreadPool.rs:686, 727, 742`                                  | unsafe_block ×3  | lifetime-laundering                             | mixed                                        | source-direct  | S-prior           | `bun_ptr::detach_lifetime_ref(self.arena.get())` and `Transpiler::<'static>::for_worker` — strips per-worker arena lifetime so a `Transpiler<'static>` can be returned to safe code. |
| `src/bundler/BundleThread.rs:155-188, 207-278`                             | unsafe_fn ×3     | refcount-lifecycle, raw_method_call             | strong                                       | source-direct  | S-prior           | `BundleThread::{spawn,enqueue,thread_main}` — instance-pointer lifecycle for the bundle thread. `unsafe impl<T> Send for SendPtr<T>` declared inline. |
| `src/bundler/BundleThread.rs:389-390`                                      | unsafe_impl      | Send/Sync                                       | strong (UnboundedQueue/ResetEvent rationale) | source-direct  | S-prior           | `Instance: Send + Sync` for the bundler thread proxy.                                              |
| `src/bundler/analyze_transpiled_module.rs:46-47`                           | unsafe_impl      | bytemuck Pod/Zeroable                           | ok                                           | source-direct  | S-000357/8        | `RecordKind: bytemuck::Pod + Zeroable`.                                                            |
| `src/bundler/analyze_transpiled_module.rs:218-220, 399-407, 449, 458`      | unsafe_fn        | refcount-lifecycle, allocator                   | strong                                       | source-direct  | S-000359-368      | `ModuleInfoDeserialized::deinit`, `free_aligned_dup`, `destroy_raw` — explicit allocator pairing.  |
| `src/bundler/analyze_transpiled_module.rs:511, 517, 524`                   | `#[unsafe(no_mangle)]` extern fns | FFI                            | ok                                           | source-direct  | S-prior           | C ABI surface for the analyzer.                                                                    |
| `src/bundler/AstBuilder.rs:138, 266, 338, 449, 588`                        | unsafe_block ×6  | zig_port_ref, MaybeUninit, ptr_intrinsic        | weak (one-line)                              | source-direct  | S-000373-377      | Zig-port artefacts: `&mut *self.current_scope`, `e.assume_init()`, `&*module_scope`, `ptr::read(&raw const st.value)`. |
| `src/bundler/HTMLScanner.rs:×13`                                           | unsafe_block     | mixed                                           | mostly strong (13 SAFETY comments)           | source-direct  | S-prior           | HTML rewrite scanner — small surface, well-commented.                                              |
| `src/bundler/transpiler.rs:×25`                                            | unsafe_block + unsafe_fn | mixed                                   | strong (27 SAFETY comments)                  | source-direct  | S-prior           | Transpiler glue (single-threaded worker setup).                                                    |
| `src/bundler/ParseTask.rs:×58`                                             | unsafe_block + unsafe_fn | mixed                                   | strong (54 SAFETY comments)                  | source-direct  | S-prior           | Largest secondary surface; per-task scheduling, log handoff, plugin path.                          |
| `src/bundler/cache.rs:1`                                                   | unsafe_block     | other                                           | n/a                                          | source-direct  | n/a               | One-off cast.                                                                                      |
| `src/bundler/OutputFile.rs:1`                                              | unsafe_block     | other                                           | n/a                                          | source-direct  | n/a               | One-off cast.                                                                                      |
| `src/bundler_jsc/analyze_jsc.rs:17`                                        | `#[unsafe(no_mangle)]` | FFI surface                              | n/a                                          | source-direct  | n/a               | C ABI entry to the JSC analyzer.                                                                   |
| `src/bundler_jsc/analyze_jsc.rs:188, 210, 245`                             | unsafe extern "C" | FFI                                            | n/a                                          | source-direct  | n/a               | `JSC__VariableEnvironment__add`, `IdentifierArray::*`, `JSC_JSModuleRecord::*` declarations.       |
| `src/bundler_jsc/analyze_jsc.rs:225-237, 353-552`                          | unsafe_fn ×many  | FFI                                             | weak (zero `// SAFETY:` comments inside the impl bodies) | source-direct  | n/a               | The JSC bridge crate has 26 unsafe sites and only **7** SAFETY comments — the lowest density in Section M; nearly every body is a thin FFI thunk into `JSC_*`. |
| `src/standalone_graph/StandaloneModuleGraph.rs:84, 189-190`                | unsafe_impl      | Send/Sync                                       | strong                                       | source-direct  | S-prior           | `Instance: Sync`, `StandaloneModuleGraph: Send + Sync`.                                            |
| `src/standalone_graph/StandaloneModuleGraph.rs:277, 330`                   | unsafe extern "C" | FFI                                            | ok                                           | source-direct  | S-prior           | `Bun__getStandaloneModuleGraphMachoLength/PELength/ELFVaddr/Data` — exe-format readers.            |
| `src/standalone_graph/StandaloneModuleGraph.rs:287-345`                    | unsafe_block ×7  | validity-bytes, ptr_intrinsic                   | strong                                       | source-direct  | S-prior           | `read_unaligned` from the embedded module graph in Mach-O / PE / ELF sections; bytes are bun-emitted, but a tampered binary would feed adversarial input here. |
| `src/standalone_graph/StandaloneModuleGraph.rs:472-639`                    | unsafe_block ×many | validity-bytes, slice_from_raw                | strong                                       | source-direct  | S-prior           | `slice_to`/`slice_to_z`/`slice_to_mut` over the raw bytes; bound-checked.                          |
| `src/standalone_graph/StandaloneModuleGraph.rs:655-677`                    | unsafe_fn        | slice_from_raw                                  | strong                                       | source-direct  | S-prior           | The three `slice_to*` primitives — every byte read goes through these.                             |

The remaining ~430 sites are mostly: `bun_core::heap::take/destroy/into_raw`,
`bun_ptr::detach_lifetime{,_ref}` lifetime laundering (Zig-port artefacts),
small `&mut *raw` reborrows in single-threaded helpers, and FFI thunks. Phase
2 will normalise and re-id; the table above captures every site whose
soundness depends on the parallel-build invariant or on the EXP-014 `Slice<T>:
Copy` documented gap.

## Anchor cross-refs

* **EXP-010 (parallel-callback aliasing 5-site cluster)** — verdict: STILL
  APPLIES, now with a Tree-Borrows model witness for the aliased-`&mut` shape
  (`experiments/EXP-010`; raw log
  `phase5_experiment_results/EXP-010-tree-borrows-model.log`). This is not a
  full integrated `bun build` trace, but it confirms the exact Rust aliasing
  rule being violated. Do not simplify the remediation to "change `&mut` to
  `&`": `SymbolMap::follow()` mutates links through `Cell`
  (`src/ast/symbol.rs:706-727`), so the parallel codegen path also needs either
  a proof that `follow_all()` made every later `follow()` store-free or a
  no-compress/read-only follow variant.
* **EXP-014 (`multi_array_list::Slice<T>: Copy` documented gap)** — verdict:
  EXPLOITED but currently single-threaded. The prior-named exploiters
  (`LinkerGraph::load`, `bundle_v2`) are present at `LinkerGraph.rs:502-535`
  and `bundle_v2.rs:{1997, 2062, 2170, 5270}`. None weaponise the gap (no two
  copies' `split_mut()` results are simultaneously live), but the type still
  permits it.
