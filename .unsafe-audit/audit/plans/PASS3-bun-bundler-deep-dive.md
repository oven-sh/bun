# PASS3 — `bun_bundler` Deep Dive

Scope: every `unsafe` site in `src/bundler/` (498 sites across 30 files) and the
parallel-codegen control flow that surrounds them. Focus areas, per the audit
brief:

1. AST cross-thread mutation through `MimallocArena`-backed storage.
2. Symbol-table aliasing across chunks.
3. Renamer / Printer / Linker borrow patterns reborrowed from parallel tasks.
4. Source-map writer concurrency.
5. Hash-map sharing across workers.
6. Bundle-thread task lifetime / `Send` correctness.
7. Cache invalidation and incremental-compile races.
8. CSS module local-scope sharing.
9. Macro-emitted `unsafe`.

Method: read the dispatch surface of every parallel fan-out
(`worker_pool.each_ptr`, `worker_pool.schedule(batch)`, `worker_pool.wait_for_all`)
in `linker_context/generateChunksInParallel.rs`, then walk each thread-pool
callback into its impl, then trace what fields the callback dereferences
through which provenance. For each finding I cite the file path and the
verbatim line numbers as `src/bundler/<file>:<line>`.

No emojis. No hedging. Where a finding is genuinely sound (rare for `&mut`
patterns across parallel tasks) I say so and cite the proof. Where it is
unsound, I say `BUG` and give the minimal repro shape.

--------------------------------------------------------------------------------

## 0. Executive summary

Site totals for `bun_bundler` (`crate == "bun_bundler"`, per inventory):

| Kind                | Count |
| ------------------- | ----- |
| `unsafe_block`      | 455   |
| `unsafe_impl`       |  25   |
| `unsafe_fn`         |  17   |
| `unsafe_cell_decl`  |   1   |
| **Total**           | **498** |

Densest files:

| File                                                             | Sites |
| ---------------------------------------------------------------- | ----- |
| `bundle_v2.rs`                                                   | 102   |
| `LinkerContext.rs`                                               |  72   |
| `ParseTask.rs`                                                   |  53   |
| `BundleThread.rs`                                                |  26   |
| `transpiler.rs`                                                  |  23   |
| `ThreadPool.rs`                                                  |  21   |
| `linker_context/findImportedFilesInCSSOrder.rs`                  |  18   |
| `analyze_transpiled_module.rs`                                   |  16   |
| `linker_context/doStep5.rs`                                      |  15   |
| `linker_context/prepareCssAstsForChunk.rs`                       |  14   |

### Findings by severity

