# Perf-bugs: logic errors causing slowness

7 confirmed logic bugs found during perf hunt (round 6, user-facing APIs).

## `src/runtime/webcore/blob/read_file.rs:738`

**Empty-regular-file fast path on POSIX uses stale `file_store.mode` and never fires for fresh Bun.file()**

After `resolve_size_and_last_modified` has fstat'd the fd and set `self.could_block = !is_regular_file(stat.st_mode)`, the empty-file short-circuit tests `bun_sys::is_regular_file(self.file_store.mode)`. `self.file_store` is a clone taken in `create_with_ctx` from the Blob's store *before* any stat, and `File::init` defaults `mode = 0`. `is_regular_file(0)` → `kind_from_mode(0) == Unknown` → false, so for `Bun.file(path).text()` on a 0-byte file the fast path is never taken: we fall through, allocate a 16-byte buffer, zero the 64 KB stack buffer, and issue a read() that returns 0. The Windows equivalent (line 1262) correctly uses `this.is_regular_file` which was set from the fresh fstat at line 1240.

**User-visible:** `await Bun.file(emptyFile).text()` / `.bytes()` on Linux/macOS does an unnecessary 16-byte heap allocation, a 64 KB memset, and one extra read() syscall per call. In build-tool / glob workloads that touch many empty placeholder files, each such read pays full overhead instead of returning immediately after fstat.

**Fix:** Replace the condition with `if self.size == 0 && !self.could_block` (which is exactly `is_regular_file(fresh_stat.st_mode)`), mirroring the Windows branch. This restores the intended short-circuit: skip buffer alloc and read() for 0-byte regular files.

---

## `src/runtime/webcore/Blob.rs:5107`

**Fast-path guard for stat'd Blob destinations is inverted (checks ==RegularFile instead of !=)**

