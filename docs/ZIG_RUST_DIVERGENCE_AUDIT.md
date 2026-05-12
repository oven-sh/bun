# Zig→Rust Port Divergence Audit

## Summary

**26 divergences** found across three structural categories where Zig idioms do not map 1:1 to Rust.

| Risk   | Count | refcount-transfer-vs-plus1 | deinit-vs-drop | error-union-vs-result |
|--------|------:|---------------------------:|---------------:|----------------------:|
| HIGH   |     4 |                          2 |              1 |                     1 |
| MEDIUM |    11 |                          2 |              4 |                     5 |
| LOW    |    11 |                          3 |              5 |                     3 |
| **Total** | **26** |                      **7** |         **10** |                 **9** |

### Category notes

- **refcount-transfer-vs-plus1** — Zig `toJS()` *transfers* the caller's +1 to the JS wrapper; Rust `to_js()` *adds* a fresh +1 (FileSink.rs:977-984 documents this inversion). Any call site ported verbatim from Zig leaks one ref.
- **deinit-vs-drop** — Zig pools recycle with `value.* = undefined` (no destructor); Rust `HiveArray::put` runs `drop_in_place`. Types that had `deinit()` but no `impl Drop` leak; types with both risk double-free.
- **error-union-vs-result** — Zig functions with `!T` signatures whose bodies never error were ported with real `Err` arms. Every transliterated `catch unreachable → .expect("unreachable")` is now reachable.

### Top-5 by shipping risk

1. **`Bun.spawn({stdin:'pipe'})` leaks one FileSink per `proc.stdin` read** — fd exhaustion in long-running parents (subprocess/Writable.rs:403-468)
2. **`Bun.spawn({stdin: ReadableStream})` leaks FileSink at rc≥2** — compounds #1 by an extra +1 on the stream-stdin path (subprocess/Writable.rs:233/340)
3. **`Body::Value` has no `Drop` → every Request/Response GC leaks WTFString refs + Blob content-type buffers** — monotonic RSS growth under HTTP load (hive_array.rs:478 + Body.rs:1511)
4. **`convert_utf16_to_utf8_in_buffer` widened from infallible to fallible** — ~10 Windows path call sites now panic or silently swallow where Zig succeeded (bun_core/lib.rs:2317)
5. **`FileSink::to_js` protocol inversion** — root cause of #1/#2; every future `init→to_js` port site is a latent leak until adapted (FileSink.rs:1199-1216)

---

## HIGH risk (4)

### H1. `Bun.spawn` stdin-pipe getter leaks one FileSink per access

**Zig**: `src/runtime/api/bun/subprocess/Writable.zig:244-272` — `.pipe` arm of `toJS`: `this.* = .{ .ignore = {} }; … return pipe.toJS(globalThis)` / `pipe.toJSWithDestructor(...)`. Zig `pipe.toJS()` **transfers** the enum's +1 to the JS wrapper (`createObject` without ref).

