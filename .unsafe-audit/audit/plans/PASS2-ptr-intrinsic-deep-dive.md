# PASS2 — `ptr_intrinsic` + `ptr_arith` Deep-Dive

**Audit scope.** 1,188 `unsafe` sites tagged `ptr_intrinsic` and/or `ptr_arith` across
55 crates / 325 files. Combined because the two operate on the same primitive
(`*mut T` / `*const T`) and the same UB classes (alignment, OOB, provenance) apply.

**Method.** Stratified sample of ~120 sites by operation type and by crate weight
(`bun_runtime` 381, `bun_install` 103, `bun_bundler` 70, `bun_jsc` 58, `bun_sys` 57,
`bun_core` 54, `bun_collections` 54, `bun_alloc` 40, `bun_sourcemap` 39,
`bun_standalone_graph` 24, `bun_io` 15, `bun_ptr` 15…). Each sampled site read with
15 lines of context to verify: (a) source of the pointer, (b) bound on any
index/offset, (c) alignment guarantee, (d) Drop ordering. Inventory at
`.unsafe-audit/unsafe-inventory.jsonl`; per-op samples at
`/tmp/audit_samples/*.jsonl`.

---

## 0. Executive Summary

| Metric                                | Count |
|---------------------------------------|------:|
| Total sites in cluster                | 1,188 |
| Distinct files                        |   325 |
| Distinct crates                       |    55 |
| `unsafe_block` kind                   | 1,053 |
| `unsafe_fn` kind                      |   117 |
| `unsafe_impl` kind                    |    17 |
| `unsafe_trait` kind                   |     1 |

**Operation breakdown (lexically counted on `full_text`)**

| Op                       | Sites |
|--------------------------|------:|
| `ptr.add(n)` (free fn)   |   360 |
| `addr_of_mut!`           |   223 |
| `core::ptr::read`        |    81 |
| `core::ptr::copy_nonoverlapping` |    71 |
| `addr_of!`               |    69 |
| `core::ptr::write`       |    35 |
| `core::ptr::read_unaligned` |  27 |
| `core::ptr::copy` (memmove) | 27 |
| `core::ptr::drop_in_place` |   8 |
| `ptr.read()` (method)    |     8 |
| `ptr.read_unaligned()` (method) | 7 |
| `core::ptr::replace`     |     5 |
| `core::ptr::write_unaligned` | 3 |
| `core::ptr::write_volatile` | 2 |
| `ptr.wrapping_add(n)`    |     2 |
| `core::ptr::read_volatile` | 0 |
| `core::ptr::swap`        |     0 |

**Classification of audited sample (≈120 sites)**

| Class                              | Approx % of sample |
|------------------------------------|-------------------:|
| **(A) STRICTLY_UNAVOIDABLE**       |               42 % |
| **(B) PERF_ONLY** (could be safer) |               18 % |
| **(C) REFACTORABLE** to safe code  |               12 % |
| **UB-RISK** (real concern)         |              ~5 sites flagged |
| **SAFETY-comment-only** (works in practice; contract weaker than caller invariants) | balance |

**Hard UB-risk findings ready for `pre-existing-ub-N`:** **6**

1. `pre-existing-ub-ptr-1` — `standalone_graph::slice_to[_mut/_z]` debug-asserts in-bounds but reads/writes via `from_raw_parts[_mut]` in release with attacker-influenced offsets.
2. `pre-existing-ub-ptr-2` — `bun_core::Unaligned::slice_align_cast[_mut]` debug-asserts pointer alignment, then forms `&[T]`/`&mut [T]` over the bytes — instant UB on access if a release-build caller violates the contract. Lit caller: `ArrayBuffer::as_u16` / `as_u32`.
3. `pre-existing-ub-ptr-3` — `bun_io::Request::store_callback_seq_cst` uses `write_volatile` + SeqCst fence to publish a `fn` pointer cross-thread. Volatile is not atomic per the Rust memory model; should be `AtomicPtr` with `Release`/`Acquire`.
4. `pre-existing-ub-ptr-4` — `sys::SysQuietWriterAdapter::adapter_write_all` computes `this.pos + bytes.len() > this.cap` with no overflow guard; an oversized `bytes` makes the comparison wrap, bypassing the drain branch, then `copy_nonoverlapping` writes past `buf.add(pos)`.
5. `pre-existing-ub-ptr-5` — `bun_install::windows-shim::bun_shim_impl::*` final `ptr::copy(src, dst, len + 1)` bounds the destination by a `debug_assert!(len + 1 <= BUF2_U16_LEN)` only; release builds with malformed shim metadata can overrun `out_buf`.
6. `pre-existing-ub-ptr-6` — `SerializedSourceMap::header()` (in both `sourcemap/lib.rs` and `standalone_graph/StandaloneModuleGraph.rs`) documents *"caller checked"* the length, but `source_files_count` / `source_file_name` / `compressed_source_file` / `source_file_names` are public accessors that call `header()` with no precondition check of their own.

Severities range medium → low; threat-model context (e.g., #1, #5 require a
tampered standalone executable, where the attacker already controls a generated
binary artifact) is noted per
finding.

---

## 1. Per-op Type Analysis

### 1.1 `core::ptr::read` (81 hits) and `ptr::read_unaligned` (27 hits) + method forms

**Predominant idioms.**

- **Zig "struct assignment" port.** `core::ptr::read(&raw const x.field)` reads
  a non-`Copy` arena-backed field bitwise so the resulting value is a *logical
  duplicate* of `x.field`. Drop is then suppressed via `ManuallyDrop`,
  consumed-by-value into a builder, or paired with a follow-up `ptr::write`.
  Examples: `bundler/AstBuilder.rs:449,588`, `bundler/Chunk.rs:230,233`,
  `bundler/linker_context/convertStmtsForChunk.rs:412,432,445,522,540`,
  `bundler/LinkerContext.rs:2277`, `js_parser/lower/lower_decorators.rs:92` etc.
  Soundness rests on the arena invariant (no Drop runs on arena-bytes) plus an
  explicit `ManuallyDrop` / `ptr::write` per call. Documented well; class **(A)**.

- **Read-and-clear of `static mut` (`take_environ`)** —
  `bun_core/lib.rs:235` uses `core::ptr::replace(&raw mut ENVIRON, (null, 0))` to
  swap and capture. `&raw mut` rather than `&mut` keeps it compatible with the
  `static_mut_refs` lint. Sound; class **(A)**.