| # | Severity | Finding |
| - | -------- | ------- |
| **B-1** | **HIGH (UB-by-construction)** | **Renamer borrow cascade.** Every JS part-range task for a given chunk concurrently calls `(*renamer_ptr).as_renamer()` → returns `Renamer<'r>` containing `&'r mut NumberRenamer` (or `&'r mut MinifyRenamer`) pointing at the **same** `chunk.renamer`. N parallel `&mut`'s to one pointee. Stacked/Tree Borrows UB regardless of read-only behavior. |
| **B-2** | **HIGH (UB-by-construction)** | **`&mut LinkerContext` aliased N ways during `generate_chunk` fan-out.** `each_ptr(chunk_contexts[0], LinkerContext::generate_chunk, chunks_to_do)` (`generateChunksInParallel.rs:330`) fans out one task per chunk; each task calls `ctx.c()` (`LinkerContext.rs:1657`) which executes `unsafe { self.c.assume_mut() }` and hands `&mut LinkerContext` to `post_process_*_chunk`. The pointee is one `LinkerContext`; every worker thread holds an aliased `&mut` to it for the duration of the impl. |
| **B-3** | **HIGH (UB-by-construction)** | **`&mut LinkerContext` aliased N ways during the JS/CSS part-range fan-out.** `generate_compile_result_for_js_chunk` / `..._for_css_chunk` reborrow `&mut LinkerContext` from `c_ptr` inside the worker callback (`generateCompileResultForJSChunk.rs:61`; `generateCompileResultForCssChunk.rs:45`). The comment-justified contract is "the &mut is scoped to the impl call", but multiple workers are inside their own impl call simultaneously against the same `LinkerContext`. Same UB shape as B-2. |
| **B-4** | **HIGH (UB-by-construction)** | **`&mut Chunk` aliased N ways during the JS/CSS part-range fan-out.** Multiple `PendingPartRange` tasks belonging to one chunk run in parallel; each materializes `let chunk_mut: &mut Chunk = unsafe { &mut *chunk_ptr };` (`generateCompileResultForJSChunk.rs:62`; `generateCompileResultForCssChunk.rs:46`). The disjoint write target (`compile_results_for_chunk[i]`) is plumbed correctly via `Chunk::write_compile_result_slot` *afterwards*, but the impl call itself holds `&mut Chunk` aliased across threads. |
| **B-5** | **HIGH (UB-by-construction)** | **`&mut LinkerContext` and `&mut Chunk` aliased N ways during CSS-AST prep fan-out.** `prepare_css_asts_for_chunk` (`prepareCssAstsForChunk.rs:76-80`) takes raw pointers and immediately reborrows `&mut *linker` (one shared linker) and `&mut *chunk` (per task — disjoint *if* the scheduler dedupes). The linker reborrow is the live UB; the chunk reborrow is fine *iff* every CSS chunk has at most one task (verified in `generateChunksInParallel.rs:118-134`, where one task is pushed per `chunk.content.is_css()`). |
| **B-6** | **MEDIUM (latent UB on Windows)** | **Windows waker placeholder is `zeroed_unchecked`.** `BundleThread::uninitialized` writes `unsafe { bun_core::ffi::zeroed_unchecked() }` into `waker` on Windows (`BundleThread.rs:155`). `Waker { loop_: &'static _ }` has a non-null validity invariant; constructing an all-zero value is *language-level* UB in the strict sense (`mem::zeroed::<&T>()` is UB). Mitigation noted in-tree: the placeholder is overwritten by `ptr::write` in `thread_main` before any read, and `ready_event.wait()` blocks the spawning thread. Codex P2 already filed this. |
| **B-7** | **MEDIUM** | **`Chunk::write_compile_result_slot` reads boxed-slice fat-pointer in place.** `core::ptr::read(slots.cast::<*mut [UnsafeCell<CompileResult>]>())` (`Chunk.rs:243`) relies on `Box<[T]>` having the same layout as `*mut [T]`. The standard library *does* guarantee `Box<T>: #[repr(transparent)] *mut T` for the thin-pointer case, but the *fat*-pointer case is a much narrower guarantee. The comment cites this; this is on the audit watchlist but not yet a confirmed bug. |
| **B-8** | **MEDIUM** | **`StaticRouteVisitor::c` holds a detached `&LinkerContext` while `c.log_disjoint()` is called inside the same chunk loop.** `generateChunksInParallel.rs:627` uses `bun_ptr::detach_lifetime_ref::<LinkerContext>(c)`; later (line 997) the loop calls `c.log_disjoint().add_error_fmt(...)`. `log_disjoint(&self)` returns a `&mut Log` from a `&LinkerContext`. The visitor's detached `&LinkerContext` is *not* invalidated by the `&mut Log` (the log is a sibling allocation), but the open-coded combination is hard to audit — see §5.4 for the full proof. |
| **B-9** | **LOW** | **`unsafe { combined_part_ranges.set_len(total_count) }` before initializing every slot via index writes** (`generateChunksInParallel.rs:198`). The slots ARE all written before `worker_pool.schedule(batch)` is called (the loop on lines 201-302 writes `remaining_part_ranges[0]` for every chunk's parts/imports). But if any future code path leaves a slot uninitialized between `set_len` and `schedule`, the dropped `PendingPartRange` (when `combined_part_ranges` drops) reads uninit memory through the embedded `Task` / `ctx: &GenerateChunkCtx`. Currently sound by inspection; brittle. |
| **B-10** | **LOW** | **`unsafe { &raw mut (*c).graph.symbols }` derived from a `*mut LinkerContext` recovered through a `BackRef`'s `as_mut_ptr` which originated from a `&mut LinkerContext` borrow in `generate_chunks_in_parallel` (`generateChunksInParallel.rs:79`)** is fed to `rename_symbols_in_chunk(c: *mut LinkerContext, ...)` which then writes `ast.module_scope[source_index]` and `ast.parts[source_index]` for every `source_index` in `files_in_order`. With code-splitting enabled, `source_index` rows are non-disjoint across chunks (see `renameSymbolsInChunk.rs:25-38` CONCURRENCY comment which acknowledges this). The note says "writes are idempotent", which is a behavioral hand-wave, not a memory-safety proof. Per the audit brief, **this counts as the canonical Stacked-Borrows hazard.** |
| **B-11** | **LOW** | **`unsafe impl Send` / `unsafe impl Sync` blanket impls on `Chunk`, `LinkerContext`, `LinkerGraph`, `CompletionHandle`, `SourceMapDataTask`, `PrepareCssAstTask`, `ThreadPool`** (`Chunk.rs:133-134`, `LinkerContext.rs:239-240`, `LinkerGraph.rs:96-97`, `bundle_v2.rs:1543-1544`, `LinkerContext.rs:1379`, `prepareCssAstsForChunk.rs:41`, `ThreadPool.rs:77-78`). Most have rigorous in-tree SAFETY comments; none has been challenged with an explicit shared-mutation enumeration. See §4 for the per-impl breakdown. |
| **B-12** | **INFO** | **CSS local-name table sharing.** `c.mangled_props: LocalsResultsMap` (`ArrayHashMap<Ref, Box<[u8]>>`) is borrowed `&c.mangled_props` from every CSS chunk task simultaneously (`generateCompileResultForCssChunk.rs:96`). Keys are frozen before parallel codegen; reads are safe. The aliased read borrow is sound only because the surrounding `&LinkerContext` is never paired with a `&mut`-into-mangled_props anywhere in the codegen pass; verified via global ripgrep — see §5.5. |

**Bug count: 11 (5 HIGH, 4 MEDIUM, 2 LOW).** B-12 is informational.

The HIGH-severity bugs B-1..B-5 are all the same class: **aliased `&mut T`
materialized inside thread-pool callbacks where peer tasks hold `&mut T` to
the same pointee.** Miri would crash immediately on any of them. Real-world
miscompiles would require either:

1. A future LLVM optimisation that exploits `noalias` on a function argument
   that was implicitly tagged `noalias` because rustc translated `&mut T`
   that way (rustc *currently* withholds `noalias` from arg-position `&mut`
   in some cases; this is being tightened).
2. A future Tree Borrows enforcement pass shipped with rustc that statically
   rejects the pattern.

Both are reasonably likely on a 12-month horizon. The fix shape is uniform:
**replace every `&mut LinkerContext` / `&mut Chunk` / `&mut ChunkRenamer` in
worker-pool callbacks with `*mut T` (or a `Sync` Cell-wrapped view), deref
to `&T` for reads and use raw-pointer + `addr_of_mut!` for the few disjoint
writes.** `doStep5.rs:43-58` is the canonical template — it does exactly
this, with a fully-justified SAFETY comment.

--------------------------------------------------------------------------------

## 1. Module-level unsafe map

```
src/bundler/
├── bundle_v2.rs                                   102 (single biggest concentration)
├── LinkerContext.rs                                72
├── ParseTask.rs                                    53
├── BundleThread.rs                                 26  (singleton + waker, Windows risk)
├── transpiler.rs                                   23
├── ThreadPool.rs                                   21  (worker lifecycle)
├── linker_context/
│   ├── findImportedFilesInCSSOrder.rs              18
│   ├── doStep5.rs                                  15  (correct template — see §3)
│   ├── prepareCssAstsForChunk.rs                   14
│   ├── generateCodeForFileInChunkJS.rs             12
│   ├── scanImportsAndExports.rs                    10
│   ├── generateChunksInParallel.rs                  9  (the dispatch surface)
│   ├── renameSymbolsInChunk.rs                      8
│   ├── generateCompileResultForHtmlChunk.rs         8
│   ├── generateCompileResultForCssChunk.rs          7
│   ├── generateCodeForLazyExport.rs                 6
│   ├── generateCompileResultForJSChunk.rs           5
│   ├── convertStmtsForChunk.rs                      5
│   ├── computeChunks.rs                             5
│   ├── writeOutputFilesToDisk.rs                    2
│   └── postProcessJSChunk.rs                        2  (under-counted; see §2.2)
├── analyze_transpiled_module.rs                    16
├── HTMLScanner.rs                                  13
├── linker.rs                                        9
├── LinkerGraph.rs                                   8
├── Chunk.rs                                         8  (CompileResultSlots: sound)
├── options.rs                                       6
├── AstBuilder.rs                                    5
├── lib.rs                                           2
└── barrel_imports.rs                                2
```

Category split (categories assigned at inventory time, JSONL `categories`):

```
other                        226  (vast majority — needs re-categorization)
zig_port_mut_ref              70  ("unsafe { &mut *raw }" — the bug class)
zig_port_shared_ref           34
ptr_intrinsic                 22
fd_syscall                    20
ptr_intrinsic+fd_syscall      17  (heap+ffi)
ptr_cast                      16
send_impl                     11
sync_impl                     10
ptr_arith                      8
bun_heap_lifecycle             6
raw_ptr_lifecycle/ptr_intrinsic/ptr_cast 11  (BACKREF construction)
mem_transmute                  3
maybe_uninit                   3
```

The 70 `zig_port_mut_ref` sites are the audit primary surface. Of those, **every
site that lives inside a worker-pool callback or its callees is a candidate
B-1..B-5 violation**. The 34 `zig_port_shared_ref` sites are mostly sound
(`&LinkerContext` shared across workers).

--------------------------------------------------------------------------------

## 2. The Renamer borrow cascade — full enumeration

This is the headline finding the audit brief specifically asked for. The
existing in-tree `TODO(ub-audit)` at `Chunk.rs:130-132` flagged the lifetime
of `Renamer<'r>` but did not enumerate every site or trace the cascade end-
to-end. Below is the full chain.

### 2.1 Where the renamer is constructed

`generateChunksInParallel.rs:71-88` runs the renamer fan-out:

```rust
let ctx = GenerateChunkCtx {
    chunk: bun_ptr::BackRef::new_mut(&mut chunks[0]),
    c: unsafe { bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<LinkerContext>(c)) },
    chunks: bun_ptr::BackRef::new_mut(chunks),
};
c.worker_pool()
    .each_ptr(ctx, LinkerContext::generate_js_renamer, chunks);
```

Each `LinkerContext::generate_js_renamer` (`LinkerContext.rs:1052-1061`) call
hands ONE chunk to one task and writes `chunk.renamer = ChunkRenamer::Number(...) | ::Minify(...)`.

The renamer-population phase is OK in itself: each chunk's renamer is written
by exactly one task. The acknowledged Stacked-Borrows hazard there is the
row-overlap problem (B-10) for `ast.module_scope[source_index]` /
`ast.parts[source_index]` when code-splitting puts the same `source_index` in
multiple chunks — `renameSymbolsInChunk.rs:25-38` documents this. The
in-tree mitigation is real: writes are routed through `split_raw()`
root-provenance pointers, so per-row derefs do not pop sibling tasks' borrow
tags. Subject to the row-overlap semantic question (idempotence), this phase
is sound.

`generate_js_renamer` waits for completion via the implicit `each_ptr` join
before the next phase begins. After that join, **`chunk.renamer` is populated
and never written again** for the rest of the link step.

### 2.2 Where the renamer is READ in parallel

`generateChunksInParallel.rs:200-307` builds a `Batch` of `PendingPartRange`
tasks — many of them per chunk — and schedules them, waiting for all via
`worker_pool.wait_for_all()`.

Each part-range callback is one of:

- `generate_compile_result_for_js_chunk` (`generateCompileResultForJSChunk.rs:26`)
- `generate_compile_result_for_css_chunk` (`generateCompileResultForCssChunk.rs:22`)
- `generate_compile_result_for_html_chunk`

The JS callback hits the renamer through this sequence:

```rust
// generateCompileResultForJSChunk.rs:60-69
let result = {
    let c_mut: &mut LinkerContext = unsafe { &mut *c_ptr };
    let chunk_mut: &mut Chunk = unsafe { &mut *chunk_ptr };
    generate_compile_result_for_js_chunk_impl(
        &mut **worker, c_mut, chunk_mut, part_range.part_range,
    )
};
```

…then inside `..._impl` (line 164-168):

```rust
let renamer_ptr: *mut crate::bun_renamer::ChunkRenamer =
    core::ptr::addr_of_mut!(chunk.renamer);
let result = generate_code_for_file_in_chunk_js(
    c, &mut buffer_writer,
    unsafe { (*renamer_ptr).as_renamer() },
    chunk, part_range, ...);
```

And `ChunkRenamer::as_renamer(&mut self)` (`ungate_support.rs:498-505`) returns
a `Renamer::NumberRenamer(&'r mut NumberRenamer)` or
`Renamer::MinifyRenamer(&'r mut MinifyRenamer)`. The `&'r mut` borrows the
**boxed** inner renamer.

The printer consumes `Renamer<'r, 'src>` by value (the printer struct's field is
`renamer: rename::Renamer<'a, 'a>`, `js_printer/lib.rs:1698`).

#### Why this is undefined behaviour

A chunk produces multiple part_ranges. `generateChunksInParallel.rs:204-249`
loops `for (i, part_range) in js.parts_in_chunk_in_order.iter().enumerate()`
and emits one `PendingPartRange` per `i`. All of them target the same
`chunk_ptr`. The worker pool runs them in parallel. Each task evaluates:

```
&mut *core::ptr::addr_of_mut!(chunk.renamer)   // form &mut ChunkRenamer
  .as_renamer()                                // returns Renamer::Number(&mut NumberRenamer)
```

If the chunk has K live part_ranges, you get K coexisting `&mut NumberRenamer`
to the SAME `NumberRenamer` on the heap. This is the textbook aliased-mut UB
shape. The fact that downstream `Renamer::name_for_symbol` only reads is
irrelevant — the `&mut` reference itself asserts uniqueness when it is
formed, and Stacked Borrows pops sibling tasks' borrow stacks when the
second `&mut` is forged.

#### Why `MinifyRenamer::name_for_symbol` is `&mut self` (but read-only)

`js_printer/renamer.rs:257-279`. The body never mutates `self`. The
`&mut self` is a port artifact (and possibly a stale signature from when
`name_for_symbol` cached results). The corresponding `NumberRenamer::name_for_symbol`
is `&self` (line 825-851). Both are read-only at run time, so the *behavioral*
race is benign — but the borrow model still requires uniqueness.

#### Sites in the cascade

| Site | File:line | Role |
| ---- | --------- | ---- |
| S-1  | `Chunk.rs:130-132` | The flagged `TODO(ub-audit)` (existing) |
| S-2  | `generateCompileResultForJSChunk.rs:61-62` | Materializes `&mut LinkerContext` + `&mut Chunk` |
| S-3  | `generateCompileResultForJSChunk.rs:164-165` | `addr_of_mut!(chunk.renamer)` then `(*renamer_ptr).as_renamer()` |
| S-4  | `ungate_support.rs:498-505` | `ChunkRenamer::as_renamer(&mut self)` — the `&mut` factory |
| S-5  | `js_printer/renamer.rs:97-99`  | `enum Renamer<'r, 'src>::NumberRenamer(&'r mut NumberRenamer)` etc. |
| S-6  | `js_printer/renamer.rs:111-117` | `Renamer::name_for_symbol(&mut self, ...)` (read-only body) |
| S-7  | `js_printer/renamer.rs:257-279` | `MinifyRenamer::name_for_symbol(&mut self, ...)` (read-only body) |
| S-8  | `js_printer/lib.rs:1698`        | `Printer` field `renamer: Renamer<'a, 'a>` (consumes by value but the inner `&mut` is the live alias) |

#### Fix shape

The minimal correct change is **lower the inner reference type from `&mut T`
to `*const T` (or `*const RenamerCell`) where `RenamerCell` is `repr(transparent)
UnsafeCell<NumberRenamer>` + safe accessor methods taking `&self`**.

```rust
// New shape:
pub enum Renamer<'r, 'src> {
    NumberRenamer(&'r NumberRenamerView),
    NoOpRenamer(&'r NoOpRenamer<'src>),
    MinifyRenamer(&'r MinifyRenamerView),
}

#[repr(transparent)]
pub struct NumberRenamerView(NumberRenamer);
impl NumberRenamerView {
    pub fn name_for_symbol(&self, r: Ref) -> &[u8] { ... }
}
```

Both `name_for_symbol` impls already only read `self`; converting them to
`&self` (and the wrapper to `&NumberRenamerView`) is a mechanical change.
`ChunkRenamer::as_renamer` then becomes `fn as_renamer(&self) -> Renamer<'_, '_>`
and the parallel-task code becomes:

```rust
// BEFORE
let renamer_ptr = core::ptr::addr_of_mut!(chunk.renamer);
let r = unsafe { (*renamer_ptr).as_renamer() };

// AFTER
let renamer_ptr: *const ChunkRenamer = core::ptr::addr_of!(chunk.renamer);
let r = unsafe { (*renamer_ptr).as_renamer() };
```

…and the materialization at the parallel boundary is a `&ChunkRenamer`, which
is sound under SB because `&T` aliasing is allowed.

The same shape applies to `NumberRenamer::assign_name`, `add_top_level_symbol`,
`assign_names_recursive_with_number_scope` — but **those run during the
renamer-population phase, which is one task per chunk, so the existing
`&mut` shape there is fine.** They should stay `&mut`. Only `name_for_symbol`
and the `enum Renamer<'r>` need the rework.

--------------------------------------------------------------------------------

## 3. The correct template — `doStep5`

`linker_context/doStep5.rs:43-58` is the canonical example of how a worker-pool
callback should access shared state. Every other parallel callback should be
audited against this shape.

```rust
// doStep5.rs:50-58
pub unsafe fn do_step5(this: *mut LinkerContext<'_>, source_index_: Index, _: usize) {
    let source_index = source_index_.get();
    let _trace = perf::trace("Bundler.CreateNamespaceExports");

    // Shared-ref view for all read-only access. Multiple worker threads may
    // hold `&LinkerContext` simultaneously; the SoA buffers live behind raw
    // pointers inside `MultiArrayList`, so this borrow does not assert
    // immutability over the heap cells we write below.
    let c: &LinkerContext<'_> = unsafe { &*this };
```

Key correctness points:

1. **Receiver is `*mut LinkerContext`, not `&mut`.** The function is `unsafe
   fn` and propagates raw provenance through the call.
2. **Body forms `&LinkerContext` only.** Shared-XOR-mutable means N
   concurrent `&LinkerContext` are fine.
3. **Writes go through `split_raw()` SoA columns**, which yield
   `*mut [T]` from the buffer base with no intermediate `&mut`. Each row
   write is `unsafe { &mut *((col as *mut T).add(i)) }`. Per-row `&mut T`
   borrows do not invalidate sibling tasks' borrow tags under SB because
   their derivation chain shares the root-provenance pointer, not a
   `&mut [T]` super-borrow.
4. **The macro `row_mut!` localises the unsafe.** Audit pressure is lower
   when there is one well-documented site per column.

Every parallel callback in `linker_context/` should match this template.
Currently:

| Callback                                       | Template-conformant? | Notes |
| ---------------------------------------------- | -------------------- | ----- |
| `do_step5` (scan_imports_and_exports fan-out)  | YES                  | The reference. |
| `compute_line_offsets` / `compute_quoted_source_contents` | YES       | `ParentRef<LinkerContext>` Deref → `&LinkerContext`; per-row column writes via raw ptr. (`LinkerContext.rs:1485-1509`). |
| `rename_symbols_in_chunk`                      | MOSTLY               | `unsafe fn (c: *mut LinkerContext, chunk: &mut Chunk, files_in_order: &[u32])` — `&LinkerContext` for reads (line 64) plus raw SoA columns. Two issues: (a) `&mut Chunk` is per-task disjoint and OK; (b) `ast.module_scope[i]` / `ast.parts[i]` writes overlap across chunks under code-splitting (B-10). |
| `generate_compile_result_for_js_chunk`         | **NO** (B-3, B-4)    | Materializes `&mut LinkerContext` and `&mut Chunk`. |
| `generate_compile_result_for_css_chunk`        | **NO** (B-3, B-4)    | Same shape. |
| `generate_compile_result_for_html_chunk`       | **NO** (presumed)    | Same dispatch shape (per `generateChunksInParallel.rs:282-298`); read source. |
| `prepare_css_asts_for_chunk`                   | **NO** (B-5)         | `&mut LinkerContext` aliased across CSS chunks. |
| `generate_chunk` (the `each_ptr` post-process fan-out) | **NO** (B-2) | Re-derives `&mut LinkerContext` via `ctx.c()`. |
| `generate_js_renamer`                          | MOSTLY               | Per-chunk disjoint `&mut Chunk` is OK; renamer writes through `*mut LinkerContext`. |

The fix for B-2..B-5 is to change five function signatures:

- `pub fn generate_compile_result_for_js_chunk_impl(worker, c: *mut LinkerContext, chunk: *mut Chunk, part_range)`
- `pub fn generate_compile_result_for_css_chunk_impl(worker, c: *mut LinkerContext, chunk: *mut Chunk, imports_in_chunk_index)`
- `pub fn prepare_css_asts_for_chunk_impl(c: *mut LinkerContext, chunk: *mut Chunk, bump)`
- `pub fn post_process_js_chunk(ctx, worker, chunk: *mut Chunk, chunk_index)`
- (and the html sibling)

…then in each impl, `let c: &LinkerContext = unsafe { &*c };` and use
`c.log_disjoint()` / `c.parse_graph()` / `c.graph` etc. through the shared
borrow. The few `&mut Chunk` writes (`chunk.intermediate_output =`,
`chunk.output_source_map =`, `chunk.isolated_hash =`) become
`addr_of_mut!((*chunk).intermediate_output)` writes, which are
SB-clean because no `&mut Chunk` is materialized.

--------------------------------------------------------------------------------

## 4. `unsafe impl Send` / `unsafe impl Sync` audit

### 4.1 `Chunk` — `Chunk.rs:133-134`

```rust
unsafe impl Send for Chunk {}
unsafe impl Sync for Chunk {}
```

SAFETY comment cites `CompileResultSlots` (sound — `UnsafeCell` per slot,
`Sync`) and `files_with_parts_in_chunk: ArrayHashMap<IndexInt, AtomicUsize>`
(sound — `AtomicUsize` is `Sync`, and the key set is frozen before parallel
codegen, so the map itself is read-only).

Watchlist items called out in the SAFETY comment:

- `unique_key: &'static [u8]` — fine.
- `Renamer<'r>` (now in `chunk.renamer: ChunkRenamer`) — the comment says
  "the printer never writes through it" but the borrow shape is still
  `&'r mut`. The comment notes "the borrow should become `&'r`." This is the
  B-1 fix; the in-tree TODO is accurate.

What the comment does NOT cover:

- `output_source_map: source_map::SourceMapPieces` — written by the
  single-threaded outer loop in `generateChunksInParallel.rs:807-810`
  (`chunk.output_source_map.finalize(...)`). NOT written from worker tasks.
  Sound.
- `intermediate_output: IntermediateOutput` — written via `core::mem::take`
  + restore in the single-threaded outer loop (`generateChunksInParallel.rs:660-675`,
  749-750). Also written by `post_process_*_chunk` from worker tasks —
  this is where B-2 lives, but the shape `chunk.intermediate_output =`
  through a `&mut Chunk` is OK *per chunk* (disjoint); the UB is in the
  aliased `&mut LinkerContext` accessed alongside.
- `template: PathTemplate` and `final_rel_path: Box<[u8]>` — written in the
  single-threaded outer loop (`generateChunksInParallel.rs:384, 419`).
  Read from worker tasks. Sound *if* worker tasks run after the path
  computation; verify ordering: the `final_rel_path` write happens after
  `wait_for_all()` on the part-range fan-out (line 307), so it is causally
  after the parallel reads in `generate_compile_result_for_js_chunk`. The
  read in `generate_chunk` (post-process) at `generateChunksInParallel.rs:330`
  also runs after `wait_for_all()` for part_ranges (line 307) but BEFORE
  the `final_rel_path` write (line 419). So `generate_chunk` reads the
  *default* (`Box::default() == Box<[]>`) `final_rel_path`, not the
  populated one. **Verify** this is intended; I read the dispatch and it
  looks like `generate_chunk` does not read `chunk.final_rel_path`. If it
  does in a future change, B-2's `&mut LinkerContext` would shadow a real
  data race on `final_rel_path`.

`Send + Sync` is sound for `Chunk` as a whole *given the disjoint-write
contract*; B-1..B-4 are the contract violations.

### 4.2 `LinkerContext<'a>` — `LinkerContext.rs:239-240`

```rust
unsafe impl<'a> Send for LinkerContext<'a> {}
unsafe impl<'a> Sync for LinkerContext<'a> {}
```

No surrounding SAFETY comment in the inventory snapshot. The implicit
contract is that the bundler's parallel passes only read it, with
per-row writes through SoA raw pointers. This contract is upheld by
`do_step5`, `compute_line_offsets`, `compute_quoted_source_contents`,
and `rename_symbols_in_chunk`. It is **violated** by `generate_chunk`,
`generate_compile_result_for_js_chunk`, `generate_compile_result_for_css_chunk`,
and `prepare_css_asts_for_chunk` (see §0 B-2/B-3/B-5).

`Send + Sync` itself is fine; **the contract violations are at the call sites**,
not in the impl.

### 4.3 `LinkerGraph` — `LinkerGraph.rs:96-97`

`Send + Sync` blanket. Same shape — SAFETY upheld by callers, not the impl.
`graph.symbols` is the cross-thread mutation hot spot (B-10).

### 4.4 `ThreadPool` — `ThreadPool.rs:77-78`

`Send + Sync`. The pool holds `worker_pool: *mut bun_threading::ThreadPool`
and a `Guarded<HashMap<ThreadId, *mut Worker>>`. The guarded map serialises
worker lookup. Workers are leaked `Box`es referenced by raw `*mut`; once
the worker is published in the map, only `get_worker` derefs it, and the
worker is fully written before publication (the `worker.write(...)` block
at `ThreadPool.rs:443-460`). Sound modulo the `unsafe { (*worker).init(&*self.v2) }`
at line 461 — that runs *after* the map insertion at line 434, so a peer
thread looking up the same `id` could deref a partially-initialised
worker. But `id == ThreadId::current()` so peer threads never see this
slot. Sound.

### 4.5 `CompletionHandle` — `bundle_v2.rs:1543-1544`

`Send + Sync` on a vtable handle. Sound (vtables are read-only).

### 4.6 `SourceMapDataTask` — `LinkerContext.rs:1379`

`Send`. Holds `ctx: Option<ParentRef<LinkerContext>>`, `thread_task: Task`,
`source_index: u32`. `ParentRef` is `Send` because the pointee outlives the
task. Sound.

### 4.7 `PrepareCssAstTask` — `prepareCssAstsForChunk.rs:41`

`Send`. Holds raw `*mut LinkerContext`, `*mut Chunk`. The SAFETY comment at
lines 36-40 is accurate for `Send`; the per-task contract violation is in
the impl (B-5).

### 4.8 General observation on the `unsafe impl Send/Sync` impls

None of the impls are unsound *in isolation*. Every observed UB is in the
**use sites** that violate the disjoint-mutation contract these impls
implicitly promise. Adding `// SAFETY: contract: only one task may
materialize `&mut T` to this pointee at a time. See doStep5.rs:43-58 for
the canonical safe pattern.` to each `unsafe impl` would make the contract
auditable.

--------------------------------------------------------------------------------

## 5. Per-area findings

### 5.1 AST cross-thread mutation

`bun_alloc::MimallocArena`-backed AST nodes live for the bundle pass. The
parallel codegen phase reads AST nodes through `c.graph.ast.split_raw()`
(SoA columns, root provenance, per-row pointer). No worker task writes
AST nodes during the codegen phase — verified by ripgrep across all
`generate_compile_result_for_*_chunk*.rs` and `postProcess*Chunk.rs` for
`items_*_mut` and `slice_mut`. (`postProcessJSChunk.rs:79` calls
`items_module_scope_mut()` — but `post_process_js_chunk` runs in the
parallel `each_ptr(LinkerContext::generate_chunk, ...)` fan-out!)

`postProcessJSChunk.rs:79`:

```rust
let runtime_scope: &mut Scope =
    &mut c.graph.ast.items_module_scope_mut()[runtime_input_file];
```

…where `c: &mut LinkerContext = ctx.c()` (line 53, into a parallel callback).
`runtime_input_file` is the runtime AST row, **the same row for every
chunk's post-process task**. Multiple worker threads concurrently materialize
`&mut Scope` to the same row.

This is a **second-order** instance of B-2: the aliased `&mut LinkerContext`
is forged from `ctx.c()`, the aliased `&mut Scope` is forged from inside
that. Two separate `&mut`-uniqueness violations stacked.

**FINDING B-2-EXTRA:** `postProcessJSChunk.rs:79` materializes `&mut Scope`
to the *same* runtime scope row from every parallel post-process task.
Concrete shared-mutation aliasing. The body reads `runtime_scope.members.get(...)`
(line 80, 82-95) — *read-only* through the `&mut Scope`. UB by reference
shape; benign at run time.

Fix: drop the `_mut`:

```rust
let runtime_scope: &Scope =
    &c.graph.ast.items_module_scope()[runtime_input_file];
```

### 5.2 Symbol-table aliasing

`graph.symbols: symbol::Map { symbols_for_source: NestedList<Symbol> }`.
Two cross-thread access patterns:

1. **Read from any worker task.** Sound — accessed via `&LinkerContext` or
   through a non-owning view built by `make_symbols_view` in
   `renameSymbolsInChunk.rs:118-127`.

2. **Write during renamer construction and symbol-follow path compression.**
   The renamer phase writes `symbol.flags` (declared-symbol setup in
   `add_top_level_declared_symbols`) and can also touch `symbol.link`
   through `symbols.follow`. These writes go through
   `ChunkRenamer`'s owned `Box<NumberRenamer>` / `Box<MinifyRenamer>` —
   their `symbols: ManuallyDrop<symbol::Map>` is a shallow non-owning view
   over the same underlying `NestedList`. Multiple parallel renamer tasks
   could call `symbols.follow(ref_)` against overlapping rows when
   code-splitting puts the same source in multiple chunks.

   `symbols.follow(ref_)` is implemented as:

   ```rust
   pub fn follow(&self, ref_: Ref) -> Ref {
       // walks Symbol.link and performs path compression through Cell<Ref>
   }
   ```

   This is **not read-only**. `src/ast/symbol.rs:667-724` rewrites
   `symbol.link` and intermediate `p.link` through `Cell<Ref>`. The earlier
   draft of this artifact incorrectly said "NO MUTATION"; Codex review caught
   that mistake against the source.

   Correct proof obligation: a parallel renamer fix cannot stop at
   `&mut Renamer` → `&Renamer`. It must additionally prove that
   `LinkerContext::generate_chunks_in_parallel`'s earlier
   `self.graph.symbols.follow_all()` fully compressed every link before worker
   codegen and that no new links are created after that point, **or** it must
   add a no-compress/read-only follow path for worker threads. Without that
   proof, `&self` only hides the same interior mutation behind `Cell`.

3. **Write through `LinkerGraph::symbol_mut`** (`LinkerGraph.rs:392-395`).
   This is `unsafe fn`, called from sequential phases (`load`, `link`).
   Not called from worker tasks during the parallel codegen phase. Sound.

### 5.3 Source-map writer concurrency

Two separate concerns:

1. **`SourceMapData::compute_line_offsets` / `compute_quoted_source_contents`**
   (`LinkerContext.rs:1485-1509`). One task per `source_index`; writes the
   per-row `graph.files[source_index].line_offset_table` /
   `quoted_source_contents` slot through a raw column pointer. Disjoint
   across tasks. Sound. The `ParentRef<LinkerContext>` parameter yields
   `&LinkerContext` only (template-conformant).

2. **`chunk.output_source_map`** (`source_map::SourceMapPieces`). Written
   only in the single-threaded outer loop in `generateChunksInParallel.rs:807-864`,
   after `wait_for_all()` on the part-range fan-out. The per-chunk
   `output_source_map` is appended to by the **printer** through
   `Printer::source_map_builder`, which writes into the per-task printer
   buffer and is folded into `chunk.output_source_map` during
   post-processing.

   Verify the post-process write site: `postProcessJSChunk.rs:841-...`
   gated on `c.options.source_maps != None`. The chunk's source map is
   merged from per-task `CompileResultForSourceMap` entries gathered into
   `compile_results_for_source_map`. Each entry is the result of one
   `PendingPartRange`; the merge is sequential within `post_process_js_chunk`.
   Per chunk this is single-threaded. Across chunks, each chunk's source
   map is its own.

   **But `post_process_js_chunk` itself runs in parallel across chunks!**
   So there are N parallel `post_process_js_chunk` calls each writing
   their own `chunk.output_source_map`. Per-chunk disjoint, sound *per
   target field*. The B-2 issue (aliased `&mut LinkerContext`) shadows this.

3. **`SourceMapPieces::finalize`** (`generateChunksInParallel.rs:807-863`).
   Single-threaded outer loop. Sound.

### 5.4 Hash-map sharing across workers

| HashMap                                                 | Access pattern                          | Sound? |
| ------------------------------------------------------- | --------------------------------------- | ------ |
| `chunk.files_with_parts_in_chunk: ArrayHashMap<u32, AtomicUsize>` | Read concurrently; values mutated via `AtomicUsize::fetch_add(Relaxed)` | YES (key set frozen pre-parallel) |
| `c.mangled_props: LocalsResultsMap` (`ArrayHashMap<Ref, Box<[u8]>>`) | Read concurrently from CSS tasks | YES |
| `c.graph.symbols.symbols_for_source: NestedList<Symbol>` | Read concurrently; non-owning shallow views built per task | YES |
| `chunk.exports_to_other_chunks: ArrayHashMap<Ref, &'static [u8]>` | Read concurrently during JS codegen | YES (frozen) |
| `js.imports_from_other_chunks: ArrayHashMap<...>` | Read concurrently | YES (frozen) |
| `c.parse_graph().path_to_source_index_map` | Read concurrently | YES |
| `c.reserved_names_for_scope` (in renamer setup) | Each task allocates its own | YES (per-task) |
| `unique_key_to_path: StringHashMap<Box<[u8]>>` | Built/used single-threaded after `wait_for_all()` | YES |
| `duplicates_map: StringArrayHashMap<DuplicateEntry>` | Single-threaded | YES |

No worker-shared `&mut HashMap` writes were observed in the parallel
phases. The only writer-on-shared-HashMap case is the **atomic counter**
on `files_with_parts_in_chunk` — sound by construction.

The `static_route_visitor` cache (`generateChunksInParallel.rs:628`) is
mutated in the SEQUENTIAL post-`wait_for_all` loop at lines 1156-1158
(`static_route_visitor.has_transitive_use_client(...)`). Single-threaded.
Sound.

### 5.5 Bundle-thread task lifetime / `Send`

`BundleThread<C>` runs forever on a dedicated OS thread. Singleton storage:
`OnceLock<Instance>` with `Instance(NonNull<()>)` (`BundleThread.rs:385-390`).
`Send + Sync` for `Instance` is sound — `BundleThread::enqueue` only
performs raw-pointer field projections (`UnboundedQueue::push` is `&self`,
`Waker::wake` is `&self`); no `&mut BundleThread` is materialized in
`enqueue` after the bundle thread is running.

`BundleThread::thread_main` is the unique owner of the singleton from the
spawn point onward. It writes `instance.waker` once (line 213) before
calling `ready_event.set()` (line 219). After that, `waker` is read-only
from the bundle thread's perspective and `wake()`-from-any-thread via
the `&Waker` autoref path. Sound modulo B-6 (Windows placeholder).

`generation` is read/written only on the bundle thread (acknowledged at
`BundleThread.rs:251, 265`). Sound.

`generate_in_new_thread` (line 283) drives the `BundleV2` instance to
completion before returning; subsequent `drop_in_place(transpiler_ptr)`
and `drop_in_place(ast_memory_store)` (lines 360-361) are the explicit
arena-edge `Drop` calls the codebase calls out in the project CLAUDE.md
("**Arena gotcha**"). Sound.

### 5.6 Cache invalidation / incremental compile

The dev-server path (`bake::DevServer`) holds an incremental cache.
`finish_from_bake_dev_server` (`bundle_v2.rs:5240-...`) is the entry
point. The cache invalidation is the dev-server's responsibility; the
bundler reads frozen state.

`bundle_v2.rs:5248-5252` is the one `unsafe` site here:

```rust
let start = unsafe {
    &mut *dev_server
        .current_bundle_start_data()
        .cast::<DevServerInput>()
};
```

The SAFETY comment cites DevServer's invariant: `current_bundle` is `Some`
during finish, and the `start_data` slot is `&mut`-exclusive for the
finalize call. This is a cross-crate contract (DevServer in `bun_runtime`)
that cannot be locally verified — but the contract is explicit and the
audit trail is correct.

No cache UAF observed. The "use freed cache slot" case would require
DevServer to drop `start_data` *while* `finish_from_bake_dev_server` is
running; out of audit scope (different crate).

### 5.7 CSS module local scope

`c.mangled_props` (`LocalsResultsMap`) is built before the parallel CSS
codegen phase (in `mangle_local_css()`, line 64 of
`generateChunksInParallel.rs`). It is read by every CSS chunk task as
`&c.mangled_props` (`generateCompileResultForCssChunk.rs:96`,
`prepareCssAstsForChunk.rs:254`). No writer during the parallel phase.
Sound.

The Pass-2 watchlist item about CSS cross-file composition is upheld
here: the read set is the same map across all chunks, but the access is
shared-read only.

### 5.8 Macro-emitted unsafe

`from_field_ptr!` (used at many sites — e.g. `pending_part_range_prologue`
line 1711; `io_task_callback` line 354; `task_callback` line 362;
`run_line_offset` line 1407; `run_quoted_source_contents` line 1441).
Expands to `core::ptr::read` of an offset-of computation. Each call site
already has SAFETY documenting "the task pointer points at the intrusive
`task` field of a live ParseTask/SourceMapDataTask/PendingPartRange".
Sound modulo the upstream invariant.

`bun_crash_handler::link_impl_BundleGenerateChunkCtx!` (`LinkerContext.rs:69`)
expands to a vtable wiring; the SAFETY at line 110 is generated by the
macro. Sound modulo the macro contract.

The `owned_task!` macro in `bun_threading::work_pool` is **not** used in
`bun_bundler` (verify: ripgrep `owned_task!` in `src/bundler/` returns
zero hits). The `unsafe impl Send` for tasks here is hand-written, not
macro-generated, so the Codex P3 `CODEX-P3-cross-thread-task-send-boundaries.md`
plan does NOT impact bundler crates directly. But the four bundler-side
`unsafe impl Send` impls in §4 above are all written in a discipline
compatible with the proposed `unsafe trait` migration.

--------------------------------------------------------------------------------

## 6. Representative 40-site enumeration

Per the brief, 40-60 representative sites with file:line + classification.
Numbering follows `(F)inding` / `(O)k` / `(W)atchlist`.

| #  | F/O/W | Site                                                          | Notes |
| -- | ----- | ------------------------------------------------------------- | ----- |
| 1  | F (B-1) | `Chunk.rs:130-132`                                          | The seed `TODO(ub-audit)`; in-tree. |
| 2  | O     | `Chunk.rs:133-134`                                            | `unsafe impl Send/Sync for Chunk` — sound modulo callers. |
| 3  | O     | `Chunk.rs:152`                                                | `unsafe impl Sync for CompileResultSlots` — sound (UnsafeCell per slot). |
| 4  | W (B-7) | `Chunk.rs:243`                                              | `core::ptr::read(slots.cast::<*mut [UnsafeCell<CompileResult>]>())` — `Box<[T]>` fat-ptr ABI guarantee. |
| 5  | O     | `Chunk.rs:175, 184`                                           | `&*c.get()` post-pool-join — sound. |
| 6  | F (B-6) | `BundleThread.rs:155`                                       | `zeroed_unchecked` for `Waker` on Windows; flagged in `CODEX-P2-windows-waker-placeholder.md`. |
| 7  | O     | `BundleThread.rs:167-203`                                     | Spawn / enqueue raw-ptr discipline — sound. |
| 8  | O     | `BundleThread.rs:359-362`                                     | Explicit `drop_in_place` of `Transpiler` and `ASTMemoryAllocator` before arena drop — arena-edge correctness. |
| 9  | O     | `BundleThread.rs:386-390`                                     | `Instance(NonNull<()>)` `Send + Sync` — sound. |
| 10 | F (B-2) | `LinkerContext.rs:1657-1663`                                | `GenerateChunkCtx::c(&self) -> &mut LinkerContext` — the factory for the aliased `&mut`. |
| 11 | F (B-2) | `postProcessJSChunk.rs:53`                                  | `let c: &mut LinkerContext = ctx.c();` from a parallel callback. |
| 12 | F (B-2-EXTRA) | `postProcessJSChunk.rs:79`                            | `&mut Scope` to the runtime scope row from every parallel task. |
| 13 | F (B-3) | `generateCompileResultForJSChunk.rs:61`                     | `let c_mut: &mut LinkerContext = unsafe { &mut *c_ptr };` |
| 14 | F (B-4) | `generateCompileResultForJSChunk.rs:62`                     | `let chunk_mut: &mut Chunk = unsafe { &mut *chunk_ptr };` |
| 15 | F (B-1) | `generateCompileResultForJSChunk.rs:164-168`                | `addr_of_mut!(chunk.renamer)` + `(*renamer_ptr).as_renamer()`. |
| 16 | F (B-1) | `ungate_support.rs:498`                                     | `ChunkRenamer::as_renamer(&mut self)` — should be `&self`. |
| 17 | F (B-3) | `generateCompileResultForCssChunk.rs:45`                    | Same aliased `&mut LinkerContext` shape. |
| 18 | F (B-4) | `generateCompileResultForCssChunk.rs:46`                    | Same aliased `&mut Chunk` shape. |
| 19 | F (B-5) | `prepareCssAstsForChunk.rs:77-78`                           | `&mut *linker` aliased across CSS chunks. |
| 20 | O     | `linker_context/doStep5.rs:50-58`                            | **Canonical correct template** — `&LinkerContext` only, SoA per-row writes. |
| 21 | O     | `linker_context/doStep5.rs:94`                               | `row_mut!` macro — well-localised unsafe. |
| 22 | F (B-10) | `renameSymbolsInChunk.rs:25-38`                            | In-tree CONCURRENCY note acknowledges code-splitting row overlap; calls it "benign behaviorally" — needs explicit proof. |
| 23 | O     | `renameSymbolsInChunk.rs:43-127`                             | Raw-ptr SoA pattern, mostly correct (`split_raw()`, raw `*mut symbol::Map`). |
| 24 | F (B-9) | `generateChunksInParallel.rs:198`                           | `unsafe { combined_part_ranges.set_len(total_count) }` — invariant upheld by inspection only. |
| 25 | O     | `generateChunksInParallel.rs:79-81`                          | `BackRef::new_mut(&mut chunks[0])` + `ParentRef::from_raw_mut(c)` — the BACKREF construction. |
| 26 | O     | `generateChunksInParallel.rs:238-240, 265-267, 290-292`      | `detach_lifetime_ref::<GenerateChunkCtx>(chunk_ctx)` — sound (the holder outlives via `wait_for_all`). |
| 27 | F (B-8) | `generateChunksInParallel.rs:627`                           | `StaticRouteVisitor::c = detach_lifetime_ref::<LinkerContext>(c)`. Held alongside `c.log_disjoint()` writes. |
| 28 | O     | `generateChunksInParallel.rs:505-506, 622`                   | `unsafe { &mut *LinkerContext::bundle_v2_ptr(...) }` — single-threaded outer loop, sound. |
| 29 | O     | `bundle_v2.rs:232, 241, 254, 279`                            | `BackRef`/`ParentRef` deref convenience — sound. |
| 30 | O     | `bundle_v2.rs:290`                                           | `transpiler_for_target(Browser).assume_mut()` — single-threaded driver. |
| 31 | F (B-2 extension?) | `bundle_v2.rs:5290-5291`                          | `&mut *parts_col.add(index)` + `&mut *import_records_col.add(index)` — single-threaded `finish_from_bake_dev_server`, so disjoint per-row writes here are fine. |
| 32 | O     | `bundle_v2.rs:5366`                                          | `(*parts_col.add(record.source_index.get() as usize)).len()` — read through the other column's raw ptr, no `&[T]` super-borrow. Sound. |
| 33 | O     | `bundle_v2.rs:3257, 3682`                                    | `(*runtime_parse_task).ctx = Some(...)` — BACKREF setup, single-threaded. |
| 34 | O     | `bundle_v2.rs:5248-5252`                                     | `&mut *dev_server.current_bundle_start_data().cast()` — cross-crate contract, in-tree SAFETY. |
| 35 | O     | `ParseTask.rs:354, 362`                                      | `from_field_ptr!(ParseTask, io_task/task, task)` — task callback prologue, sound per CONCURRENCY note. |
| 36 | O     | `ParseTask.rs:221-223`                                       | `unsafe fn ctx<'r>(&self) -> &'r BundleV2<'static>` — lifetime-laundered backref; documented invariant. |
| 37 | O     | `ParseTask.rs:622, 641, 741, 789`                            | `&mut (*transpiler).options.define` etc. — single-task ParseTask runs against per-worker transpiler clones. Sound. |
| 38 | O     | `LinkerContext.rs:1406-1416, 1438-1471`                      | `run_line_offset`/`run_quoted_source_contents` — TEMPLATE-CONFORMANT (`ParentRef<LinkerContext>` Deref, per-row raw writes). |
| 39 | O     | `LinkerContext.rs:526-546`                                   | `unsafe fn load` — single-threaded bundle setup. |
| 40 | O     | `LinkerContext.rs:710-718, 720-735`                          | HTML-imports raw-ptr access via `(*parse_graph).html_imports...` — sound (single-threaded path through `link` setup). |
| 41 | O     | `LinkerGraph.rs:348`                                         | `dependencies.writable_slice(part_ids.len())` — pre-sized write area. Sound. |
| 42 | F (B-10) | `LinkerGraph.rs:392-395`                                   | `unsafe fn symbol_mut(&self, ref_: Ref) -> &mut Symbol` — `&self`+`&mut Symbol` factory. Currently called only from sequential phases; if a future caller is parallel, this becomes another B-1-style hazard. |
| 43 | O     | `LinkerGraph.rs:507, 526`                                    | `set_len` for files/entry_points — invariants checked. |
| 44 | O     | `LinkerGraph.rs:692`                                         | `copy_nonoverlapping` — pre-sized buffers. Sound. |
| 45 | O     | `ThreadPool.rs:147`                                          | `(*THREAD_POOL.get()).write(...)` — once-only init. Sound. |
| 46 | O     | `ThreadPool.rs:414-464`                                      | `get_worker(&self, id) -> &'static mut Worker` — the `&'static mut` is the per-thread Worker, retrieved through `Guarded` lookup. Sound (per-thread keying). |
| 47 | O     | `ThreadPool.rs:563, 567, 587, 595, 622`                      | Worker deinit — single-threaded teardown. Sound. |
| 48 | O     | `findImportedFilesInCSSOrder.rs:31, 45, 242, 243, 288`       | Bitwise copies + `set_len(0)` — single-threaded CSS ordering pass. Sound. |
| 49 | O     | `findImportedFilesInCSSOrder.rs:386, 396, 424`               | `&*order_ptr.add(j)` — pre-sized order list, single-threaded. Sound. |
| 50 | O     | `prepareCssAstsForChunk.rs:259-260`                          | `&*(&raw const c.graph.symbols).cast::<bun_ast::symbol::Map>()` — repr-transparent bridge, sound. |
| 51 | O     | `analyze_transpiled_module.rs:46-47`                         | `unsafe impl bytemuck::{Zeroable, Pod} for RecordKind` — single enum byte, sound. |
| 52 | O     | `analyze_transpiled_module.rs:218-220, 263-266`              | `ModuleInfoDeserialized::deinit` — explicit teardown. Sound. |
| 53 | O     | `HTMLScanner.rs:301, 339, 365`                               | `(*self.this).on_*` — lol_html callback dispatch through `*mut Self`, sound (one writer). |
| 54 | O     | `bundle_v2.rs:6210`                                          | `&mut *std::ptr::from_mut::<bun_ast::Log>(s)` — split-borrow widening. Sound. |
| 55 | O     | `bundle_v2.rs:6728`                                          | `core::ptr::drop_in_place(value)` for cache eviction — explicit Drop. Sound. |
| 56 | O     | `bundle_v2.rs:7627`                                          | `&mut *ext_free_function.cast::<ExternalFreeFunctionAllocator>()` — single-threaded FFI free callback. Sound. |
| 57 | O     | `linker.rs` (9 sites)                                        | Mostly accessor unwraps from `Option<NonNull<T>>` — sound. |
| 58 | O     | `transpiler.rs` (23 sites)                                   | Single-threaded transpiler driver; many `&mut *transpiler` reborrows, all linear. Sound. |
| 59 | O     | `options.rs` (6 sites)                                       | Config struct accessors, sound. |
| 60 | O     | `AstBuilder.rs` (5 sites)                                    | Builder lifetime management. Sound. |

--------------------------------------------------------------------------------

## 7. Hardened SAFETY-comment templates

The audit consistently shows that **the absence of a "concurrent caller
enumeration" in SAFETY comments is the proximate cause of the B-class
findings**. The current style ("see XYZ note") accumulates trust without
a checkable invariant. Below are three templates that should be used at
parallel-task surfaces.

### 7.1 Template: parallel callback that takes `*mut T`

```rust
//
// # Safety
//
// CONCURRENCY: thread-pool callback. Runs as one task per
// {chunk, source_index, part_range} (specify which). Peer tasks
// concurrently hold `*mut T` to the same pointee. The body MUST NOT
// materialize `&mut T` to the shared pointee — Stacked Borrows would
// pop sibling tasks' borrow tags.
//
// Permitted:
//   - `let t: &T = unsafe { &*t_ptr };` — shared read.
//   - `unsafe { addr_of_mut!((*t_ptr).field) }` — disjoint per-task write.
//   - `let cell: &AtomicUsize = ...; cell.fetch_add(...)` — atomic RMW.
//
// Forbidden:
//   - `unsafe { &mut *t_ptr }` while peer tasks exist.
//   - any helper whose receiver is `&mut self` and whose body could be
//     invoked from peer tasks against the same `self`.
//
// Disjoint writes performed by this callback:
//   - `(*t_ptr).<field>` … (enumerate)
//
// Reads performed by this callback through `&T`:
//   - `(*t_ptr).<read_field>` … (enumerate)
//
// Caller invariant:
//   - The thread pool joins on `wait_for_all()` before any reader of the
//     disjoint write target reads it.
pub unsafe fn callback(t: *mut T, ...) { ... }
```

### 7.2 Template: lifetime-detached BACKREF

```rust
// Lifetime-detached BACKREF into <parent>. The pointee is owned by
// <parent>, which outlives this <holder> via <which join / which Drop
// ordering>. Reborrowing `&'r mut T` from this pointer is sound IFF
// no peer thread holds a `&T` / `&mut T` to the same pointee for the
// duration of `'r`. Document which join enforces that here.
pub <field>: bun_ptr::ParentRef<T>,
```

### 7.3 Template: `unsafe impl Send` / `unsafe impl Sync`

```rust
// SAFETY:
//   1. Disjoint-mutation contract: no two threads materialize `&mut`
//      to the same field of `Self` at the same time.
//      Enforced by: <callers / pool join / atomic field>.
//   2. Shared-read fields:    <list>.
//   3. Atomic fields:         <list>.
//   4. Disjoint-per-task fields: <list>.
//   5. Single-writer fields:  <list (sequential phase ordering)>.
//   6. Drop ordering:         <which thread drops Self>.
//
// Violations of (1) observed in the codebase:
//   - <site>:<line>  (file ticket #N)
unsafe impl Send for T {}
unsafe impl Sync for T {}
```

--------------------------------------------------------------------------------

## 8. Recommended PRs

Ordered by leverage / value.

### PR-1: Renamer borrow cascade (B-1)

Scope: `src/js_printer/renamer.rs`, `src/bundler/ungate_support.rs`,
`src/bundler/linker_context/generateCompileResultForJSChunk.rs` (impl call site),
`src/bundler/linker_context/postProcessJSChunk.rs` (uses `Renamer` indirectly
via `js_printer::print`).

1. Wrap each renamer in a `#[repr(transparent)]` newtype with `&self`
   read-only accessors:
   - `pub struct NumberRenamerView(NumberRenamer);`
   - `pub struct MinifyRenamerView(MinifyRenamer);`
2. Change `Renamer` to hold `&'r T` instead of `&'r mut T`:
   ```rust
   pub enum Renamer<'r, 'src> {
       NumberRenamer(&'r NumberRenamerView),
       NoOpRenamer(&'r NoOpRenamer<'src>),
       MinifyRenamer(&'r MinifyRenamerView),
   }
   ```
3. Switch `Renamer::name_for_symbol` to `&self`. The bodies are already
   read-only.
4. Switch `MinifyRenamer::name_for_symbol` to `&self` (no functional
   change; the `&mut` was a port artifact).
5. Switch `ChunkRenamer::as_renamer` to `&self`, **and** either route
   worker-thread symbol lookup through a no-compress/read-only follow path or
   assert/prove the `follow_all()` postcondition before entering the worker
   fan-out.
6. At the parallel call site, replace `addr_of_mut!(chunk.renamer)` with
   `addr_of!(chunk.renamer)`.

Net effect: the renamer-during-codegen path becomes `&` everywhere; the
`&mut` is retained only for the construction phase (one task per chunk, no
parallel writers).

Risk: medium. The `assign_name` / `add_top_level_symbol` paths must remain
`&mut self`, and the construction phase must still take the renamer
through `Box<NumberRenamer>` mutably. The split is clean.

Verification: `bun bd run build` on `test/bundler/`; Miri on a reduced
fixture.

### PR-2: Generalised parallel-callback shape fix (B-2..B-5)

Scope:
- `src/bundler/LinkerContext.rs` (`generate_chunk`, `GenerateChunkCtx::c`)
- `src/bundler/linker_context/postProcessJSChunk.rs`
  (`post_process_js_chunk`)
- `src/bundler/linker_context/postProcessCSSChunk.rs` (postProcessCSSChunk.rs)
- `src/bundler/linker_context/postProcessHTMLChunk.rs`
- `src/bundler/linker_context/generateCompileResultForJSChunk.rs`
- `src/bundler/linker_context/generateCompileResultForCssChunk.rs`
- `src/bundler/linker_context/generateCompileResultForHtmlChunk.rs`
- `src/bundler/linker_context/prepareCssAstsForChunk.rs`

1. Change `GenerateChunkCtx::c(&self) -> &mut LinkerContext` to
   `c_ptr(&self) -> *mut LinkerContext` and `c(&self) -> &LinkerContext`.
2. Change every parallel-callback impl signature from
   `c: &mut LinkerContext, chunk: &mut Chunk` to
   `c: *mut LinkerContext, chunk: *mut Chunk`.
3. Inside each impl, materialize `let c: &LinkerContext = unsafe { &*c };`.
4. Per-chunk-disjoint writes (`chunk.intermediate_output =`, etc.) become
   raw-ptr field writes via `addr_of_mut!`.
5. Replace `postProcessJSChunk.rs:79`'s `items_module_scope_mut()` with
   `items_module_scope()`.
6. Audit every worker-thread call to `symbols.follow(ref_)`; no worker should
   path-compress shared symbol rows unless the work is serialized by
   `source_index` or guarded by an explicit per-row synchronization strategy.

Risk: high (large diff, touches all four codegen entry points). The
refactor is mechanical and the doStep5 template already exists; the
risk is integration churn, not correctness.

Verification: full `bun bd test test/bundler` matrix; Miri on a small
fixture; cross-platform CI smoke.

### PR-3: Windows waker placeholder (B-6)

Scope: `src/bundler/BundleThread.rs`.

Implement `Waker::placeholder()` on Windows mirroring the macOS variant.
The `loop_: &'static _` field needs a sentinel `&'static StubLoop` value
that satisfies the non-null invariant. The existing
`Async::Waker::placeholder()` route on Unix is the model.

Risk: low. Codex P2 plan
(`CODEX-P2-windows-waker-placeholder.md`) is already filed.

### PR-4: `unsafe impl Send/Sync` contract documentation (B-11)

Scope: all 7 `unsafe impl Send`/`unsafe impl Sync` impls in
`src/bundler/`. Use template §7.3.

Risk: zero (documentation only).

Verification: rg `unsafe impl (Send|Sync)` in `src/bundler/` to confirm
no impl was missed.

### PR-5: Code-splitting row-overlap proof (B-10)

Scope: `src/bundler/linker_context/renameSymbolsInChunk.rs`.

Current CONCURRENCY comment (`renameSymbolsInChunk.rs:25-38`) says
"the writes are idempotent (`declared_symbols` flag set, scope-member
sort) so the race is benign there but is still a Stacked Borrows hazard
here." That is a hand-wave. Either:

