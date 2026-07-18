# Bun perf hunt: high-impact findings

4 survey rounds, 56 areas/targets, **165 findings total**.
**27 high-impact/high-confidence** (listed below), 84 medium/high (see combined json).

All high/high findings verified against source at HEAD.
23 findings have dedicated fix sessions already spawned (from round 1).

## High impact / high confidence (27)

### bake

**`src/runtime/bake/DevServer.rs:4054`** 🔵 open
**Per-file deep copy of source-map VLQ buffer on every bundle/reload**

Inside the per-compiled-file loop of `finalize_bundle` (runs once per file in every initial bundle and every HMR rebuild), `compile_result.source_map_chunk()` returns `Option<&bun_sourcemap::Chunk>` and the code calls `.clone()` on it. `Chunk` derives `Clone` and contains `buffer: MutableString { list: Vec<u8> }`, so this deep-copies the entire VLQ mapping buffer (typically KB-tens of KB per file, aggregate MB for a full route bundle). The cloned `Chunk` is then passed by value into `receive_chunk`, which only ever calls `buffer.to_owned_slice()` (a `mem::take` + `into_boxed_slice`) on it — so the sole purpose of the clone is to obtain owned bytes from a borrowed `&Chunk`. The data is copied once here and then moved out; the copy could be eliminated entirely.

*Fix:* Iterate `js_chunk.compile_results_for_chunk` mutably (or add/ use a `source_map_chunk_mut()` accessor) and `core::mem::take` the `Chunk` instead of cloning it — the compile results are discarded after `finalize_bundle` so the move is safe. This removes one full `Vec<u8>` allocation + memcpy per bundled file per reload. If a mutable iterator is not feasible, change `ReceiveChunkSourceMap` to carry `&'a Chunk` and have `PackedMap::new_non_empty` take `&Chunk` and build `vlq_` with `Box::<[u8]>::from(chunk.buffer.list.as_slice())` (same single copy, no intermediate `Vec` clone).


### cpp_bindings

**`src/jsc/bindings/bindings.cpp:1871`** 🔵 open
**Per-fetch() header serialization does 2×(O(N²) lookups + sort + Vector<String> alloc) via spec iterator**

WebCore__FetchHeaders__copyTo (line 1871) and WebCore__FetchHeaders__count (line 1917) both call headers->createIterator() and drain it with iter.next(). FetchHeaders::Iterator is the Fetch-spec sorted iterator: on first next() it heap-allocates a Vector<String> m_keys, copies every header name into it, std::sorts it, then for every subsequent next() it calls m_headers.get(key) which is findHTTPHeaderName (gperf hash) + a linear scan over the common/uncommon vector. A full drain is therefore O(N log N) sort + O(N²) comparisons + N gperf lookups. from_fetch_headers() (src/http_jsc/headers_jsc.rs:31,83) calls count() then copy_to() back-to-back for every outgoing fetch() request (src/runtime/webcore/fetch.rs:1401,1648) and for every StaticRoute/FileRoute response, so each request pays this twice.

*Fix:* copyTo/count do not need spec-sorted order — they just flatten into a byte buffer for the HTTP client. Rewrite both to iterate headers->internalHeaders().commonHeaders(), .uncommonHeaders(), and .getSetCookieHeaders() directly (each entry already carries both key and value). That is O(N) with zero heap allocation, no sort, no gperf re-lookup, and no linear scan per key. The same direct-iteration pattern is already used in writeFetchHeadersToUWSResponse (NodeHTTP.cpp:776-848) and getInternalProperties (JSFetchHeaders.cpp:673-709).


### css

**`src/css/properties/custom.rs:474`** ✅ handed off
**TokenList::parse reallocates via drain().collect() for every value with >=2 tokens**

After `parse_into` fills `tokens`, the whitespace-trim step unconditionally does `tokens.drain(start..end).collect()` whenever `tokens.len() >= 2`. This always allocates a brand-new Vec and moves every element into it, even in the common case where `start==0 && end==tokens.len()` (no trimming needed). `TokenList::parse` runs for every `--custom: ...;` declaration (CustomProperty::parse) and every known property that contains `var()` (UnparsedProperty::parse), so this is a per-declaration heap allocation + memcpy.

*Fix:* Skip the rebuild when `start == 0 && end == tokens.len()` and return `TokenList { v: tokens }` directly. When trimming is needed, do it in place: `tokens.truncate(end); if start > 0 { tokens.remove(0); }` (a single O(n) shift, no second allocation).


### encoding

**`src/bun_core/lib.rs:1813`** 🔵 open
**encodeInto(utf16) partial-fill path is pure scalar, no SIMD ASCII fast-path**

`copy_utf16_into_utf8_with_utf8_len` (the function `TextEncoder__encodeInto16` and `encode16_impl` both reach via `strings::copy_utf16_into_utf8{,_with_utf8_len}`) only tries the simdutf bulk convert when `utf8_len <= buf.len()` and the input is surrogate-free. In every other case — output buffer smaller than the full encoding (the canonical `encodeInto` streaming use), or a single unpaired surrogate anywhere in the input — it falls through to a per-codepoint scalar loop (`decode_utf16_with_fffd` + `encode_wtf8_rune` + slice copy) starting from index 0. ASCII runs are therefore narrowed one u16 at a time instead of via SIMD. The sibling implementation in `string/immutable/unicode.rs::copy_utf16_into_utf8_with_buffer_impl` already has the faster algorithm: `first_non_ascii16` SIMD scan + `copy_u16_into_u8` per segment, with simdutf retried around each surrogate. Only the slower variant is wired into `TextEncoder`.

