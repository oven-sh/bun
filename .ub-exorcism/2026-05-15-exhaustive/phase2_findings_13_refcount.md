# Phase 2 Findings — Bucket 13: Reference-Count Lifecycle

**Bucket scope** (UB-TAXONOMY §13): `Arc::from_raw`/`into_raw` pairing;
`Box::from_raw` post-Drop; `RawWaker` vtable `from_raw` without
forget/into_raw; multi-threaded `Arc` strong-count not synced with `from_raw`.

**Run**: `2026-05-15-exhaustive`
**Sweeper**: static-bucket-13 (refcount-lifecycle)
**Sources**: Phase 1 inventories A–U, Phase 1 notes (esp. B/F/I/S/T), prior
audit `unsafe-inventory.jsonl`, EXP registry (EXP-027 listed but is the
Windows `RawSlice` experiment; the **`AnyRefCounted`-on-`NodeHTTPResponse`
port-debt** lives only in Section F's note, not in EXP-027 itself).
**Verdict**: pairing audit clean across the workspace; no new T1 UB findings;
documented port-debt and one weakly-paired pattern remain. Phase 2 actions
are remediation-grade, not severity-blockers.

---

## 1. Workspace-wide enumeration

Counts (current source, `rg` workspace-wide, restricted to `src/**/*.rs`,
production `unsafe { … }` blocks; comments and doc strings included in the
raw greps but excluded from "live site" totals):

| primitive | live sites | source-of-truth files |
|---|---:|---|
| `bun_core::heap::into_raw` | 400 | `src/bun_core/heap.rs` (definitions); 28 in section B alone (per `B_runtime_api.md`) |
| `bun_core::heap::take` | 301 | matched against `into_raw` site-by-site by section sweepers |
| `bun_core::heap::destroy` | 9 | rare: only the all-in-one drop helper |
| `Box::into_raw` | 10 live (most are in heap.rs/comments) | `bun_alloc/lib.rs` ×2 (BSSList overflow), `runtime/api/filesystem_router.rs:862`, `runtime/dns_jsc/dns.rs:3996`, `runtime/node/node_zlib_binding.rs:832`, `runtime/shell/interpreter.rs:1633`, `runtime/socket/Listener.rs:815`, `runtime/socket/udp_socket.rs:1706`, `runtime/bake/DevServer.rs:1118`, `runtime/webcore/ReadableStream.rs:1203` |
| `Box::from_raw` | 18 live | enumerated below |
| `Arc::into_raw` | 6 live | `jsc/SavedSourceMap.rs` ×4, `jsc/VirtualMachine.rs:6300`, `sourcemap/ParsedSourceMap.rs` (helper indirection) |
| `Arc::from_raw` | 2 live | `jsc/SavedSourceMap.rs:425`, `runtime/shell/subproc.rs:2103` |
| `Arc::increment_strong_count` | 3 live | `jsc/SavedSourceMap.rs:424`, `sourcemap/ParsedSourceMap.rs:231`, `runtime/shell/IOWriter.rs:1064`, `runtime/shell/subproc.rs:2102` |
| `Rc::from_raw` | 1 live | `runtime/dispatch.rs:1069` (paired with `Rc::into_raw` 5 lines below) |
| `IntrusiveRc::into_raw` | 7 live | `runtime/socket/socket_body.rs` ×4, `runtime/api/bun/Terminal.rs:604`, `runtime/api/bun/js_bun_spawn_bindings.rs:786`, `runtime/test_runner/bun_test.rs:1195` |
| `IntrusiveRc::from_raw` | 6 live | `runtime/socket/socket_body.rs` ×2, `runtime/api/bun/Terminal.rs:574`, `runtime/api/bun/subprocess/SubprocessPipeReader.rs:138`, `spawn/static_pipe_writer.rs:169`, `runtime/test_runner/bun_test.rs:726` |
| `BackRef::from_raw` | 16 live | enumerated below; **no `BackRef::into_raw` exists by design** — `BackRef` is a non-owning witness |
| `Vec::from_raw_parts` | 11 live | enumerated below |
| `core::mem::forget(x)` | 53 live (excluding doc/comment hits) | enumerated below; dominated by ManuallyDrop-style ownership transfers |
| `ManuallyDrop::{new,take,drop,into_inner}` | 119 live | bulk usage is in collections / parsers; 7 highlighted in section B |
| `RawWaker` / `RawWakerVTable` | **0** | nothing async-waker shaped — Bun's event loop is its own scheduler |

**Coverage of the Section B inventory claim** ("28 `bun_core::heap::into_raw` +
4 `Box::from_raw` + 1 `Vec::from_raw_parts` + 2 `IntrusiveRc::from_raw` + 1
`BackRef::from_raw` + 2 `mem::forget` + 7 `ManuallyDrop` sites, all paired and
documented") — verified per-file against the workspace counts. The B-local
totals are a subset of the workspace tallies above; no orphan in B vs in any
sibling section.

---

## 2. Full per-site `Box::from_raw` enumeration with pairing status

Live `Box::from_raw` sites (excluding comments / doc):

| file:line | producing-side `into_raw` | pairing status | notes |
|---|---|---|---|
| `src/ast/lib.rs:3313` | `lib.rs:3269` (`Box::into_raw(Box::new(MimallocArena::new()))`) | **paired** | thread-local arena Drop helper |
| `src/bun_alloc/lib.rs:2352` | `lib.rs:2354` (same fn — BSSList head rotation) | **paired** | inline tail special-case correct (skipped via `core::ptr::eq` check) |
| `src/bun_alloc/lib.rs:2441` | `lib.rs:2354` (recursive Drop chain) | **paired** | recursive Drop walks `prev` chain; tail-skip enforced |
| `src/bun_core/heap.rs:103` | `heap::into_raw` (this file's `into_raw` is the workspace producer) | **paired (definition)** | the canonical `take(this) = Box::from_raw(this)` helper |
| `src/bun_core/heap.rs:92` | same | **paired (definition)** | `destroy(this) = drop(take(this))` |
| `src/collections/array_hash_map.rs:1603` | `lib.rs:1602` `Box::into_raw_with_allocator` | **paired** | uses `_with_allocator` to preserve the bumpalo allocator parameter — correct nightly idiom |
| `src/collections/hive_array.rs:459`, `:603` | `slot::Box::new` heap allocation; reclaimed in slot Drop | **paired** | hive slot release path |
| `src/jsc/host_fn.rs:629` | `IntoHostConstructReturn::into_host_construct_return` (which `Box::into_raw`s as its first step) | **paired by trait contract** | host-fn panic-barrier reclaim |
| `src/libuv_sys/libuv.rs:608` | `lib.rs:590` `set_owned_data` Box::into_raw | **paired** | UvHandle::take_owned_data ⟷ set_owned_data round-trip; same `T` required |
| `src/libuv_sys/libuv.rs:1282`, `:1288` | caller-side `Box<Pipe>` allocation | **paired** | `Pipe::close_and_destroy` reclaim, both the never-init'd and init'd-but-closed branches |
| `src/runtime/api/html_rewriter.rs:421`, `:457`, `:884` | `Response::init` `bun_core::heap::into_raw` 1–10 lines above | **paired (scopeguard)** | three `Response::finalize(Box::from_raw(r))` paths inside scopeguard cleanup so panic-during-FFI still frees |
| `src/runtime/api/bun/js_bun_spawn_bindings.rs:1929` | `to_process()` callee `Box::into_raw(Box::new(Subprocess::init(...)))` | **paired** | sync-spawn path; subprocess never reaches a JS wrapper |
| `src/runtime/cli/test/parallel/Channel.rs:283` | caller-side `bun_core::heap::into_raw(Box::new(uv::Pipe::init(...)))` | **paired** | only on success — failure path leaves caller responsible (explicit comment) |
| `src/runtime/crypto/CryptoHasher.rs:154` | host-fn construct path that produced `handle` | **paired** | finalizer invoked on JSC GC |
| `src/runtime/node/node_fs_watcher.rs:1107` | finalizer reclaim path; constructor `bun_core::heap::into_raw` | **paired** | FSWatcher GC finalizer |
| `src/runtime/webcore/Request.rs:866` | `bun_core::heap::into_raw(Box::new(Request::init(...)))` constructor | **paired** | drop path during finalize/init failure |
| `src/sql_jsc/shared/SQLDataCell.rs:226`, `:254` | global-allocator `Box<[u8]>::new_zeroed_slice`/Vec spawn at `postgres/DataCell.rs:30-47` and `:822-851` | **paired** (cross-bucket-20: see §3 below) | `Bytea` & `TypedArray` reconstructions; **TODO(port) annotations stale** per Section S note — producer trace is now layout-consistent |

**Verdict**: every workspace `Box::from_raw` is paired. The four
"non-`bun_core::heap`" idiomatic exceptions noted by Section B
(`html_rewriter.rs` ×3 + `js_bun_spawn_bindings.rs` ×1) are the same set
captured here. No orphan.

---

## 3. SQLDataCell — explicit cross-bucket 20 (allocator-pairing) callout

**Location**: `src/sql_jsc/shared/SQLDataCell.rs:226` (Bytea),
`SQLDataCell.rs:254` (TypedArray), `SQLDataCell.rs:149` (Array `Vec` fat
pointer release).

**Producer trace per Section S** (`phase1_notes/S_sql_redis.md:66-89`):
- `Bytea` — `postgres/DataCell.rs:30-47` allocates exactly `hex.len()/2`
  bytes and stores `written` as `byte_len`. The reconstruction at line 226
  uses the stored `byte_len`, **not** the original capacity — but since the
  producer always allocates exactly `byte_len` (no over-allocation), the
  layout matches.
- `TypedArray` — `from_bytes_typed_array()` (`DataCell.rs:822-851`) allocates
  `out_bytes` and stores `byte_len = out_bytes`. The reconstruction at line
  254 also uses `byte_len`. Layout matches.

**Cross-bucket-20 risk**: any future producer that allocates with a *capacity
> length* would break the `Box::<[u8]>::from_raw` layout (mimalloc tolerates
this at runtime but `Box::from_raw` is a layout-typed reconstruction; calling
`from_raw` with the wrong size is **library-invariant UB** even when the
actual `free()` would succeed). The current source is sound; the audit risk
is the missing `static_assertions`-class invariant.

**Phase 11 candidate**: convert SQLDataCell's `(ptr, len)` storage to a
`Box<[u8]>` directly inside the variant (no manual `Box::from_raw`), or wrap
the reconstruction in a typed helper that asserts `byte_len == capacity` at
the producer side. Cross-references **Bucket 20 alloc-pairing**.

**Stale TODO cleanup**: `SQLDataCell.rs:225` says `TODO(port): verify
allocation size == len (Zig free() uses slice.len)`. The verification is
done in §S; the TODO should be deleted.

---

## 4. Live `core::mem::forget` enumeration with intent classification

53 live sites. Pattern classification:

| pattern | site count | sample |
|---|---:|---|
| **Ownership transfer to FFI / external finalizer** (the one true `mem::forget` use) | 14 | `runtime/api/BunObject.rs:1692` (escape_html16 → JSC external-string finalizer), `runtime/api/BunObject.rs:2137` (mime cache transfer), `bun_core/external_shared.rs:67/74/161` (RAII handles handed to C), `runtime/socket/Listener.rs:239/328/1071/1292` (socket_config moved into uws), `runtime/socket/SSLConfig.rs:72`, `runtime/api/Response.rs:71`, `jsc/ResolvedSource.rs:115`, `runtime/api/BunObject.rs:1692` |
| **`mem::forget(mem::take/replace(&mut field, default))`** — moves *out* of a self field that has destructible content into "Used" / "EMPTY" without running Drop on the in-place value (because ownership has just been handed to a caller) | 13 | `runtime/webcore/Body.rs` ×4, `bundler/Chunk.rs` ×2, `bundler/linker_context/*` ×3, `http/lib.rs` ×2 (unix_socket_path), `install/NetworkTask.rs` ×2 |
| **`ManuallyDrop`-style suppress-Drop after manual decomposition** | 13 | `bundler/ParseTask.rs:1960`, `js_parser/p.rs` ×4, `runtime/webcore/streams.rs` ×3 + `ReadableStream.rs:1223`, `io/PipeReader.rs` ×2 (source taken into another struct), `sql_jsc/postgres/DataCell.rs:730`, `runtime/webcore/s3/multipart.rs:955`, `bundler/bundle_v2.rs:3984` |
| **Manual lock guard `mem::forget`** | 1 | `bun_core/util.rs:2766` (deliberate: paired with caller-side later release) |
| **`mem::forget(buf)` after handing buffer to JS / FFI** | 12 | `bun_core/string/StringBuilder.rs` ×2, `bun_core/string/mod.rs:1293`, `jsc/webcore_types.rs:1135`, `http_jsc/websocket_client.rs:432`, `sys/lib.rs:8386`, `sys/dir.rs:293`, `runtime/webcore/Response.rs:71`, `runtime/cli/pm_pkg_command.rs:907`, `runtime/cli/update_interactive_command.rs:258`, `collections/multi_array_list.rs:913`, `ptr/CowSlice.rs:233` |

**Verdict**: every site is a documented ownership transfer or a Drop-suppression
paired with a manual move. No `mem::forget` is used to leak a refcount or to
hide a UAF. The `web_worker.rs:817` site is a **comment** explicitly
explaining why `mem::forget(api_lock_guard)` is **NOT** used (good
discipline).

---

## 5. `Vec::from_raw_parts` enumeration with pairing status

11 live sites:

| file:line | source allocator | pairing | notes |
|---|---|---|---|
| `src/uws_sys/us_socket_t.rs:540` (`to_stream_buffer`) | global mimalloc, decomposed in `update` | **partial / borrow-style** | see §6.1 below |
| `src/uws_sys/us_socket_t.rs:561` (`destroy`) | same | **paired** with the `update` decomposition | matches Zig spec; explicit `unsafe fn destroy` |
| `src/jsc/bindgen.rs:256/275/353` | global mimalloc; produced by codegen FFI helper | paired | each call site reconstructs from a previously decomposed Vec |
| `src/jsc/webcore_types.rs:684` | global mimalloc | paired | `init`/`init_owned` records ptr/len/cap; `len ≤ cap` enforced by recording invariant |
| `src/runtime/webcore/streams.rs:2590/2596` | global mimalloc | paired | snapshot Vec from byte slice for stream chunk |
| `src/runtime/webcore/s3/multipart.rs:243` | global mimalloc | paired | drop-on-err path |
| `src/runtime/webcore/encoding.rs:305` | global mimalloc | paired | typed-array reconstruct |
| `src/runtime/webcore/blob/Store.rs:593` | global mimalloc | paired | Blob store reconstruct |
| `src/sql_jsc/shared/SQLDataCell.rs:149` | global mimalloc, Zig `ArrayList.items.ptr` shape | paired | per Section S, layout matches |
| `src/runtime/api/filesystem_router.rs:790` | global mimalloc | paired | lifetime erasure (same allocation, no realloc) |

Plus four `Vec::from_raw_parts_in` sites in `collections/vec_ext.rs` that
preserve the allocator parameter — correct nightly idiom.

---

## 6. Top concerning unpaired or weakly-paired sites

### 6.1 — `us_socket_stream_buffer_t::to_stream_buffer` is `&self`-receiver but transfers ownership of the heap `Vec`

**File**: `src/uws_sys/us_socket_t.rs:534-547`

**Shape**:

```rust
pub fn to_stream_buffer(&self) -> StreamBuffer {
    StreamBuffer {
        list: if !self.list_ptr.is_null() {
            unsafe { Vec::from_raw_parts(self.list_ptr, self.list_len, self.list_cap) }
        } else { Vec::new() },
        cursor: self.cursor,
    }
}
```

**Risk**: signature is `&self` but body produces a `Vec` that owns the same
allocation as `self.list_ptr`. If `to_stream_buffer` is called twice without
an intervening `update(stream_buffer)` (which re-stamps `list_ptr/len/cap`),
the second call is a double-`from_raw_parts` ⇒ double-free as soon as either
returned `Vec` is dropped.

**Current safety mechanism**: caller convention. The C-exported
`us_socket_buffered_js_write` (`runtime/socket/uws_jsc.rs:138`) calls
`to_stream_buffer` exactly once per invocation and `update` exactly once on
the matching deferred-cleanup path, mirroring the Zig `defer
buffer.update(stream_buffer)` pattern.

**Recommendation**:
1. Change signature to `pub fn take_stream_buffer(&mut self) -> StreamBuffer`
   (only `&mut`-receiver) and **null `self.list_ptr` immediately** on the way
   out so a second call sees the no-op `Vec::new()` arm.
2. Document the borrow/update cycle as a typed RAII guard
   (`StreamBufferGuard<'a>` that auto-`update`s in Drop).

**Severity**: T2 (workmanship). Current single-call discipline is sound; the
shape is fragile against future refactors.

---

### 6.2 — `Rc::from_raw` + manual clone-and-`into_raw` instead of `Rc::increment_strong_count`

**File**: `src/runtime/dispatch.rs:1068-1076`

**Shape**:

```rust
let strong: BunTestPtr = unsafe {
    let rc = std::rc::Rc::from_raw(container as *const BunTestCell);
    let cloned = rc.clone();
    let _ = std::rc::Rc::into_raw(rc);   // restore borrowed ref
    cloned
};
```

**Risk**: the manual borrow-clone-restore pattern is strictly equivalent to
`Rc::increment_strong_count(p); Rc::from_raw(p)` (which is the std-canonical
form). The manual form is sound because `Rc::clone` is infallible and panic-
free — but it is **strictly more fragile**: any future code rearrangement that
inserts code between `from_raw` and `into_raw` (e.g. a debug log, a metric
bump, a `?`-style early return) that *does panic* would `Drop` the original
`rc`, decrementing the count below the borrowed level.

**Recommendation**: rewrite as `Rc::increment_strong_count(container); let
strong = Rc::from_raw(container);`. Functionally identical; eliminates the
panic-window risk by construction.

**Cross-ref**: `jsc/SavedSourceMap.rs:424-425` and `sourcemap/ParsedSourceMap.rs:231` already
use this canonical form; `runtime/shell/IOWriter.rs:1064` and
`runtime/shell/subproc.rs:2102` also use it. Only `dispatch.rs:1069` deviates.

**Severity**: T3 (style; would-be-a-bug if future refactor). Listed as a
worth-fixing-while-we're-here cleanup, not a current UB.

---

### 6.3 — `BSSList<T, COUNT>::Drop` recurses through boxed-prev chain — stack-depth-bounded only by call-site discipline

**File**: `src/bun_alloc/lib.rs:2435-2444`

**Shape**: `Drop` for `BSSList` does `drop(unsafe { Box::from_raw(head) })`
which recursively drops `prev: Option<Box<…>>`. Each overflow block holds
`BSS_LIST_CHUNK_SIZE` (typically 64–256) items. Recursion depth = total
overflows / chunk size.

**Risk**: stack overflow on Drop if the list has accumulated thousands of
overflow blocks. Not UB at the refcount level — the pairing is correct — but a
typed-recursion-on-Drop hazard adjacent to bucket 13.

**Mitigation**: convert the recursive Drop to an iterative `while let
Some(boxed) = head.take() { head = boxed.prev.take(); drop(boxed); }`. Same
allocator discipline; no stack growth.

**Severity**: T3 (defensive). No current evidence of exhaustion in practice.

---

## 7. Cross-references to existing EXP entries

- **EXP-027** (per `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md:774`) is the
  Windows `dir_iterator::IteratorResultWName` `RawSlice<u16>` lifetime
  experiment, **not** a refcount bucket experiment. The mission brief's
  reference to "EXP-027 (`AnyRefCounted` on NodeHTTPResponse — port-debt)" is
  a mis-attribution; the actual NodeHTTPResponse `AnyRefCounted` port-debt
  is captured in `phase1_notes/F_server_jsc_hooks.md` lines 119 and 179
  (open question 3) and now has the registry entry **EXP-056**. Fresh source
  check tightened the old wording: `rc_ref()` is `Cell<u32>`-only, but
  `rc_deref_with_context()` calls `deref(&self)`, and the zero-count path calls
  `deinit()` before freeing via `heap::take(self.as_ctx_ptr())`. Phase 5 now
  has that destructor-path witness: `EXP-056-shared-dealloc.log` confirms Tree
  Borrows rejects the `&self -> as_ctx_ptr() -> Box::from_raw` deallocation.

---

## 8. Pairing audit verdict (summary)

| dimension | result |
|---|---|
| `into_raw` ⟷ `from_raw` orphans | **0 across the workspace** |
| `Box::from_raw` post-Drop hazards | **0** (every site paired with an upstream `Box::into_raw` or `bun_core::heap::into_raw` in the same module / scopeguard) |
| `Arc::strong_count` not synced with `from_raw` | **0** (both `Arc::from_raw` sites use `Arc::increment_strong_count` first; both go through `ParsedSourceMap::ref_/deref` helpers; both are single-thread JSC table accesses guarded by mutex) |
| `RawWaker` vtable bugs | **N/A** (no RawWaker uses workspace-wide) |
| Cross-bucket SQLDataCell hazards | tracked under **§3** as a Bucket-20 (alloc-pairing) callout — current source sound; producer-side capacity-vs-len contract should be made type-enforced |
| Stale TODOs / weak invariants | 3 actionable cleanups (`SQLDataCell.rs:225/251`, `dispatch.rs:1069`, `us_socket_t.rs:534`); none current-source-UB |
| Section B claim ("zero orphans") | **verified workspace-wide** |

**Overall verdict for Bucket 13**: one confirmed T1 UB finding after Phase 5
closure: EXP-056 (`NodeHTTPResponse::deref(&self)` zero-ref dealloc through
shared provenance). The remaining T2/T3 remediation candidates documented above
are tracked for Phase 11.

---

## 9. Phase 11 / follow-on candidates

1. **EXP-056 remediation** — change `NodeHTTPResponse` zero-ref release to take
   an original/raw heap pointer, not `self.as_ctx_ptr()`. The canonical local
   model is `CellRefCounted::deref(this: *mut Self)`: project only the
   refcount field through raw pointer, then call `destroy(this)` on zero. The
   old cross-thread `Cell` race worry is not claimed; source search found no
   `RefPtr<NodeHTTPResponse>` use.
2. **Bucket-20 cross-fix for SQLDataCell** — convert the `(ptr, byte_len)`
   variants to an in-variant `Box<[u8]>` (eliminates the manual `from_raw`
   reconstruction). Cross-bucket-20 (alloc-pairing).
3. **Style/polish** — replace `dispatch.rs:1069`'s manual borrow-clone-restore
   with `Rc::increment_strong_count` + `Rc::from_raw` (canonical form).
4. **Workmanship** — change
   `us_socket_stream_buffer_t::to_stream_buffer(&self)` to
   `take_stream_buffer(&mut self)` and null `list_ptr` on the way out, OR
   wrap as a `StreamBufferGuard<'a>` RAII type.
5. **Defensive** — convert `BSSList` recursive Drop to an iterative loop.

---

## 10. Files / artifacts referenced

- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase1_notes/B_runtime_api.md` (section B claim and per-file totals)
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase1_notes/F_server_jsc_hooks.md` (NodeHTTPResponse port-debt)
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase1_notes/I_runtime_dns_jsc.md` (`*bun_core::heap::take(this)` move-out pattern)
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase1_notes/S_sql_redis.md` (SQLDataCell producer trace)
- `/data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/phase1_notes/T_ffi_c_libs.md` (libuv `Box::from_raw` ×3 audit)
- `/data/projects/bun/src/CLAUDE.md` (heap 3-fn API canonical doc)
- `/data/projects/bun/src/runtime/api/bun/subprocess.rs:127-129` (explicit anti-pattern doc)
- `/data/projects/bun/src/sourcemap/ParsedSourceMap.rs:209-243` (canonical `increment_strong_count`/`decrement_strong_count` discipline)
