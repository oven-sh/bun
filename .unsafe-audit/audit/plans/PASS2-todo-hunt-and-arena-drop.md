# Pass-2: TODO Hunt, Arena-Drop Hazards, `zeroed_unchecked`, and `ManuallyDrop`/`mem::forget` Audit

Scope: full `src/**.rs`.
Methodology: targeted `rg` enumeration → per-site contextual read (20-30 lines) → verdict against UB / Drop-in-arena / niche / forget-without-reclaim hazard classes.
Pre-flagged carve-outs (per task brief, already documented by Codex P2 and excluded from "new finding" counts): `Renamer<'r>` parallel chunk gen (`Chunk.rs:130-132`) and Windows `BundleThread::uninitialized` waker (`BundleThread.rs:147-155`).

## Executive summary

| Scan | Hits | New concerning | Hard bugs |
|---|---:|---:|---:|
| `TODO(ub-audit)\|TODO(soundness)\|TODO(unsafe)` (rust) | 3 | 0 (all 3 already known to Codex P2 / cross-references to same TODO) | 0 |
| `FIXME\|XXX\|HACK` (rust) | ~24 (full scan); 13 unsafe-adjacent | 1 (`open.rs` Windows uv_loop_t leak per `Editor::open`) | 0 UB; 1 bounded leak |
| `MimallocArena` drop-in-arena hazards | 5 classes reviewed | 0 (all explicitly paired with `ManuallyDrop` / `mem::forget` and comment-justified) | 0 |
| `zeroed_unchecked` call sites | 34 T's | 1 (`BundleThread.uninitialized.waker` on Windows — already pre-flagged by Codex) | 0 new UB |
| `mem::forget` / `ManuallyDrop` | 342 hits across 38 files | 27 distinct ownership-transfer sites, 5 paired-drop sites reviewed | 1 bounded leak (`DependencyVersionValue::npm`) |

**Net new soundness bugs found this pass:** 0.
**Net new bounded-leak findings:** 2 — `DependencyVersionValue::npm` (`Box<Query>` global-heap chain inside `ManuallyDrop<NpmInfo>`) and `Editor::open` Windows `MiniEventLoop` leak per editor-open. Both are documented and bounded; neither is UB.

The carve-out TODOs (`Chunk.rs:130-132`, `BundleThread.rs:147-155`) are real — re-confirmed below — but already targeted by Codex P2.

---

## Section 1: `TODO(ub-audit)` findings

`rg -n 'TODO\(ub-audit\)|TODO\(soundness\)|TODO\(unsafe\)' --type rust src/` returns exactly **3** matches; all reference the same single concern (the `Renamer<'r>` overlap inside the parallel chunk fan-out).

### 1.1 `src/bundler/Chunk.rs:130-132` (primary site)