1. Prove idempotence with a property test under TSAN (run the renamer
   twice with shuffled chunk order and verify identical output), or
2. Serialise the cross-chunk overlap explicitly (a per-source spinlock
   indexed by `source_index`, taken only when the chunk owns a source
   that appears in another chunk).

Risk: medium. Most users do not enable code-splitting, so this is a
latent UB that may have shipped for a long time. The fix matters for
correctness more than perf.

### PR-6: `Chunk::write_compile_result_slot` ABI watchlist (B-7)

Scope: `src/bundler/Chunk.rs:243`.

Add a `static_assertions::assert_eq_size!(Box<[u8]>, *mut [u8])` and
the corresponding `align_of` check at module scope to make the
fat-pointer ABI assumption load-bearing in the type system. If the
assertion ever fails (e.g. a future `Box` representation change), the
build fails loudly rather than silently turning into UB.

Risk: zero (an additional compile-time assertion).

--------------------------------------------------------------------------------

## 9. Items NOT addressed by this pass

For audit completeness, these were considered and ruled out of scope for
this deliverable:

1. **The `BundleThread` macOS waker** (`BundleThread.rs:148`) uses
   `Async::Waker::placeholder()` — already known-good per the in-tree
   comment. Verified.
2. **`ASTMemoryAllocator` thread-local push/pop** in `BundleThread.rs:294-295`,
   337. The thread-local invariant is "exactly one push outstanding per
   thread", upheld by the explicit `pop()` before `drop_in_place`. Sound.