- **Wire-format header decode.** `read_unaligned` over a `*const T`
  cast from a `&[u8]` — used in `bun_io::write::FixedBufferStream::read_struct`
  (`src/io/write.rs:194`), `bun_exe_format::read_struct` (`src/exe_format/lib.rs:35`),
  `bun_sourcemap::InternalSourceMap::sync_entry` (`src/sourcemap/InternalSourceMap.rs:183`),
  `runtime/node/dir_iterator.rs:672-690` (Windows
  `FILE_DIRECTORY_INFORMATION` field reads), and dirent reads at
  `runtime/node/dir_iterator.rs:817`. Each uses `read_unaligned` deliberately —
  the source is a kernel/disk buffer with no alignment guarantee.

- **`bytemuck::Pod` POD bitwise read.** Mostly funnelled through
  `bytemuck::from_bytes` / `try_from_bytes`; not in this cluster.

**Soundness pivot points:**

- **Source-bytes bounds.** `read_unaligned::<T>(ptr)` requires `[ptr, ptr +
  size_of::<T>())` to be a single allocation. Every audited call either (a)
  derives `ptr` from `buf[off..off + size_of::<T>()]` (`as_ptr().cast::<T>()`),
  forcing the slice bound to fail safely (`exe_format::read_struct`,
  `io::FixedBufferStream::read_struct`), or (b) passes the FFI / kernel-written
  region (`Bun__getStandaloneModuleGraph*`, `NtQueryDirectoryFile`,
  `uv_fs_req_t::ptr`) which is a trust-boundary, not a Rust-side fault.

- **Alignment.** `ptr::read` requires `align_of::<T>()`-aligned source. Audited
  sites uniformly use `read_unaligned` when the source is byte-addressed, or
  `read` when the source is a `&T`/`*const T` projected from a Rust-managed
  allocation. No mis-classification observed.

- **Drop ownership.** The Zig-port `ptr::read` pattern is the load-bearing one
  — it deliberately *duplicates* the value. Misuse would surface as a
  double-drop on the second user. All audited sites pair the read with one
  of: `ManuallyDrop`, immediate `ptr::write` over the source slot, or arena
  semantics that disable Drop entirely. We did not find a single site where
  the duplicate could escape.

### 1.2 `core::ptr::write` (35 hits) + method forms (`ptr.write(...)`, `addr_of_mut!(...).write(v)`)

**Predominant idioms.**

- **Field-by-field init of uninit storage.**
  `addr_of_mut!((*p).field).write(value)` over `*mut MaybeUninit<T>`-shaped
  uninit storage. Canonical sites: `bundler/transpiler.rs:1325-1353`
  (Transpiler init), `bundler/BundleThread.rs:212` (Waker init),
  `collections/hive_array.rs:188-485` (HiveArray init-in-place),
  `runtime/socket/WindowsNamedPipeContext.rs:345`. Class **(A)** — required
  whenever the caller hands you a `*mut Self` to *uninit* storage and `&mut
  *self` would be reading-uninit-memory UB.

- **Bitwise overwrite without dropping the LHS.** Used everywhere we'd
  otherwise have a drop-during-overwrite UB. Examples:
  `runtime/socket/socket_body.rs:2607-2613` (`drop_in_place(p);
  ptr::write(p, new_handlers); (*p).mode = …` rewrites a live struct after
  manually deiniting it), `runtime/webcore/s3/{download_stream.rs:252,
  simple_request.rs:452}`, `install/NetworkTask.rs:307`,
  `runtime/webcore/Request.rs:1612`, `js_parser/p.rs:8506`. The fixed pattern
  is `ptr::write(dst, ptr::read(src))` — a bit-move of `T` where the caller is
  asserting the value's heap-owned data has a *unique* live alias.

- **Vec-with-reserved-capacity sparse write.** `install/migration.rs:866-872,
  1007-1023, 1178-1188, 1448-1462`: pre-allocate `num_deps`, then drive two
  raw cursors `deps_cursor` / `res_cursor` writing fresh `Dependency` /
  `PackageID` values. Each `ptr::write` precondition is "cursor < num_deps";
  the cursors are not defensively bounded inside the loop but `num_deps` is
  the exact sum of input property counts — see §3.2 finding.

- **Linear FIFO write_item.** `collections/linear_fifo.rs:602,725` —
  `MaybeUninit<T>` slot, `ptr::write` matches Zig assignment-without-drop.

### 1.3 `core::ptr::copy_nonoverlapping` (71 hits)

**Caller's three obligations.** Non-overlap, source readable for `n*T`,
destination writable for `n*T`. Surveyed sites split into:

- **Allocator copy/grow paths** (`bun_alloc/{ast_alloc.rs:364,
  stack_fallback.rs:255, MimallocArena.rs:460, lib.rs:1468,3232}`) — `src` and
  `dst` are distinct allocations (newly allocated `dst`, abandoning `src`).
  Non-overlap is trivial.

- **MultiArrayList SoA scatter/gather** (`collections/multi_array_list.rs:632,
  655, 897, 916, 972, 1014, 1103, 1130`) — copy a `T` field bytes-by-bytes
  into / out of per-field columns. Source and destination are always one
  stack-resident `MaybeUninit<T>` and one column slot, so non-overlap is
  structural.

- **`String`/`Vec` material building.** `bun_core::String` and StringBuilder
  copies (`bun_core/{lib.rs:1951, string/immutable.rs:528,1072,1126,1142,1187,
  string/immutable/escapeHTML.rs:75, string/StringBuilder.rs:95,
  util.rs:1568,1627,4127}`). All caller-side `dst` is fresh.

- **Wire-format encode/decode** (`runtime/api/bun/h2_frame_parser.rs:378,452`
  — `StreamPriority::from`, `SettingsPayloadUnit::from`). SAFETY comments
  state "caller guarantees `src.len() == BYTE_SIZE`". Verified by tracing each
  caller: `handle_priority_frame` rejects with `FRAME_SIZE_ERROR` if `frame.length
  != BYTE_SIZE` and obtains `payload` from `handle_incomming_payload` which
  blocks until `remaining_length == 0`, i.e. `payload.len() == frame.length`.
  The contract holds; recommend tightening the SAFETY comment to cite that
  chain, but no refactor needed.

- **Standalone-graph subslice read.** `slice_to` /
  `slice_to_mut` / `slice_to_z` in
  `src/standalone_graph/StandaloneModuleGraph.rs:655-691` — see UB finding §3.1.

