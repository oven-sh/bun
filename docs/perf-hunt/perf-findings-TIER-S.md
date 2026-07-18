# Bun perf hunt: TIER S findings

The 13 highest-leverage wins from 189 findings across 5 survey rounds.
Each should produce a measurable delta on a standard benchmark.
All verified against source at HEAD.

## `src/bun_core/string/identifier.rs:28`
**Workload:** transpile | **Est. impact:** ~2-3% transpile time

**lexer::is_identifier() has no ASCII fast path; called for every EDot and object property key**

`is_identifier()` decodes every byte through `CodepointIterator::next` (stateful cursor: pos = i + width, load, branch, store i/width/c) and then calls `is_identifier_part()` per codepoint. The cursor dependency chain serializes the loop so LLVM cannot vectorize it (~10 ops/byte). In the printer hot loop this is invoked at /workspace/bun/src/js_printer/lib.rs:3687 for every `EDot` node (`a.b` property access — one of the top-3 most frequent expr kinds) and at :4912 for every object-literal property key. >99.9% of `e.name` values are pure ASCII, so the full WTF-8 decode + Unicode-table path is paid on every dot for no benefit.

**Fix:** Prepend an ASCII fast path to `bun_core::identifier::is_identifier`: if `strings::is_all_ascii(text)` (or `text.iter().all(|&b| b < 0x80)`), check `text[0]` against `[a-zA-Z_$]` and `text[1..]` against `[a-zA-Z0-9_$]` via a 256-entry `static` bitmap or the existing range match (both auto-vectorize). Fall through to the current `CodepointIterator` loop only when a non-ASCII byte is seen. This fixes all call sites (EDot, print_property, EImportIdentifier alias, ECommonjsExportIdentifier) at once with no AST changes.

---

## `src/bun_core/string/StringJoiner.rs:91`
**Workload:** bun build | **Est. impact:** 5-10MB dead scan/chunk, estimated_count never read

**StringJoiner watcher memmem-scans the entire bundle output for unique_key, but `estimated_count` is never read**

`push_node` runs `strings::index_of(data_slice, self.watcher.input)` (SIMD memmem) over every pushed slice to increment `watcher.estimated_count` whenever `watcher.input` is non-empty. `post_process_js_chunk` (postProcessJSChunk.rs:456) sets `watcher.input = chunk.unique_key` (25 bytes), so every `j.push(compile_result.code())` for each of the ~1000+ part_ranges scans that slice. But the only reads of `estimated_count` in the whole repo are StringJoiner's own unit tests (StringJoiner.rs:284,304). `break_output_into_pieces` (LinkerContext.rs:4079) then calls `j.contains(&self.unique_key_prefix)`, which re-scans every node's bytes a second time for effectively the same information.

**Fix:** Either (a) set `watcher.input` to `c.unique_key_prefix` instead of `chunk.unique_key` and replace `j.contains(&self.unique_key_prefix)` in `break_output_into_pieces` with `j.watcher.estimated_count > 0` (and use the count to size `pieces`), eliminating the second full scan; or (b) simply stop setting `watcher.input` in post_process_* so the `input.len() > 0` gate short-circuits the dead scan.

**Quantified:** Eliminates one full memmem pass over the concatenated JS output per chunk. For a 1000-module app producing ~5–10 MB of printed JS, that is ~5–10 MB of redundant SIMD scanning removed from the single-threaded post-process step (and the same for CSS/HTML chunks).

---

## `src/js_printer/renamer.rs:697`
**Workload:** bun build | **Est. impact:** 30-50k HashMap alloc/free per 1k-module build

**NumberRenamer allocates & drops a fresh hashbrown HashMap for every AST scope**

In `assign_names_recursive_with_number_scope`, each scope with symbols calls `number_scope_pool.get_init(NumberScope { name_counts: NameCountMap::with_capacity_and_hasher(symbol_count, ..) })` (line 697-717), and the walk-back at line 753 calls `put(s)` which `drop_in_place`s the `name_counts` HashMap (hive_array.rs:433). The HiveArrayFallback pool recycles the 2-field struct slot but NOT the HashMap's heap buffer, so every non-empty scope does one `hashbrown` table alloc + one free. `rename_symbols_in_chunk` is invoked per chunk and iterates every file in `files_in_order`, recursing into every scope — and it is serialized (one worker per chunk; typical non-code-split builds have 1 JS chunk).

