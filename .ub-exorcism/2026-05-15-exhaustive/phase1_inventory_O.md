# Phase 1 Inventory — Section O: alloc-and-collections

Run: `2026-05-15-exhaustive`. Scope: `src/bun_alloc/`, `src/collections/`.

Mapper tallies (audited base `origin/main@4d443e5402`):

| crate             | files | `unsafe` keyword sites | dangerous-pattern sites |
| ----------------- | ----- | ---------------------- | ----------------------- |
| `bun_alloc`       | 14    | 308                    | 92                      |
| `bun_collections` | 8     | 149                    | 61                      |
| **Section O**     | 22    | **457**                | **153**                 |

The `457` figure is the mapper's heuristic site count, not a raw `rg '\bunsafe\b'`
headline. An independent current-source sanity scan on this checkout sees 467
non-comment lines containing `unsafe`; the difference is counting-definition
noise (function-pointer types, macro bodies, and grouped multi-line sites).
Use `457` only as a Phase-1 mapper-local workload count until Phase 2
normalization re-ids current-source rows.

Site-count prior was 430; mapper-current 457 ⇒ +27 (multi_array_list refactor added macro-emitted/scaffolded sites and explicit-`Send`/`Sync` reaffirmations; see notes file). SAFETY-comment density: 318 instances across the same scope (high coverage).

Per-file unsafe distribution:

| file                                       | unsafe sites |
| ------------------------------------------ | ------------ |
| `src/bun_alloc/lib.rs`                     | 142          |
| `src/bun_alloc/MimallocArena.rs`           | 44           |
| `src/bun_alloc/stack_fallback.rs`          | 40           |
| `src/bun_alloc/heap_breakdown.rs`          | 13           |
| `src/bun_alloc/ast_alloc.rs`               | 13           |
| `src/bun_alloc/hashbrown_bridge.rs`        | 12           |
| `src/bun_alloc/basic.rs`                   | 10           |
| `src/bun_alloc/fallback.rs`                | 8            |
| `src/bun_alloc/c_thunks.rs`                | 8            |
| `src/bun_alloc/BufferFallbackAllocator.rs` | 8            |
| `src/bun_alloc/MaxHeapAllocator.rs`        | 4            |
| `src/bun_alloc/memory.rs`                  | 3            |
| `src/bun_alloc/fallback/z.rs`              | 2            |
| `src/bun_alloc/NullableAllocator.rs`       | 1            |
| `src/collections/vec_ext.rs`               | 37           |
| `src/collections/hive_array.rs`            | 28           |
| `src/collections/bit_set.rs`               | 23           |
| `src/collections/pool.rs`                  | 16           |
| `src/collections/multi_array_list.rs`      | 15 (was 30)  |
| `src/collections/array_hash_map.rs`        | 15           |
| `src/collections/linear_fifo.rs`           | 13           |
| `src/collections/lib.rs`                   | 2            |

`multi_array_list` site count dropped from 30 (prior `S-001037..S-001066`) to 15 keyword hits despite gaining lines because the row-op path was rebuilt on safe `<[MaybeUninit<u8>]>` `copy_within` / `copy_from_slice`. The two macros `__mal_split_mut_impl` and `__mal_split_raw_impl` emit unsafe code at expansion sites; per-instantiation site count is not yet counted (Phase 2 expansion).

Phase-5 correction: the in-source `Slice<T>: Copy` soundness gap at
`multi_array_list.rs:564-568` is no longer just a prose TODO. EXP-014 mirrors
`Copy` + two `items_mut(&mut self)` calls on copied slice views and fails under
Tree Borrows with `write access ... is forbidden`. The local API hole is
confirmed; the remaining work is mapping which real Section-M callers exercise
overlapping mutable views.

Table (selected high-signal sites — full per-line list in prior audit JSONL plus the refactor delta below):