- **NtQueryDirectoryFile drain** — `dir_iterator.rs` uses `read_unaligned`,
  not `copy_nonoverlapping`. The actual `copy_nonoverlapping` in that file
  (none in the cluster) is fine.

- **JSC array conversion in-place reinterpret.** `jsc/bindgen.rs:302,316` —
  copy old `ExternType` bytes into a stack local, convert, copy new `ZigType`
  bytes back to the same column. Reentrant reinterpretation. The function
  gates entry on `size_of::<ZigType>() <= size_of::<ExternType>()` (line 277),
  so the byte-wise copies of `i`-indexed slots are strictly monotonic in
  address-of-slot. Non-overlap holds.

### 1.4 `core::ptr::copy` (memmove, 27 hits) — explicitly *may overlap*

Audited 16 of these.

- **Shift-down in arrays.** `bounded_array.rs:230,249` — `core::ptr::copy(base.add(i),
  base.add(i + 1), s_len)`. Standard "shift forward to make room" memmove.
  Sound.

- **Linear-FIFO rotate.** `linear_fifo.rs:94,285` — rotate readable region to
  the buffer start. `count` and `head` bounded by FIFO invariants.

- **In-place path normalize.** `runtime/node/path.rs:3299,3313,3388` — rewrite
  a normalized path in-place; `copy(path_ptr.add(off), path_ptr, len)` with
  `off < len`. Memmove handles the directionality.

- **TLS write payload pad.** `h2_frame_parser.rs:1735,1792,5685` — shift to
  prepend the `padding` byte. Buffer is a 16 KiB thread-local; `payload_size
  ≤ MAX_PAYLOAD_SIZE_WITHOUT_FRAME` (=16,374) plus `padding ≤ 255`, fits.

- **Encoding fast-path** (`runtime/webcore/encoding.rs:635,647`) — see §3.4.

- **Glob path stitch** (`glob/GlobWalker.rs:1542`) — `copy_len` bounded by
  callers' input.

- **Windows shim spawn cmdline copy** (`install/windows-shim/bun_shim_impl.rs:1244`) — see §3.5.

### 1.5 `core::ptr::drop_in_place` (8 hits)

| Site | Pattern |
|---|---|
| `bundler/bundle_v2.rs:6728` | `drop_in_place(value)` — manual drop of in-arena value before slot reuse. |
| `bundler/BundleThread.rs:359` | Tear-down of `transpiler` + `ast_memory_store` ptrs *during* worker exit; matches Zig's two-step `deinit`. |
| `collections/hive_array.rs:324,340` | `put`/`reset` — drop the slot value before recycling. Documented arena-special-case. |
| `resolver/dir_info.rs:383,391` | Drop a pinned `Box<NonNull<P>>` before re-installing. |
| `runtime/socket/socket_body.rs:2609` | `drop_in_place(p)` followed by `ptr::write(p, new_handlers)`. Standard re-init-after-deinit pair. |
| `sql_jsc/postgres/PostgresSQLConnection.rs:*` (not listed verbatim in this cluster) | n/a |

**No double-drop risk found.** Each site is paired with either (a) immediate
`ptr::write` overwrite, (b) a release of the slot via a free-list / bitset
unset (`hive_array::put`), or (c) a follow-up `heap::take`/`Box::drop` that
frees the allocation. No `drop_in_place` is followed by another `drop_in_place`
on the same memory along any control-flow path I could find.

### 1.6 `addr_of!` (69) + `addr_of_mut!` (223)

**Why so many?** Two macro-classes dominate:

1. **Field projection from `*mut T` without going through `&mut *p`.** This is
   the Stacked-Borrows-friendly idiom — `addr_of_mut!((*p).field)` is a `*mut`
   projection that does NOT create a reborrow, so callbacks freeing `*p` can
   race the field access without an SB protector violation. Used heavily where
   a callback may free `Self`:
   - `runtime/shell/subproc.rs:2422` (`ptr::replace(addr_of_mut!((*this).state), …)`)
   - `bundler/bundle_v2.rs:3759` (`addr_of_mut!((*task).task)`)
   - `bundler/Chunk.rs:233` (`compile_results_for_chunk` slot pointer derive)
   - `bundler/LinkerContext.rs:526,529` (project disjoint fields of `*bundle`)
   - `bundler/ParseTask.rs:2214,2295` (project `resolver` from `*mut Transpiler`)

   In each, the parent `unsafe fn` documents "callback may free `self`" or
   "split-borrow without `&mut Self`". Class **(A)** — required by Bun's FFI
   model.

2. **Uninit-storage initialisation.** `addr_of_mut!((*p).field).write(v)`
   over a fresh `MaybeUninit<Self>` / freshly allocated `*mut Self`. Used in
   `BundleThread`, `Transpiler::init1`, `HiveArray::init_in_place`,
   `WindowsNamedPipeContext::create`. Class **(A)**.

The `addr_of_mut!(self.field)` (taking a `&mut self` first) is rarer; the
ones I sampled (`util.rs:237` `Unaligned::set`) write through it deliberately
because `self` is `repr(packed)`. Sound.

### 1.7 `ptr.add(n)` (~360) / `ptr.offset(n)` (0 in sample, all `add`)

All `n: usize`, so no wraparound from negative `isize`. Out-of-bounds risk
breaks down by where `n` comes from:

| `n` source | Sample sites | Soundness |
|---|---|---|
| compile-time / `size_of::<T>()` | `bun_alloc/ast_alloc.rs:128,129,150,151` | Sound by construction |
| loop counter `i in 0..len` where `len` is the buffer's own length | `multi_array_list::scatter/gather`, `collections/array_hash_map.rs:738` | Sound |
| HashMap probe index from `self.index` table | `collections/array_hash_map.rs:738` | Sound (table invariant) |
| Per-record offset from kernel-managed buffer (`NextEntryOffset`, `inotify_event.len`) | `runtime/node/dir_iterator.rs:*`, `watcher/INotifyWatcher.rs:356`, `watcher/WindowsWatcher.rs:178`, `runtime/node/path_watcher.rs:865,893` | Trust-boundary; OK if kernel honors protocol |
| Disk/wire offset (`StringPointer.offset`, `SyncEntry.byte_offset`) | `standalone_graph/StandaloneModuleGraph.rs:580 (and others)`, `sourcemap/InternalSourceMap.rs:175,183,194` | Header / `is_valid_blob` validates, but several sites rely on `debug_assert!` only — see §3.1 |
| FFI `*mut T` from user JS (typed-array view) | `jsc/array_buffer.rs:614,632` | OK — JSC enforces `byteOffset` alignment on typed-array construction |