*Fix:* Route `TextEncoder`'s 16-bit paths through the segment-SIMD implementation (`copy_utf16_into_utf8_with_buffer_impl::<false>`) or port its `first_non_ascii16` + `copy_u16_into_u8` loop into `strings_impl::copy_utf16_into_utf8_with_utf8_len`'s fallback so partial-buffer fills and surrogate-containing inputs still get SIMD treatment for ASCII runs. On simdutf `SURROGATE` failure, use `r.count` to resume from the failing position instead of restarting at 0.


### event_loop_tick

**`src/jsc/event_loop.rs:543`** 🔵 open
**update_counts() does pointer-chase + arithmetic even when delta == 0**

update_counts() runs on every tick_concurrent_with_count() call (≥3× per EventLoop::tick()). After `concurrent_ref.swap(0, SeqCst)`, it unconditionally evaluates `self.vm_ref().platform_loop_opt().expect("event_loop_handle")` (Option load + panic-branch) and then falls into the `else` arm doing `loop_.num_polls -= 0`, `u32::try_from(0).expect(...)`, and `loop_.active.saturating_sub(0)` — two pointer-chased load+stores and two `.expect()` branches — when `delta == 0`, which is the overwhelming steady-state case (only ref_concurrently/unref_concurrently bump it). There is no fast-path guard.

*Fix:* Insert `if delta == 0 { return; }` immediately after the swap (before `platform_loop_opt()`). Optionally also gate the swap itself with a relaxed load-first (`if self.concurrent_ref.load(Relaxed) == 0 { return }`) to avoid the SeqCst RMW in the common case; correctness is preserved because a missed delta is picked up on the next tick_concurrent call.


### glob

**`src/glob/GlobWalker.rs:2408`** ✅ handed off
**bun_join::<true> does 3 allocator round-trips per joined path (to_vec + push-grow + shrink)**

In SENTINEL mode, `s.as_bytes().to_vec()` allocates exactly `len` bytes, then `v.push(0)` must grow (realloc), then `v.into_boxed_slice()` must shrink (realloc) because the growth left cap > len. That is three allocator calls where one suffices. `join()` (which routes here when `absolute: true`) is called per subdirectory pushed onto the work stack and per matched path in `prepare_matched_path`.

*Fix:* Replace with `let mut v = Vec::with_capacity(s.as_bytes().len() + 1); v.extend_from_slice(s.as_bytes()); v.push(0); v.into_boxed_slice()` so capacity == len and neither `push` nor `into_boxed_slice` reallocates.


### http_client

**`src/http/HTTPThread.rs:248`** ✅ handed off
**Unused 32KB zeroed heap allocation per HTTP/1.1 request in RequestBodyBuffer**

Every call to send_initial_request_payload (once per HTTP/1.1 request, and again on each write-backpressure retry) invokes get_request_body_send_buffer() which in the common (<32KB) path does Box::new([0u8; 32768]) — a 32KB heap allocation plus a 32KB memset — and for the large path takes a 512KB HeapRequestBodyBuffer. The only thing ever done with that buffer is to_array_list(), which reads its .len() to size a fresh Vec::with_capacity(...) and otherwise ignores it. The boxed buffer is never written or read from and is dropped at scope exit. Net effect: an extra 32KB (or 512KB) malloc+memset+free per request on top of the Vec that is actually used.

*Fix:* Delete the RequestBodyBuffer indirection for this caller: compute the target capacity (min(32KB, estimate) or 512KB) and call Vec::with_capacity directly in send_initial_request_payload, mirroring what the ProxyHeaders arm already does at lib.rs:3475. Alternatively make the Stack variant a zero-sized capacity marker instead of a Box<[u8; 32K]>.


### http_client_ondata

**`src/http/lib.rs:4751`** 🔵 open
**Body buffer pre-reserves only one packet instead of Content-Length**

In handle_response_body_from_multiple_packets (the per-TCP-read path for Content-Length bodies), the first-packet pre-allocation is `try_reserve_exact(incoming_data.len())` — i.e. one TCP read's worth. Every subsequent packet falls through to `buffer.write(remainder)` → `Vec::extend_from_slice`, which grows by doubling. For an N-byte download that arrives in ~64KB reads this is ~log2(N) reallocs and ~2N bytes of extra memcpy even though `content_length` is known up-front. The guard `incoming_data.len() < PREALLOCATE_MAX` (256 MB) is effectively always true for a socket read, which strongly suggests the intended comparand was `content_length`, not the single-packet length. Verified there is no other pre-reserve for `body_out_str`/`compressed_body` anywhere on this path; the same shape exists in the original Zig (so it is 'battle-tested', but still wasted work on every large download, e.g. `bun install` tarballs).

*Fix:* When the buffer is empty and `content_length` is Some, reserve `content_length.min(PREALLOCATE_MAX)` instead of `incoming_data.len()`:
    if buffer.list.is_empty() {
        let target = content_length.unwrap_or(incoming_data.len()).min(PREALLOCATE_MAX);
        let _ = buffer.list.try_reserve_exact(target);
    }
This removes all mid-download reallocs for responses with a known Content-Length (identity or compressed-accumulate paths).


### install_core

**`src/install/npm.rs:2942`** ✅ handed off
**O(V²) publish-time lookup in npm manifest parser**

