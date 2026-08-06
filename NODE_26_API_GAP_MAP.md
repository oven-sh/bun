# Node v26.3.0 API gap map

Comparison of Bun main (`5fa371a8d0d8`, reports `process.versions.node = 26.3.0`) against Node v26.3.0
(`nodejs/node` tag `v26.3.0`, plus the real v26.3.0 binary for behavioral ground truth).

Method: re-derived the "added in (24.3.0, 26.3.0]" list from the YAML `added:` blocks in Node's
`doc/api/*.md` (315 raw doc entries), probed every public API against both runtimes with identical
scripts (no flags, and with `--experimental-stream-iter`), verified flag/stability claims against
Node's `lib/` and `src/` sources, and checked ecosystem usage via the repo's vendored test
dependencies plus GitHub code search. Probe scripts are in `node26-gap-probes/` on this branch:
run `probe26.mjs` and `probe-extra.mjs` under any pair of binaries (plain and with
`--experimental-stream-iter`) and diff the JSON; `derive.mjs` re-extracts the added-in-window list
from a Node checkout's `doc/api/`.

## Headline numbers

Of the 97 originally flagged APIs:

- 45 (`node:stream/iter` 29 + `node:zlib/iter` 16) are **already implemented** behind Bun's matching
  `--experimental-stream-iter` flag. Verified byte-identical to Node: all 38 stream/iter exports
  (incl. `Broadcast.from`, `Share.from`, `SyncShare.fromSync`, the 26.1 classic-interop members),
  all 16 zlib/iter transforms (gzip/deflate/brotli/zstd roundtrips pass), identical no-flag error
  codes and ExperimentalWarning text. No issue needed.