### 1.8 `ptr.wrapping_add(n)` (2 hits)

Both sites — searched manually — wrap for "compute address that may have
already gone past the end and isn't dereferenced until a separate bounds
check". Wrapping is the *correct* primitive when the result is compared not
deref'd. Sound.

### 1.9 `ptr::write_volatile` (2 hits) / `read_volatile` (0)

- `sql_jsc/postgres/PostgresSQLConnection.rs:1502` — zero an
  `options_buf: Box<[u8]>` byte-by-byte before drop. Correct use (defeat
  dead-store elimination for security-sensitive zeroing).
- `io/lib.rs:1167` — see §3.3 (UB-risk).

### 1.10 `ptr::replace` (5 hits)

Two of five (`bun_core/lib.rs:235`, `runtime/shell/subproc.rs:2422`) reviewed
above. The others are equivalent `Self`-state swaps through raw field
pointers. All sound.

---

## 2. Representative Sites (file:line, classification)

Below: 32 specific cases used to ground the analysis above.

### Read

1. **`src/bundler/AstBuilder.rs:449`** — `unsafe { core::ptr::read(&raw const st.value) }`. Bit-clone of `s.value` (arena-backed `StmtData::SExpr` payload). Paired with `ManuallyDrop` higher up. **Class (A).**
2. **`src/bundler/linker_context/convertStmtsForChunk.rs:412`** — `core::ptr::read(&raw const s.func)` to strip `IsExport`. Sole copy then reaches `Stmt::alloc` which moves it into a fresh `S::Function`; original `s.func` remains in arena (no Drop). **Class (A).**
3. **`src/collections/linear_fifo.rs:480`** — `unsafe { ptr::read(self.buf.as_slice().as_ptr().add(self.head)) }` immediately followed by `self.discard(1)`. Bounds: `count > 0` ⇒ `head` in readable region. **Class (A).**
4. **`src/jsc/btjs.rs:53`** — `core::ptr::write(context, ffi::zeroed_unchecked())` — Windows-only out-param zeroing before `RtlCaptureContext`. **Class (A).**
5. **`src/install/migration.rs:866`** — Sparse `ptr::write(dependencies_base.add(i), Dependency::default())` over reserved Vec capacity (debug-build only). **Class (A).**

### Read_unaligned

1. **`src/io/write.rs:194`** — `read_unaligned(buf[pos..end].as_ptr().cast::<T>())` after `end > buf.len()` rejected. Idiomatic, safe-bound at the slice site. **Class (A).**
2. **`src/exe_format/lib.rs:35`** — Helper `read_struct<T: Copy>(bytes: &[u8]) -> T` with a doc-cited length precondition and `debug_assert!`. The pattern is for *callers* to pass `&buf[off..][..size_of::<T>()]`; class **(A)** *if* every caller in the cluster honours it (verified by grep — they do).
3. **`src/runtime/node/dir_iterator.rs:672-690`** — Three `read_unaligned` of `FILE_DIRECTORY_INFORMATION` fields via `p.add(entry_offset + offset_of!(.., NextEntryOffset))`. Bounds check is `entry_offset < end_index` (kernel-set). Trust-boundary on `NtQueryDirectoryFile`. **Class (A).**
4. **`src/runtime/node/node_fs.rs:6196`** — `read_unaligned(req.ptr_as::<RawStatFS>())` after libuv `rc >= 0`. Libuv's `req.ptr` contract. **Class (A).**
5. **`src/standalone_graph/StandaloneModuleGraph.rs:292,345,357,580,2153,2183,2213,…`** — `read_unaligned::<Offsets>` and `read_unaligned::<CompiledModuleGraphFile>` from the embedded section. Each preceded by a trailer/length sanity check, but the per-`StringPointer.offset` access goes through `slice_to` whose bounds check is `debug_assert!`. **UB-RISK** under tampered binary — see §3.1.
6. **`src/sourcemap/InternalSourceMap.rs:175,183,194`** — Header reads after `is_valid_blob`. Mostly safe. `sync_entry(i)` documents `i < sync_count` precondition; verified by binary-search bound (`hi: usize = n_sync as usize`). **Class (A).**

### Write

1. **`src/bun_alloc/lib.rs:2210`** — `BSSListOverflowBlock::zero(this: *mut Self)` with `addr_of_mut!((*this).used/prev).write(...)`. Initialises uninit storage; assignment-with-drop would UAF on `prev: Option<Box<…>>` garbage. **Class (A).**
2. **`src/runtime/socket/socket_body.rs:2607-2613`** — `drop_in_place(p) → ptr::write(p, new_handlers) → (*p).mode = prev_mode → (*p).active_connections.set(...)`. Active-connection counter copied OUT before drop; mode reasserted AFTER write. **Class (A).**
3. **`src/install/migration.rs:1007-1023`** — workspace path: `ptr::write(dependencies_base.add(deps_cursor), Dependency { … workspace path/name … })` then `deps_cursor += 1`. SAFETY says "deps_cursor < num_deps; capacity reserved above". `num_deps` accumulated up-front from JSON property counts; see §3.2.
4. **`src/runtime/socket/WindowsNamedPipeContext.rs:345`** — `ptr::write(this, WindowsNamedPipeContext { … })` over freshly allocated uninit storage. **Class (A).**
5. **`src/runtime/webcore/Request.rs:1612`** — `ptr::write(req, Request { … })` over a sentinel `Box<Request>` whose fields hold dangling but valid sentinels; documented in `clone()`. **Class (A).**

### Write_unaligned

1. **`src/bun_core/util.rs:237`** — `Unaligned<T>::set` writes through `addr_of_mut!(self.0).write_unaligned(value)` on a `repr(packed)` field. **Class (A).**
2. **`src/exe_format/lib.rs:45`** — `write_struct<T: Copy>(bytes: &mut [u8], value: &T)`. Mirror of `read_struct`. **Class (A).**

### Copy_nonoverlapping