Inside the per-version loop (`for prop in versions` at line 2342), the code re-fetches `json.get(b"time")` every iteration (linear scan of root props) and then does `time_obj.get().get(version_name)` — a linear scan over the `time` object, which has one entry per version. With V versions that is V linear scans of ~V keys each, i.e. O(V²) byte-slice comparisons. Packages like typescript (~3700 versions) or @types/node (~2000 versions) incur millions of string comparisons per manifest parse, and this runs for every unique package on a cold install.

*Fix:* Before the versions loop, look up the `time` object once and build a `HashMap<u64, &[u8]>` (string-hash → date str) from its properties in a single pass. In the loop, hash `version_name` and do an O(1) lookup. This reduces the whole thing to O(V).


### js_internal

**`src/js/internal/sql/shared.ts:971`** 🔵 open
**Per-query full-string toUpperCase()+trim() just to check a prefix in checkUnsafeTransaction**

For every Postgres/MySQL query executed through the default pool, `checkUnsafeTransaction` allocates a full uppercase copy of the entire SQL string (via `sql.toUpperCase().trim()`) only to test whether it starts with "BEGIN" or "START TRANSACTION". For bulk inserts generated by `normalizeQuery` (e.g. 1000 rows × 10 cols of `$n` placeholders → tens of KB), this is an O(n) allocation+copy per query where an O(1) case-insensitive prefix check on the first ~17 chars after leading whitespace would suffice.

*Fix:* Skip leading whitespace manually, then compare the first 5/17 characters case-insensitively without allocating. E.g.:
  let i = 0; const n = sql.length;
  while (i < n && sql.charCodeAt(i) <= 32) i++;
  // case-insensitive startsWith against "BEGIN" / "START TRANSACTION" over sql[i..]
or `const head = sql.substring(i, i + 17).toUpperCase();` so only ≤17 chars are uppercased instead of the whole query.


### js_printer_expr

**`src/bun_core/string/identifier.rs:28`** 🔵 open
**lexer::is_identifier() has no ASCII fast path; called for every EDot and object property key**

`is_identifier()` decodes every byte through `CodepointIterator::next` (stateful cursor: pos = i + width, load, branch, store i/width/c) and then calls `is_identifier_part()` per codepoint. The cursor dependency chain serializes the loop so LLVM cannot vectorize it (~10 ops/byte). In the printer hot loop this is invoked at /workspace/bun/src/js_printer/lib.rs:3687 for every `EDot` node (`a.b` property access — one of the top-3 most frequent expr kinds) and at :4912 for every object-literal property key. >99.9% of `e.name` values are pure ASCII, so the full WTF-8 decode + Unicode-table path is paid on every dot for no benefit.

*Fix:* Prepend an ASCII fast path to `bun_core::identifier::is_identifier`: if `strings::is_all_ascii(text)` (or `text.iter().all(|&b| b < 0x80)`), check `text[0]` against `[a-zA-Z_$]` and `text[1..]` against `[a-zA-Z0-9_$]` via a 256-entry `static` bitmap or the existing range match (both auto-vectorize). Fall through to the current `CodepointIterator` loop only when a non-ASCII byte is seen. This fixes all call sites (EDot, print_property, EImportIdentifier alias, ECommonjsExportIdentifier) at once with no AST changes.


### json_parse

**`src/parsers/json_index.rs:99`** 🔵 open
**StructuralIndex::at() re-bounds-checks self.win[] after the refill gate — LLVM cannot elide it**

`at()` is the hottest stage-2 primitive (every `pos_at`/`peek`/`run`/`string_body_at` call goes through it, ~6-10× per JSON value). It does `if logical - self.base >= self.win.len() { self.fill_to(logical); } self.win[logical - self.base]`. Because the cold `fill_to(&mut self)` call is merged back into the fall-through, LLVM inserts a phi and re-checks `i < win.len()` on the hot path even though the `if` already proved it. Release LLVM IR confirms: 53 surviving `panic_bounds_check` calls targeting json_index.rs:99 across the crate, 11 inside `parse_object` and 8 inside `parse_array` (i.e. one extra compare+branch per index lookup, per token, per document).

*Fix:* Restructure `at()` so the hot path returns before the cold call, so no phi merges the two: `let i = logical - self.base; if let Some(&p) = self.win.get(i) { return p as usize; } self.fill_to(logical); self.win[logical - self.base] as usize`. (Or `get_unchecked` after the explicit `<` check.) This removes one compare+branch from every index lookup in the per-token loop.


### resolver

**`src/resolver/package_json.rs:1293`** ✅ handed off
**Exports-map exact-key lookup is a linear scan of Vec<MapEntry>**

`Entry::value_for_key` iterates `EntryDataMap.list` (a plain `Vec<MapEntry>`) and compares each key with `strings::eql`. It is called from `resolve_imports_exports` (line 1777) for the exact-subpath lookup and from `resolve_exports` (line 1722) for the "." lookup — i.e. once per `import 'pkg/sub'` that hits a package with an "exports" map. For packages with large exports maps (rxjs ~150 keys, @mui/material ~400, lodash-es-style layouts), this is O(n) string compares per import instead of O(1).

*Fix:* Store a `StringArrayHashMap<u32>` (key → index into `list`) alongside `list` in `EntryDataMap`, built once in `visit_object` (package_json.rs:1125) where the map is parsed. `value_for_key` then becomes a single hash lookup. `expansion_keys` already gets this parse-time preprocessing; exact keys should too.

**`src/resolver/package_json.rs:1656`** ✅ handed off
**ESModule::finalize scans path 4x and re-allocates even when no '%' is present**