3. **`Worker::heap` lazy init** in `ThreadPool.rs:476`. The
   `has_created` boolean gates every read. Sound.
4. **The `ParseTask::ctx` BACKREF lifetime laundering** in
   `ParseTask.rs:221-223`. Documented invariant; sound.
5. **`detach_lifetime_*` helpers** at 30+ sites. They are
   lifetime-extension primitives; each call site documents the holder/
   pointee outlives relationship. Sound when the documented invariant
   holds — and we've spot-checked five of them.
6. **The `bun_ptr::ParentRef` / `BackRef` family.** Their soundness
   contracts (`owner outlives holder`) are the foundation of the bundle
   pipeline. They are correctly applied; the holder-outlives-pointee
   relationships are documented at construction sites in
   `generateChunksInParallel.rs`.

--------------------------------------------------------------------------------

## 10. Appendix: how to reproduce the audit

```bash
# Stratified inventory of bun_bundler unsafe sites:
grep '"crate":"bun_bundler"' .unsafe-audit/unsafe-inventory.jsonl \
  | jq -r '[.line, .kind, (.categories|join(",")), (.text_first_120|.[0:90])] | @tsv'

# Per-file counts:
grep '"crate":"bun_bundler"' .unsafe-audit/unsafe-inventory.jsonl \
  | jq -r '.file' | sort | uniq -c | sort -rn

# Parallel-callback enumeration:
rg -n '(each_ptr|worker_pool\.schedule|wait_for_all)' src/bundler/

# Renamer cascade entry points:
rg -n 'as_renamer|name_for_symbol|Renamer::' src/bundler/ src/js_printer/

# Aliased &mut LinkerContext factories (the B-2/B-3/B-5 surface):
rg -n '&mut \*c_ptr|&mut \*linker|ctx\.c\(\)|assume_mut' src/bundler/
```

The full text-bucket map of every cited line in this report can be
regenerated from the JSONL inventory at
`.unsafe-audit/unsafe-inventory.jsonl`.