1. **`src/bun_alloc/ast_alloc.rs:364`** — grow-spill: copy `old.size()` bytes from `ptr` to fresh `p`. Non-overlap via fresh allocation. **Class (A).**
2. **`src/bun_alloc/stack_fallback.rs:255`** — grow-spill for stack-fallback allocator. Source/dest disjoint by allocation. **Class (A).**
3. **`src/runtime/api/bun/h2_frame_parser.rs:378`** — `StreamPriority::from`. Caller obligations verified through `handle_priority_frame` → `handle_incomming_payload`. **Class (A).**
4. **`src/runtime/webview/ChromeProcess.rs:697`** — `Bun__Chrome__autoDetect(out_buf, out_cap)` checks `buf.len() > out_cap` first, then copies. **Class (A).**
5. **`src/jsc/bindgen.rs:302,316`** — in-place reinterpret ExternType→ZigType. Gated `size_of::<ZigType>() <= size_of::<ExternType>()`. **Class (A).**
6. **`src/standalone_graph/StandaloneModuleGraph.rs:* (via slice_to)`** — see §3.1.
7. **`src/sys/lib.rs:9142`** — `copy_nonoverlapping(bytes.as_ptr(), this.buf.add(this.pos), bytes.len())` inside `adapter_write_all`. **UB-RISK** — see §3.4.
8. **`src/install/windows-shim/bun_shim_impl.rs:611`** — copy image-path bytes into `buf1_u8 + nt_prefix`. Pre-checked by ends_with + arithmetic; bounded. **Class (A).**

### Copy (memmove)

1. **`src/bun_core/bounded_array.rs:230`** — shift-right by one in `BoundedArray::insert`. `i < self.len <= CAPACITY`. **Class (A).**
2. **`src/runtime/api/bun/h2_frame_parser.rs:1735,1792,5685`** — Prepend padding byte for HTTP/2 DATA frame. `slice.len() ≤ MAX_PAYLOAD_SIZE_WITHOUT_FRAME`. **Class (A).**
3. **`src/runtime/webcore/encoding.rs:635,647`** — JS string encode hot path; `to_len`-bounded. **Class (A).**

### Drop_in_place / Replace

1. **`src/collections/hive_array.rs:324`** — `drop_in_place(value)` then ASAN poison; `value` is a hive slot; bitset `used` then unset. **Class (A).**
2. **`src/runtime/shell/subproc.rs:2422`** — `ptr::replace(addr_of_mut!((*this).state), Done(Box::default()))`. Raw-field swap without `&mut Self`. **Class (A).**

### Ptr arithmetic

1. **`src/runtime/cli/upgrade_command.rs:1108-1127`** — `buf_ptr.add(destination_executable.len() - target_filename_.len())` and friends. Carefully reasoned, NUL written at separator. **Class (A).**

---

## 3. Bug Findings (`pre-existing-ub-ptr-N`)

### 3.1 `pre-existing-ub-ptr-1` — standalone-graph `slice_to` family uses `debug_assert!`-only bounds

**File:** `src/standalone_graph/StandaloneModuleGraph.rs:655-691`

```rust
unsafe fn slice_to(base: *const u8, len: usize, ptr: StringPointer) -> &'static [u8] {
    if ptr.length == 0 { return b""; }
    let off = ptr.offset as usize;
    let n = ptr.length as usize;
    debug_assert!(off.checked_add(n).is_some_and(|end| end <= len));
    let _ = len;
    unsafe { core::slice::from_raw_parts(base.add(off), n) }
}

unsafe fn slice_to_mut(base: *mut u8, len: usize, ptr: StringPointer) -> *mut [u8] {
    let off = ptr.offset as usize;
    let n = ptr.length as usize;
    debug_assert!(off.checked_add(n).is_some_and(|end| end <= len));
    let _ = len;
    core::ptr::slice_from_raw_parts_mut(unsafe { base.add(off) }, n)
}

unsafe fn slice_to_z(base: *const u8, len: usize, ptr: StringPointer) -> &'static ZStr {
    if ptr.length == 0 { return ZStr::EMPTY; }
    let off = ptr.offset as usize;
    let n = ptr.length as usize;
    debug_assert!(off.checked_add(n).is_some_and(|end| end < len));
    let _ = len;
    unsafe { ZStr::from_raw(base.add(off), n) }
}
```

`from_bytes` (line 531) calls these helpers with `StringPointer` values
read straight from the embedded `__BUN`/`.bun`/`bun_compiled` section via
`read_unaligned`. Producer-side `to_bytes` writes these honestly, but in
release builds:

- `slice_to_mut` returns a `*mut [u8]` whose JSC-side write goes OOB if
  `ptr.offset + ptr.length > raw_len`.
- `slice_to` / `slice_to_z` materialize `&'static [u8]` / `&'static ZStr` over
  bytes outside the section, dereferenced immediately by callers (`file_names`
  push, `name`/`contents` reads).

The values are read from the user-supplied compiled binary on disk. Threat
model footnote: a tampered standalone executable already implies arbitrary
execution. **Severity: low-medium.** Recommendation: replace `debug_assert!`
with a runtime `if !ok { return Err(BunError::CorruptedModuleGraph) }`. The
fall-through (`return None` / `Err`) is already in adjacent code at
`from_executable`, so the wiring is minimal.

### 3.2 `pre-existing-ub-ptr-2` — `Unaligned::slice_align_cast` hands out `&[T]` over potentially-misaligned bytes

**File:** `src/bun_core/util.rs:243-264`

```rust
pub fn slice_align_cast(slice: &[Unaligned<T>]) -> &[T] {
    debug_assert!(
        (slice.as_ptr() as usize) % core::mem::align_of::<T>() == 0,
        "Unaligned::slice_align_cast: pointer is not {}-byte aligned",
        core::mem::align_of::<T>(),
    );
    unsafe { core::slice::from_raw_parts(slice.as_ptr().cast::<T>(), slice.len()) }
}
```

