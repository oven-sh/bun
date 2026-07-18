# Bun performance hunt: findings index

309 unique findings from 326 raw across 8 survey rounds.

| File | Description |
|---|---|
| `perf-findings-TIER-S.md` | The ~13 highest-leverage findings with quantified benchmark impact |
| `perf-findings-BUGS.md` | 7 logic bugs (inverted conditions, infinite loops, missing fast-paths) |
| `perf-findings-summary.md` | All high/high + medium/high, grouped |
| `perf-findings-combined.json` | All 309 unique findings, structured (problem/evidence/fix) |
| `perf-findings-round{1..8}.json` | Raw per-round output |

## All 38 high-impact / high-confidence findings

- `src/resolver/package_json.rs:1293` Exports-map exact-key lookup is a linear scan of Vec<MapEntry>
- `src/resolver/package_json.rs:1656` ESModule::finalize scans path 4x and re-allocates even when no '%' is present
- `src/install/npm.rs:2942` O(V²) publish-time lookup in npm manifest parser
- `src/http/HTTPThread.rs:248` Unused 32KB zeroed heap allocation per HTTP/1.1 request in RequestBodyBuffer
- `src/runtime/server/server_body.rs:3108` H3 request URL built with unsized Vec + redundant copy (per-request)
- `src/css/properties/custom.rs:474` TokenList::parse reallocates via drain().collect() for every value with >=2 tokens
- `src/glob/GlobWalker.rs:2408` bun_join::<true> does 3 allocator round-trips per joined path (to_vec + push-grow + shrink)
- `src/semver/Version.rs:666` parse_version_number re-filters and copies bytes that are already guaranteed all-digit
- `src/runtime/webcore/Blob.rs:4086` FormData file parts are copied twice (read_file buffer cloned into joiner, then freed)
- `src/runtime/shell/states/Expansion.rs:609` Command-substitution stdout buffer is .clone()'d instead of moved
- `src/sql_jsc/mysql/protocol/ResultSet.rs:197` MySQL result rows heap-allocate a fresh Box<[SQLDataCell]> per row
- `src/watcher/WindowsWatcher.rs:446` O(events × watchlist) nested path-compare loop on Windows (acknowledged TODO)
- `src/runtime/test_runner/expect.rs:378` Per-assertion Vec<u8> heap allocation in Expect::get_value() that is discarded on the happy path
- `src/runtime/socket/socket_body.rs:2970` O(N²) memmove draining node:net write buffer under backpressure
- `src/runtime/bake/DevServer.rs:4054` Per-file deep copy of source-map VLQ buffer on every bundle/reload
- `src/router/lib.rs:1565` Route pattern re-parsed byte-by-byte on every match attempt (per-request × per-dynamic-route)
- `src/jsc/bindings/bindings.cpp:1871` Per-fetch() header serialization does 2×(O(N²) lookups + sort + Vector<String> alloc) via spec iterator
- `src/js/internal/sql/shared.ts:971` Per-query full-string toUpperCase()+trim() just to check a prefix in checkUnsafeTransaction
- `src/bun_core/string/identifier.rs:28` lexer::is_identifier() has no ASCII fast path; called for every EDot and object property key
- `src/http/lib.rs:4751` Body buffer pre-reserves only one packet instead of Content-Length
- `src/bun_core/lib.rs:1813` encodeInto(utf16) partial-fill path is pure scalar, no SIMD ASCII fast-path
- `src/sys/lib.rs:6381` openat_a on Windows: redundant 98 KB PathBuffer + memcpy that is immediately discarded
- `src/sys/dir.rs:178` delete_tree: per-entry unlink/open re-copies name into a PathBuffer when a zero-copy ZStr is already available (POSIX)
- `src/runtime/server/mod.rs:728` AbortSignal is heap-allocated in C++ unconditionally for every request
- `src/runtime/server/mod.rs:743` webcore::Request is Box::new'd per request while its siblings are pooled
- `src/jsc/event_loop.rs:543` update_counts() does pointer-chase + arithmetic even when delta == 0
- `src/parsers/json_index.rs:99` StructuralIndex::at() re-bounds-checks self.win[] after the refill gate — LLVM cannot elide it
- `src/runtime/api/bun/h2_frame_parser.rs:2151` HTTP/2 DATA frame queue zero-fills ~16KB per queued write
- `src/runtime/webcore/encoding.rs:825` Buffer.from(str, 'hex') zero-fills output before hex-decoding into it
- `src/jsc/bindings/bindings.cpp:5703` Two heap allocations per Postgres/MySQL date cell in Bun__parseDate
- `src/runtime/api/html_rewriter.rs:169` HTMLRewriter content ops re-validate already-UTF-8 bytes from ZigString::to_slice()
- `src/sql_jsc/shared/ObjectIterator.rs:56` SQL ObjectIterator re-fetches column name via FFI for every cell (rows × columns)
- `src/runtime/server/server_body.rs:3053` Per-request FFI `deprecated_report_extra_memory(sizeof Ctx)` for pooled memory inflates GC counter
- `src/js_parser/visit/visit_stmt.rs:29` stmts_to_list allocates+copies every block/try/switch body where Zig wrapped in-place
- `src/js_parser/visit/visit_expr.rs:2485` e_arrow copies the body stmts twice per arrow function (Zig copied once)
- `src/react_compiler/inference/infer_reactive_places.rs:148` Redundant operand collection inside fixpoint loop (computed twice + extra collect)
- `src/react_compiler/inference/propagate_scope_dependencies_hir.rs:1974` Deep clone of entire inner-function instruction array per nested closure
- `src/js/internal/util/inspect.js:2686` getOwnNonIndexProperties allocates a descriptor object per index for every Array/TypedArray
- `src/install/npm.rs:2342` PackageManifest::parse does ~22 O(n) linear property scans per version instead of one pass
- `src/install/PackageInstall.rs:977` verify() does a full recursive JSON parse (~10 heap allocs) per package just to read name/version
- `src/install/lockfile/Tree.rs:1004` filter()→hoist_dependency does an O(D×H) linear scan over the root tree's dep list on every warm install
- `src/js_printer/renamer.rs:697` NumberRenamer allocates & drops a fresh hashbrown HashMap for every AST scope
- `src/bun_core/string/StringJoiner.rs:91` StringJoiner watcher memmem-scans the entire bundle output for unique_key, but `estimated_count` is never read
- `src/runtime/server/server_body.rs:3061` AbortSignal is heap-allocated for every request even when request.signal is never read
- `src/runtime/server/RequestContext.rs:3124` drain_microtasks() (and to_blob_if_possible) run twice per synchronous response
- `src/runtime/webcore/fetch/FetchTasklet.rs:2430` Per-callback memcpy of body bytes into scheduled_response_buffer (then source is discarded)
- `src/http/lib.rs:4770` is_streaming tests body_receive_mode.is_some() instead of the mode value, forcing per-chunk callbacks in BufferAll
- `src/runtime/test_runner/expect.rs:641` Expect::call() heap-boxes a RefData per expect() whose refcount is never shared
- `src/bunfig/arguments.rs:79` bunfig.toml probed 2-3× per startup when absent
- `src/bundler/options.rs:1790` BundleOptions setup boxes ~120 static-literal strings per startup
- `src/js_printer/lib.rs:3687` Printer re-validates every `.name` with a CodepointIterator walk
- `src/runtime/webcore/blob/read_file.rs:738` **[BUG]** Empty-regular-file fast path on POSIX uses stale `file_store.mode` and never fires for fresh Bun.file()
- `src/runtime/webcore/Blob.rs:5107` **[BUG]** Fast-path guard for stat'd Blob destinations is inverted (checks ==RegularFile instead of !=)
- `src/runtime/webcore/blob/write_file.rs:361` **[BUG]** EAGAIN retry in WriteFile::do_write never re-issues the write() — infinite busy-loop
- `src/runtime/webcore/Body.rs:1796` **[BUG]** response.text() skips the to_blob_if_possible() fast path that json()/arrayBuffer()/bytes() take for already-buffered streams
- `src/jsc/bindings/sqlite/JSSQLStatement.cpp:2229` **[BUG]** Per-write version bump defeats the cached row Structure for every statement on the DB
- `src/js/bun/sqlite.ts:296` **[BUG]** Statement#run() with no args allocates the {changes, lastInsertRowid} object twice
- `src/js/internal/streams/writable.ts:618` **[BUG]** onwrite `needTick` tests kObjectMode bit instead of kDestroyed (operator-precedence bug preserved with Number())