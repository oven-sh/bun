# Section O: alloc-and-collections

## Purpose

Section O covers Bun's foundational memory and container layer: the `bun_alloc` crate (global mimalloc, `MimallocArena`, AST bump arena, fallback/stack/null/buffer-backed allocators, BSS pools, the WTFStringImpl FFI surface, and the Darwin heap-breakdown zone) and the `bun_collections` crate (`MultiArrayList` SoA, `LinearFifo`, `HiveArray` slot pool, `BitSet`/`DynamicBitSetList`, `ArrayHashMap`/`StringHashMap`, intrusive `Pool`, and the `vec_ext` extension traits that Zig-shaped `ArrayList` callers depend on). Together they are the lowest unsafe layer in the workspace — every higher crate borrows allocator handles, column slices, and slot tokens defined here, and every novel-allocator or novel-container UB in Bun originates somewhere in this section.

## Unsafe-surface tally (vs prior 430)

Current keyword-`unsafe` sites: **457** (bun_alloc 308, bun_collections 149). **+27** vs the audit prior of 430. The increase is **not** a regression in safety posture — it comes from the `4d443e5402` MAL refactor (next section) introducing two thin typed-column-view structs whose constructors are safe but whose `as_slice`/`as_mut_slice` methods own the workspace's *only* `from_raw_parts*` in MAL, plus the `__mal_split_mut_impl` macro that emits one `from_raw_parts_mut` per field at the call site (a single MAL element struct with N fields contributes N additional source-direct `unsafe` per `split_mut()` instantiation). SAFETY-comment coverage stayed dense (318 across the section); the new sites all carry SAFETY blocks tied to module invariants (`INVARIANT:column_base`, `INVARIANT:col`).

## multi_array_list.rs post-refactor surface