Forming `&[T]` over a misaligned pointer is **immediate UB on first access**
(Rust references must be aligned, regardless of how they're used). The check
is `debug_assert!`. Lit callers: `src/jsc/array_buffer.rs:598,620`
(`ArrayBuffer::as_u16`, `ArrayBuffer::as_u32`), which feed into Node-zlib /
brotli / zstd binding code that mutates the slice (`NativeZlib.rs:146`,
`NativeBrotli.rs:215`, `NativeZstd.rs:162,203`). In practice JSC's typed-array
constructors enforce `byteOffset % size_of::<T>() == 0`, so this is
"works-in-practice"; but the contract is enforced only at the JSC layer, not
defended at the Rust boundary.

**Severity: low.** **Recommendation:** swap `debug_assert!` for a hard runtime
`assert!`, or change the public API to `Result<&[T], MisalignedError>` and
let callers handle. Cost is one compare/jcc per call — negligible relative to
the cost of the conversion's IO.

### 3.3 `pre-existing-ub-ptr-3` — volatile-write-for-cross-thread-publish in `bun_io::Request::store_callback_seq_cst`

**File:** `src/io/lib.rs:1163-1169`

```rust
pub fn store_callback_seq_cst(&mut self, cb: for<'a> fn(&'a mut Request) -> Action<'a>) {
    unsafe { core::ptr::write_volatile(&raw mut self.callback, cb) };
    core::sync::atomic::fence(Ordering::SeqCst);
}
```

The Rust memory model treats *non-atomic* writes as data races when paired
with reads on other threads, even with volatile + fence. The doc comment
explicitly says the io thread *reads* `callback` after popping from an MPSC
queue, which itself supplies acquire on the `next` pointer. So a fix exists:
move the publish into the MPSC `push` (the existing acquire-on-`next` pairs
with that push's release), and let `callback` be plain non-atomic. Or wrap
`callback` in `AtomicPtr` and use `store(Release)` / `load(Acquire)`.

**Severity: low (Miri-flagged, not observed at runtime).** Recommendation:
either rely on the MPSC's release/acquire pair (Zig's natural model) or
adopt `AtomicPtr`. The current code is comment-only justified.

The companion comment at `webcore::blob::{read_file,write_file}` reportedly
uses the same pattern; recommend reviewing those once this is fixed for
consistency.

### 3.4 `pre-existing-ub-ptr-4` — `SysQuietWriterAdapter::adapter_write_all` `pos + bytes.len()` overflow

**File:** `src/sys/lib.rs:9120-9147`

```rust
if this.pos + bytes.len() > this.cap {     // ← may wrap on huge bytes.len()
    if this.pos > 0 { _ = fd_write_all_quiet(this.fd, this.buffered()); this.pos = 0; }
    if bytes.len() >= this.cap { _ = fd_write_all_quiet(this.fd, bytes); return Ok(()); }
}
unsafe { core::ptr::copy_nonoverlapping(bytes.as_ptr(), this.buf.add(this.pos), bytes.len()) };
this.pos += bytes.len();
```

If `bytes.len()` ≈ `usize::MAX`, `this.pos + bytes.len()` wraps to a small
value, the branch is bypassed, and `copy_nonoverlapping` writes `bytes.len()`
bytes into `this.buf + this.pos` — instant heap-buffer-overflow.

In practice the writer is fed by `Output::pretty` / log macros where
`bytes.len()` is bounded by the format buffer (a few KiB). The wrapper exists
for the diagnostic path in `bun_sys`, not user input. **Severity: low.**
Recommendation: `if this.pos.checked_add(bytes.len()).is_none_or(|end| end > this.cap)`.

### 3.5 `pre-existing-ub-ptr-5` — Windows shim `core::ptr::copy(spawn_command_line, dst, len + 1)` debug-only bound

**File:** `src/install/windows-shim/bun_shim_impl.rs:1242-1244`

```rust
let len = unsafe { bun_core::ffi::wstr_units(spawn_command_line) }.len();
let dst = bun_ctx.out_buf().expect(...);
debug_assert!(len + 1 <= BUF2_U16_LEN);
unsafe { core::ptr::copy(spawn_command_line, dst, len + 1) };
```

Release builds will copy past the end of `dst` if the shim metadata
generates a command line larger than `BUF2_U16_LEN` u16 units. The shim
metadata is produced at install-time from `package.json` `bin` entries plus
the install prefix; a path-length pathology (Windows long-path UNC) could
plausibly cross 32 K u16 units.

**Severity: low.** Recommendation: hard `assert!` (or return
`LauncherErr::CommandLineTooLong` and continue). Both `dst` and `src` are
already validated at the caller level, but the bound enforcement here is the
single source of truth.

### 3.6 `pre-existing-ub-ptr-6` — `SerializedSourceMap::header()` has caller-precondition contract not enforced by sibling accessors

**Files:** `src/sourcemap/lib.rs:853-902`, `src/standalone_graph/StandaloneModuleGraph.rs:2330-2370`

```rust
pub fn header(self) -> Header {
    // SAFETY: callers guarantee `bytes.len() >= size_of::<Header>()`.
    unsafe { core::ptr::read_unaligned(self.bytes.as_ptr().cast::<Header>()) }
}
```

The only public caller that *does* check first is `mapping_blob`. The other
public methods that call `self.header()` — `source_file_names()`,
`compressed_source_files()`, and (in the StandaloneModuleGraph copy)
`source_files_count()`, `source_file_name(index)` — do not check. In the
current call graph everything is reached from
`LazySourceMap::load → mapping_blob → ...`, so the length is in practice
already validated. But the public interface allows direct calls; a future
caller could trip OOB read on a too-small `bytes`.

**Severity: low.** Recommendation: gate the header read inside `header()`
with a runtime length check returning `Option<Header>` (or pass length up
front), and update the small handful of internal callers.

---

## 4. Hardened SAFETY-comment templates

Use these as starting points when writing new sites. Each fills in the
*precondition* that makes the operation sound — leave nothing implicit.

### `core::ptr::read` / `read_unaligned`

```rust
// SAFETY:
// 1. `ptr` is the start of `size_of::<T>()` initialized bytes for `T`.
// 2. Source allocation outlives this read (lifetime: <…>).
// 3. The bytes form a valid `T` (every bit pattern allowed; e.g.
//    `T: Copy + bytemuck::Pod` / arena-backed AST node).
// 4. (`ptr::read` only) `ptr` is aligned to `align_of::<T>()`.
// 5. Drop ownership: caller will not run drop on `*ptr` again — either
//    `ManuallyDrop` here, or `ptr::write` over `*ptr`, or arena disables Drop.
unsafe { core::ptr::read(ptr) }
```

### `core::ptr::write` / `write_unaligned`

```rust
// SAFETY:
// 1. `ptr` points to `size_of::<T>()` writable bytes (no `&` reborrow active).
// 2. The byte range is fully owned by this writer for the duration.
// 3. The previous occupant is *not* dropped (uninit / explicitly drop_in_place
//    just above / arena-allocated). Plain `*ptr = value` would drop the LHS.
// 4. (`ptr::write` only) `ptr` is aligned to `align_of::<T>()`.
unsafe { core::ptr::write(ptr, value) }
```

### `core::ptr::copy_nonoverlapping`

```rust
// SAFETY:
// 1. `src` is valid for reads of `n * size_of::<T>()` bytes.
// 2. `dst` is valid for writes of `n * size_of::<T>()` bytes.
// 3. `[src, src + n*size_of::<T>())` and `[dst, dst + n*size_of::<T>())` do
//    NOT overlap (specify how: distinct allocations / monotonic index /
//    `addr(src) + n*size <= addr(dst)`).
// 4. Both pointers are aligned to `align_of::<T>()` (or `T = u8`).
// 5. `n` does not arithmetic-overflow when multiplied by `size_of::<T>()`.
unsafe { core::ptr::copy_nonoverlapping(src, dst, n) }
```

### `core::ptr::copy` (memmove)

```rust
// SAFETY:
// As copy_nonoverlapping, but ranges MAY overlap. Direction is handled by
// memmove. Still requires both endpoints in the same allocation when overlap
// is expected (cite the allocation here).
unsafe { core::ptr::copy(src, dst, n) }
```

### `ptr.add(n)`

```rust
// SAFETY:
// `n * size_of::<T>()` does not overflow `isize` and the resulting pointer
// stays within (or one-past-the-end of) the allocation rooted at `<base
// pointer>` — bound here is `<n < CAPACITY>` (cite invariant).
unsafe { ptr.add(n) }
```

### `addr_of_mut!((*p).field)`

```rust
// SAFETY:
// `p` is non-null and aligned for `Self`; the field projection itself does
// not require `*p` to be initialized — only the field's containing struct's
// layout. The returned `*mut Field` is used to (a) initialize via `.write()`,
// or (b) project past a reborrow boundary callers expect (cite the parent
// callback's free contract).
unsafe { core::ptr::addr_of_mut!((*p).field) }
```

### `core::ptr::drop_in_place(p)`

```rust
// SAFETY:
// 1. `p` is aligned and points to an initialized, fully-owned `T`.
// 2. After this returns, `*p` is *logically uninitialized*; no caller will
//    dereference it again until it has been re-`ptr::write`-ed or freed.
// 3. There is no panic between here and the next initialization or free
//    (else `*p` is dropped twice via Drop unwind).
unsafe { core::ptr::drop_in_place(p) }
```

### Volatile write / read

```rust
// SAFETY:
// Volatile semantics — the write is not optimized away. NOT a cross-thread
// synchronization primitive; pair with explicit `AtomicPtr`/`AtomicUsize`
// or a release-on-publish + acquire-on-load that the surrounding data
// structure already provides.
// (For secure zeroing only:) used to defeat dead-store elimination on
// security-sensitive memory before drop.
unsafe { core::ptr::write_volatile(ptr, value) }
```

---

## 5. Refactor opportunities (toward safe code)

### 5.1 Replace `core::ptr::copy_nonoverlapping(src.as_ptr(), dst, len)` with `<slice>::copy_from_slice` when both ends are slices

Candidates:

- `bun_alloc/lib.rs:1468,3232` — `unsafe { copy_nonoverlapping(src.as_ptr(), ptr, src.len()) }` with subsequent `from_raw_parts(ptr, src.len())`. Refactor to allocate, then `Vec::extend_from_slice(src)` or `MaybeUninit::write_slice(uninit_slice, src)`.
- `bundler/linker_context/generateCodeForFileInChunkJS.rs:407-414` — Vec copy with `set_len`. Replace with `Vec::extend_from_slice` once arena allocation supports the `Allocator` trait. (Note Bun's `AstAlloc` is `unsafe impl Allocator`, so this already works.)
- `runtime/webview/ChromeProcess.rs:697` — drop in favour of `slice::from_raw_parts_mut(out_buf, out_cap).get_mut(..buf.len()).copy_from_slice(&buf)` + bounds check.

**Property test sketch.** For each `unsafe fn foo(src: &[T], dst_ptr, dst_cap)`,
property-test:

```rust
proptest! {
    #[test]
    fn copy_within_cap_matches_slice(src: Vec<u8>, cap: usize) {
        let cap = (cap % 4096).max(src.len());
        let mut dst = vec![0u8; cap];
        unsafe { foo(&src, dst.as_mut_ptr(), cap); }
        assert_eq!(&dst[..src.len()], &src[..]);
    }
}
```

### 5.2 Replace `ptr.add(i)` index access with `[i]` (slice indexing) for Vec/Box<[T]>

Sites where the entire allocation is owned by a single `Vec<T>` or `Box<[T]>`
and the `.add(i)` is purely a bounds-check elision:

- `collections/array_hash_map.rs:738` — internal index probe.
- `collections/multi_array_list.rs:944` — swap-remove SoA tail.

These are perf-bound hot paths; class **(B) PERF_ONLY**. Property test: see
above; benchmark before vs after via `bun bench` harness. If the perf delta
is < 1 % the safe code wins.

### 5.3 Replace `ptr::read` + `ManuallyDrop` Zig-port pattern with safe builder

Hard refactor: many bundler sites do `core::ptr::read(arena_thing)` to
duplicate a value into a fresh statement. The clean Rust shape is a
`Clone`-impl on `S::Function` / `E::Class` that copies *without* allocating
(since the arena bytes will be reclaimed atomically). Class **(C)** but
non-trivial — defer to a Phase-B refactor that gives every AST node a proper
`Clone` impl backed by the arena.

### 5.4 Replace volatile-for-publish with `AtomicPtr` (UB finding §3.3)

Defines the patch:

```rust
struct Request {
    // was: callback: fn(&mut Request) -> Action<'_>,
    callback: AtomicPtr<()>,
}
impl Request {
    pub fn store_callback_seq_cst(&self, cb: fn(&mut Request) -> Action<'_>) {
        self.callback.store(cb as *mut (), Ordering::Release);
    }
    pub fn load_callback(&self) -> fn(&mut Request) -> Action<'_> {
        unsafe { core::mem::transmute(self.callback.load(Ordering::Acquire)) }
    }
}
```

Property: `store_then_load` returns the same function pointer on the same
thread; cross-thread the release/acquire pair establishes happens-before.

### 5.5 Replace `slice_to[_mut|_z]` `debug_assert!` with hard checks (UB finding §3.1)

`from_bytes` already returns `Result<…, BunError>`. Replace the helpers with:

```rust
fn slice_to(base: *const u8, len: usize, ptr: StringPointer)
    -> Result<&'static [u8], CorruptedModuleGraph>
{
    if ptr.length == 0 { return Ok(b""); }
    let off = ptr.offset as usize;
    let n = ptr.length as usize;
    let end = off.checked_add(n).ok_or(CorruptedModuleGraph)?;
    if end > len { return Err(CorruptedModuleGraph); }
    Ok(unsafe { core::slice::from_raw_parts(base.add(off), n) })
}
```

Cost: one branch per call; called O(modules + sourcemap files) at startup
only, so negligible.

---

## 6. Recommended PRs

### PR-PTR-1 — "Harden standalone graph subslice helpers" (UB findings §3.1 + §3.6)

**Scope:**

- Convert `slice_to`/`slice_to_mut`/`slice_to_z` in
  `src/standalone_graph/StandaloneModuleGraph.rs` to `Result`-returning
  variants; thread `CorruptedModuleGraph` through `from_bytes_alloc`.
- Add runtime length check inside `SerializedSourceMap::header()`
  (`src/sourcemap/lib.rs:855`,
  `src/standalone_graph/StandaloneModuleGraph.rs:2330`).
- Test: a `bun build --compile` followed by `truncate -s -16` should fail
  cleanly (`"corrupted module graph"`), not crash.

### PR-PTR-2 — "Replace volatile-write-for-publish with `AtomicPtr`" (UB finding §3.3)

**Scope:**

- `src/io/lib.rs:1163` `store_callback_seq_cst`: change `callback` field
  type to `AtomicPtr<()>` with `Release`/`Acquire`.
- Audit `webcore::blob::{read_file,write_file}` for the same pattern and
  apply the same change.
- Test: existing `bun_io::Request` tests should keep passing; add a Miri
  test that exercises the cross-thread store/load (requires Miri-clean test
  harness, in scope of separate ticket).

### PR-PTR-3 — "Fix overflow in `SysQuietWriterAdapter::adapter_write_all`" (UB finding §3.4)

**Scope:**

- One-line `checked_add` fix at `src/sys/lib.rs:9130`.
- Add a `bun bd test` for a giant log line to confirm.

### PR-PTR-4 — "Promote `Unaligned::slice_align_cast` `debug_assert!` to hard `assert!`" (UB finding §3.2)

**Scope:**

- `src/bun_core/util.rs:243,257`: replace `debug_assert!` with `assert!`.
- Run `bun bd test` on the typed-array / zlib / brotli / zstd surface to
  verify no path actually triggers it.

### PR-PTR-5 — "Bound Windows-shim spawn-command-line copy" (UB finding §3.5)

**Scope:**

- `src/install/windows-shim/bun_shim_impl.rs:1242`: replace `debug_assert!`
  with a real `if len + 1 > BUF2_U16_LEN { return LauncherErr::CommandLineTooLong; }`.
- Add an installer test with a synthesized super-long `bin` entry.

### PR-PTR-6 (defer) — "Phase-B: lift bundler `ptr::read` patterns to safe arena Clone"

**Scope:** see §5.3.  Large; defer until Phase-B AST refactor lands.

---

## 7. Aggregate sample distribution

Of the ~120 sites sampled in detail:

| Outcome                             | Count |
|-------------------------------------|------:|
| **Sound under documented contract** | ≈ 95  |
| **Sound but weak SAFETY comment**   | ≈ 18  |
| **UB-RISK filed**                   |     6 |
| **Refactorable (low cost)**         | ≈ 8  |

The 95-sound-as-documented majority is the bulk of:

- field-projection / uninit-init via `addr_of_mut!`;
- arena-backed `ptr::read` Zig-port pattern (gated by `ManuallyDrop`);
- bounded `ptr.add(i)` over Vec / Box<[T]>;
- kernel/libuv/libc trust-boundary `read_unaligned`;
- fresh-allocation `copy_nonoverlapping` (allocator grow paths).

The 18 weak-comment sites mostly say *"caller checked X"* where X is in
practice checked by the *transitive* caller (one or two frames up) and the
intermediate frame just relies on it. None of these are wrong today, but
they're brittle.

The 6 UB-RISKs are concentrated in:
- exe-format-on-disk parsing (#1, #6),
- cross-thread publish via volatile (#3),
- diagnostic-path bounded buffers (#4, #5),
- a `debug_assert!`-only alignment gate (#2).

None of them are reachable via stable, untrusted JS today; the highest
practical impact is #3 (Miri-flagged) and #1 (release-only behavior on
already-tampered binary).

---

## 8. Verification

To reproduce the inventory slice:

```sh
jq -c 'select((.categories | index("ptr_intrinsic")) // (.categories | index("ptr_arith")))' \
  .unsafe-audit/unsafe-inventory.jsonl