`finalize()` runs on every successful exports/imports-map resolution. It first does four separate `strings::contains` passes over `result.path` (one per `INVALID_PERCENT_CHARS` entry), then unconditionally calls `PercentEncoding::decode_into` (byte-by-byte copy into a PathBuffer), then allocates a fresh `Box::<[u8]>::from(resolved_path)` at line 1697 — dropping the `Box<[u8]>` that `resolve_target` just allocated (e.g. line 2142/2159). For the overwhelmingly common case where the resolved path contains no `%`, all of this is wasted: 4 scans + 1 copy + 1 extra heap allocation per import.

*Fix:* At the top of `finalize` (after the status check), do a single `strings::index_of_char(&result.path, b'%')`. If `None`, return `result` as-is — no decode, no realloc, and the 4 substring scans become unnecessary (all four patterns start with `%`). Only when a `%` is present fall through to the existing check/decode/realloc path.


### router

**`src/router/lib.rs:1565`** 🔵 open
**Route pattern re-parsed byte-by-byte on every match attempt (per-request × per-dynamic-route)**

In the per-request hot path `Routes::match_dynamic` (line 555-563) iterates every dynamic route and calls `Pattern::match_` for each. Inside `Pattern::match_`, the `while` loop calls `Pattern::init(match_name, offset)` (line 1565, and again at 1608) which re-tokenizes the immutable route's `match_name` byte-by-byte (`init_maybe_hash` scans for '/' and '[' at lines 1778-1907) and wyhashes each static segment via `HashedString::init` (lines 1805/1814/1910 → HashedString.rs:24 `hash(buf)`). The route patterns never change after `RouteLoader::load_all`; `Pattern::validate` already parses them once at load time (line 1677 `Pattern::init_unhashed`) but the result is discarded except for `param_count`/`kind`. Result: for N dynamic routes with S segments of length L, every `router.match()` call does O(N·S·L) redundant byte-scanning + O(N·S_static) redundant wyhash calls on data that is constant for the process lifetime.

*Fix:* Precompute the segment list once at load time: store a `Box<[pattern::Value]>` (or a packed `[(Tag, TinyPtr, u32 hash)]`) on `Route` (it is already heap-boxed, so no extra indirection), filled from the existing `Pattern::validate` pass. Change `Pattern::match_` to iterate that precomputed slice instead of calling `Pattern::init` in the loop. This removes all per-request route-name byte-scanning and route-side wyhash calls, reducing dynamic-match cost to one URL-segment split + one compare per segment per candidate route.


### runtime_server

**`src/runtime/server/server_body.rs:3108`** ✅ handed off
**H3 request URL built with unsized Vec + redundant copy (per-request)**

In prepare_js_request_context_for (the H3 path, IS_H3 branch) the request URL is built by `let mut s = Vec::new(); write!(&mut s, "https://{}", fmt); ... s.extend_from_slice(path); request_object.url.set(BunString::clone_utf8(&s));`. The Vec starts with zero capacity, so `write!` triggers several grow-reallocations for the `https://` + host bytes, then `extend_from_slice(path)` can realloc again, and finally `clone_utf8` copies the whole buffer a second time. This runs for every HTTP/3 request.

*Fix:* Pre-size the buffer: `Vec::with_capacity("https://".len() + host.len() + path.len())` (HostFormatter writes at most host + optional brackets, so an upper bound is cheap). This collapses the Vec growth into a single allocation. Further, `BunString` could be built once from the owned Vec (e.g. a create-from-owned-bytes helper) instead of `clone_utf8(&s)`, avoiding the second copy.


### semver

**`src/semver/Version.rs:666`** ✅ handed off
**parse_version_number re-filters and copies bytes that are already guaranteed all-digit**

`parse_version_number` loops over its input with a per-byte match that handles x/*/X, space, dot, and other chars, copying digits into a 20-byte stack buffer before calling `T::parse_ascii` on the copy. But all three call sites (lines 542/547/552) pass `&input[part_start_i..last_char_i]`, a slice the caller already proved is 100% ASCII digits via the `while input[i].is_ascii_digit()` loop at line 533. The match-filter and buffer copy are therefore dead work done 3× per `Version::parse`, which runs for every version key in every npm manifest (npm.rs:2082/2345 — thousands per popular package) and every dependency spec.

*Fix:* Replace the body with a direct `T::parse_ascii(input)` (keeping the debug-build error log on None). The overflow case (>20 digits) is already handled by `parse_unsigned` returning Err. This removes one O(n) scan + one small memcpy per major/minor/patch component.


### server_onrequest

**`src/runtime/server/mod.rs:728`** 🔵 open
**AbortSignal is heap-allocated in C++ unconditionally for every request**

prepare_js_request_context() calls `jsc::AbortSignal::new(global)` on every request. This crosses FFI into `WebCore__AbortSignal__new` (bindings.cpp:5534) which does `WebCore::AbortSignal::create(context)` — a RefCounted C++ heap allocation — then two more FFI hops (`pending_activity_ref()` and `ref_()`). There is no fast-path: the signal is created even when the user never reads `request.signal` and the request completes synchronously without aborting.

*Fix:* Defer AbortSignal creation. Pass `None` to `Request::init` and leave `ctx.signal = None`. Create the signal on first `request.signal` access (Request::get_signal already does this) and have the lazy path also register the pointer back into the live `AnyRequestContext` so `on_abort` can fire it. `on_abort`/`set_signal_aborted` already no-op when `self.signal` is None (RequestContext.rs:618), so a never-observed signal correctly fires nothing. Edge case to cover: if abort happens before first `.signal` access, the lazy getter must return an already-aborted signal (check `ctx.flags.aborted()` when materializing).

**`src/runtime/server/mod.rs:743`** 🔵 open
**webcore::Request is Box::new'd per request while its siblings are pooled**

Every request heap-allocates a `webcore::Request` via `bun_core::heap::into_raw(Request::new(Request::init(..)))` where `Request::new` is literally `Box::new(v)` (Request.rs:144). The surrounding code goes to great lengths to pool the other per-request structs — `RequestContext` comes from a 2048-slot `HiveArray::Fallback` (mod.rs:689) and the body `Value` comes from a 256-slot hive (Body.rs:553) — but the `Request` itself hits mimalloc alloc/free every time (freed in Request::finalize via `Box::from_raw`).

*Fix:* Allocate `Request` from a per-VM `HiveArray::Fallback` exactly like `Body::Value` (Body.rs:542-561). `Request::finalize` returns the slot to the pool instead of `Box::from_raw`. Request is already designed to be re-initialized in place (`finalize_without_deinit` resets every field), and it is always created/destroyed on the JS thread, so no Send concerns.


### shell

**`src/runtime/shell/states/Expansion.rs:609`** 🔵 open
**Command-substitution stdout buffer is .clone()'d instead of moved**

When a `$(...)` command substitution finishes, `child_done` does `buffered_stdout_mut().clone()` to obtain the captured stdout, producing a full heap copy of the buffer. The source buffer lives in the child Script's duped `ShellExecEnv` (created at line 217 with `ShellExecEnvKind::CmdSubst` + `OutKind::Pipe`, so always `Bufio::Owned`) and is unconditionally freed a few lines later by `interp.deinit_node(child)` (line 637). The clone is therefore a pure extra allocation + memcpy of the entire captured output; for `$(cat bigfile)` or any substitution producing megabytes, peak memory and CPU roughly double for that step.

*Fix:* Replace `.clone()` with `core::mem::take(...)` on the `&mut Vec<u8>`. Because the CmdSubst env is always `Bufio::Owned` for stdout (stdout is forced to `OutKind::Pipe` at Expansion.rs:211), taking leaves an empty Vec in an env that is about to be dropped. Optionally add a `ShellExecEnv::take_buffered_stdout()` helper (or a `debug_assert!(matches!(_buffered_stdout, Bufio::Owned(_)))`) to encode that invariant.


### socket

**`src/runtime/socket/socket_body.rs:2970`** 🔵 open
**O(N²) memmove draining node:net write buffer under backpressure**

`internal_flush` (called from every `on_writable` event) writes from the head of `buffered_data_for_node_net` and then shifts the remainder down with `b.copy_within(written.., 0); b.truncate(len)`. Under sustained TCP backpressure a buffer of N bytes drained W bytes per writable event does N/W memmoves averaging N/2 bytes each → ~N²/(2W) bytes of copying to deliver N bytes. The same shift-down pattern appears at lines 2632-2636 and 2670-2683 in `write_or_end_buffered`. No read-offset is tracked; every partial drain pays O(remaining).

*Fix:* Track a `drain_offset: Cell<usize>` alongside the Vec and write `&buf[offset..]`; only `copy_within`/shrink when `offset > buf.len()/2` (amortized O(1) per byte). Alternatively store the buffer as a `VecDeque<u8>`/ring so partial drains are pointer advances. This keeps total copy work O(N) regardless of how many writable ticks it takes to drain.


### sql

**`src/sql_jsc/mysql/protocol/ResultSet.rs:197`** 🔵 open
**MySQL result rows heap-allocate a fresh Box<[SQLDataCell]> per row**

Both Row::decode_text (line 197) and Row::decode_binary (line 257) do `vec![SQLDataCell::null(); self.columns.len()].into_boxed_slice()` on every row. The caller JSMySQLConnection::on_result_row (JSMySQLConnection.rs:832) builds a fresh Row with `values: Box::default()` and then decode() allocates this Box, all per-row. For a result set of N rows this is N heap alloc+free pairs plus N*cols zeroing, where the buffer size is fixed by the statement's column count and could be reused across rows.

*Fix:* Mirror the Postgres approach: use a fixed stack array (e.g. `[SQLDataCell::default(); 70]`) inside on_result_row for column counts below JSObject::max_inline_capacity(), and only heap-allocate when columns exceed that. Alternatively, keep a reusable `Vec<SQLDataCell>` on the MySQLStatement (sized once at header time) and `clear()`/re-fill it per row instead of allocating a new Box each row.


### sys_file

**`src/sys/lib.rs:6381`** 🔵 open
**openat_a on Windows: redundant 98 KB PathBuffer + memcpy that is immediately discarded**

`openat_a` unconditionally materializes a `bun_paths::PathBuffer` (98 302 bytes on Windows), memcpys the incoming `&[u8]` into it, writes a NUL, builds a `ZStr`, and calls `openat(dir, z, ...)`. On Windows, `openat` (lib.rs:3960) immediately calls `super::openat_windows_a(dir, path.as_bytes(), ...)` — i.e. it strips the NUL right back off and hands the raw `&[u8]` to the UTF-8→UTF-16 converter. The entire PathBuffer copy + NUL step is dead work on Windows, done once per open. The 98 KB stack local also forces `__chkstk` stack probing (~24 page touches) per call. `File::openat`, `Dir::open_at`, `open_dir_at`, and the `delete_tree` inner loop all route through this (≈100 call sites in the tree).

*Fix:* Add a `#[cfg(windows)]` fast-path in `openat_a` that returns `openat_windows_a(dir, path, flags, perm)` directly, bypassing the PathBuffer/ZStr round-trip. Keep the existing body under `#[cfg(not(windows))]` where the NUL-terminated C string is actually required by `libc::openat`.

**`src/sys/dir.rs:178`** 🔵 open
**delete_tree: per-entry unlink/open re-copies name into a PathBuffer when a zero-copy ZStr is already available (POSIX)**

Inside the per-entry hot loop of `Dir::delete_tree`, each file is removed via `unlinkat_a(top.iter.dir(), entry.name.slice_u8(), 0)` and each subdirectory is opened via `openat_a(top.iter.dir(), entry.name.slice_u8(), ...)`. Both `*_a` helpers allocate a stack `PathBuffer` (4 KB Linux / 1 KB macOS / 98 KB Windows), memcpy the name into it, and append a NUL — solely to produce a `&ZStr`. But on POSIX the kernel already wrote `d_name` NUL-terminated inside the iterator's getdents buffer, and `dir_iterator::Name::as_zstr()` (lib.rs:237) returns that `&ZStr` with zero copying. So every file deleted pays a 1–4 KB stack bump + memcpy of the name that is provably redundant. For `rm -rf node_modules` this is 10^5+ redundant copies.

*Fix:* On `cfg(not(windows))`, call `unlinkat_with_flags(top.iter.dir(), entry.name.as_zstr(), 0)` and `openat(top.iter.dir(), entry.name.as_zstr(), O::DIRECTORY|..., 0)` directly, skipping `unlinkat_a`/`openat_a`. Keep the `*_a` path only for Windows (where `as_zstr()` returns `&WStr` and a different wide-path helper would be needed to avoid the UTF-8 round-trip there too).


### test_runner

**`src/runtime/test_runner/expect.rs:378`** 🔵 open
**Per-assertion Vec<u8> heap allocation in Expect::get_value() that is discarded on the happy path**

Expect::get_value() is the shared prelude for nearly every matcher (reached via matcher_prelude() from toBe, toEqual, toStrictEqual, toContain, toHaveLength, toMatch, toMatchObject, toThrow, run_string_affix_matcher, contain_matcher, etc.). On every single assertion it unconditionally calls Output::pretty_fmt_rt(matcher_params_fmt, ...), which internally runs pretty_fmt_runtime() and allocates a fresh Vec<u8> (Vec::with_capacity(fmt.len()*4), ~72 bytes for the common "<green>expected<r>" literal). The rendered buffer is passed into process_promise() as `impl fmt::Display`, but process_promise() only touches it inside the `Promise::Resolves | Promise::Rejects` failure branches; for the overwhelmingly common case (no .resolves/.rejects, `_ => Ok(value)`) the PrettyBuf is never read and is simply dropped. This is a heap allocation + byte-scan per passing assertion.

*Fix:* Defer the ANSI rewrite: pass the raw `matcher_params_fmt: &'static str` through to process_promise() and only call Output::pretty_fmt_rt inside the three error branches that actually format it (the throw_pretty_matcher_error calls). Alternatively, memoize like get_signature() does (there are only ~4 distinct literal values), or wrap it in a lazy Display adapter that calls pretty_fmt_rt on first use. Any of these makes the passing-assertion path allocation-free.


### watcher

**`src/watcher/WindowsWatcher.rs:446`** 🔵 open
**O(events × watchlist) nested path-compare loop on Windows (acknowledged TODO)**

For every `FILE_NOTIFY_INFORMATION` event, the code iterates the entire watchlist (`for item_idx in 0..n_items`) and calls `is_parent_or_equal(path, eventpath)` on each entry. This is O(events × watched_items × path_len) per `watch_loop_cycle`. The TODO comment at line 437 explicitly acknowledges this needs a better search structure. For projects with thousands of watched files, a burst of events (common on save-all / git checkout) degrades quadratically.

*Fix:* Maintain a `HashMap<HashType, WatchItemIndex>` keyed on the path hash (already computed/stored as `WatchItem.hash`) and look up the exact path first; only fall back to a directory-prefix scan when no exact match. Alternatively keep the file_path column sorted and binary-search a prefix range, as the TODO suggests.


### webcore

**`src/runtime/webcore/Blob.rs:4086`** 🔵 open
**FormData file parts are copied twice (read_file buffer cloned into joiner, then freed)**

When serializing a `DOMFormData` with a file-backed Blob entry, `node_fs.read_file` produces an owned `StringOrBuffer::Buffer`. The code then does `joiner.push_cloned(result.slice())`, which allocates a second buffer of the same size and memcpys (`StringJoiner::push_cloned` = `Box::from(data)`, /workspace/bun/src/bun_core/string/StringJoiner.rs:71-76), and immediately afterwards `buf.destroy()` frees the original. For every file entry this doubles peak memory and adds a full-file memcpy; this runs once per File field on every `fetch(body: FormData)` / `new Response(formData)` that contains file paths.

*Fix:* Extract the owned allocation from `StringOrBuffer::Buffer` and hand it to `joiner.push_owned(...)` instead of `push_cloned`. `StringJoiner::push_owned(Box<[u8]>)` already exists and avoids the copy; only the Buffer→Box<[u8]> move helper (or an `into_boxed_slice()` on the NodeFS Buffer type) is needed.


---

## Medium/high (84)

- `src/js_parser/p.rs:7048` Quadratic per-item insert() loop when splicing instance members into constructor
- `src/js_parser/fold.rs:139` Double hash lookup on import_items_for_namespace per property access during bundling
- `src/js_printer/renamer.rs:1064` ExportRenamer::next_renamed_name is O(n²) on name collisions and arena-allocates every failed attempt
- `src/js_printer/lib.rs:3386` Linear scan over commonjs_named_exports for every ECommonjsExportIdentifier expression
- `src/js_printer/lib.rs:5665` SExportClause always heap-allocates a Vec<&ClauseItem> even when no filtering is needed
- `src/resolver/resolver.rs:4741` match_tsconfig_paths exact-match does O(n) key scan over an ArrayHashMap
- `src/resolver/resolver.rs:4784` match_tsconfig_paths recomputes '*' position for every key on every import
- `src/bundler/linker_context/MetafileBuilder.rs:890` O(N²·M) reverse-dependency path matching in metafile markdown generator
- `src/bundler/LinkerContext.rs:3865` Fresh Vec<usize> allocated and sorted per source file in Step 4 import matching
- `src/install/lockfile/printer/Yarn.rs:87` Yarn printer builds requested-versions map with O(P×D) nested scan
- `src/install/lockfile/Tree.rs:734` Sort comparators call is_less_than twice, doubling string-compare work
- `src/install/lockfile/bun.lock.rs:344` Fresh Vec<u8> allocated per dependency when building pkg_map key
- `src/install/lockfile/printer/Yarn.rs:87` O(P×D) linear scan per package when building yarn.lock requested-versions map
- `src/install/lockfile/bun.lock.rs:2145` O(W²) workspace-row matching when parsing bun.lock
- `src/bun_core/string/mod.rs:792` String::has_prefix_comptime scans/transcodes entire string to check a short prefix
- `src/bun_core/string/mod.rs:768` String::eql_utf8/eql_comptime transcodes the whole string before a length-mismatch can short-circuit
- `src/bun_core/string/StringJoiner.rs:108` StringJoiner::detach_lifetime re-allocates and copies the entire nodes Vec to change a lifetime
- `src/collections/multi_array_list.rs:1360` MultiArrayList::sort() stable path is O(n²) insertion sort
- `src/collections/linear_fifo.rs:299` LinearFifo::realign() wrapped branch is O(buf_len × head / 2KB) — effectively quadratic
- `src/collections/array_hash_map.rs:2050` StringHashMap safe insert paths heap-allocate the key Box even when the key already exists
- `src/http/h2_client/dispatch.rs:570` Fresh Vec<[u32;3]> allocated for every HTTP/2 response header block
- `src/http/h2_client/ClientSession.rs:589` O(n_streams) linear scan in h2/h3 *_by_http_id, run per streaming-body chunk
- `src/http/h2_client/encode.rs:109` h2 write_request lowercases and classifies every request header twice
- `src/runtime/server/ServerConfig.rs:236` O(n²) static-route dedup via Vec::contains + Vec::remove
- `src/runtime/server/mod.rs:2227` O(N_static × N_user) nested scan for HEAD route check in set_routes
- `src/css/css_parser.rs:3422` add_symbol_for_name boxes the lookup key on every class/id selector
- `src/css/selectors/selector.rs:845` Minified [attr=val] serialization allocates two Vecs per selector; Printer.scratchbuf is never used
- `src/glob/GlobWalker.rs:595` Fresh Box<PathBuffer> (4KB Linux / ~98KB Windows) allocated per directory traversed
- `src/glob/GlobWalker.rs:703` Redundant .to_vec() immediately re-copied by dupe_z in literal-tail stat path
- `src/glob/GlobWalker.rs:1991` prepare_matched_path: two hash probes + duplicate path allocation per matched result
- `src/glob/GlobWalker.rs:1153` Heap dupe_z just to NUL-terminate an entry name for lstatat (FileKind::Unknown path)
- `src/sourcemap/InternalSourceMap.rs:884` InternalSourceMap::append_vlq_to does not pre-reserve output capacity
- `src/semver/Version.rs:1130` Tag::parse_with_pre_count does a useless first-pass scan whose early-return can never fire
- `src/js/internal/fs/glob.ts:353` Pattern.cacheKey() rebuilds suffix string via += loop on every call, never memoized
- `src/runtime/node/node_fs.rs:10121` rm -rf allocates a fresh Vec<u8> per directory entry despite stated "O(1) memory"
- `src/runtime/node/node_fs.rs:6978` Recursive readdir withFileTypes re-joins+dirnames the parent path for every entry
- `src/runtime/node/net/BlockList.rs:156` BlockList addAddress/addRange/addSubnet use Vec::insert(0) — O(n²) to build N rules
- `src/runtime/webcore/fetch/FetchTasklet.rs:2215` skip_chunked_framing() re-scans all request headers on every streamed chunk
- `src/runtime/shell/builtin/seq.rs:201` Builtins clone/to_vec their whole output buffer before enqueue() which immediately copies it again
- `src/shell_parser/braces.rs:1316` flatten_tokens() is O(n²) and clones each merged SmolStr
- `src/shell_parser/braces.rs:886` Brace expansion snapshots the output prefix into a fresh Vec at every expansion node
- `src/runtime/api/bun/h2_frame_parser.rs:1868` HTTP/2 DATA partial-flush copies payload into a fresh Vec per chunk
- `src/paths/string_paths.rs:208` to_w_path_normalized does redundant pooled-buffer get + slash scan/copy; to_w_path already normalizes slashes
- `src/paths/lib.rs:238` join_sep_vec starts with Vec::new() and grows via extend_from_slice in loop (no capacity reservation)
- `src/bundler/transpiler.rs:2348` Per-module heap reallocation+copy of the entire symbol table on every print
- `src/sql_jsc/postgres/Signature.rs:116` Signature::generate stores an unused owned copy of the full SQL text
- `src/sql_jsc/postgres/PostgresSQLConnection.rs:2444` Postgres DataRow re-zeroes cells that were just default-initialized
- `src/jsc/ModuleLoader.rs:465` Linear scan over ~138 builtin aliases when a prebuilt HashMap already exists
- `src/io/lib.rs:997` tick_kqueue allocates a fresh Vec<KEvent> on every IO-thread wakeup
- `src/watcher/INotifyWatcher.rs:450` O(events × watchlist) linear wd→index scan per inotify event
- `src/watcher/Watcher.rs:900` index_of / parent lookup are O(n) → O(n²) total when registering N files
- `src/runtime/test_runner/diff/diff_match_patch.rs:1214` O(n^2) Vec::remove(0) inside inner loop of diff_cleanup_semantic_lossless
- `src/js/node/http2.ts:3874` http2 request()/respond() iterate headers 2-3x with redundant Object.keys() + toLowerCase()
- `src/js/builtins/ProcessObjectInternals.ts:503` Windows process.env set trap does O(n) scan with n toUpperCase() allocations per assignment
- `src/js/builtins/CommonJS.ts:406` require.cache Proxy ownKeys() is O(cjs × esm) via array.includes in loop
- `src/runtime/crypto/EVP.rs:257` Wasted ERR_clear_error/ERR_get_error on every Bun.CryptoHasher#update() call
- `src/runtime/socket/udp_socket.rs:1584` Two heap allocations per UDP destination address in send()/sendMany()
- `src/runtime/bake/dev_server/incremental_graph.rs:856` Fresh ArrayHashMap allocated per bundled file in import diffing
- `src/url/lib.rs:631` URL::parse scans the entire post-scheme URL for '@' and ':' on every parse (per-fetch / per-HTTP-request)
- `src/url/lib.rs:1230` O(n²) linear name-dedup inside per-param loop in QueryStringMap::init / init_with_scanner (per-request FileSystemRouter path)
- `src/router/lib.rs:1572` Static-segment compare wyhashes both sides then memcmps anyway
- `src/valkey/valkey_protocol.rs:556` Redundant Box<[u8]> allocation for every RESP3 Push kind (per pub/sub message)
- `src/dotenv/env_loader.rs:1359` create_null_delimited_env_map: N+2 heap allocations per subprocess spawn (could be 2)
- `src/uws/lib.rs:1148` 64KB stack buffer zero-initialized on every TLS data chunk in SSLWrapper::handle_traffic
- `src/event_loop/DeferredTaskQueue.rs:78` DeferredTaskQueue::run() re-hashes keys on removal though index is already known (stale TODO)
- `src/jsc/bindings/webcore/FetchHeaders.cpp:386` FetchHeaders::Iterator::next() does a linear HTTPHeaderMap::get() per step → O(N²) full iteration
- `src/js/internal/fs/glob.ts:353` Pattern.cacheKey() rebuilds the same suffix string on every directory entry in fs.glob
- `src/md/ref_defs.rs:42` normalize_label allocates a fresh Vec<u8> on every reference-link lookup
- `src/md/helpers.rs:100` is_unicode_punctuation_extended does a linear scan over ~300 sorted ranges per flanking check
- `src/md/ref_defs.rs:380` build_ref_def_hashtable copies every paragraph's bytes into self.buffer even when it cannot be a ref-def
- `src/md/inlines.rs:218` process_inline_content clones the entire emph_delims Vec (and allocates a fresh prev_candidate Vec) per block and per link label
- `src/js_parser/lexer.rs:2921` JSX lexer loops reload `self.contents` per byte (the `step_with` optimization was never applied to JSX)
- `src/js_parser/lexer.rs:1079` `parse_string_literal_inner` re-slices + bounds-checks + compares `>= 4096` on every ordinary body byte
- `src/js_printer/lib.rs:2634` print_non_negative_float falls back to core::fmt::write for every non-integer number literal
- `src/picohttp/lib.rs:615` `last_len` is always 0: picohttp’s incremental-reparse guard never fires, headers re-scanned from byte 0 on every fragment
- `src/css/css_parser.rs:5371` consume_comment scans byte-by-byte with no SIMD fast-path for ASCII runs
- `src/bun_core/lib.rs:1640` to_utf8_from_latin1 scans the ASCII prefix twice on non-ASCII input
- `src/jsc/bindings/BunString.cpp:445` BunString__fromUTF8 re-validates UTF-8 with the validating converter after validate_utf8 already passed
- `src/bun_core/lib.rs:1781` encodeInto(utf16) scans the entire input to compute a length it then discards
- `src/sys/dir.rs:172` delete_tree: heap allocation per subdirectory for StackItem::name
- `src/runtime/server/RequestContext.rs:1349` RequestContext::create eagerly looks up the Range header on every request
- `src/parsers/json_stage2.rs:334` newline_in_gap_before() computes self.run(j) before the ASCII test that makes it unnecessary
- `src/parsers/json_stage2.rs:907` parse_number() calls #[cold] rest_is_ws_cold unconditionally — no empty-tail fast path
- `src/jsc/bindings/webcore/streams/JSReadableStreamDefaultController.cpp:593` Redundant `readableStreamHasDefaultReader(stream) &&` guard before null-safe `readableStreamGetNumReadRequests`

Full details in `.perf-findings-combined.json` and per-round `.perf-findings-round{1..4}.json`.