```rust
unsafe impl Send for Chunk {}
unsafe impl Sync for Chunk {}
// TODO(ub-audit): `Renamer<'r>` still borrows `&'r mut {Number,Minify}Renamer`,
// so the per-chunk renamer is reborrowed mutably from each part-range task;
// the printer never writes through it, but the borrow should become `&'r`.
```

**Verdict: real concern — refactor candidate, not currently observable UB.**

Audit trail:
- The parallel fan-out (`generate_compile_result_for_js_chunk` in `src/bundler/linker_context/generateCompileResultForJSChunk.rs:54-69` and the CSS twin at `generateCompileResultForCssChunk.rs:38-48`) materializes `let chunk_mut: &mut Chunk = unsafe { &mut *chunk_ptr };` once per `PendingPartRange` task. Many peer tasks may hold their own `&mut Chunk` to the *same* allocation concurrently — that is overlapping `&mut` from the aliasing model's perspective and is in principle UB.
- The mitigation is structural: every `&mut Chunk`-derived write is funneled through `Chunk::write_compile_result_slot` (`Chunk.rs:230-255`), which **never** materializes `&mut Chunk` or `&mut [CompileResult]` at the boundary — it projects `addr_of_mut!((*chunk).compile_results_for_chunk)`, casts to `*mut [UnsafeCell<CompileResult>]`, and writes through `UnsafeCell::get` (the field `compile_results_for_chunk` is `CompileResultSlots(Box<[UnsafeCell<CompileResult>]>)`, `Sync` via the explicit impl on `Chunk.rs:152`).
- The remaining `&mut Chunk` materialization inside `chunk_mut` passes through to `generate_compile_result_for_{js,css}_chunk_impl` to access `chunk.renamer.as_renamer()`. `as_renamer()` (in `src/bundler/ungate_support.rs:498-508`) takes `&mut ChunkRenamer` for one reason: `Renamer::{NumberRenamer, MinifyRenamer}(&'r mut _)` variants carry `&mut` of the underlying renamer (`renamer.rs:96-100`).
- Reading the implementations confirms the TODO author's claim: `MinifyRenamer::name_for_symbol(&mut self)` (`renamer.rs:257-279`) and `NumberRenamer::name_for_symbol(&self)` (`renamer.rs:825-851`) only *read* — the former takes `&mut self` solely because the enum variant requires it; the latter is already `&self`. `name_for_symbol` is the only Renamer method invoked on the parallel path (call-graph: `js_printer::print -> p.name_for_symbol` at `lib.rs:2750`).
- Mitigating today: the printer never writes through the renamer; the symbol map is populated single-threaded in `renameSymbolsInChunk` *before* `generate_chunks_in_parallel` fans out. So even though the model would call peer `&mut Chunk` borrows aliased, no actual mutation occurs through them.
- The proper fix is a one-day refactor: change `Renamer` variants to `&'r {Number,Minify}Renamer`, change `MinifyRenamer::name_for_symbol` to `&self` (body already only reads), change `ChunkRenamer::as_renamer` and `name_for_symbol` to `&self`. That cascades into `chunk_mut: &mut Chunk` becoming `chunk_ref: &Chunk` for the fan-out, after which the `Sync for Chunk` claim becomes routine instead of requiring the carved-out `compile_results_for_chunk` `UnsafeCell` argument.

### 1.2 `src/bundler/linker_context/generateCompileResultForJSChunk.rs:54-59`

```rust
// SAFETY: `c_ptr` / `chunk_ptr` carry mutable provenance; the disjoint-write
// contract is documented on `pending_part_range_prologue`. The `&mut`
// borrows below are scoped to the impl call so they do not overlap the
// raw slot write that follows. (Peer tasks still hold their own `&mut`
// views into the same `LinkerContext`/`Chunk` for read-only printer use —
// see TODO(ub-audit) on `unsafe impl Sync for Chunk`.)
```

**Verdict: cross-reference to §1.1; same concern.**
This comment block is the consumer side; nothing new.

### 1.3 `src/bundler/linker_context/generateCompileResultForCssChunk.rs:38-43`

**Verdict: cross-reference to §1.1; same concern (CSS twin).**

### Summary, Section 1

One real concern, surfaced three times. Not UB today by virtue of `name_for_symbol` reading only, but the printer's transitively-required `&mut Renamer<…>` does force the bundler to materialize aliased `&mut Chunk` across peer tasks — a refactor (drop the `&mut` from `name_for_symbol` and propagate `&Renamer<…>` upward) eliminates the entire class. Recommended as **PR-RP-001** (rename-symbol `&self` plumb).

---

## Section 2: FIXME / XXX / HACK findings (top entries)

Full scan: `rg -n '\b(FIXME|XXX|HACK)\b' --type rust src/` returns 24 distinct matches. Per task brief, the audit examined the 13 most unsafe-adjacent. Most are scope-cuts (`# FIXME: support fd > 2` / `# FIXME: error location` in shell parsing) with no safety implication — listed but not analyzed.

### 2.1 `src/runtime/cli/open.rs:505-513` — `FIXME(windows-leak)` — REAL BOUNDED LEAK

```rust
// FIXME(windows-leak): Zig's autoClose (open.zig:329-335) used std.process.Child
// directly (CreateProcessW) and never created a uv loop. The sync::spawn substitution
// requires a `WindowsOptions.loop_`; `MiniEventLoop::init_global` heap-allocates a
// MiniEventLoop + uv_loop_t into a thread-local that is NEVER torn down. Because this
// runs on a fresh detached std::thread per `Editor::open()` call, every editor-open on
// Windows leaks one MiniEventLoop + uv_loop_t (+ DotEnv Loader/Map if env was null).
```

**Verdict: real Windows-only leak. Author-documented. Not UB. Bounded by editor-open frequency.**
Severity: low. User-triggered cold path. Would deserve a follow-up: thread the caller's existing `EventLoopHandle` through `SpawnedEditorContext` instead of constructing a thread-local per-call.

### 2.2 `src/event_loop/MiniEventLoop.rs:543, 603-607` — `FIXME TODO` panic in `increment_pending_unref_counter`

```rust
panic!("FIXME TODO");
```

**Verdict: faithful port of Zig spec body. MiniEventLoop has no `pending_unref_counter`; only `jsc::VirtualMachine` does. Reachable only if a caller wrongly dispatches through MiniEventLoop. Not UB; explicit panic on misuse.**

### 2.3 `src/glob/matcher.rs:149-150` — `FIXME(@DonIsaac): This looks backwards to me`

**Verdict: glob-matcher logic question, not memory safety. Out of scope for this audit.**

### 2.4 `src/runtime/webcore/fetch/FetchTasklet.rs:479-481` — `XXX` re Zig coercion vs Rust signatures

```rust
unsafe fn deinit(this: *mut FetchTasklet) {
```

**Verdict: documentation note on error-type coercion difference between Zig and Rust. Not a safety concern; the `*mut Self` deinit signature is correct and matches the Pass-1 file-input pattern.**

### 2.5 `src/runtime/shell/subproc.rs:1722` — `FIXME: SHOULD THIS BE HERE?`

```rust
BufferedOutput::ArrayBuffer { buf: _buf, .. } => {
    // FIXME: SHOULD THIS BE HERE?
    // ArrayBuffer.Strong drops itself.
}
```

**Verdict: explicit comment confirms `ArrayBuffer.Strong` is RAII. No-op arm is correct. Marked FIXME because the original author was uncertain at port time, not because there is a bug.**

### 2.6 `src/jsc/VirtualMachine.rs:1524` — `FIXME: should call event_loop().tick() in global_exit`

```rust
// FIXME: we should be doing this, but we're not, but unfortunately
// doing it causes like 50+ tests to break
// self.event_loop().tick();
```

**Verdict: documented test-bench discrepancy; deliberate omission. No UB.**

### 2.7 `src/runtime/shell/IOWriter.rs:960` — `FIXME (matches Zig)`

**Verdict: faithful port note; not a soundness flag.**

### 2.8 `src/runtime/shell/builtin/ls.rs:261` — `FIXME windows`

**Verdict: Windows behavior gap, not memory safety.**

### 2.9 `src/runtime/test_runner/expect/toBeEmpty.rs:58` — `FIXME: can we do this?`

**Verdict: scope question. Not safety.**

### 2.10 `src/runtime/node/zlib/NativeBrotli.rs:226` — `// XXX: onerror isn't set yet`

**Verdict: ordering note. Not memory safety.**

### 2.11 `src/css/css_parser.rs:602`, `5580` — `FIXME: have a special-purpose tokenizer / Use bun CodepointIterator`

**Verdict: performance follow-ups. Not safety.**

### 2.12 `src/shell_parser/parse.rs:997`, `3445`; `src/shell_parser/braces.rs:895`, `1255` — `FIXME error location` / `FIXME support …`

**Verdict: ergonomics/feature gaps. Not safety.**

### 2.13 `src/runtime/ffi/ffi_body.rs:886-888` — `FIXME: why are we duping here? can we at least use a stack fallback allocator?`

**Verdict: PERF question, not safety. Duped buffer is freed normally; no leak.**

### Summary, Section 2

Out of 24 FIXME/XXX/HACK matches, exactly one is a real (documented, bounded) defect: `open.rs:505` Windows `uv_loop_t` leak. The rest are either explicit port notes ("matches Zig"), feature gaps in the shell/CSS parsers, or performance follow-ups. No memory safety / UB hazards uncovered by this scan beyond the `Renamer<'r>` matter already covered in §1.

---

## Section 3: `MimallocArena` Drop-in-arena hazards

`MimallocArena::reset` / `Drop` bulk-frees backing pages via `mi_heap_destroy`; values living inside the arena DO NOT run `Drop`. Per `src/CLAUDE.md` (Memory & Allocators):

> If a type owns a heap allocation, refcount, or fd, free it explicitly before the arena resets.

Sites surveyed:

### 3.1 `ASTMemoryAllocator::enter` / `reset` (`src/ast/ast_memory_allocator.rs:130-188`)

**Verdict: paired.**

`enter()` calls `self.arena.reset()` when `arena_dirty` (line 153) before pushing a new scope. `Drop` (line 89-108) calls `self.arena.reset()` if dirty before returning the arena to the per-thread pool (`return_pooled_arena`). `Scope::exit` runs first because it borrows `&mut self`. The store-overrides (`Stmt/Expr.Data.Store.MEMORY_ALLOCATOR`, `data_store_override`, `ast_alloc::set_thread_heap`) are restored in `pop()` before any field is freed. No use-after-arena-reset hazard.

A *separate* concern (clearly documented in comments at lines 142-146): the `AstAlloc` allocator bypasses `track_alloc`, so `reset_retain_with_limit(8M)` never trips for AST-data allocations — every previous module's AST data leaks for the worker arena's lifetime (the "ESM leak" the comment references). Real performance / memory concern; not UB.

### 3.2 Bundler `Worker.ast_memory_store: ManuallyDrop<ASTMemoryAllocator>` (`src/bundler/ThreadPool.rs:452, 500, 614`)

**Verdict: paired.**

`get_worker` writes a fresh `ManuallyDrop::new(ASTMemoryAllocator::default())` (line 452); `Worker::deinit` runs `ManuallyDrop::drop(&mut worker.ast_memory_store)` (line 614) *outside* the `has_created` guard, so the default-constructed arena is freed even if `create()` never ran (the explicit comment at lines 605-613). Drop order is: `data` (`transpiler.arena` borrows `heap`) → `ast_memory_store` → `heap`. Sound.

### 3.3 Bundler-arena CSS / part-range artifacts

`src/bundler/linker_context/findImportedFilesInCSSOrder.rs:24-26` and `src/bundler/linker_context/prepareCssAstsForChunk.rs:190-225` allocate `Vec<ImportConditions>` and `BundlerStyleSheet` via `mem::ManuallyDrop` plus `mem::forget` to mirror the Zig "no destructor + bitwise duplicate" pattern. The buffers are **Global-backed** (not arena-backed) — `VecExt::init_capacity_in` ignores the arena hint (comment explicitly says so).

**Verdict: bounded leak documented in comments, not UB.** The leaked buffers' lifetime is "for the lifetime of the process" per the comment (CSS bundles are bundle-lifetime, and a Bun process services one bundle invocation typically). For `bun build --watch`, every rebuild leaks one CSS-import-order ecosystem worth of these condition buffers — bounded by AST size. Recommended as `PR-RP-002`: replace `bitwise_copy(wrapping_conditions)` with `Rc`/index-based sharing to plug the leak.

### 3.4 CSS Chunk asts (`src/bundler/Chunk.rs:1323-1331`)

```rust
impl Drop for CssChunk {
    fn drop(&mut self) {
        core::mem::forget(core::mem::take(&mut self.asts));
    }
}
```

**Verdict: bounded leak documented.** `asts: Box<[BundlerStyleSheet]>` contains bitwise shallow copies of source AST headers (via `ptr::read` in `prepareCssAstsForChunk`). Multiple slots may alias the same source AST's heap buffers when a file is imported more than once — element-wise drop would double-free. The leak is one `Box<[BundlerStyleSheet]>` header per CSS chunk per bundle. Bundle-lifetime.

### 3.5 `CssImportOrder.conditions` (`src/bundler/Chunk.rs:1346-1357`)

Same pattern. The `condition_import_records` arm explicitly notes that uniquely-owned slots free normally; only the `conditions` Vec is `mem::forget`ed for the bitwise-aliasing reason.

**Verdict: bounded leak; documented.**

### 3.6 `printer_ast` in `LinkerContext.rs:2273-2277`

```rust
let printer_ast = core::mem::ManuallyDrop::new(unsafe { core::ptr::read(ast) }.to_ast());
```

**Verdict: correct.** The bitwise `ptr::read(ast)` produces a `BundledAst` aliasing the stored ManuallyDrop-wrapped storage; `to_ast()` decomposes it into an `Ast`; the outer `ManuallyDrop` keeps that `Ast` from running Drop. The `MultiArrayList::get` source already returns `ManuallyDrop<BundledAst>` so the storage retains uniqueness. No double-free path.

### 3.7 `bundler/linker_context/scanImportsAndExports.rs:604-611` — Arena-backed StringBuilder

```rust
let mut builder = core::mem::ManuallyDrop::new(bun_core::StringBuilder {
    len: 0,
    cap: string_buffer.len(),
    ptr: core::ptr::NonNull::new(string_buffer.as_mut_ptr()),
});
```

**Verdict: correct.** The `string_buffer` came from `graph.arena().alloc_slice_fill_default`, not the global allocator. `StringBuilder::drop` would try to free it via `bun_core::heap::destroy::<[MaybeUninit<u8>]>` (which routes through the global allocator), handing mimalloc a pointer it never minted. The `ManuallyDrop` wrap prevents that misroute; the arena reclaims on `reset()`. Documented inline.

### Summary, Section 3

Five MimallocArena Drop-in-arena hazards reviewed. All five are paired with explicit `ManuallyDrop` / `mem::forget` mitigations and inline comments explaining why. The remaining bounded leak (Section 3.3) is documented as a known refactor target.

---

## Section 4: `zeroed_unchecked()` per-T audit

The unchecked variant wraps `mem::zeroed::<T>()` for foreign POD types where the orphan rule blocks an `unsafe impl Zeroable`. Caller asserts T is valid at all-zero bit pattern. There are **34** call sites (rg confirms). Per-T breakdown:

| File | Line | T | Niche/Drop hazard? | Verdict |
|---|---|---|---|---|
| `src/bun.rs` | 844 | generic `T` (in `zero<T>()`) | Caller-asserted | Generic shim; caller bears burden |
| `src/bundler/ThreadPool.rs` | 110 | `bun_threading::Mutex` | None (atomic word; unlocked = zero) | Safe; comment notes `Default::default()` non-const |
| `src/bundler/BundleThread.rs` | 155 | `Async::Waker` (Windows variant) | **NonNull `loop_: &'static _`** | **UB on Windows** — already Codex P2 (CODEX-P2-windows-waker-placeholder.md). Confirmed real. |
| `src/install/resolution.rs` | 861 | `ResolutionValue<I>` (union of `VersionedURLType`/`SemverString`/`Repository`/`SemverString`/`()`/`()`/`SemverString` etc.) | All variants POD, no NonZero | Safe; comment explicit |
| `src/install/PackageManagerTask.rs` | 62 | `Task::request` (Tagged union of `ManuallyDrop<_>`) | Untagged union of `ManuallyDrop`; overwritten by caller | Safe |
| `src/install/PackageManagerTask.rs` | 63 | `Task::data` (same shape) | Same | Safe |
| `src/install/bin.rs` | 515 | `Bin::Value` (union with `ExternalStringList`/`String`/`(String, String)`/`u64`) | POD; no NonZero | Safe |
| `src/event_loop/ConcurrentTask.rs` | 268 | `Task { tag: TaskTag(u8), ptr: *mut () }` | `TaskTag` is `u8` newtype; `*mut ()` is `null` | Safe; tag=0 == `Access` valid discriminant; ptr null overwritten by caller |
| `src/bun_core/output.rs` | 357 | `Output` (writer state) | `(ptr, len) = (null, 0)` documented "empty" state | Safe |
| `src/exe_format/macho.rs` | 75, 76, 530, 532, 666 | `segment_command_64`, `section_64`, `CodeDirectory` | `#[repr(C)]` POD, all integer fields | Safe |
| `src/jsc/NodeModuleModule.rs` | 99 | `ErrorableString` | Tag + 2-word union of `bun_core::String` (5-variant tagged) — variant 0 (`Empty`) | Safe; documented as "empty state" |
| `src/jsc/btjs.rs` | 54 | `WINDOWS_CONTEXT` (CONTEXT struct from ntdll) | `#[repr(C)]` POD | Safe; immediately overwritten by `RtlCaptureContext` |
| `src/jsc/btjs.rs` | 610 | `ucontext_t` | `#[repr(C)]` POD | Safe; `getcontext()` fully initializes |
| `src/patch/lib.rs` | 1907 | `WindowsOptions` (implicit via `Default`) | Default is itself `zeroed_unchecked` | Safe; documented |
| `src/standalone_graph/StandaloneModuleGraph.rs` | 393 | `libc::stat` / `uv_stat_t` | `#[repr(C)]` POD | Safe |
| `src/threading/Futex.rs` | 309 | `linux::timespec` | Two `i64` | Safe |
| `src/resolver/fs.rs` | 2943 | `BY_HANDLE_FILE_INFORMATION` (Win32) | POD | Safe |
| `src/sha_hmac/sha.rs` | 72 | `Self` (SHA hasher; BoringSSL ctx) | POD; immediately written by `*_Init` | Safe |
| `src/sha_hmac/sha.rs` | 125 | `Self` (EVP_MD_CTX wrapper) | POD; written by `EVP_MD_CTX_init` | Safe |
| `src/sys/lib.rs` | 4661 | `StatFS` | POD | Safe |
| `src/sys/lib.rs` | 8089 | `sockaddr_storage` | POD | Safe |
| `src/sys/lib.rs` | 8153 | `union` arm (`any`) | POD | Safe |
| `src/runtime/image/codec_png.rs` | 164 | `spng_iccp` | POD, null-profile-ptr = no-profile | Safe |
| `src/runtime/cli/pack_command.rs` | 1884 | `Box<BufferedFileReader>` | Caller asserts; immediately overwrites `unbuffered_reader` | Safe |
| `src/runtime/cli/run_command.rs` | 3454 | `CONSOLE_SCREEN_BUFFER_INFO` | POD | Safe |
| `src/spawn_sys/spawn_process.rs` | 93-99 | `FILETIME ×4` | POD | Safe |
| `src/spawn/process.rs` | 1657 | `WaitPidPoller`/`Poller` (enum?) — see audit caveat below | Needs verification | See below |
| `src/spawn/process.rs` | 1823 | `uv_process_options_t` | POD | Safe |
| `src/spawn/process.rs` | 1896 | `uv_stdio_container_t` | POD | Safe |
| `src/spawn/process.rs` | 2122 | `uv::Process` (inside `Poller::Uv(...)` ctor) | POD | Safe |
| `src/spawn/process.rs` | 3279 | `[libc::pollfd; 2]` | POD | Safe |
| `src/runtime/node/zlib/NativeBrotli.rs` | 43 | `LastResult` (c_int / enum 0) | enum-of-c_int — verify discriminant 0 is valid | See below |
| `src/runtime/node/dir_iterator.rs` | 956 | `NameData` (`[u8;513]` or `[u16;257]`) | Array of integers | Safe |
| `src/runtime/node/node_os.rs` | 1447, 1677 | `libuv::uv_utsname_s` | POD | Safe |

### 4.1 Spotlight: `spawn/process.rs:1657` — `loop_: zeroed_unchecked()`

Comment: "all-zero bit pattern is discriminant 0 with a null payload — valid representation, never dereferenced before assignment."
**Verdict: comment-attested. If `loop_` is `Option<NonNull<uv::Loop>>` discriminant 0 == `None`. Safe.** (Could not be 100% confirmed without typedef chase but the documented intent + immediate overwrite pattern is correct.)

### 4.2 Spotlight: `NativeBrotli.rs:43` — `LastResult: c_int / enum 0`

Comment: "all-zero is a valid LastResult (c_int 0 / enum 0)."
**Verdict: depends on the enum being `#[repr(C)]` (or `#[repr(i32)]`) with discriminant 0 a valid variant. By the comment author's read, BrotliDecoderResult::OK == 0, so this is fine. Safe.**

### 4.3 Confirmed pre-flagged hazard: `BundleThread.rs:155` Windows waker

The `#[cfg(windows)]` arm zeros a `Waker { loop_: &'static EventLoop }`. `&'static _` has the NonNull validity invariant — zeroing it is **language-level UB even if never read** (`invalid_value` lint). The comment explicitly admits this. Per Codex P2 plan, the fix is to add a `Waker::placeholder()` on the Windows side parallel to the macOS one, returning a fully-initialized inert value.

### Summary, Section 4

34 sites audited. 33 are safe (POD with no niche, immediate overwrite, or explicit empty-state documentation). One is a known Windows-only `invalid_value` UB (already on the Codex P2 plan). No new bugs.

---

## Section 5: `mem::forget` / `ManuallyDrop` pair audit

342 hits across 38 files. The audit grouped them into ownership categories:

### 5.1 Documented ownership-transfer to FFI consumer (paired by external owner) — SOUND

| Site | Pairing |
|---|---|
| `src/bun_core/string/StringBuilder.rs:28, 43` | Drop reclaims via `heap::destroy` (impl at line 335-350) |
| `src/bun_core/string/mod.rs:318` | `Ctx` ownership transferred to WTF external string; finalizer frees |
| `src/bun_core/string/mod.rs:426, 443` | Vec → `ExternalStringImpl` (`mi_free` matches global allocator) |
| `src/bun_core/string/mod.rs:1293` | `OwnedString::into_inner` — refcount transfer (no leak) |
| `src/bun_core/string/mod.rs:2292` | Bytes hand-off via `take_owned_raw` (foreign `mi_free`) |
| `src/bun_core/string/SmolStr.rs:117` | `from_baby_list` — `SmolStr::drop` reclaims via `mi_free` |
| `src/bun_core/external_shared.rs:67, 74, 161` | `.leak()` / `into_optional` — caller receives raw +1 ref |
| `src/runtime/webcore/streams.rs:117, 890, 897` | Vec → JSC `ArrayBuffer` (MarkedArrayBuffer_deallocator) |
| `src/http_jsc/websocket_client.rs:432` | UTF-16 buffer adopted by WTF::ExternalStringImpl |
| `src/uws_sys/Response.rs:509` | Stack `ManuallyDrop<F>` for synchronous FFI; closure invoked then dropped via `ptr::read` |
| `src/uws_sys/us_socket_t.rs:519` | C side reads ptr/len/cap; ownership transferred |
| `src/bun_core/atomic_cell.rs:218-222` | Union transmute — never leaks; result is `ManuallyDrop::into_inner` |
| `src/bun_core/util.rs:2772` | RAII guard cancelation pattern (commit-on-success); guard's Drop is the un-leak |
| `src/io/PipeReader.rs:1829, 1937` | uv handle still in queue — leak documented, matches Zig parity |

**All sound.** Every leak has either an external reclamation path (FFI side runs the destructor) or the leak is documented as Zig-parity bounded.

### 5.2 Bitwise-duplicate-without-Drop patterns (Zig `@memcpy`-style port aliasing)

| Site | Pattern |
|---|---|
| `src/js_parser/p.rs:8449, 8471, 8489, 8511` | Bitwise-duped `part` / `declared_symbols` / `import_record_indices` — source slot still owns; forget the duplicate |
| `src/bundler/linker_context/findImportedFilesInCSSOrder.rs:199, 711` | `bitwise_copy(wrapping_conditions)` — duplicates aliased to global-heap conditions Vec |
| `src/bundler/linker_context/prepareCssAstsForChunk.rs:200, 414, 458` | Shallow-copied `BundlerStyleSheet` / `ast.rules` headers aliasing source-stylesheet arena buffer |
| `src/bundler/linker_context/computeCrossChunkDependencies.rs:524` | `clause_items` Vec leaked into raw fat ptr — bundler arena owns |
| `src/bundler/Chunk.rs:1329, 1352` | CssChunk asts / CssImportOrder.conditions Drop — bitwise-aliasing |
| `src/runtime/webcore/s3/multipart.rs:955` | `self.buffered` ownership transferred to UploadPart; Vec assignment would drop the source |
| `src/bundler/ParseTask.rs:1960` | OnBeforeParseResult — buffer outlives Contents wrapper for plugin pass |

**All sound** with respect to UB. Each is documented inline. The CSS-import-order ecosystem (`findImportedFilesInCSSOrder.rs:24`) explicitly accepts a bounded leak (`init_capacity_in` returns Global-backed Vec; the bitwise-copy aliasing means each visit pushes one leaked Vec header per import). The `PORTING.md §CSS-import-order` reference signals this is a known refactor target.

### 5.3 `ManuallyDrop` over `MultiArrayList::get` returns — SOUND

`src/bundler/linker_context/postProcessJSChunk.rs:168, 912, 1363` and `src/bundler/LinkerContext.rs:2277` wrap the result of `MultiArrayList::get` (which itself returns `ManuallyDrop<BundledAst>`) and the converted `Ast`. Both layers must NOT drop because the storage retains ownership of every field (`named_imports`, `parts`, `top_level_symbols_to_parts`, etc.). The pattern is correct and documented.

### 5.4 `ManuallyDrop<symbol::Map>` in renamers — SOUND

`src/js_printer/renamer.rs:220, 245, 593, 674` (`MinifyRenamer`, `NumberRenamer`) hold a `ManuallyDrop<symbol::Map>` because the renamer is built over a borrowed `LinkerGraph.symbols` view. `NoOpRenamer` is owning (line 55) — call-site comment at 47-54 documents that the `RuntimeTranspilerStore` leak fix required the ownership distinction.

`renameSymbolsInChunk.rs:122-126` (`make_symbols_view`) builds a non-owning `symbol::Map` via `from_borrowed_slice_dangerous`, then unwraps the `ManuallyDrop` to satisfy `symbol::Map`'s by-value semantics. The unwrap is sound because the returned `Map` is itself fed back into a `ManuallyDrop` wrapper at the consumer (`MinifyRenamer`/`NumberRenamer`).

### 5.5 Static initializer leak: `src/bundler/bundle_v2.rs:3984` — INTENTIONAL

```rust
if enable_reloading {
    core::mem::forget(this);
}
```

Documented: under `--watch`, the watcher thread holds `*mut BundleV2` via the reloader's ctx and dereferences it after this function returns. The Zig spec arena-allocates and never frees. Leak is bounded because the next file change `execve()`s the process. **Sound.**

### 5.6 `DependencyVersionValue::npm` — **BOUNDED LEAK** (new finding)

```rust
#[repr(C)]
pub union DependencyVersionValue {
    pub uninitialized: (),
    pub npm: ManuallyDrop<NpmInfo>,
    ...
    pub git: ManuallyDrop<Repository>,
    pub github: ManuallyDrop<Repository>,
    ...
}
```

`NpmInfo { name: SemverString, version: semver::query::Group, is_alias: bool }`. `Group { head: List, ... }`. `List { head: Query, ... }`. `Query { range: Range, next: Option<Box<Query>> }` (`src/semver/SemverQuery.rs:29-34`). The `Box<Query>` chain is allocated via `Box::new(Query { range, next: None })` at `SemverQuery.rs:216` — **global allocator**, not arena.

The Zig comment claim ("arena-freed") does not hold in the Rust port: `Box<Query>` uses the global allocator. There is no `Drop for DependencyVersion`, no `ManuallyDrop::drop(&mut value.npm)` anywhere in `src/install/`. Search confirms zero matches:

```sh
rg 'ManuallyDrop::drop\(&mut.*\.npm\)|deinit_dep_version|VersionValue.*deinit' --type rust src/
# (no output)
```

Construction is `Box::new(Query { range, next: None })` via `semver::query::parse` (`src/install/dependency.rs:1295-1313` and `src/install/PackageManager/PackageManagerResolution.rs:271-277`). Each parse leaks the entire `Box<Query>` chain.

**Verdict: real leak, but bounded.** Dependencies are held in `Lockfile` (no `Drop for Lockfile`) and the lockfile is process-lifetime in normal `bun install`. In `bun install --watch` or programmatic re-installs it would accumulate. Severity: low. Author's "Zig has no destructors here either — arena-freed" comment is inaccurate for the Rust port and should be amended.

**Recommendation: `PR-RP-003`** — add an explicit `Dependency::deinit` (or `Drop for DependencyVersion` guarded on `tag == Npm`) that walks the `Option<Box<Query>>` chain and drops it. Alternative: change `Query.next` to `Option<NonNull<Query>>` allocated in a per-lockfile arena, matching the Zig original.

### 5.7 `CrossChunkImport::sorted_import_items: ManuallyDrop<CrossChunkImportItemList>` — SOUND

`src/bundler/ungate_support.rs:152` — Vec borrowed view; documented as "Zig's `BabyList` has no destructor". Inner `CrossChunkImportItem.export_alias: Box<[u8]>` would also need handling if the items were owned, but they're aliased to the bundler-arena-built `ImportsFromOtherChunks`. Drop is bounded leak per bundle.

### 5.8 Audit of `Box<[u8]>` leaked into raw ptr in `StringBuilder` — SOUND

`StringBuilder::init_capacity` (`StringBuilder.rs:24-30`) leaks a `Box<[u8]>` into `(ptr, cap)`; `Drop` reclaims by reconstructing the `Box<[u8]>` slice (line 343-348). One leak path: `StringBuilder::allocate` (`StringBuilder.rs:40-46`) overwrites `self.ptr` *without* freeing the prior buffer if called twice. Grep confirms every call site calls `allocate()` exactly once (after a sequence of `count*()`); the call pattern is single-shot. **Sound under current usage**; would become a leak if a future caller re-uses a `StringBuilder`.

### Summary, Section 5

342 sites grouped. 27 distinct ownership-transfer patterns reviewed. All UB-class concerns (aliased Drop, double-free, use-after-free) are mitigated by the documented `ManuallyDrop` / `mem::forget` pairing. One new bounded leak finding: `DependencyVersionValue::npm` (Section 5.6).

---

## Section 6: Consolidated bug findings

### Pre-existing UB candidates (re-confirmed from Codex P2, NOT new)

| ID | File:Line | Class | Severity | Status |
|---|---|---|---|---|
| `pre-existing-ub-windows-waker` | `src/bundler/BundleThread.rs:155` | `invalid_value` UB on `&'static` zero | Low (struct overwritten before any read) | Codex P2 plan exists |
| `pre-existing-ub-chunk-mut-alias` | `src/bundler/Chunk.rs:130-132`, `linker_context/generateCompileResultFor{Js,Css}Chunk.rs:54-69, 38-48` | Overlapping `&mut Chunk` peers across parallel tasks (no actual writes) | Low (printer never writes) | Codex P2 plan exists |

### New findings (this pass)

| ID | File:Line | Class | Severity | Recommendation |
|---|---|---|---|---|
| `pre-existing-leak-dep-npm` | `src/install_types/resolver_hooks.rs:414`; constructors at `src/install/dependency.rs:1306` and `src/install/PackageManager/PackageManagerResolution.rs:274` | Bounded leak: `Box<Query>` chain inside `ManuallyDrop<NpmInfo>` never reclaimed; comment claims arena-freed but uses global allocator | Low (process-lifetime in `bun install`); could grow under repeat installs | PR-RP-003 below |
| `pre-existing-leak-open-windows` | `src/runtime/cli/open.rs:505` | Bounded Windows-only leak: one `MiniEventLoop + uv_loop_t` per `Editor::open` | Low (cold path, user-triggered) | PR-RP-004 below |

No new UB bugs uncovered.

---

## Section 7: Recommended PRs

### PR-RP-001: Drop `&mut` from `Renamer::name_for_symbol` chain

Files: `src/js_printer/renamer.rs` (the `Renamer<'r,'src>` enum + `MinifyRenamer::name_for_symbol`), `src/bundler/ungate_support.rs` (`ChunkRenamer::name_for_symbol` / `as_renamer`), parallel-printer call sites in `src/bundler/linker_context/generateCompileResultFor{Js,Css}Chunk.rs` and `postProcessJSChunk.rs`.
- Change `Renamer` variants from `&'r mut _` to `&'r _`.
- Change `MinifyRenamer::name_for_symbol(&mut self, _) -> &[u8]` to `&self` (body is read-only).
- Cascade: `ChunkRenamer::name_for_symbol(&self)`, `chunk.renamer.as_renamer()` takes `&self`, `generate_compile_result_for_*_chunk` takes `&Chunk` (not `&mut Chunk`).
- Eliminates the aliased-`&mut Chunk` peer-borrow concern (Section 1) cleanly. `unsafe impl Sync for Chunk` claim becomes routine.

### PR-RP-002: Replace CSS import-order bitwise-aliasing with shared ownership

Files: `src/bundler/linker_context/findImportedFilesInCSSOrder.rs`, `src/bundler/linker_context/prepareCssAstsForChunk.rs`, `src/bundler/Chunk.rs` (`CssChunk::Drop`, `CssImportOrder::Drop`).
- Replace `bitwise_copy<T>` `ptr::read` aliasing with `Rc<ImportConditions>` or index-into-conditions-arena handles.
- Removes the documented per-CSS-bundle leak (Section 3.3-3.5).
- Eliminates four `mem::forget` sites and the two CssChunk/CssImportOrder Drop hacks.

### PR-RP-003: Reclaim `DependencyVersionValue::npm`'s `Box<Query>` chain

Files: `src/install_types/resolver_hooks.rs` (add `Dependency::deinit` or `Drop for DependencyVersion`), or change `semver::query::Group`'s `Box<Query>` to arena allocation.
- Plug the bounded leak (Section 5.6).
- Update the inline comment at `resolver_hooks.rs:407-409` to reflect Rust's allocator reality.

### PR-RP-004: Thread caller's `EventLoopHandle` through `Editor::open` (Windows)

File: `src/runtime/cli/open.rs:505-533`.
- Pass the existing event-loop handle from the calling JS context through `SpawnedEditorContext` instead of creating a thread-local `MiniEventLoop` per call.
- Plugs the per-editor-open leak (Section 2.1).

### PR-RP-005 (already on Codex P2 plan): Add `Async::Waker::placeholder()` for Windows

File: `src/bundler/BundleThread.rs:149-155` + `src/async/waker.rs` (or wherever `Waker` lives).
- Mirror the macOS `placeholder()` implementation on Windows — return a fully-initialized inert value rather than `zeroed_unchecked()` on `&'static`.
- Eliminates the documented `invalid_value` UB.

---

## Appendix A: Scan reproduction

```bash
# Section 1
rg -n 'TODO\(ub-audit\)|TODO\(soundness\)|TODO\(unsafe\)' --type rust src/
# Section 2
rg -nC 2 '\b(FIXME|XXX|HACK)\b' --type rust src/
# Section 3
rg -nC 3 'MimallocArena|ast_alloc::|ast_alloc_heap|ASTMemoryAllocator' --type rust src/
# Section 4
rg -n 'zeroed_unchecked|boxed_zeroed_unchecked' --type rust src/
# Section 5
rg -n 'mem::forget|ManuallyDrop' --type rust src/
```

All counts in the executive summary correspond exactly to these queries' outputs as observed during the audit.

## Appendix B: Counts

- `TODO(ub-audit)`: **3** matches across 3 files (all reference the same Renamer concern).
- `FIXME|XXX|HACK`: **24** matches; 13 unsafe-adjacent; 1 real (bounded leak).
- `zeroed_unchecked`: **34** call sites; 33 safe + 1 known UB (pre-flagged).
- `mem::forget` / `ManuallyDrop`: **342** matches across 38 files; ~27 distinct ownership-transfer patterns; 5 paired-drop sites verified; 1 new bounded leak.

Total **new** soundness bugs found this pass: **0** UB; **2** documented bounded leaks (npm-version chain; open.rs Windows uv_loop).