`fast_path_ok` intends (per the original Zig comment: 'Is this a file that is known to be a pipe? Let's avoid blocking the main thread on it.') to SKIP the main-thread sync fast path when the destination is a known pipe/TTY. The code instead skips it when the destination is a known REGULAR FILE: `f.mode != 0 && bun_core::kind_from_mode(f.mode) == bun_core::FileKind::File`. The condition is inverted. Result: a Blob whose mode has been populated (Bun.stdout/Bun.stderr, or any Bun.file() after `.size`/`.stat()`) and is a regular file is forced onto the async threadpool even for <256 KiB writes, while a Blob known to be a pipe/TTY takes the synchronous path the comment was trying to avoid. Bug originates in Zig PR #7470 and was ported faithfully.

**User-visible:** `Bun.write(Bun.stdout, shortBuf)` when stdout is redirected to a file (e.g. `bun run script.js > out`) pays threadpool-dispatch + promise-microtask latency (≈10–20 µs) instead of a ~1 µs synchronous write; any `const f=Bun.file(p); await f.size; await Bun.write(f, small)` pattern likewise loses the fast path.

**Fix:** Flip the comparison to `!= bun_core::FileKind::File` (equivalently `!bun_sys::is_regular_file(f.mode)`), so the sync fast path is skipped only when the destination is known NOT to be a regular file.

---

## `src/runtime/webcore/blob/write_file.rs:361`

**EAGAIN retry in WriteFile::do_write never re-issues the write() — infinite busy-loop**

`do_write` computes `let result = sys::write(fd, ...)` at line 347 *outside* the `loop { match &result { ... } }` at line 350. On `Err` with errno == RETRY (EAGAIN) and `!self.could_block`, it executes `continue` (line 361), which re-matches the SAME stale `result` forever — the syscall is never retried. `could_block` is computed from `file.pathlike.is_fd()` (write_file.rs:462) so any path-opened destination has `could_block=false`; if that path resolves to a FIFO/pipe/char-device opened O_NONBLOCK and the kernel returns EAGAIN, the threadpool worker spins at 100% CPU. The identical bug exists in the pre-port Zig (`const result = bun.sys.write(...)` outside `while (true)`), so it is latent but real.

**User-visible:** `Bun.write(Bun.file('/tmp/my_fifo'), bigBuf)` (or any path that resolves to a non-regular file) hangs a threadpool worker at 100% CPU once the pipe buffer fills, instead of waiting for writability; user sees the promise never resolve and one core pegged.

**Fix:** Move the `sys::write(fd, ...)` call inside the loop (making `result` mutable), or replace `continue` with `result = sys::write(fd, &self.bytes_blob.shared_view()[off..off+len]); continue;` so EAGAIN actually retries the syscall.

---

## `src/runtime/webcore/Body.rs:1796`

**response.text() skips the to_blob_if_possible() fast path that json()/arrayBuffer()/bytes() take for already-buffered streams**

In BodyMixin::get_text, the `Value::Locked` + readable-stream branch goes straight to `locked.set_promise(.., Action::GetText, Some(readable))`, which dispatches into C++ `readableStreamToText` (JS property `get`, `JSC::call`, promise-then plumbing in BunStreamConsumers.cpp:875-911). Every sibling — get_json (line 1896), get_array_buffer (line 1946), get_bytes (line 2001), get_blob (line 2154) — first calls `value.to_blob_if_possible()`, which for a Locked body with a native ByteStream/ByteBlobLoader that already holds the full payload (ReadableStream.rs:194-203) converts to `Value::InternalBlob` and falls through to the synchronous `use_as_any_blob_* → to_*` path. `get_text` is the only consumer missing this call, so `.text()` on a Response/Request whose body is a completed native stream (e.g. `new Response(stream)` constructed from a Blob- or Bytes-backed ReadableStream, or after `.body` was touched) always takes the slow C++ stream-consumer path while `.json()` on the same object resolves synchronously in Rust.

**User-visible:** `.text()` on a Response/Request backed by a native ReadableStream whose data is already buffered (e.g. `new Response(blobStream).text()` or `.text()` after touching `.body`) takes the C++ readableStreamToText path (handle->get + JSC::call + promise chaining) instead of the zero-JS-call native path. A microbenchmark of `new Response(someCompletedByteStream)` would show `.text()` measurably slower than `.json()`/`.arrayBuffer()` for the same payload, even though `.text()` should be the cheapest of the three.

**Fix:** Add `value.to_blob_if_possible();` before the `if let Value::Locked(locked) = value` check in `get_text` (both the with-readable and no-readable Locked arms), mirroring get_json/get_array_buffer/get_bytes. Then the already-buffered case falls through to `use_as_any_blob_allow_non_utf8_string() → AnyBlob::to_string(Transfer)`.

---

## `src/jsc/bindings/sqlite/JSSQLStatement.cpp:2229`

**Per-write version bump defeats the cached row Structure for every statement on the DB**

After every sqlite3_step(), Bun does `if (!sqlite3_stmt_readonly(stmt)) castedThis->version_db->version++;` and then checks `need_update()` (== `version_db->version != this->version`). Any INSERT/UPDATE/DELETE therefore increments the shared DB version, which makes `need_update()` return true for *every* prepared statement on that DB on its next execution, forcing `initializeColumnNames()` to run again. That function heap-allocates a fresh `PropertyNameArrayBuilder`, clears `_structure`, calls `sqlite3_column_name` / `String::fromUTF8ReplacingInvalidSequences` / `Identifier::fromString` per column, and rebuilds the JSC Structure via `addPropertyTransition`. The intent (commit bcc4580 "invalidate column name caches when the schema of table may change") was to catch ALTER TABLE, but plain DML does not change column names — so the expensive fast-path cache (`_structure` used by `putDirectOffset` in `constructResultObject`) is thrown away on every write. Worse, because the increment happens *before* the `need_update()` check, the write statement itself rebuilds its own (usually empty) column set on every `.run()`.

**User-visible:** In the canonical ORM pattern `for each row { insert.run(row); }` followed by or interleaved with `select.all()`, every `select.all()` pays the full cost of re-deriving column Identifiers and re-creating the JSC Structure (one heap alloc + N UTF-8 decodes + N Structure transitions) instead of reusing the cache, and every `insert.run()` pays an extra heap alloc for a throwaway PropertyNameArrayBuilder. This adds measurable overhead proportional to column count on every query in any workload that mixes reads and writes on the same Database.

**Fix:** Only bump `version_db->version` for schema-changing statements. A cheap accurate check is available via SQLite: cache `sqlite3_column_count(stmt)` on the statement and compare after step (SQLite auto-reprepares on SQLITE_SCHEMA so the count/name changes become visible), or gate the bump on `sqlite3_stmt_readonly(stmt)==0 && sqlite3_stmt_isexplain(stmt)==0 && sqlite3_column_count(stmt)==0 && <statement touches sqlite_schema>`. Simplest correct fix: drop the unconditional `version++` on every write; instead, in `initializeColumnNames`, skip the rebuild when `sqlite3_column_count` and the first column name still match the cache. At minimum, move `update_version()` before the increment so a write statement doesn't invalidate *itself* every call.

---

## `src/js/bun/sqlite.ts:296`

**Statement#run() with no args allocates the {changes, lastInsertRowid} object twice**

For statements with `paramsCount > 0`, `this.run` is wired to `#run`. When the user calls `.run()` with no arguments (re-executing with previously bound params), `#run` calls `this.#runNoArgs()` — which already builds and returns a `{changes, lastInsertRowid}` object — then discards that return value and calls `createChangesObject()` a second time. Two objects are allocated where one suffices.

**User-visible:** One extra `{changes, lastInsertRowid}` allocation (and two extra internal-field reads) per `.run()` call on parameterized statements invoked without arguments.

**Fix:** Change the zero-arg branch of `#run` to `return this.#runNoArgs();`.

---

## `src/js/internal/streams/writable.ts:618`

**onwrite `needTick` tests kObjectMode bit instead of kDestroyed (operator-precedence bug preserved with Number())**

The expression `state[kState] & Number(kDestroyed !== 0)` evaluates to `state[kState] & 1`, which is the kObjectMode bit (1<<0), not kDestroyed (1<<4). The original Node.js line `(state[kState] & kDestroyed !== 0)` has the same precedence bug; Bun wrapped it in `Number()` (likely to silence a lint/TS warning) instead of fixing the parenthesization. Result: for objectMode Writables with a synchronous `_write` and no user callback (e.g. every objectMode Transform/PassThrough), `needTick` is always truthy, so the fast-path `state.pendingcb--` is never taken on the first write of each tick and a `process.nextTick(afterWrite, ...)` is scheduled instead. Conversely, for destroyed non-objectMode streams the needed afterWrite tick is skipped.

**User-visible:** objectMode Transform/PassThrough streams (and any objectMode Writable with a sync _write) pay one extra process.nextTick + afterWrite invocation per chunk when chunks arrive one-per-tick (the normal pipe() pattern). Measured ≈27% extra wall-clock per chunk on a sync objectMode Writable; fixing it eliminates ~N redundant microtask schedulings for an N-chunk objectMode pipeline.

**Fix:** Change line 618 to `const needTick = needDrain || (state[kState] & kDestroyed) !== 0 || cb !== nop;`.

---