| file:line                                          | site_kind     | bucket(s)                                  | safety_status                         | macro_status        | prior_id  | notes                                                                                          |
| -------------------------------------------------- | ------------- | ------------------------------------------ | ------------------------------------- | ------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `src/collections/linear_fifo.rs:68-70`             | unsafe_block  | uninit/MaybeUninit, reference validity     | wrong (claims POD/any-bit-pattern-only, no T bound) | source-direct       | S-001024  | **EXP-001 anchor; UB miri-confirmed; UNCHANGED.** Not limited to niche-bearing T; the cast exposes uninitialized backing slots as `T`. |
| `src/collections/linear_fifo.rs:77-79`             | unsafe_block  | uninit/MaybeUninit, reference validity     | wrong (cites L68)                     | source-direct       | S-001025  | Mutable mirror of the EXP-001 cast.                                                           |
| `src/collections/linear_fifo.rs:94`                | unsafe_block  | aliasing (memmove)                         | ok                                    | source-direct       | S-001026  | `ptr::copy` overlap shift.                                                                     |
| `src/collections/linear_fifo.rs:103`               | unsafe_block  | uninit/MaybeUninit (poison)                | ok                                    | source-direct       | S-001027  | Debug-only poison; writes bytes never re-read as T.                                            |
| `src/collections/linear_fifo.rs:285`               | unsafe_block  | aliasing                                   | ok                                    | source-direct       | S-001029  | `realign` overlap copy.                                                                        |
| `src/collections/linear_fifo.rs:313-321`           | unsafe_block  | uninit/MaybeUninit, ptr_intrinsic          | ok (byte-granularity rationale)       | source-direct       | S-001030  | tmp↔buf copy via 1-aligned bytes; correct.                                                     |
| `src/collections/linear_fifo.rs:480,602,721,725`   | unsafe_block  | ptr::read/write                            | ok (in-bounds asserted)               | source-direct       | S-001033,34,35,36 | Pop/push slot move.                                                                       |
| `src/collections/multi_array_list.rs:483`          | unsafe_block  | ptr_arith (NonNull::add)                   | ok (INVARIANT:column_base)            | source-direct (new) | NEW       | `column_base` primitive — single audited site for column offset GEP.                           |
| `src/collections/multi_array_list.rs:511`          | unsafe_block  | aliasing, slice_from_raw                   | ok (INVARIANT:col)                    | source-direct (new) | NEW       | `Col::as_slice` — sole `from_raw_parts` in shared path.                                        |
| `src/collections/multi_array_list.rs:536`          | unsafe_block  | aliasing, slice_from_raw                   | ok (INVARIANT:col + excl)             | source-direct (new) | NEW       | `ColMut::as_mut_slice` — sole `from_raw_parts_mut` in exclusive path.                          |
| `src/collections/multi_array_list.rs:556-557`      | unsafe_impl   | Send/Sync                                  | terse but correct (one-line SAFETY)   | source-direct       | S-001037/8 | Carried over; rationale `bytes` uniquely owned.                                               |
| `src/collections/multi_array_list.rs:689`          | unsafe_fn     | aliasing                                   | ok (caller contract documented)       | source-direct       | S-001041  | `column_bytes_mut` now thin shim over `ColMut`.                                                |
| `src/collections/multi_array_list.rs:813-826`      | unsafe_block  | ptr_intrinsic, ptr_arith                   | ok                                    | source-direct       | S-001045-7 | `Slice::scatter` — only direct `copy_nonoverlapping` in MAL.                                  |
| `src/collections/multi_array_list.rs:839-853`      | unsafe_block  | ptr_intrinsic, uninit/MaybeUninit          | ok (padding-uninit caveat documented) | source-direct       | S-001046-7 | `Slice::gather` + `out.assume_init()` (padding-uninit accepted).                              |
| `src/collections/multi_array_list.rs:1239`         | unsafe_block  | ptr_intrinsic (write_bytes)                | ok                                    | source-direct       | S-001063  | `zero()` memset; explicit perf justification for not using safe `fill`.                        |
| `src/collections/multi_array_list.rs:1253`         | unsafe_block  | allocator                                  | ok (free_allocated_bytes invariant)   | source-direct       | S-001064  | Now via `NonNull<u8>` field — `new_unchecked` site removed.                                    |
| `src/collections/multi_array_list.rs:1265`         | unsafe_fn     | other (caller contract: init promise)      | ok                                    | source-direct       | S-001065  | `set_len` caller-contract — unchanged.                                                         |
| `src/collections/multi_array_list.rs:197-205`      | unsafe_block  | aliasing, slice_from_raw                   | ok (disjoint columns, &mut self)      | macro-emitted       | NEW       | `__mal_split_mut_impl` body — N-way `from_raw_parts_mut`.                                      |
| `src/collections/multi_array_list.rs:1548`         | unsafe_block  | ptr_arith (test helper)                    | ok                                    | source-direct (test)| NEW       | Sort test SortContext deref.                                                                   |
| `src/collections/hive_array.rs:195-201`            | unsafe_fn     | uninit/MaybeUninit, raw place-init         | ok (placement-new contract)           | source-direct       | —         | `HiveArray::init_in_place` writes bitset only; buffer left uninit (sound for `MaybeUninit<T>`).|
| `src/collections/hive_array.rs:331-351`            | unsafe_fn     | uninit/MaybeUninit, drop_in_place          | ok (preserves Rust drop discipline)   | source-direct       | —         | `put` runs T's destructor (Zig had none) — documented divergence.                              |
| `src/collections/hive_array.rs:386-462`            | type+drop     | aliasing (raw owner ptr), uninit, niche    | ok (HiveSlot type-state encodes init) | source-direct       | —         | `HiveSlot<'h,T,CAP>` — new type-state guard against (H1/H2/H3) hazards; tagged owner ptr.      |
| `src/collections/array_hash_map.rs:520-532`        | unsafe_fn     | uninit/MaybeUninit (3 parallel set_len)    | ok (caller writes before re-index)    | source-direct       | —         | `set_entries_len` — three-column uninit window; caller contract.                               |
| `src/collections/array_hash_map.rs:1561-1562`      | unsafe_impl   | Send/Sync (tagged-ptr key)                 | ok (atomicity not added)              | source-direct       | —         | `StringHashMapKey` Send/Sync gated on `A`.                                                     |
| `src/collections/array_hash_map.rs:1898-1903`      | unsafe_fn     | aliasing, lifetime extension to `'static`  | documented unsafe contract            | source-direct       | EXP-015  | `put_borrowed` — caller must keep `key` alive. Phase-5 caller audit found no current misuse.   |
| `src/collections/array_hash_map.rs:2011-2014`      | unsafe_fn     | aliasing, lifetime extension to `'static`  | documented unsafe contract            | source-direct       | EXP-015  | `get_or_put_borrowed` — same pattern. Phase-5 caller audit found no current misuse.           |
| `src/collections/bit_set.rs:814`                   | unsafe_block  | ptr_arith (static empty mask)              | ok                                    | source-direct       | —         | `EMPTY_MASKS_DATA` sentinel for zero-capacity sets.                                            |
| `src/collections/bit_set.rs:839,853`               | unsafe_block  | slice_from_raw                             | ok                                    | source-direct       | —         | `masks()`/`masks_mut()` rebuild slices over header pointer.                                    |
| `src/collections/bit_set.rs:914-952`               | unsafe_block  | allocator (raw alloc/realloc)              | ok                                    | source-direct       | —         | `DynamicBitSetList` grow/shrink — direct `std::alloc` calls.                                   |
| `src/collections/bit_set.rs:1392`                  | unsafe_impl   | Send                                       | one-liner SAFETY                      | source-direct       | —         | `DynamicBitSetList: Send`.                                                                     |
| `src/collections/pool.rs:51,61-70`                 | unsafe_fn     | uninit/MaybeUninit                         | ok (intrusive next-walk pattern)      | source-direct       | —         | `Node<T>::data_ref/data_mut` — `MaybeUninit::assume_init_{ref,mut}`.                           |
| `src/collections/pool.rs:148,165,193,311,319,397,408,419` | unsafe_block | aliasing (intrusive list), assume_init | ok                                    | source-direct       | —         | Intrusive single-linked free-list; raw `(*p).next` walks.                                      |
| `src/collections/vec_ext.rs:243-253`               | unsafe_fn     | aliasing (bump-arena bitwise move)         | ok                                    | source-direct       | —         | `from_bump_slice` — caller contract.                                                           |
| `src/collections/vec_ext.rs:267-294`               | safe fn / unsafe inside | aliasing, set_len                | ok (paired set_len(0) for src)        | source-direct       | —         | `from_bump_vec` — explicit free-back-to-arena (arena Drop-discipline).                         |
| `src/collections/vec_ext.rs:300-311`               | unsafe_fn     | aliasing (borrowed-vec laundering)         | ok (contract: never drop/grow)        | source-direct       | —         | `from_borrowed_slice_dangerous` — ManuallyDrop-wrapped alias.                                  |
| `src/collections/vec_ext.rs:422-466`               | unsafe_fn x5  | uninit/MaybeUninit (set_len contracts)     | ok (caller-contract docs)             | source-direct       | —         | `expand_to_capacity`/`writable_slice*`/`reserve_expand_tail` — explicit "all writes before read".|
| `src/collections/vec_ext.rs:497-507`               | safe fn / unsafe inside | aliasing (shallow alias clone)    | ok (ManuallyDrop seal)                | source-direct       | —         | `shallow_copy` — ManuallyDrop alias.                                                           |
| `src/collections/vec_ext.rs:518-525`               | unsafe_block  | slice_from_raw                             | ok (cap-bounded)                      | source-direct       | —         | `allocated_slice` — full-cap MaybeUninit view.                                                 |
| `src/bun_alloc/ast_alloc.rs:125-152`               | unsafe_block  | ptr_arith (bump arena)                     | ok (rich rationale)                   | source-direct       | —         | `bump_alloc`/`bump_refill` — TLS bump cursor for AST.                                          |
| `src/bun_alloc/ast_alloc.rs:283-369`               | unsafe_impl   | Allocator (ZST routing)                    | ok (mega-SAFETY block)                | source-direct       | —         | `AstAlloc` impl `Allocator` — gates `mi_expand` on `old.size > BUMP_MAX`; documents `clone_in` aliasing invariant. |
| `src/bun_alloc/MimallocArena.rs:112,120`           | unsafe_impl   | Send, Sync                                 | ok (assert_owning_thread enforced)    | source-direct       | —         | Allocation gated to owning thread; reset() asserts.                                            |
| `src/bun_alloc/MimallocArena.rs:618`               | unsafe_impl   | Allocator                                  | ok                                    | source-direct       | —         | `&MimallocArena: Allocator`.                                                                   |
| `src/bun_alloc/stack_fallback.rs:57-76`            | UnsafeCell    | aliasing (interior mut over `&self`)       | ok (Sync gating prevents abuse)       | source-direct       | —         | `StackFallback<N,A>::buf: UnsafeCell<[MaybeUninit<u8>;N]>`.                                    |
| `src/bun_alloc/stack_fallback.rs:158-172`          | unsafe_block  | aliasing, ptr_arith                        | ok                                    | source-direct       | —         | `try_alloc_inline` — issues `*mut u8` from `&self` via UnsafeCell.                             |
| `src/bun_alloc/stack_fallback.rs:207-282`          | unsafe_impl   | Allocator (inline + fallback)              | ok                                    | source-direct       | —         | `&StackFallback<N,A>: Allocator` — gates ownership by pointer-range check.                     |
| `src/bun_alloc/stack_fallback.rs:339,348-403`      | unsafe_impl   | Allocator (raw arena ptr)                  | ok                                    | source-direct       | —         | `ArenaPtr: Allocator` — type-erased arena handle.                                              |
| `src/bun_alloc/stack_fallback.rs:456-503`          | unsafe_impl   | Allocator (heap-bound)                     | ok                                    | source-direct       | —         | `MimallocHeapRef: Allocator`.                                                                  |
| `src/bun_alloc/lib.rs:123-124`                     | unsafe_impl   | Send/Sync (vtable allocator)               | terse                                 | source-direct       | —         | `StdAllocator` — vtable-backed allocator surface.                                              |
| `src/bun_alloc/lib.rs:624-651`                     | unsafe_impl   | GlobalAlloc                                | ok                                    | source-direct       | —         | `Mimalloc: GlobalAlloc` — the `#[global_allocator]`.                                           |
| `src/bun_alloc/lib.rs:666-705`                     | unsafe_fn     | allocator (raw FFI realloc)                | ok                                    | source-direct       | —         | `realloc_slice`/`realloc_raw`/`usable_size` — `mi_realloc` raw FFI.                            |
| `src/bun_alloc/lib.rs:726-1188`                    | extern "C"/"Rust" | FFI                                     | ok                                    | source-direct       | —         | WTFStringImpl FFI block, kernel32 fallback, fatal handler.                                     |
| `src/bun_alloc/lib.rs:1067-1073`                   | unsafe_block  | atomics over UnsafeCell repr               | ok (layout-pun rationale)             | source-direct       | —         | `Cell<u32>` ↔ `AtomicU32` repr-transparent pun on `m_ref_count`.                               |
| `src/bun_alloc/lib.rs:2167-2280`                   | static, unsafe_impl Send/Sync | repr(C) struct                | ok                                    | source-direct       | —         | `BSSList<V,COUNT>` — fixed-page BSS pool.                                                      |
| `src/bun_alloc/heap_breakdown.rs:135-136,275`      | unsafe_impl Send/Sync, extern "C" | Darwin malloc_zone_t     | ok                                    | source-direct       | —         | Darwin `Zone` registration.                                                                    |
| `src/bun_alloc/hashbrown_bridge.rs:31-66`          | macro+unsafe_impl | Allocator-trait bridge                 | ok (SAFETY in macro)                  | macro-emitted       | —         | `bridge_allocator_api2!` — two instantiations.                                                  |
| `src/bun_alloc/c_thunks.rs:42-55,120`              | unsafe extern "C" fn | FFI free thunks                     | ok                                    | source-direct + macro| —        | Macro-emitted `free` thunks bound to a named allocator.                                        |

Note: this Phase 1 table targets the *primitives*; the full ~457 per-line list is the union of (a) prior `S-001*` ids in `.unsafe-audit/unsafe-inventory.jsonl` for unchanged rows and (b) the multi_array_list refactor delta enumerated above. Phase 2 will normalize, fold macro-expansion sites in, and re-id.