Refactor `4d443e5402` (#30726, "funnel multi_array_list SoA ops through Col/ColMut primitives") was a substantial safety-posture upgrade that fundamentally re-shaped MAL's unsafe surface:

- **Col / ColMut primitives** (`src/collections/multi_array_list.rs:486-538`): two `'a`-bounded wrappers around `(NonNull<F>, usize)`. `Col::new`/`ColMut::new` are safe-but-internal (module invariant `INVARIANT:col`: "non-null, `F`-aligned, dangling-or-pointing-into-a-column-of-≥-len-initialized-Fs-valid-for-'a"). Only their `as_slice`/`as_mut_slice` carry `unsafe`, and those are the **only** `slice::from_raw_parts*` calls in MAL's row-op path. Aliasing model: shared `&'a [F]` for `Col`, exclusive `&'a mut [F]` for `ColMut` enforced by `PhantomData<&'a mut [F]>` plus `&mut self` on every caller. Soundness depends on `INVARIANT:col`, which every internal caller upholds, and on the documented `Slice<T>: Copy` "known soundness gap" (lines 564-568) that lets two slice copies overlap mutably. EXP-014 now has a Tree-Borrows mirror witness confirming this local API hole.
- **SoA growth path** (`set_capacity`, `shrink_and_free`, `clone`, `append_list_assume_capacity`, `insert_assume_capacity`, `ordered_remove`, `swap_remove`): every per-row mutation previously written as direct `ptr::copy[_nonoverlapping]` over `*mut u8` is now `Slice::copy_rows_within` / `copy_rows_from` / `swap_rows` / `scatter` / `gather`, all of which operate on `&mut [MaybeUninit<u8>]` views produced via `ColMut<'_, MaybeUninit<u8>>` and use **safe** `<[MaybeUninit<u8>]>::copy_within` / `copy_from_slice` / `swap_with_slice` / `split_at_mut`. `scatter` and `gather` remain `unsafe` for the per-field byte copy (`ptr::copy_nonoverlapping` between the stack `T` and column slots) — irreducible, since per-field metadata is dynamic.
- **`set_len` calls**: exactly one (`MultiArrayList::set_len`, line 1265, `pub unsafe fn`, caller-contract documented). Internal mutators advance `self.len` directly (private field). No internal `set_len` calls in the growth path.
- **`NonNull<u8>` field migration**: `Slice::ptrs` and `MultiArrayList::bytes` are now `NonNull<u8>` arrays/scalars rather than `*mut u8`. The `ptr::NonNull::new_unchecked` previously surrounding `deallocate` (prior `S-001064`, `S-001066`) is gone — `free_allocated_bytes` and `Drop` both pass `self.bytes` straight to `Allocator::deallocate`. `EMPTY`/`new_in` initialize to `Reflected::<T>::DANGLING` (an aligned `NonNull<T>::dangling().cast::<u8>()`), retiring the `null_mut()` sentinel and its accompanying capacity-guarded branches.
- **`__mal_split_mut_impl` macro** (lines 187-208): the new safe replacement for `items_raw` + per-call-site `unsafe { &mut * }` patterns. Macro-expansion contributes one `from_raw_parts_mut` per field at every `multi_array_columns! { … }` instantiation; SAFETY rationale ("distinct columns of a `MultiArrayList` occupy non-overlapping byte ranges within one allocation; `&mut self` guarantees exclusive access") is correct.
- **Net delta**: keyword-`unsafe` count dropped from 30 → 15 in this file, but the macro adds 1 site per field per call site (Phase 2 expansion needed for a true count). Soundness posture is meaningfully improved — the row-op `unsafe` budget went from "every shift/swap is a raw pointer arithmetic" to "one `column_base` GEP + two `from_raw_parts*` audited sites + irreducible `scatter`/`gather`."

## linear_fifo.rs anchor status (EXP-001)

**Current state of `assume_init_slice<T>` helper** (`src/collections/linear_fifo.rs`, lines 62-80):

```rust
/// Reinterpret `&[MaybeUninit<T>]` as `&[T]`. `MaybeUninit<T>` has identical
/// layout to `T`; exposing uninitialized bytes as `T` is sound only when any
/// bit pattern is a valid `T` (in-tree LinearFifo users are byte buffers —
/// see the `StaticBuffer` TODO below). Centralises the four per-buffer-kind
/// casts behind one audited block.
#[inline(always)]
fn assume_init_slice<T>(s: &[MaybeUninit<T>]) -> &[T] {
    // SAFETY: see fn doc.
    unsafe { &*(ptr::from_ref::<[MaybeUninit<T>]>(s) as *const [T]) }
}

/// Mutable variant of [`assume_init_slice`]. The input borrow is consumed by
/// the cast, so the returned `&mut [T]` is the sole live reference into the
/// allocation for its lifetime.
#[inline(always)]
fn assume_init_slice_mut<T>(s: &mut [MaybeUninit<T>]) -> &mut [T] {
    // SAFETY: see `assume_init_slice`.
    unsafe { &mut *(ptr::from_mut::<[MaybeUninit<T>]>(s) as *mut [T]) }
}
```

- **Core flaw**: the issue is not merely "T lacks an any-bit-pattern bound."
  Uninitialized bytes are not an initialized `T` value even when every bit
  pattern would otherwise be valid. A `T: bytemuck::AnyBitPattern` bound only
  helps if the buffer implementation also initializes every exposed slot
  (e.g. zero/fill on allocation) or changes the API to expose only initialized
  prefixes / `MaybeUninit<T>` views. The pass-2 F-1 remediation has **not**
  landed.
- **Caller list** (workspace-wide `rg`): all callers are within `src/collections/linear_fifo.rs` itself.
  - line 127 — `StaticBuffer<T,N>::as_slice` (the `// TODO(port)` comment at lines 115-118 explicitly flags this as the unfixed phase-B item. The source phrases the intended constraint as "any-bit-pattern", but the stronger Rust-side requirement is that callers not expose uninitialized slots as `T` at all; a typed `MaybeUninit<T>` view or an initialized-prefix view would be the sound shape.)
  - line 131 — `StaticBuffer<T,N>::as_mut_slice`
  - line 168 — `DynamicBuffer<T>::as_slice`
  - line 172 — `DynamicBuffer<T>::as_mut_slice`
- **Verdict**: **still-applies** — shape is byte-identical to the EXP-001 reproduction at `/data/projects/bun/.unsafe-audit/verification/miri-confirmed-linear-fifo-niche-ub.md` lines 17-19. The witness uses a niche-bearing type for a crisp Miri signal, but the source issue is broader: `assume_init_slice<T>` / `_mut` expose the full uninitialized backing allocation as `T`. Active hot paths cited in that anchor (`LinearFifo<RefDataValue, _>` in test_runner, `LinearFifo<{Entry, PromisePair}, _>` in Valkey) remain the live exposure surface.

## bun_alloc arena discipline

The `CLAUDE.md` "Arena edge case" warning ("values allocated in `MimallocArena` do not run `Drop` when the arena resets") is **architecturally** addressed by the AST layer design rather than per-allocation discipline:

- **`AstAlloc::deallocate` is an unconditional no-op** (`src/bun_alloc/ast_alloc.rs:311-317`). Every `Vec<T, AstAlloc>` / `Box<T, AstAlloc>` reachable from a parsed AST relies on `mi_heap_destroy` at `ASTMemoryAllocator::reset()` time to reclaim its backing storage. Per the file-level SAFETY block (lines 250-282) this is intentional and is the load-bearing invariant that lets `Expr::Data::clone_in` ship two `Vec` headers aliasing one buffer (neither runs `T::drop`).
- **Reachable callers that allocate into `AstAlloc`**: 14+ direct call sites of `bun_alloc::AstAlloc::vec()` (`src/js_parser/p.rs`, `src/js_parser_jsc/Macro.rs`, `src/js_printer/lib.rs`, `src/parsers/yaml.rs`, `src/bundler/transpiler.rs`, `src/bundler/linker_context/postProcessJSChunk.rs`); reset call sites: `BundleThread.rs:294`, `ThreadPool.rs:692`, `transpiler.rs:394-416,2881-2883` (all paired with `Stmt::data_store_reset` / `store_ast_alloc_heap::reset`).
- **`MimallocArena::reset` discipline** (`src/bun_alloc/MimallocArena.rs:220-252`): asserts owning-thread + non-default; rebuilds the heap atomically with `mi_heap_destroy` + `mi_heap_new`. Bump-arena cursor is dropped on every `set_thread_heap` (`ast_alloc.rs:172-176`) so a cursor never outlives the heap that backed its chunk.
- **`DetachAstHeap` RAII guard** (`ast_alloc.rs:185-207`): explicit escape hatch for "this allocation must outlive the parse arena" — `Expr::deep_clone` for `WorkspacePackageJSONCache` documents this exact need. Without it, the next `ASTMemoryAllocator::reset()` frees buffers the cache still holds.
- **Drop-required types that *do* land in arena storage**: `vec_ext.rs::from_bump_vec` (lines 267-294) explicitly handles the case — copies elements out, then calls `src.set_len(0)` and `drop(src)` to free the scratch buffer back to the arena (real `mi_free`, not a bump no-op). This is the canonical pattern and is documented as preventing an "≈+11% transpile RSS on a 5.7 MB input" leak.

**Concerning latent pattern**: nothing in the type system prevents a non-arena-aware caller from putting `Vec<T, AstAlloc>` over a `T: Drop` into an AST node, then relying on AST drop to free it — the no-op `deallocate` would leak the `T` payloads (the *buffer* is reclaimed by `mi_heap_destroy`, but per-element destructors never run). Phase-5 enumeration found no concrete soundness-critical `T: Drop` payload yet; EXP-016 is now a needs-refinement ownership audit, not a confirmed finding.

## Notable patterns

- **`HiveSlot<'h, T, CAP>` type-state guard** (`hive_array.rs:386-462`): a "claimed-but-uninitialized" slot token that prevents the legacy two-phase `HiveArray::get()` UB hazards H1 (early-return leaves slot claimed-uninit so a later `put()` drops garbage), H2 (`&mut *p` over uninit `T` is instant validity UB when `T` has niches), and H3 (partial field-write then `assume_init_ref`). The `Drop` impl distinguishes inline (clear `used` bit) vs heap-fallback (free `Box<MaybeUninit<T>>` without dropping `T`) via a tagged `owner: usize`. This is the strongest type-state pattern in the section; the legacy `HiveArray::get` remains but is `#[deprecated]`.
- **`UnsafeCell<[MaybeUninit<u8>; N]>` inline buffer** (`stack_fallback.rs:57-76`): `StackFallback<N,A>` issues `*mut u8` from `&self` via interior mutability. Gated `!Sync` (via `Cell`/`UnsafeCell`) so single-thread-only.
- **`ptr::NonNull::new_unchecked(s.as_ptr() as *mut u8)` for string keys** (`array_hash_map.rs:1581,1604`): two sites that build `StringHashMapKey` from a raw byte pointer; both safe at the call site (pointer comes from a live slice).
- **Lifetime-laundering `&[u8]` → `&'static [u8]`** (`array_hash_map.rs:1898-2014`): `put_borrowed`/`get_or_put_borrowed` extend a `&'a [u8]` to `'static` via raw cast then store it in the map. Phase-5 correction: both entry points are `unsafe fn` and the docs state the lifetime contract. A workspace caller audit found exactly three real call sites, all in parser scope handling, and all pass source-text / lexer-string-table / already-stored map keys that outlive the arena-backed `Scope`. Track as an unsafe-contract surface, not a current UB finding.
- **Macro-emitted FFI thunks** (`c_thunks.rs:64-130`): the `mi_*` allocator-thunk macro emits `extern "C" fn` for `malloc_size`/`calloc_items`/`free` bound to a named allocator. Safe-by-construction: bodies are all-safe Rust calling the underlying allocator; `free` is `unsafe extern "C" fn` because the C ABI requires it.
- **`unsafe impl Send`/`Sync` discipline**: 18 such impls in the section. Strongest is `MimallocArena` (Send via thread-id stamp + `assert_owning_thread`, Sync because `&MimallocArena` allocations route through mimalloc's per-call atomics). Weakest is `StringHashMapKey: Send/Sync` (one-line SAFETY; gated on `A`) — defensible but minimal.
- **`#[repr(C)]` / `#[repr(transparent)]` correctness asserts**: present where required (`bit_set.rs:138,460`; `hive_array.rs:24,655`; `pool.rs:20`; `stack_fallback.rs:47`; `bun_alloc/lib.rs` 13+ sites for WTFStringImpl/`Cell` punning). The `Cell<u32>` ↔ `AtomicU32` repr pun at `lib.rs:1067-1073` is rationale-documented.

## Open questions

1. **EXP-001 fix latency**: the `assume_init_slice<T>` UB was confirmed by miri before the MAL refactor shipped, and the MAL refactor demonstrates the team is willing to do invasive container refactors. Why was the smaller initialized-prefix / `MaybeUninit<T>` accessor refactor not landed concurrently? A bare `T: bytemuck::AnyBitPattern` bound is not enough unless allocation initializes all exposed slots. Either (a) the fix is gated on the existing `bun_collections` test-harness compile issue mentioned in EXP-001, (b) a zero/fill strategy was rejected for performance, or (c) it was deferred. The audit's defensibility requires this to land; recommend re-checking before publishing.
2. **`Slice<T>: Copy` documented soundness gap** (`multi_array_list.rs:564-568`): explicitly known, not closed, has at least two cited live exploiters (`LinkerGraph::load`, `bundle_v2`). EXP-014 confirms the minimal copy-and-two-`items_mut` shape under Tree Borrows; the remaining work is an integrated caller audit, not proving the local shape.
3. **`AstAlloc + T: Drop`** instantiations: continue structured type-field audit. Direct Phase-5 grep found the usual AST value/reference vectors and no obvious lock/refcount/FFI-handle payload, so do not count this as a bug until a concrete destructor-bearing payload is identified.
4. **`StringHashMapKey::put_borrowed` lifetime extension to `'static`**: caller-discipline-only but currently audited clean at all three call sites. Could the `'a` be propagated via the map's lifetime parameter? Refactor cost vs. soundness gain unknown.
5. **`__mal_split_mut_impl` macro per-instantiation site count**: Phase 2 should `cargo expand` each `multi_array_columns!` use site to count macro-emitted `unsafe` blocks before normalizing the inventory.

## Anchor cross-refs (EXP-001)

- Witness: `/data/projects/bun/.unsafe-audit/verification/miri-confirmed-linear-fifo-niche-ub.md`
- Current source (unchanged shape): `src/collections/linear_fifo.rs:62-80`
- Prior inventory id: `S-001024` (also `S-001025` for the `_mut` mirror)
- Status: **still-applies** — miri reproduction is byte-identical to current source; bound on `T` has not been tightened; no caller-side niche-guard has been added.
- Live exposure paths (per EXP-001 §): `LinearFifo<RefDataValue, _>` (test_runner ResultQueue), `LinearFifo<{Entry, PromisePair}, _>` (Valkey client).