**Rust**: `src/runtime/api/bun/subprocess/Writable.rs:403-468` — `to_js` `Pipe` arm: `subprocess.stdin.replace(Writable::Ignore)` then `pipe.to_js(global_this)` / `pipe.to_js_with_destructor(...)` returned **without** `pipe_release(pipe_nn)`. Rust `FileSink::to_js`/`to_js_with_destructor` (FileSink.rs:1199-1215) call `self.ref_()` first, **adding** a +1 for the wrapper. The local `pipe_nn: NonNull<FileSink>` (holding the enum's original +1, no Drop) is dropped without `FileSink::deref`. Net: ref_count stays at 2 forever; after JS wrapper GC's `finalize` derefs once → rc=1, never reaches 0. Same in both the has-exited branch (line 441) and the destructor branch (line 461). `weak_file_sink_stdin_ptr` is weak (no owned ref) so doesn't compensate.

**Symptom**: Every `Bun.spawn({stdin:'pipe'})` whose `proc.stdin` getter is read leaks one native FileSink (heap allocation + writer buffers + possibly the underlying fd via `writer.owns_fd` not closing). Observable as `$__INTERNAL_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__fileSinkLiveCount()` growing unbounded across spawn loops, and as fd exhaustion in long-running parent processes that spawn many children with stdin pipes.

**Test coverage**: ❌ none — no test asserts FileSink live-count returns to baseline after a spawn-with-stdin-pipe loop.

**Recommended fix**: After `pipe.to_js(...)` / `pipe.to_js_with_destructor(...)` returns the JSValue, call `FileSink::deref(pipe_nn)` before returning (mirror the Blob.rs:1899-1902 pattern). Apply at both line 441 and line 461. Add a regression test that spawns N children with `stdin:"pipe"`, reads `proc.stdin`, awaits exit, GC's, and asserts `fileSinkLiveCount()` is unchanged.

---

### H2. `Bun.spawn({stdin: ReadableStream})` leaks FileSink at rc≥2

**Zig**: `src/runtime/api/bun/subprocess/Writable.zig:115/193` — `pipe.assignToStream(&stdio.readable_stream, ...)`. Zig version takes no extra ref; `create`'s +1 stays with the enum.

**Rust**: `src/runtime/api/bun/subprocess/Writable.rs:233/340` — `pipe.assign_to_stream(rs, global)`. Rust version takes a +1 inside (FileSink.rs:1543); combined with H1, the ReadableStream-stdin path ends at rc≥2 after wrapper GC vs Zig's rc=0. Flow: `FileSink::create*` (rc=1) → `assign_to_stream` adds +1 (rc=2) → stored in `Writable::Pipe(pipe_nn)`. If `proc.stdin` is later read, `to_js` adds another +1 (rc=3) and the local is dropped → controller-finalize + sink-finalize bring it to rc=1, never freed.

**Symptom**: Passing a `ReadableStream` as `stdin` to `Bun.spawn` leaks the FileSink (and its IOWriter buffers / fd) for the life of the process, even after the stream completes and the Subprocess is GC'd.

**Test coverage**: ❌ none.

**Recommended fix**: After `pipe.assign_to_stream(rs, global)` at Writable.rs:233 and :340, call `FileSink::deref(pipe)` to release the +1 that `assign_to_stream` added on behalf of the controller (the controller's `finalize` will release it again — no, the controller holds its own +1; the *enum* still holds create's +1). Correct fix: leave `assign_to_stream`'s +1 owned by the controller, and ensure the enum's +1 is released when `Writable::Pipe` is consumed (i.e. in `to_js` per H1, **and** in `Writable`'s deinit/close path if `stdin` is never read). Audit `Writable::close`/`deinit` for the same missing deref.

---

### H3. `Body::Value` recycled without Drop → WTFString / Blob content-type leak per Request/Response GC

**Zig**: `src/bun.zig:1886-1889` (`HiveRef.unref`: `if (@hasDecl(T,"deinit")) this.value.deinit(); this.allocator.put(this)`) + `src/runtime/webcore/Body.zig:966` (`Body.Value.deinit` derefs `WTFStringImpl`, deinits `Blob`, deinits `Locked.readable`).

**Rust**: `src/collections/hive_array.rs:478-490` (`HiveRef::unref` → `(*pool).put(self)` only; comment claims "Zig's `@hasDecl` deinit maps to `T::Drop`") + `src/runtime/webcore/Body.rs:1511` (`Value` has `pub fn reset(&mut self)` but **no** `impl Drop`). Variant payloads `WTFStringImpl` (`Copy` raw ptr, no Drop) leak +1 WTF refcount; `Blob.content_type: Cell<*const [u8]>` (raw ptr, no Drop) leaks heap when `content_type_allocated==true`. Only `store: StoreRef`, `name: OwnedStringCell`, and `Locked.readable.held: strong::Optional` have implicit drop glue.

**Symptom**: Memory leak per Request/Response GC: WTFString refcounts never reach zero (string bodies pin WTF heap), and Blob content-type buffers leak. Observable as monotonic RSS growth under HTTP load with string/typed bodies; would fail leak-detector tests.

**Test coverage**: ✅ partial — `test/js/bun/http/serve-leak.test.ts` exercises Request/Response churn but does not assert WTFString live-count.

**Recommended fix**: Either (a) `impl Drop for Body::Value { fn drop(&mut self) { self.reset() } }`, ensuring `reset()` is idempotent (it must leave fields in a validly-droppable empty state since `HiveArray::put` will `drop_in_place` again — see M4); or (b) restore explicit `value.reset()` before `pool.put()` in `HiveRef::unref`. Prefer (a) so the invariant "Drop = deinit" holds for all hive-pooled types.

---

### H4. `convert_utf16_to_utf8_in_buffer` widened from ∅ error set to {buffer-too-small}

**Zig**: `src/bun_core/string/immutable/unicode.zig:1564-1578` — `pub fn convertUTF16toUTF8InBuffer(buf, input) ![]const u8` has `!T` signature but body **never** returns an error (just calls simdutf and slices `buf[0..result]`). Effective error set = ∅.

**Rust**: `src/bun_core/lib.rs:2317-2345` — `pub fn convert_utf16_to_utf8_in_buffer(...) -> Result<&mut [u8], EncodeIntoResult>` **does** return `Err` when simdutf reports a surrogate **and** the Vec-fallback exceeds `out.len()`.

**Symptom**: Every transliterated `catch unreachable → .expect("unreachable")` is now a **reachable** panic; every `catch {…} → Err(_) => …` now executes a recovery path Zig never took. Cascades to ~10 Windows wide-path call sites (see M7–M11). Panics or silently-swallowed conversions where Zig would have written past the buffer (UB) or simply succeeded for the common simdutf-handles-it case.

**Test coverage**: ❌ none — no test passes a u16 path whose UTF-8 expansion exceeds the destination buffer.

**Recommended fix**: Either (a) restore Zig's contract — make the function infallible by allocating into the provided slice and `debug_assert!`ing capacity (matching Zig's implicit precondition), removing `Result` from the signature; or (b) keep the new `Err` and audit every caller (M7–M11) to handle it correctly instead of `.expect("unreachable")` / `.unwrap_or(0)`. Prefer (a) for parity; (b) is the safer-than-Zig option but requires ~10 call-site changes.

---

## MEDIUM risk (11)

### M1. `FileSink::to_js` protocol inversion — every unaudited caller is a latent leak

**Zig**: `src/runtime/webcore/FileSink.zig:641-647` — `toJS`/`toJSWithDestructor` call `JSSink.createObject` directly; caller's +1 transferred.

**Rust**: `src/runtime/webcore/FileSink.rs:1199-1216` — `to_js`/`to_js_with_destructor` call `self.ref_()` **before** `JSSink::create_object`; wrapper gets a fresh +1, caller keeps its +1. Intentional protocol inversion (documented at FileSink.rs:977-984): Rust makes the per-wrapper +1 explicit, requiring every caller that allocates via `init`/`create*` then calls `to_js*` to also `FileSink::deref()` afterward. Blob.rs:1899/1956 were already fixed; subprocess Writable.rs (H1/H2) was not.

**Symptom**: Silent FileSink leak at any future call site that ports Zig's `init→toJS` pattern verbatim. Not user-visible by itself, but every unaudited caller is a latent leak.

**Test coverage**: ✅ `test/js/bun/io/filesink-leak.test.ts` covers the Blob path.

**Recommended fix**: Add `#[must_use = "caller still owns +1; call FileSink::deref after to_js"]` doc on `to_js*`, or invert back to transfer semantics and remove `self.ref_()` (then drop the compensating `deref` at Blob.rs:1902/1960). Grep for all `to_js`/`to_js_with_destructor` callers and confirm each has a paired `deref`.

---

### M2. `FileSink::assign_to_stream` leaks +1 on error early-return

**Zig**: `src/runtime/webcore/FileSink.zig:798-814` — `assignToStream`: only a transient `this.ref(); defer this.deref();` guard around the extern call; no extra ref before `JSSink.assignToStream`.

**Rust**: `src/runtime/webcore/FileSink.rs:1543-1549` — `assign_to_stream`: `self.ref_()` taken for the controller wrapper **before** `JSSink::assign_to_stream`; on the `to_error()` early-return at lines 1547-1549 that +1 is **not** released. If `${abi}__assignToStream` returns an Error without having created a controller (so no future `finalize` will fire), the speculative +1 leaks. Non-error paths are balanced (controller's `finalize` derefs).

**Symptom**: FileSink leak when piping a ReadableStream into a FileSink and the C++ `assignToStream` path errors before constructing the controller (e.g. JS exception in pipeTo setup). Rare path; manifests as native FileSink live-count growing under stream-error stress.

**Test coverage**: ❌ none.

**Recommended fix**: On the error branch at FileSink.rs:1547-1549, call `self.deref()` before returning `to_error()`. Alternatively, move the `self.ref_()` to *after* the extern call succeeds (match Zig's transient-guard structure).

---

### M3. `NumberRenamer` intermediate scopes leak global-heap `name_counts` per print job

**Zig**: `src/js_printer/renamer.zig:592-623` — `assignNamesRecursiveWithNumberScope`: loop creates child scopes; `defer if (s != initial_scope) { s.deinit(temp_allocator); pool.put(s) }` only cleans the **final** `s`; intermediate scopes' `name_counts` are arena-backed via `temp_allocator`, bulk-freed in `NumberRenamer.deinit:465 → arena.deinit()`.

**Rust**: `src/js_printer/renamer.rs:740-790` — same control flow: only final `s` is `put`; intermediate scopes never returned. `renamer.rs:847`: `name_counts: StringHashMap<u32>` is **global-heap**, not arena. No `impl Drop for HiveArrayFallback`. Zig's intermediate leaks were harmless because of the arena; Rust dropped the arena param, so intermediate scopes stay marked "used" in the hive and their `name_counts` HashMaps leak when `NumberRenamer` drops.

**Symptom**: Bundler/minifier memory leak proportional to nested-scope chain depth × scope count, per print job. Long-running dev-server / watch-mode rebuilds would grow unbounded.

**Test coverage**: ❌ none.

**Recommended fix**: Either (a) restore arena allocation for `name_counts` (use `bumpalo::collections::HashMap` or equivalent backed by the renamer's arena); or (b) track all allocated `NumberScope`s in a `Vec` and `put` each on `NumberRenamer::Drop`; or (c) `impl Drop for HiveArrayFallback` to walk used slots and drop them.

---

### M4. `HiveArray::put` now runs `drop_in_place` — root semantic divergence

**Zig**: `src/collections/hive_array.zig:65-76` — `put`: `value.* = undefined; poison; unset` — **no** destructor.

**Rust**: `src/collections/hive_array.rs:158-179` — `put`: `drop_in_place(value); poison; unset`. PORT NOTE acknowledges this as intentional. But every Zig caller that did `value.deinit(); pool.put(value)` is now `deinit() + drop_in_place()` — safe only if the manual deinit leaves the struct in a validly-droppable state (idempotent). Conversely, callers that relied on `T` having no Drop (e.g. `Body::Value`, H3) now silently leak.

**Symptom**: Either double-free (if a caller's manual pre-deinit leaves a field in a state Drop frees again — none confirmed) or leak (if `T` has no Drop but Zig had `deinit` — confirmed for `Body::Value`). Per-site audit required.

**Test coverage**: ❌ none specifically; covered indirectly by hot paths.

**Recommended fix**: Document the invariant in `HiveArray::put` doc-comment: "T::Drop must be idempotent after manual deinit, OR callers must not manually deinit before put". Add a `debug_assertions`-only sentinel that detects double-drop for hive-pooled types. Audit all `put()` callers (≈14) against this invariant.

---

### M5. `NetworkTask` self-referential field drop order is correct but unenforced

**Zig**: `src/install/PackageManager/runTasks.zig:599,650` — `defer manager.preallocated_network_tasks.put(task.request.*.network)` — Zig `put` is no-op-drop; `url_buf`/`response_buffer`/`request_buffer` leak per cycle.

**Rust**: `src/install/PackageManager/runTasks.rs:962-974,1045-1056` — manually `assume_init_drop()` on `unsafe_http_client` then `put(net_ptr)` which `drop_in_place`'s `url_buf: Box<[u8]>`, `request_buffer`/`response_buffer: MutableString`, `response: HTTPClientResult`, `apply_patch_task`, `tarball_stream`. Mostly a fix — but `unsafe_http_client: MaybeUninit<AsyncHTTP>` borrows `url_buf` (self-referential, NetworkTask.rs:46) and is dropped **before** `put` drops `url_buf`, so order is correct. `response: HTTPClientResult<'static>` (NetworkTask.rs:64) also lifetime-erases borrows of `url_buf`; field-declaration order has `response` before `url_buf` so `response` drops first — OK. Any future field reorder or added borrow would UAF.

**Symptom**: Currently a leak fix vs Zig. Risk is latent UAF if field declaration order changes or a new self-referential borrow is added after `url_buf`. No crash today.

**Test coverage**: ❌ none for drop-order invariant.

**Recommended fix**: Add a `// SAFETY: field declaration order is load-bearing — `response` and `unsafe_http_client` borrow `url_buf` and MUST be declared before it` comment at NetworkTask.rs:46-64, and a `static_assertions`-style compile check (e.g. `const _: () = assert!(offset_of!(..., response) < offset_of!(..., url_buf))`) if available.

---

### M6. `RequestContext` recycle: explicit deinit + `drop_in_place` on ~30 fields

**Zig**: `src/runtime/server/RequestContext.zig:306` — `server.request_pool_allocator.put(this)` — Zig `put` is no-op-drop; `deinit()` already cleared owned fields.

**Rust**: `src/runtime/server/mod.rs:3040-3060` — `release_request_context → (*self.request_pool).put(ctx)` runs `drop_in_place` on the entire `RequestContext`. Same explicit clears in RequestContext.rs:870-898, then `put` drops **every** field including those not explicitly cleared in `deinit()` — e.g. `request_body_readable_stream_ref`, `signal`, `byte_stream`. Any field with non-idempotent manual-deinit + Drop would double-free. None found, but RequestContext has ~30 fields and only a subset are explicitly reset.

**Symptom**: Potential double-free/UAF if any RequestContext field has both an explicit `.deinit()` call in `finalize_without_deinit`/`deinit` **and** a non-idempotent Drop. Currently the Strong-based fields are idempotent (`Optional::Drop` uses `take()`). New fields added without this discipline would crash on every request completion.

**Test coverage**: ✅ `test/js/bun/http/serve.test.ts` exercises request lifecycle heavily; would catch a regression.

**Recommended fix**: Replace explicit per-field `.deinit()` calls in RequestContext.rs:870-898 with field-reassignment to default (`self.x = Default::default()`), letting Drop handle the old value exactly once. Then `put`'s `drop_in_place` drops only defaults. Add a comment at the struct definition: "all fields must have idempotent Drop; recycled via HiveArray::put".

---

### M7. `path.resolve` Windows env-var transcoding swallows new error to `0`

**Zig**: `src/runtime/node/path.zig:2496` — `bufSize = std.unicode.wtf16LeToWtf8(buf2, r);` — different stdlib fn, **infallible** (returns bare `usize`).

**Rust**: `src/runtime/node/path.rs:3185-3187` — `buf_size = strings::convert_utf16_to_utf8_in_buffer(dst, &r).map(|s| s.len()).unwrap_or(0);`. Port swapped infallible `wtf16LeToWtf8` for fallible `convert_utf16_to_utf8_in_buffer` then swallowed the new error to `0`.

**Symptom**: On Windows, `path.resolve()` reading the per-drive `=C:` env var would compute against an empty string → falls back to drive root instead of the env-stored cwd, when the env value contains unpaired surrogates or is very long.

**Test coverage**: ✅ `test/js/node/path/resolve.test.js` (but no surrogate/long-path case).

**Recommended fix**: Port `wtf16LeToWtf8` (WTF-8, infallible by design — surrogates encode as 3 bytes) instead of using the strict-UTF-8 helper. This is the correct semantic for Windows paths anyway.

---

### M8. `bun_paths::PooledBuf::append` panics on long/surrogate Windows paths

**Zig**: `src/paths/Path.zig:133` — `convertUTF16toUTF8InBuffer(this.pooled[this.len..], characters) catch unreachable` — body is infallible so `catch unreachable` is dead.

**Rust**: `src/paths/Path.rs:336-338` — `strings::convert_utf16_to_utf8_in_buffer(dest, src).expect("unreachable").len()`. `.expect("unreachable")` is now **reachable** (see H4).

**Symptom**: Hard panic in `bun_paths::PooledBuf::append` when constructing a Path from a long/surrogate-heavy Windows wide path (e.g. install/hardlinker, run_command temp-dir).

**Test coverage**: ❌ none.

**Recommended fix**: Depends on H4 resolution. If H4(a), this becomes infallible again. If H4(b), grow the pooled buffer on `Err` and retry, or propagate `Err` up to the caller.

---

### M9. `Path<u16>::relative` — new code path with two reachable `.expect("unreachable")`

**Zig**: `src/paths/Path.zig` — `relative()` calls `relativeBufZ` which is u8-only; a u16 instantiation would `@compileError` (Zig lazy eval hides it; per PORT NOTE no u16 caller exists in Zig).

**Rust**: `src/paths/Path.rs:1260-1262` — new u16 branch transcodes via `convert_utf16_to_utf8_in_buffer(...).expect("unreachable")` twice. Runtime u16 code path with no Zig spec to compare against.

**Symptom**: Panic computing `Path<u16>::relative()` between long Windows wide paths whose UTF-8 expansion overflows the pooled scratch buffer.

**Test coverage**: ❌ none.

**Recommended fix**: Same as M8. Additionally, since this path has no Zig reference, add an explicit unit test for `Path<u16>::relative` with multi-BMP-plane inputs.

---

### M10. `Bun.which()` panics on Windows for found paths whose UTF-8 form > MAX_PATH_BYTES

**Zig**: `src/which/which.zig:26` — `convertUTF16toUTF8InBuffer(buf, result) catch unreachable` (infallible body).

**Rust**: `src/which/lib.rs:56-57` — `convert_utf16_to_utf8_in_buffer(&mut buf[..], result).expect("unreachable")`.

**Symptom**: `Bun.which()` / shell `which` panics on Windows for a found executable whose UTF-8 path > `MAX_PATH_BYTES` (Zig would have buffer-overrun / truncated).

**Test coverage**: ✅ `test/js/bun/util/which.test.ts` (but no long-path case).

**Recommended fix**: Allocate the output buffer at `result.len() * 3` (worst-case UTF-8 expansion) instead of `MAX_PATH_BYTES`, or apply H4(a).

---

### M11. `bun --bun run` on Windows fails with new `InvalidUtf16` for long `%TEMP%`

**Zig**: `src/runtime/cli/run_command.zig:629` — `try bun.strings.convertUTF16toUTF8InBuffer(...)` — `try` on a fn whose body never errors; effectively infallible.

**Rust**: `src/runtime/cli/run_command.rs:1733-1737` — `.map_err(|_| bun_core::err!("InvalidUtf16"))?`. Propagates a brand-new `InvalidUtf16` error that Zig could never produce.

**Symptom**: On Windows with very long `%TEMP%`, `bun --bun run` fails with `error: InvalidUtf16` instead of succeeding (or UB).

**Test coverage**: ❌ none.

**Recommended fix**: Apply H4(a), or size the buffer at `wide.len() * 3` so the error case is genuinely unreachable, then `.expect()`.

---

## LOW risk (11)

| # | Category | Zig site | Rust site | Divergence | Symptom | Test |
|---|---|---|---|---|---|---|
| L1 | refcount-transfer | `Blob.zig:2951/2989` `return sink.toJS(globalThis)` | `Blob.rs:1899-1902/1956-1960` `let js = sink.to_js(..); FileSink::deref(sink); Ok(js)` | Correctly adapted to new protocol — reference "fixed" site for pattern-matching against H1/H2 | None — already fixed under #53265 | ✅ |
| L2 | refcount-transfer | `streams.zig:1535` `NetworkSink::toJS` (not refcounted; `finalizeAndDestroy` frees) | `streams.rs:2376-2378` + `:2406→:2203` `finalize` only `detach_writable`, never frees | Parity (both leak on GC-only finalize) but `client.rs:551` comment "ownership transfers to JS wrapper" is misleading — neither side frees on finalize | If only GC `finalize` fires (not `finalize_and_destroy`), `Box<NetworkSink>` leaks in **both** Zig and Rust. Not a port divergence; pre-existing | ❌ |
| L3 | refcount-transfer | `Sink.zig:296-311` `construct`: `bun.new` → `createObject` (transfer) | `Sink.rs:866-872` `js_construct`: `heap::into_raw` → `create_object_extern` (transfer, no `ref_()`) | Correct, but means **two protocols** in Rust: `construct` transfers, `to_js` adds. Any refactor routing `construct` through `to_js` would leak | No runtime symptom; latent inconsistency | ❌ |
| L4 | deinit-vs-drop | `ErrorReportRequest.zig:345-353` stack `Log` + `defer log.deinit()` | `ErrorReportRequest.rs:502-523` `arena.alloc(Log::init())`; comment "log dropped at scope exit" is **wrong** — `mi_heap_destroy` doesn't run destructors | `Log{msgs:Vec, owned_strings:Vec<Box<[u8]>>}` global-heap Vecs leak | Small leak per dev-server error-report request, only if TOML lexer emits diagnostics (shouldn't for synthetic empty source) | ❌ |
| L5 | deinit-vs-drop | `RuntimeTranspilerStore.zig:275-278` `promise.deinit(); deinit(); store.put(this)` (Zig put no-op) | `RuntimeTranspilerStore.rs:511-538/593-599` `reset_for_pool` clears all → `put` drops again; `promise.deinit()` called at :593 **and** inside `reset_for_pool:534` | Redundant double-clear (idempotent today). Would become double-deref if `bun_core::String` ever gains `Drop` | Currently benign; fragile | ❌ |
| L6 | deinit-vs-drop | `pool.zig:248-257` `destroyNode`: skips deinit for `ByteList` (acknowledged leak) | `pool.rs:514-529` unconditionally `assume_init_drop()` incl. `Vec<u8>` | Rust frees overflow Vec capacity; Zig leaked it. Behavior change in the **fix** direction | Lower memory usage in Rust. Intentional improvement | ❌ |
| L7 | deinit-vs-drop | `bake.zig` `errdefer for (file_system_router_types[0..i]) |*fsr| fsr.style.deinit()` | `bake_body.rs:960-961` `// TODO(port): errdefer ... — Style should impl Drop` | `Style` has no `impl Drop`; on `?` early-return, style resources leak | Leak of FrameworkRouter `Style` resources when `Bun.serve({app:{fileSystemRouterTypes:[...]}})` validation fails partway. Tracked TODO | ❌ |
| L8 | deinit-vs-drop | `HTTPContext.zig:469-483` explicit `ssl_config.deinit(); proxy_tunnel.deref(); free(target_hostname); h2_session.deref()` then `put` (no-op) | `HTTPContext.rs:248-262` `release_parked_refs` (`take()`+`deref()`) then `:1232 put` drops empty fields | `IntrusiveRc` has no `impl Drop`, so `rp.deref()` then drop-of-`rp` is single decrement — correct. If `IntrusiveRc` ever gains Drop, becomes double-decrement. Same hazard for `h2_session: Option<NonNull>` | Correct today; latent double-deref if `IntrusiveRc` gains Drop. Pattern at :254-261 and :808-813 | ❌ |
| L9 | error-union-vs-result | `spawn.zig:221,236,247,263` per-site `NAMETOOLONG => unreachable` / `BADF => unreachable` | `posix_spawn.rs:303-312` single `spawn_errno()` maps `NAMETOOLONG => Err("NameTooLong")`, `BADF => Err("InvalidFileDescriptor")`; only `INVAL` stays `unreachable!()` | Widened error set: errnos Zig declared impossible now propagate as `Err`. Documented in Rust comment | Buggy libc returning `NAMETOOLONG` from `posix_spawn_file_actions_addclose`: Zig crashes; Rust surfaces spawn error to JS | ✅ |
| L10 | error-union-vs-result | `bun.zig:627-629` `assert((fcntl(...) catch unreachable) & O.NONBLOCK != 0)` — fcntl **always** executed | `bun.rs:505-509` `debug_assert!((fcntl(...).expect("unreachable") & O::NONBLOCK) != 0)` — compiled out in release | Zig `assert` evaluates argument unconditionally; Rust `debug_assert!` strips it. fcntl syscall + check skipped in release | None user-observable (self-check). Divergence in syscall count under strace | ❌ |
| L11 | error-union-vs-result | `exit.zig:18-21` `parseInt(u8) catch \|err\| switch { .Overflow => @intCast((parseInt(usize) catch fail) % 256), .InvalidCharacter => fail }` | `exit.rs:58-60` `parse_decimal::<u64>(s).map(\|n\| (n % 256) as ExitCode)` → `None` on any failure | Zig distinguishes Overflow (retry wider) from InvalidCharacter (fail). Rust collapsed both into `Option<u64>`; two-stage retry gone. For inputs in `(u8::MAX, usize::MAX]` both produce `n % 256` — semantics match by accident on 64-bit | None on 64-bit. Loses explicit error-variant routing — future `parse_decimal` changes would silently diverge | ✅ |