- 10 are **doc-only classes Node itself never exports** (`worker_threads.Lock`/`LockManager`,
  `v8.CPUProfileHandle`/`HeapProfileHandle`/`SyncCPUProfileHandle`/`SyncHeapProfileHandle`,
  `diagnostics_channel.BoundedChannelScope`/`RunStoresScope`, `sqlite.SQLTagStore`, and
  `async_context`'s `RunScope`). Verified `undefined` on the real Node binary too. Not gaps.
- 15 are **flag-gated in Node and absent in unflagged Node as well** (`node:ffi` 14 members behind
  `--experimental-ffi`; `process.permission.drop` behind `--permission`). Bun's behavior today is
  identical to unflagged Node, so feature detection is safe; tracked as Tier 3.
- 27 are **real unflagged gaps**, collapsing into 11 issue-sized features (Tier 1/2 below).

The older-added backlog (registerHooks, loadEnvFile, webstorage, util.diff, ...) adds 12 more, and
independent re-derivation found 8 items the original list missed (notably `node:test`'s
`expectFailure`, the WebCrypto modern-algorithms family, and several exists-but-wrong behaviors).

## Tier 1: unflagged in Node, ecosystem pressure or broken feature detection

| # | API | Added | Node status | Bun today | Where it would live | Size |
|---|-----|-------|-------------|-----------|---------------------|------|
| 1 | `module.registerHooks` | 23.5 | unflagged, Stability 1.2 RC | absent | `src/jsc/modules/NodeModuleModule.cpp` + loader seams (`ZigGlobalObject.cpp` moduleLoaderResolve/Fetch, `src/jsc/ModuleLoader.rs`, `JSCommonJSModule.cpp`); reference `lib/internal/modules/customization_hooks.js` | L |
| 2 | `module.register()` silent no-op | 20.6 (deprecated 25.9, DEP0205 in 26.0) | unflagged | present-but-broken | `NodeModuleModule.cpp:866` is `return jsUndefined()`; hooks module never loads | M (S stopgap: warn/throw) |
| 3 | `process.features.typescript` returns `'transform'` | value removed in 26.0 (PR 61803) | Node 26.3 returns `'strip'` \| `false` | present-but-broken | `BunProcess.cpp:4189` (`constructFeatures` hardcodes `"transform"`) | S (needs a semantics decision) |
| 4 | `process.loadEnvFile` | 21.7 (stable since 24.10) | unflagged, stable | absent | `BunProcess.cpp` host fn over `src/dotenv/env_loader.rs` (already powers `--env-file`) | S |
| 5 | `crypto.argon2` / `argon2Sync` always throw | 24.7 | unflagged, Stability 1.2; works on every stock Node 26 binary | present-but-broken (unconditional `ERR_CRYPTO_ARGON2_NOT_SUPPORTED` stub, `src/js/node/crypto.ts:337-345`) | native fn in `src/runtime/node/node_crypto_binding.rs` next to scrypt, computing via the in-tree `rust-argon2` crate that already powers `Bun.password` | M |
| 6 | `navigator.locks` + `worker_threads.locks` (Web Locks) | 24.5 | unflagged, Stability 1 | absent (Bun ships `navigator` without `.locks`) | new `src/js/internal/locks.ts` (port of `lib/internal/locks.js`) + native cross-worker registry modeled on `BunBroadcastChannelRegistry.cpp`; vendored WebKit `Modules/web-locks` as reference | L |
| 7 | `util.getSystemErrorMessage` | 23.1 | unflagged, stable | absent (export slot literally commented out, `src/js/node/util.ts:578`) | host fn in `src/runtime/node/node_util_binding.rs`; message table already exists at `src/sys/libuv_error_map.rs` | S |

Details and evidence:

1. **registerHooks**: vitest 4 gates module mocking and in-source testing on
   `typeof module.registerHooks === "function"` and silently disables them under Bun (it even
   suppresses its own fallback warning when `process.versions.bun` is set). import-in-the-middle
   (the ESM instrumentation layer under OpenTelemetry and dd-trace) selects sync hooks by sniffing
   `process.versions.node`, which Bun reports as 26.3.0, then calls `module.registerHooks` and
   crashes with a TypeError. Static `import { registerHooks } from 'node:module'` is a link-time
   error, so libraries cannot even import the symbol to feature-detect. Reusable seam: `Bun.plugin`
   onResolve/onLoad plumbing; hooks must cover ESM import and native CJS require alike.
2. **register() no-op**: verified end to end: Node prints initialize/resolve/load hook output plus a
   DEP0205 warning; Bun prints nothing, never loads the hooks module, exits 0. `typeof` feature
   detection passes and APM/OTel/dd-trace ESM instrumentation silently records nothing. Minimum
   viable fix is a loud warning (or throw) so tools can fall back; `module.syncBuiltinESMExports`
   and `module._preloadModules` in the same file are also silent no-op stubs.
3. **features.typescript**: ~750 GitHub files feature-detect it, including eslint, jest, nx,
   next.js, apollo-client. Strict `=== 'strip'` checks fail on Bun today. Decision needed:
   `'strip'` matches the Node 26 contract but understates Bun (which transforms enums/namespaces
   that Node's strip mode rejects); `'transform'` is semantically accurate but out of contract.
4. **loadEnvFile**: ~4350 GitHub files use it (fastify-cli, discord-player, swetrix, ...); it is
   the standard dotenv replacement. Parser exists in-tree. One divergence to handle: Bun's .env
   parser expands `$VAR` references, Node's `loadEnvFile` keeps them literal; needs an
   expansion-off compat mode. Throws ENOENT when the file is missing; default path `./.env`.
5. **argon2**: the stub is letter-faithful to a Node built on OpenSSL < 3.2 (and Bun's vendored
   node test suite passes because Bun reports `process.versions.openssl = '1.1.0'`), but every
   official Node 26 binary bundles OpenSSL 3.5+ where argon2 works, so the real-world outcome is
   "works on node, throws on bun" with `typeof` detection passing. Bun already ships a working
   argon2 (`Bun.password`, `src/runtime/crypto/pwhash.rs`, rust-argon2 with secret/associatedData
   support covering Node's full parameter set).
6. **Web Locks**: ~1500 GitHub TS files call `navigator.locks.request` (MetaMask, Grafana,
   Dexie-cloud, novu, coder; the supabase auth-js token-refresh lock is the same pattern).
   Universal libraries feature-detect and silently fall back to weaker locking; direct
   `worker_threads.locks.request()` calls throw. `navigator.locks` and `worker_threads.locks` are
   the same LockManager instance in Node; `Lock`/`LockManager` classes are documented but not
   exported (do not over-export). Locks are process-local, released on worker termination;
   diagnostics_channel events `locks.request.{start,grant,miss,end}`.
7. **getSystemErrorMessage**: js_of_ocaml's unix runtime calls it, so any js_of_ocaml-compiled
   program using that lib breaks on Bun. `util.getSystemErrorMap` (pre-window, also missing, same
   table) should land in the same PR.

## Tier 2: unflagged in Node, small or no observed users yet

| # | API | Added | Node status | Bun today | Where it would live | Size |
|---|-----|-------|-------------|-----------|---------------------|------|
| 8 | `#/`-prefixed `"imports"` subpaths | allowed since 25.4/24.14 (PR 60864) | stable | rejected (`src/resolver/resolver.rs:4849` explicit `starts_with(b"#/") -> NotFound`) | delete the clause, keep rejecting bare `#` and trailing-`/` | S |
| 9 | `diagnostics_channel.withStoreScope` + `boundedChannel`/`BoundedChannel` | 26.1 | unflagged, Stability 1 | absent | `src/js/node/diagnostics_channel.ts`; pure-JS port (~150 lines) over ALS#withScope + DisposableStack, both already working in Bun; 7 portable upstream tests | S |
| 10 | `process.finalization.register/registerBeforeExit/unregister` | 22.5 | unflagged, Stability 1.1 | absent | new `src/js/internal/process/finalization.ts` over beforeExit/exit events already emitted from C++ | S |
| 11 | `process.threadCpuUsage` | 23.9 | unflagged, stable | absent | `BunProcess.cpp`: clone `cpuUsage` validation + the 3-platform per-thread block that already exists at `JSWorker.cpp:867-897` | S |
| 12 | `process.addUncaughtExceptionCaptureCallback` | 25.9 | unflagged, Stability 1 | absent (set-variant exists) | `BunProcess.cpp` next to the set-variant; dispatch at `Bun__handleUncaughtException` | S |
| 13 | `v8.startCpuProfile` | 24.12 | unflagged, stable | absent | `src/js/node/v8.ts` + `NodeV8.cpp` over the existing `BunCPUProfiler.cpp` (already emits V8 `.cpuprofile` JSON for `--cpu-prof` and `worker.startCpuProfile`) | S |
| 14 | `v8.startHeapProfile` | 26.1 | unflagged, Stability 1 | absent | JSC has no allocation-sampling heap profiler; real data is new native work (Bun's `worker.startHeapProfile` precedent returns a valid-but-empty profile) | L (S as stub) |
| 15 | profile handles missing `Symbol.asyncDispose` | 24.8/24.9 | documented `await using` pattern | partial: `worker.startCpuProfile`/`startHeapProfile` return plain `{stop}`; `await using` throws TypeError | `src/js/node/worker_threads.ts:1193-1258` | S |
| 16 | `wasi.finalizeBindings` | 24.4 | unflagged, Stability 1 | absent (Bun's node:wasi is a bundled wasi-js port; also lacks pre-window `initialize()` and `getImportObject()`, bundle into one issue) | `src/js/node/wasi.ts` + `ERR_WASI_ALREADY_STARTED` in `ErrorCode.ts`; ~20 lines mirroring `lib/wasi.js:112-126` | S |
| 17 | `crypto.encapsulate` / `decapsulate` (KEM) | 24.7 | unflagged, Stability 1.2 | absent, but Bun already ships the WebCrypto KEM surface (`subtle.encapsulateBits/Key`, `decapsulateBits/Key`, ML-KEM-768 roundtrip verified) and ml-kem KeyObject keygen | new `CryptoKemJob` modeled on `CryptoDhJob.cpp`; BoringSSL `EVP_PKEY_encapsulate` already proven in `CryptoAlgorithmMLKEM.cpp` | M (ml-kem + x25519 DHKEM; x448 impossible on BoringSSL) |
| 18 | WebCrypto modern algorithms: Argon2id/i/d, cSHAKE128/256, KMAC128/256, KT128/256, TurboSHAKE128/256 | 24.7-25.9 | unflagged, Stability 1.1 | absent; `SubtleCrypto.supports()` (which Bun has) answers honestly `false`, so the documented detection path degrades cleanly | new `CryptoAlgorithm{Argon2,CSHAKE,KMAC,KangarooTwelve,TurboSHAKE}.cpp` modeled on `CryptoAlgorithmMLKEM.cpp`; Argon2 core shared with row 5; Keccak family is the long pole (BoringSSL has SHA3/SHAKE but no cSHAKE/KMAC/K12/TurboSHAKE EVPs) | L |
| 19 | `localStorage` / `sessionStorage` / `Storage` | 22.4, on by default since 25.0 | Stability 1.2 RC; sessionStorage works flagless, localStorage needs `--localstorage-file` | absent (no globals, no flags) | lazy globals in `ZigGlobalObject.cpp`, SQLite-backed Storage reusing `src/jsc/bindings/sqlite/`, interceptor pattern from `JSEnvironmentVariableMap.cpp`, flags in `Arguments.rs` | M |
| 20 | `QuotaExceededError` global class | 26.0 | unflagged, stable (WHATWG: now an interface extending DOMException with `quota`/`requested`) | absent (legacy `new DOMException(msg, 'QuotaExceededError')` name/code-22 path works) | C++ subclass next to `JSDOMException.cpp` + clone tag in `SerializedScriptValue.cpp`; note Bun also lacks the `getRandomValues` 65536-byte cap that is Node's main throw site, do both in one issue | M |
| 21 | `util.diff` | 23.11 | unflagged, Stability 1 | absent | JS port of `lib/internal/util/diff.js`; Bun's Rust assert myersDiff is not drop-in (different op encoding/element type) | S |
| 22 | `module.findPackageJSON` | 23.2 | unflagged, Stability 1.1 | absent | binding in `src/jsc/resolver_jsc.rs` (precedent: `_nodeModulePaths`); resolver already caches package.json per dir; bare-specifier case needs a small dedicated path | M |
| 23 | `module.stripTypeScriptTypes` | 23.2 (26.0 removed `transform` mode) | unflagged, Stability 1.2 | absent | `NodeModuleModule.cpp` + transpiler; exact parity needs position-preserving type blanking (Node guarantees unchanged line/column and rejects enums/namespaces); `Bun.Transpiler` reprints, which breaks that guarantee | M |
| 24 | `http.setGlobalProxyFromEnv` fetch half | 24.14 | unflagged | partial: http/https agent half verified identical to Node; Node additionally reroutes global `fetch()`, Bun's native fetch silently ignores it | process-global proxy override plumbed from `src/js/node/http.ts:84-130` into `src/runtime/webcore/fetch.rs` / `src/http/` | M |
| 25 | `node:test` `context.workerId` | 25.8 | unflagged, stable | partial: getter exists with Node's exact derivation but no Bun runner ever sets `NODE_TEST_WORKER_ID` (always undefined; Node's run() assigns 1..N) | `src/js/node/test.ts:476-480` (set env per spawned child); decide what plain `bun test` reports (Node isolation=none answer is 1) | S |
| 26 | `node:test` `expectFailure` export | 24.14 | unflagged | absent (export diff vs Node verified: Bun's node:test exports everything else) | `src/js/node/test.ts` | S |

## Tier 3: flag-gated in Node, or divergence tracking

| # | API | Node gate | Bun today | Notes | Size |
|---|-----|-----------|-----------|-------|------|
| 27 | `node:ffi` (14 members) | `--experimental-ffi` (+ `--allow-ffi` under `--permission`), Stability 1 | absent; error string and `isBuiltin` behavior exactly match unflagged Node, so detection is safe | shim `src/js/node/ffi.ts` over bun:ffi, gated like `--experimental-stream-iter`; real native gaps: raw dlsym / `dlopen(null)` / lazy resolution (bun dlopen demands >= 1 symbol), bigint pointer returns, write helpers, weak callback refs | L |
| 28 | `inspector.Network.webSocketCreated/...` (3) | functions exported **unconditionally** in Node; `--experimental-network-inspection` gates only delivery + auto-instrumentation | absent entirely (`inspector.Network` undefined), so `typeof` differs from stock Node even flagless | S for argument-validating no-op surface parity; M to actually deliver to CDP frontends via `inspector.open()` path (`BunDebugger.cpp` + `internal/inspector/cdp.ts`); older Network members (22.6-24.3) equally absent | M |
| 29 | `inspector.DOMStorage.*` (5) | same pattern, `--experimental-storage-inspection` | absent | blocked on webstorage (row 19) for real value; stub surface is S after row 28's plumbing | S-M |
| 30 | `--permission` model + `process.permission.drop` | `--permission` | absent; unflagged Node also has `process.permission === undefined`, so detection is safe | full enforcement is XL and cross-cutting; **footgun worth its own issue: Bun silently ignores `--permission` (and other unknown Node flags), so `bun --permission app.js` runs fully unsandboxed with no error**; erroring would be safer until implemented | XL (S for the object, meaningless without enforcement) |
| 31 | `FileHandle.pull/pullSync/writer` leak | `--experimental-stream-iter` in Node (methods undefined without it) | present and functional **without** the flag (over-exposure divergence) | gate them on the existing `createStreamIterEnabledFlag` bit in `fs.promises.ts`; today `typeof fh.pull` is inconsistent with `require('node:stream/iter')` failing | S |
| 32 | bun exposes `node:quic` and `vm.SourceTextModule` unflagged | Node gates behind `--experimental-quic` / `--experimental-vm-modules` | present (quic surface behaviorally verified through a full QUIC+HTTP/3 handshake incl. the 26.2/26.3 members) | deliberate Bun convention; listed for awareness, not action | - |

## Not actually gaps (false positives in the original 97)

Verified against the real Node v26.3.0 binary and `lib/`/`src/` sources:

- `worker_threads.Lock`, `worker_threads.LockManager`: documented classes, never exported by Node
  (`lib/worker_threads.js` exports only `locks`).
- `v8.CPUProfileHandle`, `HeapProfileHandle`, `SyncCPUProfileHandle`, `SyncHeapProfileHandle`:
  return-value-only classes, not exports. The real gaps are the two `v8.start*Profile` functions.
- `diagnostics_channel.BoundedChannelScope`, `RunStoresScope`: reachable only via
  `boundedChannel().withScope()` / `channel.withStoreScope()`, never exported by name.
- `sqlite.SQLTagStore`: Node documents the class but does not export it either;
  `db.createTagStore()` instances in Bun pass all behavioral checks (run/get/all/iterate/clear,
  size/capacity/db). Exact parity. If Node ever exports it, it is a one-line put in
  `NodeSqliteModule.h` (constructor class already exists).
- `node:async_context` / `RunScope`: no such module exists in Node (the md file is the doc chapter
  for `node:async_hooks`); `RunScope` is unexported there too. Bun's `AsyncLocalStorage#withScope`
  returns a working disposable `RunScope` identical to Node's, including `constructor.name`.
- `process.addUncaughtExceptionCaptureCallback` has no `remove*` counterpart in Node 26.3 (none
  documented, none in lib); the add-variant semantics: auxiliary callbacks run most-recent-first
  only when no primary set-callback exists; `true` return suppresses default handling.
- `sqlite.DatabaseSync#limits` (flagged by our own re-derivation, not the original list): false
  negative; it is an instance-level lazy accessor (absent from the prototype in Node too) and is
  fully implemented and tested in Bun, all 11 limit keys behavior-identical.

## Verified present (in-window additions Bun already has, spot-checked behaviorally)

All compared side by side against the real Node binary, not just `typeof`: `node:quic` surface
(full HTTP/3 handshake; `session.opened/closing/applicationOptions`, `stream.headers/sendHeaders`,
`QuicError` BigInt coercion, `endpoint.maxConnectionsPerHost`), `node:test` 26.x context members
(`attempt`/`tags`/`passed`, `getTestContext`, SuiteContext), WebCrypto `SubtleCrypto.supports` +
ML-KEM-768 encapsulate/decapsulate roundtrip, `http.ServerResponse#writeInformation` (repeated
1xx verified), `http.IncomingMessage#signal`, `setGlobalProxyFromEnv` agent half, `fs.Utf8Stream`,
`fsPromises.mkdtempDisposable` + sync variant, `net` socket TOS get/set, `vm.SourceTextModule#
hasAsyncGraph/hasTopLevelAwait`, `stream/consumers.bytes` (plain Uint8Array, not Buffer),
`perf_hooks.eventLoopUtilization/timerify` top-level aliases, `crypto.randomUUIDv7` (valid v7,
timestamp embedding), `x509.signatureAlgorithm(+Oid)`, and the three new N-API functions
(`node_api_create_external_sharedarraybuffer`, `node_api_create_object_with_properties`,
`node_api_set_prototype`: real implementations in `napi.cpp` with exported symbols).

Sibling gaps noticed during verification: Bun lacks `Ed448` and `ML-KEM-512` where Node has them
(ML-DSA-44, ML-KEM-768/1024, SHA3-256 all work).

## Cross-cutting hazard

Bun reports `process.versions.node = 26.3.0`. Every library that version-sniffs instead of
feature-detecting (import-in-the-middle is the highest-profile case) will assume all of the above
exists. The exists-but-wrong set (rows 2, 3, 5) is worse than absence for exactly this reason:
`typeof` checks pass and the failure is silent or a crash at call time. Those three plus row 1 are
the recommended first issues to file.