**Fix:** Keep a small `Vec<NameCountMap>` stack on `NumberRenamer` (or change `HiveArrayFallback::put` callers to instead `name_counts.clear()` and leave the slot claimed): on pop, `clear()` the map (retains buckets) and push it to the free-list; on push, pop a map, `clear()` + `reserve(symbol_count)`. This turns ~N alloc/free pairs into O(max scope depth) allocations total.

**Quantified:** Removes ~1 HashMap alloc + 1 free per non-empty scope. A 1000-module React app has ~30–50 scopes/module ⇒ ~30,000–50,000 hashbrown table alloc/free pairs eliminated on the serial per-chunk rename thread (the renameSymbolsInChunk step is a known TODO-parallelize hotspot per the file's own comment at line 16).

---

## `src/install/npm.rs:2342`
**Workload:** bun install cold | **Est. impact:** ~100-200ms, 26M->3M compares

**PackageManifest::parse does ~22 O(n) linear property scans per version instead of one pass**

Both the count pass (loop at :2079) and the build pass (loop at :2342) call `version_obj.get(b"…")` for each key they need — dist, bin, directories, bundleDependencies, bundledDependencies, cpu, os, libc, hasInstallScript, dependencies/optionalDependencies/peerDependencies, peerDependenciesMeta — ≈9 calls in the count pass + ≈13 in the build pass. `ObjectJSON::get()` (src/ast/e.rs:1166) is `properties().iter().find(|p| p.key == key)`, i.e. a linear scan over the ~15 keys an abbreviated version object carries, and most of these queried keys (cpu/os/libc/directories/bundledDependencies) are usually *absent*, so each such scan walks all 15 entries.

**Fix:** In each of the two per-version loops, iterate `version_obj.properties()` once and dispatch via `match p.key.slice()` (byte-slice match, same key set is statically known) into local `Option<&JsonValue>` slots, then run the existing logic against those slots. Do the same for the `dist` sub-object (tarball/fileCount/unpackedSize/integrity/shasum — currently 5 separate `get()`s). No API changes; all work stays inside `parse()`.

**Quantified:** ~22 scans × ~12 avg compares × ~100 versions/manifest × ~1000 unique manifests ≈ 26M short byte-slice compares reduced to 2 passes × 15 props × 100 × 1000 ≈ 3M (with one compare each). Order-of-magnitude: removes ~100-200ms of worker-thread CPU on a 1500-dep cold install; scales linearly with total published-versions-across-deps.

---

## `src/install/PackageInstall.rs:977`
**Workload:** bun install warm | **Est. impact:** largest CPU cost after syscalls

**verify() does a full recursive JSON parse (~10 heap allocs) per package just to read name/version**

`verify_package_json_name_and_version` (hit once per hoisted dependency on the warm path) calls `PackageJSONVersionChecker::parse()` → `parse_to_rows()` (src/parsers/json.rs:690), which builds a `StructuralIndex` (heap `win` Vec ≈8KB + `dirty` Vec), a heap `Box<JsonTape>`, and grows `scratch_props`/`tape.props`/`tape.items` Vecs while recursively parsing *every* nested object in the package.json (`dependencies`, `devDependencies`, `scripts`, `keywords`, …). After all that, the caller only reads the two top-level string values and breaks.

**Fix:** Replace the `parse_to_rows` call in `PackageJSONVersionChecker::parse` (or add a dedicated fast path for `verify_package_json_name_and_version`) with a zero-alloc depth-0 byte scanner: walk bytes tracking brace/bracket depth and string state, capture the first `"name":"…"` and `"version":"…"` values at depth 1, and bail as soon as both are found. `name`/`version` are the first two keys in >99% of published packages, so this typically touches <150 bytes and never allocates. The existing `skip_ws_and_comments`/`skip_string_token` helpers in json.rs already provide the primitives.

**Quantified:** Removes ≈10 heap allocations × N hoisted deps (≈1500 in a typical Next.js-size project) = ~15,000 allocs per warm install, and skips full structural-index + stage-2 parse of ~3-6 MB of JSON. This is the single largest CPU cost of warm install after the unavoidable openat/read/close syscalls.

---

## `src/install/lockfile/Tree.rs:1004`
**Workload:** bun install warm | **Est. impact:** 10-30ms, 15-20M compares removed

**filter()→hoist_dependency does an O(D×H) linear scan over the root tree's dep list on every warm install**

`install_hoisted_packages` unconditionally calls `lockfile.filter()` (src/install/hoisted_install.rs:100) to rebuild the hoisted tree. For each of D dependency edges, `hoist_dependency` recurses up to the root and linearly scans the current tree's placed-dependency list (`for i in 0..this_deps_len { if dep.name_hash != target_name_hash { continue } … }`). The root tree accumulates H≈unique-package-count entries, so most edges pay an O(H) scan, yielding O(D·H) total comparisons — each of which also does a random-access load into `deps[dep_id]` (cache-unfriendly).

**Fix:** Add a `name_hash → index` side-table (e.g. `bun_collections::HashMap<u64,u32>`) to `BuilderEntry` (or at minimum keep one for tree id 0, which dominates). `hoist_dependency` then becomes a single hash lookup per ancestor instead of a linear scan; placement in `process_subtree` inserts into the map alongside the existing `push(dep_id)`.

**Quantified:** Turns O(D·H) into O(D). For a 1500-package project (~15K dep edges, root ~1200 entries) this removes ~15-20 million u64 comparisons + indirect loads from every warm install — roughly 10-30 ms of pure CPU before the link loop even starts.

---

## `src/runtime/server/mod.rs:728`
**Workload:** Bun.serve | **Est. impact:** 1 C++ alloc + 5 FFI per request

**AbortSignal is heap-allocated in C++ unconditionally for every request**

prepare_js_request_context() calls `jsc::AbortSignal::new(global)` on every request. This crosses FFI into `WebCore__AbortSignal__new` (bindings.cpp:5534) which does `WebCore::AbortSignal::create(context)` — a RefCounted C++ heap allocation — then two more FFI hops (`pending_activity_ref()` and `ref_()`). There is no fast-path: the signal is created even when the user never reads `request.signal` and the request completes synchronously without aborting.

**Fix:** Defer AbortSignal creation. Pass `None` to `Request::init` and leave `ctx.signal = None`. Create the signal on first `request.signal` access (Request::get_signal already does this) and have the lazy path also register the pointer back into the live `AnyRequestContext` so `on_abort` can fire it. `on_abort`/`set_signal_aborted` already no-op when `self.signal` is None (RequestContext.rs:618), so a never-observed signal correctly fires nothing. Edge case to cover: if abort happens before first `.signal` access, the lazy getter must return an already-aborted signal (check `ctx.flags.aborted()` when materializing).

---

## `src/runtime/server/RequestContext.rs:3124`
**Workload:** Bun.serve | **Est. impact:** double drain_microtasks per sync response

**drain_microtasks() (and to_blob_if_possible) run twice per synchronous response**

For a handler that returns a Response synchronously, on_response() calls ctx.drain_microtasks() (line 2690) and body_value.to_blob_if_possible() (line 2736), then calls render()→do_render()→do_render_with_body() which immediately calls this.drain_microtasks() (line 3124) and value.to_blob_if_possible() (line 3128) again. No user JS executes between the two drains on this path. drain_microtasks() (is_async()==false on the sync path, so it does not early-return) performs jsc_vm.release_weak_refs() FFI + JSC__JSGlobalObject__drainMicrotasks() FFI + deferred_tasks.run() + uws_loop.drain_quic_if_necessary(). The duplicate exists only to serve the do_render_with_body_locked callback entry point.

**Fix:** Remove the drain_microtasks()/to_blob_if_possible() prologue from do_render_with_body() and move it into do_render_with_body_locked (the only caller that has not already drained). The on_response/handle_resolve → render → do_render path then drains exactly once.

**Quantified:** Per synchronous request: removes 1 redundant drain = ~2-3 FFI calls (release_weak_refs, JSC__JSGlobalObject__drainMicrotasks, drain_quic_if_necessary) plus a redundant to_blob_if_possible() branch. At ~200k req/s, ~400-600k FFI round-trips/sec eliminated.

---

## `src/jsc/bindings/bindings.cpp:1871`
**Workload:** fetch() | **Est. impact:** 2x(O(N^2)+sort+alloc) per request

**Per-fetch() header serialization does 2×(O(N²) lookups + sort + Vector<String> alloc) via spec iterator**

WebCore__FetchHeaders__copyTo (line 1871) and WebCore__FetchHeaders__count (line 1917) both call headers->createIterator() and drain it with iter.next(). FetchHeaders::Iterator is the Fetch-spec sorted iterator: on first next() it heap-allocates a Vector<String> m_keys, copies every header name into it, std::sorts it, then for every subsequent next() it calls m_headers.get(key) which is findHTTPHeaderName (gperf hash) + a linear scan over the common/uncommon vector. A full drain is therefore O(N log N) sort + O(N²) comparisons + N gperf lookups. from_fetch_headers() (src/http_jsc/headers_jsc.rs:31,83) calls count() then copy_to() back-to-back for every outgoing fetch() request (src/runtime/webcore/fetch.rs:1401,1648) and for every StaticRoute/FileRoute response, so each request pays this twice.

**Fix:** copyTo/count do not need spec-sorted order — they just flatten into a byte buffer for the HTTP client. Rewrite both to iterate headers->internalHeaders().commonHeaders(), .uncommonHeaders(), and .getSetCookieHeaders() directly (each entry already carries both key and value). That is O(N) with zero heap allocation, no sort, no gperf re-lookup, and no linear scan per key. The same direct-iteration pattern is already used in writeFetchHeadersToUWSResponse (NodeHTTP.cpp:776-848) and getInternalProperties (JSFetchHeaders.cpp:673-709).

---

## `src/runtime/webcore/fetch/FetchTasklet.rs:2430`
**Workload:** fetch() throughput | **Est. impact:** ~200MB memcpy removed per 100MB

**Per-callback memcpy of body bytes into scheduled_response_buffer (then source is discarded)**

On every HTTP-thread progress callback, `scheduled_response_buffer.write(response_buffer.list.as_slice())` copies the entire chunk, then `response_buffer.reset()` clears the source two lines later. `scheduled_response_buffer` is also never pre-reserved to Content-Length, so Vec doubling adds another ~1× payload of realloc-memcpy. All of this runs under `task_ref.mutex`.

**Fix:** When `scheduled_response_buffer.list.is_empty()` do `core::mem::swap(&mut task_ref.scheduled_response_buffer.list, &mut task_ref.response_buffer.list)` instead of write+reset; only fall back to `extend_from_slice` when coalescing onto non-empty bytes. Additionally `scheduled_response_buffer.list.reserve(content_length)` once from `result.body_size` so the coalescing path doesn't realloc. response_buffer re-grows to one chunk (≤512KB) on the next recv, which is cheap.

**Quantified:** Removes ≈100MB direct memcpy + ≈100MB Vec-growth realloc-memcpy per 100MB fetched (≈200 callbacks × 512KB, all under the tasklet mutex on the HTTP thread). Cuts body-byte copy amplification from 3× payload to ~1× for `await res.arrayBuffer()`.

---

## `src/http/lib.rs:4770`
**Workload:** fetch() throughput | **Est. impact:** bug: BufferAll forced into streaming callbacks

**is_streaming tests body_receive_mode.is_some() instead of the mode value, forcing per-chunk callbacks in BufferAll**

`let is_streaming = self.signals.get(Field::ResponseBodyStreaming) || self.signals.body_receive_mode.is_some();` — fetch() always wires body_receive_mode via `Store::to_with_backpressure()` (Signals.rs:120-124, FetchTasklet.rs:1920), so `.is_some()` is always true and every recv chunk triggers progress_update → FetchTasklet::callback even after the consumer called `.arrayBuffer()`/`.text()` and set `BodyReceiveMode::BufferAll` (i.e. 'just buffer, I don't need chunks').

**Fix:** Load the atomic and treat only AutoPause/Paused as streaming: `let is_streaming = signals.get(Field::ResponseBodyStreaming) || matches!(signals.body_receive_mode_value(), Some(BodyReceiveMode::AutoPause | BodyReceiveMode::Paused));`. When BufferAll/Ignore, accumulate in body_out_str and fire a single progress_update at `is_done` (plus pre-reserve body_out_str to `content_length.min(PREALLOCATE_MAX)` at line 4752 so the accumulation doesn't realloc).

**Quantified:** For `await res.arrayBuffer()` on 100MB: eliminates ≈200 progress_update/FetchTasklet::callback round-trips per download (≈200 mutex lock+unlock, ≈200 sync_progress_from, ≈200 has_schedule_callback CAS) and, combined with the swap above, collapses the HTTP-thread handoff to one move of a 100MB Vec instead of 200×512KB appends.

---

## `src/http/lib.rs:4751`
**Workload:** fetch() throughput | **Est. impact:** ~2N extra memcpy per download

**Body buffer pre-reserves only one packet instead of Content-Length**

In handle_response_body_from_multiple_packets (the per-TCP-read path for Content-Length bodies), the first-packet pre-allocation is `try_reserve_exact(incoming_data.len())` — i.e. one TCP read's worth. Every subsequent packet falls through to `buffer.write(remainder)` → `Vec::extend_from_slice`, which grows by doubling. For an N-byte download that arrives in ~64KB reads this is ~log2(N) reallocs and ~2N bytes of extra memcpy even though `content_length` is known up-front. The guard `incoming_data.len() < PREALLOCATE_MAX` (256 MB) is effectively always true for a socket read, which strongly suggests the intended comparand was `content_length`, not the single-packet length. Verified there is no other pre-reserve for `body_out_str`/`compressed_body` anywhere on this path; the same shape exists in the original Zig (so it is 'battle-tested', but still wasted work on every large download, e.g. `bun install` tarballs).

**Fix:** When the buffer is empty and `content_length` is Some, reserve `content_length.min(PREALLOCATE_MAX)` instead of `incoming_data.len()`:
    if buffer.list.is_empty() {
        let target = content_length.unwrap_or(incoming_data.len()).min(PREALLOCATE_MAX);
        let _ = buffer.list.try_reserve_exact(target);
    }
This removes all mid-download reallocs for responses with a known Content-Length (identity or compressed-accumulate paths).

---

## `src/runtime/test_runner/expect.rs:378`
**Workload:** bun test | **Est. impact:** 2 allocs/assertion discarded on pass

**Per-assertion Vec<u8> heap allocation in Expect::get_value() that is discarded on the happy path**

Expect::get_value() is the shared prelude for nearly every matcher (reached via matcher_prelude() from toBe, toEqual, toStrictEqual, toContain, toHaveLength, toMatch, toMatchObject, toThrow, run_string_affix_matcher, contain_matcher, etc.). On every single assertion it unconditionally calls Output::pretty_fmt_rt(matcher_params_fmt, ...), which internally runs pretty_fmt_runtime() and allocates a fresh Vec<u8> (Vec::with_capacity(fmt.len()*4), ~72 bytes for the common "<green>expected<r>" literal). The rendered buffer is passed into process_promise() as `impl fmt::Display`, but process_promise() only touches it inside the `Promise::Resolves | Promise::Rejects` failure branches; for the overwhelmingly common case (no .resolves/.rejects, `_ => Ok(value)`) the PrettyBuf is never read and is simply dropped. This is a heap allocation + byte-scan per passing assertion.

**Fix:** Defer the ANSI rewrite: pass the raw `matcher_params_fmt: &'static str` through to process_promise() and only call Output::pretty_fmt_rt inside the three error branches that actually format it (the throw_pretty_matcher_error calls). Alternatively, memoize like get_signature() does (there are only ~4 distinct literal values), or wrap it in a lazy Display adapter that calls pretty_fmt_rt on first use. Any of these makes the passing-assertion path allocation-free.

---

Full corpus: 189 findings in `.perf-findings-combined.json`, per-round in `.perf-findings-round{1..5}.json`.