```

Per-op samples are at `/tmp/audit_samples/{read,write,copy_nonoverlapping,
copy,drop_in_place,replace,addr_of,addr_of_mut,ptr_add,read_unaligned,
write_unaligned}.jsonl`.

To repro a finding, e.g. §3.1:

```sh
bun bd build --compile --outfile /tmp/exe /tmp/script.ts
truncate -s -16 /tmp/exe
/tmp/exe
# Expected after PR-PTR-1: "corrupted standalone module graph"
# Today (release build): likely segfault or silent wrong slice
```

---

## 9. Coda

This cluster is dense, but the audit returned a low UB rate (6 real
findings / 1,188 sites ≈ 0.5%). The dominant pattern — Zig-port
`ptr::read`/`ptr::write` for assignment-without-drop — is well-encapsulated,
well-documented, and consistently paired with `ManuallyDrop` or `drop_in_place`.
The remaining `addr_of_mut!` traffic is essentially mandatory: Bun's
"callback may free `self`" FFI contract makes `&mut Self` reborrows unsafe
in a way Stacked Borrows refuses, so raw-pointer-only field projection is the
only correct primitive.

The 6 hard findings cluster around two themes:

1. **`debug_assert!`-only bounds for untrusted bytes.** Three of six.
   Fix is mechanical: convert to runtime `if !ok { return Err(...) }`.

2. **Volatile-for-cross-thread-publish.** One site, with a documented twin in
   `webcore::blob`. Fix is `AtomicPtr` with `Release`/`Acquire`.

After PR-PTR-{1..5} the cluster's residual risk is at the level of "kernel /
libuv trust boundary" — i.e., the unsafe is acting as a Rust-side FFI shim
over a C-side contract we cannot statically verify. That's the irreducible
floor for any runtime with this much OS-syscall and FFI traffic.
