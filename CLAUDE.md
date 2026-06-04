This is the Bun repository - an all-in-one JavaScript runtime & toolkit designed for speed, with a bundler, test runner, and Node.js-compatible package manager. It's written primarily in Rust with C++ for JavaScriptCore integration, powered by WebKit's JavaScriptCore engine.

## Building and Running Bun

### Build Commands

- **Build Bun**: `bun bd`
  - Creates a debug build at `./build/debug/bun-debug`
  - **CRITICAL**: do not set a timeout when running `bun bd`
- **Run tests with your debug build**: `bun bd test <test-file>`
  - **CRITICAL**: Never use `bun test` directly - it won't include your changes
- **Run any command with debug build**: `bun bd <command>`
- **Run with JavaScript exception scope verification**: `BUN_JSC_validateExceptionChecks=1
BUN_JSC_dumpSimulatedThrows=1 bun bd <command>`

Tip: Bun is already installed and in $PATH. The `bd` subcommand is a package.json script.

**All build scripts support build-then-exec.** Any `bun run build*` command (and `bun bd`, and `bun scripts/build.ts` directly) accepts trailing args which are passed to the built executable after building. This is the recommended way to run your build — you never invoke `./build/debug/bun-debug` directly.

```sh
bun bd test foo.test.ts                    # debug build + quiet debug logs
bun run build test foo.test.ts             # debug build
bun run build:release -p 'Bun.version'     # release build
bun run build:local run script.ts          # debug build with local WebKit
```

When exec args are present, build output is suppressed unless the build fails — you see only the binary's output. Build flags (e.g. `--asan=off`) go before the exec args; see `scripts/build.ts` header for the full arg routing rules.

**Comparing builds:** normally use the default `build/<profile>/` dir. If you need to preserve a build as a comparison point (rare — e.g. benchmarking before/after a change), `--build-dir` parks it somewhere the next build won't overwrite:

```sh
bun run build:release --build-dir=build/baseline
```

### Changes that don't require a build

Edits to **TypeScript type declarations** (`packages/bun-types/**/*.d.ts`) do not touch any compiled code, so `bun bd` is unnecessary. The types test just packs the `.d.ts` files and runs `tsc` against fixtures — it never executes your build. Run it directly with the system Bun:

```sh
bun test test/integration/bun-types/bun-types.test.ts
```

This is an explicit exception to the "never use `bun test` directly" rule. There are no native changes for a debug build to pick up, so don't wait on one.

## Testing

### Running Tests

- **Single test file**: `bun bd test test/js/bun/http/serve.test.ts`
- **Fuzzy match test file**: `bun bd test http/serve.test.ts`
- **With filter**: `bun bd test test/js/bun/http/serve.test.ts -t "should handle"`

### Test Organization

**Default: add your test to the existing test file for the code you're changing.** Do not create a new file. A fetch bug goes in `test/js/web/fetch/fetch.test.ts`, a `Bun.serve` bug goes in `test/js/bun/http/serve.test.ts`, and so on. Keeping tests next to related coverage is what makes them discoverable and prevents duplicated setup.

- `test/js/bun/` - Bun-specific API tests (http, crypto, ffi, shell, etc.)
- `test/js/node/` - Node.js compatibility tests
- `test/js/web/` - Web API tests (fetch, WebSocket, streams, etc.)
- `test/cli/` - CLI command tests (install, run, test, etc.)
- `test/bundler/` - Bundler and transpiler tests. Use `itBundled` helper.
- `test/integration/` - End-to-end integration tests
- `test/napi/` - N-API compatibility tests
- `test/v8/` - V8 C++ API compatibility tests

**Exception:** `test/regression/issue/${issueNumber}.test.ts` is reserved for bugs that have a GitHub issue number **and** are true regressions (worked in a previous release, then broke). An issue number alone is not enough — if the behavior was never correct, it's not a regression and the test belongs in the existing file for that module. The issue number must be **REAL**, not a placeholder.

### Writing Tests

Tests use Bun's Jest-compatible test runner with proper test fixtures.

- For **single-file tests**, prefer `-e` over `tempDir`.
- For **multi-file tests**, prefer `tempDir` and `Bun.spawn`.

```typescript
import { test, expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("(single-file test) my feature", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('Hello, world!')"],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"Hello, world!"`);
  expect(exitCode).toBe(0);
});

test("(multi-file test) my feature", async () => {
  // Create temp directory with test files
  using dir = tempDir("test-prefix", {
    "index.js": `import { foo } from "./foo.ts"; foo();`,
    "foo.ts": `export function foo() { console.log("foo"); }`,
  });

  // Spawn Bun process
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Prefer snapshot tests over expect(stdout).toBe("hello\n");
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`"hello"`);

  // Assert the exit code last. This gives you a more useful error message on test failure.
  expect(exitCode).toBe(0);
});
```

- Always use `port: 0`. Do not hardcode ports. Do not use your own random port number function.
- Use `normalizeBunSnapshot` to normalize snapshot output of the test.
- NEVER write tests that check for no "panic" or "uncaught exception" or similar in the test output. These tests will never fail in CI.
- Use `tempDir` from `"harness"` to create a temporary directory. **Do not** use `tmpdirSync` or `fs.mkdtempSync` to create temporary directories.
- When spawning processes, tests should expect(stdout).toBe(...) BEFORE expect(exitCode).toBe(0). This gives you a more useful error message on test failure.
- **CRITICAL**: Do not write flaky tests. Do not use `setTimeout` in tests. Instead, `await` the condition to be met. You are not testing the TIME PASSING, you are testing the CONDITION.
- **CRITICAL**: Verify your test fails with `USE_SYSTEM_BUN=1 bun test <file>` and passes with `bun bd test <file>`. Your test is NOT VALID if it passes with `USE_SYSTEM_BUN=1`.

## Code Architecture

### Language Structure

- **Rust code** (`src/**/*.rs`): Core runtime, JavaScript bindings, bundler, package manager. This is what compiles and ships.
- **C++ code** (`src/jsc/bindings/*.cpp`): JavaScriptCore bindings, Web APIs
- **TypeScript** (`src/js/`): Built-in JavaScript modules with special syntax (see JavaScript Modules section)
- **Generated code**: Many `.rs` and `.cpp` files are auto-generated from `.classes.ts` and other sources. The build regenerates them automatically when their inputs change.

You will see `.zig` files alongside many `.rs` files (e.g. `fetch.zig` next to `fetch.rs`). These are the **original Zig implementation, kept only as a porting reference** — they are **not compiled** and **not shipped**. New code goes in `.rs`. When fixing a bug or porting a behavior, the `.zig` sibling is the source of truth for *intended semantics*: read it, then make the `.rs` match. Never add new behavior to a `.zig` file.

### Core Source Organization

The Rust side is a Cargo workspace of ~200 crates rooted at `Cargo.toml`. The key ones:

#### Foundation crates

- `src/bun_core/` - The `bun.*`-namespace foundation: strings/`String` (`string/`), formatting (`fmt.rs`), logging (`output.rs`), feature flags, env vars, allocator helpers
- `src/sys/` - Cross-platform syscall wrappers (`file.rs`, `dir.rs`, `fd.rs`, `Error.rs`, `tmp.rs`) — the `bun.sys` equivalent
- `src/collections/`, `src/threading/`, `src/paths/`, `src/semver/`, `src/sourcemap/` - shared utilities

#### Runtime Core (`src/`)

- `src/bun_bin/` - Cargo entrypoint; produces `libbun_rust.a`, linked into the final binary
- `src/runtime/cli/` - CLI argument parsing and command dispatch
- `src/js_parser/`, `src/js_printer/` - JavaScript/TypeScript parsing and printing (each is its own crate; the lexer is `src/js_parser/lexer.rs`)
- `src/transpiler/` - Wrapper around the parser/printer with sourcemap support
- `src/resolver/` - Module resolution system
- `src/ast/` - AST node types and arena allocation

#### JavaScript Runtime (`src/jsc/` + `src/runtime/`)

- `src/jsc/bindings/` - C++ JavaScriptCore bindings (generated classes from `.classes.ts` + manual bindings)
- `src/jsc/` - Rust-side JSC glue (`VirtualMachine.rs`, `web_worker.rs`, `event_loop.rs`, FFI imports)
- `src/runtime/api/` - Bun-specific JS-visible APIs (`BunObject.rs`, `JSBundler.rs`, `Glob`, `Archive`, …)
- `src/runtime/server/` - `Bun.serve` HTTP/WebSocket server
- `src/runtime/node/` - Node.js compatibility layer (fs, path, process, Buffer, …)
- `src/runtime/crypto/` - WebCrypto + `node:crypto` (`EVP.rs`, `HMAC.rs`, `CryptoHasher.rs`, …)
- `src/runtime/webcore/` - Web API implementations (`fetch.rs`, `streams.rs`, `Blob.rs`, `Response.rs`, `Request.rs`, …)
- `src/event_loop/` - Event loop and task management

#### Build Tools & Package Manager

- `src/bundler/` - JavaScript bundler (tree-shaking, CSS processing, HTML handling)
- `src/install/` - Package manager (`lockfile/`, `npm.rs` registry client, `lifecycle_script_runner.rs`)

#### Other Key Components

- `src/shell/` - Cross-platform shell implementation
- `src/css/` - CSS parser and processor
- `src/http/` - HTTP client + `websocket_client/` (WebSocket, deflate)
- `src/sql/` - SQL database integrations (Postgres, MySQL, SQLite)
- `src/bake/` - Server-side rendering / dev server framework

#### Vendored Dependencies (`vendor/`)

Third-party C/C++ libraries are vendored locally and can be read from disk (these are not git submodules):

- `vendor/boringssl/` - BoringSSL (TLS/crypto)
- `vendor/brotli/` - Brotli compression
- `vendor/cares/` - c-ares (async DNS)
- `vendor/hdrhistogram/` - HdrHistogram (latency tracking)
- `vendor/highway/` - Google Highway (SIMD)
- `vendor/libarchive/` - libarchive (tar/zip)
- `vendor/libdeflate/` - libdeflate (fast deflate)
- `vendor/libuv/` - libuv (Windows event loop)
- `vendor/lolhtml/` - lol-html (HTML rewriter)
- `vendor/lshpack/` - ls-hpack (HTTP/2 HPACK)
- `vendor/lsqpack/` - ls-qpack (HTTP/3 QPACK)
- `vendor/lsquic/` - lsquic (QUIC / HTTP/3)
- `vendor/mimalloc/` - mimalloc (memory allocator)
- `vendor/nodejs/` - Node.js headers (compatibility)
- `vendor/picohttpparser/` - PicoHTTPParser (HTTP parsing)
- `vendor/tinycc/` - TinyCC (FFI JIT compiler, fork: oven-sh/tinycc)
- `vendor/WebKit/` - WebKit/JavaScriptCore (JS engine)
- `vendor/zig/` - Zig toolchain (legacy; not used by the Rust build)
- `vendor/zlib/` - zlib-ng (compression, zlib-compat mode)
- `vendor/zstd/` - Zstandard (compression)

Build configuration for these is in `scripts/build/deps/*.ts`.

### JavaScript Class Implementation (C++)

When implementing JavaScript classes in C++:

1. Create three classes if there's a public constructor:
   - `class Foo : public JSC::JSDestructibleObject` (if has C++ fields)
   - `class FooPrototype : public JSC::JSNonFinalObject`
   - `class FooConstructor : public JSC::InternalFunction`

2. Define properties using HashTableValue arrays
3. Add iso subspaces for classes with C++ fields
4. Cache structures in `BunGlobalObject`

### Code Generation

Code generation happens automatically as part of the build process. The main scripts are:

- `src/codegen/generate-classes.ts` - Generates Rust & C++ bindings from `*.classes.ts` files
- `src/codegen/generate-jssink.ts` - Generates stream-related classes
- `src/codegen/bundle-modules.ts` - Bundles built-in modules like `node:fs`
- `src/codegen/bundle-functions.ts` - Bundles global functions like `ReadableStream`

In development, bundled JS modules can be reloaded without rebuilding native code by running `bun run build`.

## JavaScript Modules (`src/js/`)

Built-in JavaScript modules use special syntax and are organized as:

- `node/` - Node.js compatibility modules (`node:fs`, `node:path`, etc.)
- `bun/` - Bun-specific modules (`bun:ffi`, `bun:sqlite`, etc.)
- `thirdparty/` - NPM modules we replace (like `ws`)
- `internal/` - Internal modules not exposed to users
- `builtins/` - Core JavaScript builtins (streams, console, etc.)

## Landing PRs: What Bun Reviewers Catch

Distilled from the review history of ~2,500 merged PRs where review feedback led to fix commits. Roughly ordered by review frequency — everything here has blocked merges. This section supplements the build/test rules above. Before writing code that makes a non-obvious choice, pre-emptively ask "why this and not the alternative?" — if you can't answer, research until you can.

### Tests reviewers reject

- **Await conditions, wire failures to reject.** Await the actual observable condition — a promise resolved from the event handler, an ack handshake between processes, a readiness line from child stdout. Wire EVERY failure event (`error`, `close`, `abort`, process exit) to reject the awaited promise so failures surface immediately with a message instead of as an opaque 30s hang. Never throw inside event callbacks — route through reject. Don't reach for a longer per-test timeout argument to make a slow test pass — shrink the workload (and don't strip existing timeouts in passing). Buffer raw socket/stdout chunks to the protocol's framing before asserting — one `data` event is not one message. For negative assertions ("X does not happen"), poll over a bounded window rather than sleep-then-check.
- **Prove the test fails for the RIGHT reason.** Beyond `USE_SYSTEM_BUN=1`: trace the fixture through every earlier guard and threshold, checking real constants in source rather than guessing (a 40-arg input sat under an actual 128-entry limit). Check that OS fast paths (clonefile/CoW, sendfile), error-swallowing APIs (`existsSync`), and build-time fast paths (statically-analyzable `require.resolve`) can't satisfy the test without running your code. Confirm env knobs the test sets are actually read by `src/`. Assert that setup created the precondition — a failed `mkfifo` or silently-skipped server probe can make a test pass forever. Hang-guard tests assert the process exited on its own (`signalCode === null` — valid on Windows too; only asserting a *specific* signal is POSIX-only). Confirm deleting each load-bearing clause of your fix breaks at least one test. A test that passes both ways is worse than no test.
- **Every assertion must be able to fail, and must assert the strongest invariant.** Hunt vacuous patterns: `expect(x).toBe(x)` via shadowed callback params, un-awaited `.rejects`/`.resolves`, expects inside catch blocks or callbacks that may never fire, async arrows passed to `toThrow()` (always passes), loops over possibly-empty collections, conditional assertions accepting multiple outcomes. Assert exact values on normalized output (`normalizeBunSnapshot`, strip unstable values): specific error class/code/message (never bare `toThrow()`), `toBe` over `toContain`, actual bytes not lengths, artifact contents not call success; multi-line output uses `toMatchInlineSnapshot` per the rules above. Read snapshot contents before committing — a snapshot captured from buggy code certifies the bug as expected output. Never combine `--update` with a name filter (it deletes the skipped snapshots).
- **Cover the variant matrix, not just the repro.** Every sibling entry point receiving the same fix (CLI flag AND JS API; direct AND proxy; simple AND streaming AND multipart), both states of every flag including rollback/cleanup of the off state, exact limit boundaries (at the limit succeeds, one past fails), every argument overload, ESM and CJS, alternate modes (`--compile`, `--bytecode`, watch), error paths asserting the specific error, the negative contract (sibling files unmodified, callbacks NOT fired), adversarial inputs for anything parsing user data (malformed bytes, payloads above the 64KB pipe buffer, boundary-straddling chunks). Add new variants ALONGSIDE existing tests — never mutate an existing test's input to the new case, which silently deletes the old coverage.
- **Subprocess tests: drain pipes concurrently.** `Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited])` — an unread pipe fills the ~64KB OS buffer and deadlocks the child; never pipe a stream you don't read. Never assert stderr is exactly empty: ASAN/debug CI builds emit benign startup warnings — filter only exact known noise lines, or assert a combined `{ stdout, stderr, exitCode }` object so the failure diff shows everything. In multi-stage tests, assert each stage's output in order so failures attribute to the step that broke.
- **Tests must be hermetic and leave nothing behind.** Never contact external network hosts or live registries — reproduce the protocol condition with a local in-process server or the repo's container harness; external-endpoint tests get deleted in review regardless of fidelity. Never assert values derived from external moving state. Isolate process-global flags (once-flags, cached capability checks) by running each case in a fresh subprocess. Release every resource via `using`/`await using` or try/finally registered BEFORE the assertions — cleanup placed after expectations leaks on the first failing assertion and poisons later tests on Bun's persistent CI runners. Don't add a manual close alongside `using` (double-dispose). `server.close()` does not terminate live connections. Restore mutated globals in finally.
- **Every behavioral change ships an automated test in the same PR.** "Verified manually", "existing tests cover this" (without naming them), and benchmarks are not accepted as a substitute, even for obviously-correct one-liners. Severity sets the bar: crash fixes need the crashing input as a spawned fixture; UAF/leak fixes need a repro that consistently fails under ASan on the unfixed build, or a leak regression test (`Bun.gc(true)` + `heapStats` objectTypeCounts filtered to the exact leaked type; RSS thresholds need ~2x headroom). Include every reproduction from the linked issue thread. But never add NEW production code solely to make a test writable — fault-injection flags and test-only hooks get the PR blocked; use existing `bun:internal-for-testing` surfaces where they exist, otherwise prove the fix through externally observable behavior.
- **Never silently weaken, skip, or delete an existing test or safety net.** Every deletion needs a stated reason or equivalent replacement; every new skip/todo needs a comment documenting the observed failure (exact error, platform, frequency). When de-flaking, identify the property the original assertion protected and keep asserting it; strengthen the fixture until the strict assertion holds everywhere — branch expectations per-platform rather than dropping precision. Never disable sanitizers, loosen lint/ban-word counters, or weaken CI verification to get green; re-enable everything disabled while debugging. Never "correct" tests that intentionally pass invalid inputs. When changing output, defaults, or error messages, grep the whole suite for assertions relying on the old behavior and update them in the same PR. Un-skip `.todo` tests your fix makes pass — that's the acceptance criterion. Never edit a test to route around a runtime bug it exposed.
- **Copy harness conventions exactly.** Spread `bunEnv` when modifying it (`{...bunEnv, KEY: undefined}`) — sibling tests mutate the shared object. `Buffer.alloc(n, fill).toString()` instead of `"x".repeat(n)` (pathologically slow in debug JSC). `test.each` for matrices; `test.concurrent` for independent subprocess suites (not for huge-memory, elapsed-time, or shared-fixture tests). Prefer `jest.fn()` over boolean flags; async spawns over `spawnSync`. Use harness skip mechanisms with a reason — a bare top-level `return` reports PASSED. Check `harness.ts` for existing platform helpers before writing your own. Keep tests fast: minimal triggering input (~1s budget; debug+ASAN runs 10-100x slower), one server reused across a matrix. A correct but slow test still gets changes-requested.

### Native code: memory safety (the most-blocked category)

- **Pair every acquisition with its release at the acquisition site.** Arm a Drop/RAII guard before any fallible call; disarm only after ownership provably transfers. When you insert a new early return or fallible call, re-audit everything acquired above it; when a struct gains an owning field, wire its release into the owner's Drop/deinit in the same commit — and into ALL lifecycle exits (VM deinit, worker termination, process exit, transfer, explicit close), not just the path you tested. Prefer validate-first-allocate-last so error paths have nothing to clean up. Free each element of a collection, not just the container. Check the SUCCESS path for leaks too.
- **Every allocation has exactly one named owner, released exactly once, with the allocator that allocated it.** Be able to answer "who frees this, when, on which paths, with which allocator" in one sentence — comment the answer when it's non-local, especially across FFI. Arenas, worker-local mimalloc heaps, and per-subsystem allocators are not interchangeable — a mismatch is silent heap corruption. Neutralize the source handle (null/take) at the moment ownership transfers; gate deallocation on an ownership indicator (capacity, owned flag), never a content heuristic; never blanket-free a field that sometimes borrows.
- **Treat all size/index/length arithmetic on external data as adversarial.** Bounds-check the TOTAL bytes of a record before reading fields; re-establish bounds after every re-slice; validate header-derived counts before using them as loop bounds. Size output buffers for worst-case OUTPUT expansion (escaping, U+FFFD replacement) derived from the named limit constant, not input size. Widen before multiplying untrusted quantities so the guard itself can't overflow; checked arithmetic wherever the "larger" operand can be smaller. Clamp kernel/peer-reported lengths to actual capacity. Debug assertions compile out — validation of untrusted input must survive release builds. Zero-init out-params and every slot a GC visitor or destructor can walk: release-only crashes usually mean uninitialized memory; debug-build fill patterns mask the bug.
- **Exception checks after every call that can enter JS.** In C++ JSC and Rust binding code, every call that can throw or run user code — toString/toNumber, getIfPropertyExists, getIndex, coercions, callbacks, even rope-string materialization — needs RETURN_IF_EXCEPTION under a ThrowScope (C++) or JSError propagation (Rust) before its result is used. Return the empty/zero sentinel to JS only when an exception is actually pending, and return a valid value on every path including exception paths. Never call non-throwing accessors (asNumber, jsCast, getDirect) on user-supplied values without validating type first. Never clearException(). Route throwing tail calls through RELEASE_AND_RETURN; don't put check macros inside lambdas. Verify with `BUN_JSC_validateExceptionChecks=1` instead of adding suppression-list entries. Don't add checks to calls that provably cannot throw — use scope.assertNoException() with a comment.
- **Never let a pointer or slice outlive the memory it points into** (unsafe Rust, C++, FFI — where the borrow checker can't help). The classic shapes reviewers reject: slices of stack buffers; pointers into growable containers held across any call that can append (re-fetch by key after the mutating call); network/parser callback buffers stored without cloning (they are reused); `.data()` of a dead temporary; slices of small-string-optimized values (short strings dangle, long ones don't — tests won't catch it); offset views stored in fields cleanup will free; buffers handed to layers that store them past the call without the receiver copying. If background threads reference stack state, every exit path must join them first.
- **Root or copy every JSValue held beyond the current call.** WriteBarrier members declared in `.classes.ts` and visited in visitChildrenImpl (same change); Strong/protect only for justified self-keepalive; MarkedArgumentBuffer for values accumulated across slow calls — never raw JSValues in malloc'd memory or std containers the GC can't scan. A Strong ref does not prevent ArrayBuffer detach; pin() is not a GC root; hasPendingActivity uses a counter, not a boolean; zero-copy toSlice-style helpers return borrowed views to consume synchronously or clone. Prove GC-safety with a stress test (thousands of iterations with `Bun.gc(true)`). Don't add Strong refs or ensureStillAlive calls you can't concretely justify — and don't silently delete existing ones either; a suspected-unneeded ref needs a GC stress test plus an explanation in the PR.
- **Anything that can run user JS can synchronously free your state.** toString/valueOf coercions, getters, Proxy traps, event emits, close() — all of it. Do all coercions first while holding no raw pointers; read mutable state (byteLength, typed-array vectors) exactly once, after all observable side effects; re-validate liveness guards immediately after every callback; copy-and-null stored one-shot callbacks before calling them; bracket entry points that can reach synchronous teardown with ref()/defer deref(); assign state and register listeners BEFORE the call that can trigger them; null member fields before calling close on a local copy — close re-enters via callbacks.
- **Know the thread affinity of every line you touch.** JS-heap operations run only on the JS thread — marshal raw data and enqueue a task; assign shared fields only in the JS-thread completion callback. Atomics for every shared counter (including "just metrics"); compare-and-exchange or Once for one-time init; a mutex only counts if EVERY accessor takes it; benign same-value races are still UB. Copy or `toThreadSafe` strings before another thread touches them; default to seq_cst and comment any weakened ordering. Cross-thread lifetime needs structural guarantees (refcounts) — a "finalized" boolean cannot prevent UAF. Never invoke callbacks while holding a non-recursive lock. Never back per-VM state with globals or thread-locals — workers share them.
- **Reference counts provably balanced on every terminal path** — success, error, cancellation, finalize. Map each ref to a named owner; take a ref only after a fallible enqueue succeeds (or add the error-path deref); never use saturating arithmetic on counts — underflow should trap loudly; never add a ref just to silence ASAN — find the actual imbalance. The released ref may be the last one mid-callback; dropping the final reference while holding the object's own lock is UB.

### Correctness: the bug class, not the bug

- **Fix the whole class in the same PR** (same-class sites are ONE concern, not scope creep). Grep for every sibling site sharing the pattern: parallel switch arms, sync/async and text/binary protocol twins, fast/slow paths, POSIX/Windows branches, SSL/non-SSL variants, copy-pasted blocks in sibling files (look for "keep in sync" comments), every caller of a changed helper. Prefer moving the guard into the shared helper over patching each call site. Ask what OTHER inputs reach the same broken state beyond the repro's trigger. If any site is intentionally excluded, say so explicitly in the PR.
- **Enumerate the input space deliberately.** Empty input, lone `.`, delimiter-only inputs, inputs that become empty after processing, CRLF, IPv6 literals (multiple colons), values at integer max, every accepted spelling of an option (`--flag=v` and `--flag v`). Treat "empty", "zero", and "unset" as three distinct states: gate on presence (`'key' in obj`, `!== undefined`, isNull vs length==0), not truthiness. Use real parsers — never prefix-stripping, regexes, or string-matching heuristics over user-controlled input. When tightening validation, first enumerate every legitimate input class flowing through the path and prove each still passes; new CI failures on your branch are strong evidence the guard is wrong.
- **Every line you add must be demonstrably live.** Trace any flag you gate on through every context that sets it (e.g. `minify_syntax` is on for every `bun run`, not just `bun build`). Trace new state end-to-end to an actual consumer — parsed-but-never-read is a red flag. Check the lines after a new conditional for an unconditional overwrite that no-ops it. Manually exercise the failure path of any checker whose purpose is to fail. Conversely, delete defensive code only when you can show the condition cannot occur — and when a new assertion trips, fix the violating call sites; the trips are the bug list.
- **Verify semantics empirically, never from names or intuition.** Read the implementation of every helper, macro, and sentinel you rely on (toSliceZ does not null-terminate; 0 from a write means backpressure). For protocols, derive behavior from the spec's grammar and MUST clauses — network writes can always be short — and cite the upstream source line for every magic number. For ported code, the reference implementation (esbuild, the `.zig` siblings, Node) is the spec: diff control flow against it before "fixing" apparent bugs; replicate steps that look redundant. For codecs, a self-round-trip proves nothing — broken code encodes and fail-decodes consistently; validate against external known-answer vectors. Settle behavioral disputes by running the scenario and pasting the output.
- **Validate representation at every boundary.** Numbers from JS or the wire: explicitly handle NaN, ±Infinity, negatives, and out-of-range before casting (range checks silently pass NaN; casting NaN to int is UB); compare in the WIDE type, cast last; use coercing conversions (`toInt32(global)`, never `asInt32` on user values); use 64-bit types for byte lengths (buffers exceed 4GB); match loop-counter width to the source length type; decode wire values into non-exhaustive enums. Strings: never run byte-level checks without branching on encoding (JSC 8-bit strings are Latin1, not UTF-8); never compare byte counts against code-unit counts across a conversion; use WTF-8 helpers for lone surrogates (real Windows paths contain them — strict converters panic); test with non-ASCII beyond emoji (CJK, combining characters).
- **Treat every refactor as guilty until proven behavior-preserving.** Diff the old path's complete behavior — out-parameter writes, error-path side effects, condition polarity, effective defaults, operations that were unconditional becoming conditional. Re-read every predicate as a sentence (an inverted timespec check made every spawnSync timeout fire immediately). Test status flags with bitwise-AND, not equality. Audit every individual hit of bulk find-and-replace. Before deleting odd-looking code — explicit memsets, deliberate duplication, unusual casts — git-blame why it was written; it is usually load-bearing. If neighboring code does something differently than you're about to, find out why before deviating.
- **One source of truth; update every consumer atomically.** When a fact lives in two places (mirrored constant tables, encode/decode pairs), derive one from the other or compute it once. When you add an enum variant or struct field, audit every consumer of the type: every switch on the discriminant ("if not X, treat as Y" silently misclassifies new variants), every constructor/clone site (a field set only in the primary constructor is silently zero elsewhere), every hasher/serialization pair (an un-encoded field is silently dropped). When you change a signature or rename, grep the whole repo including cfg-gated code and generated-binding inputs — stale call sites compile fine and silently miss the new behavior.
- **Cache keys cover every input that shapes the output.** Target OS/arch, every baked-in config field, registry of origin; for pooled connections a snapshot of establishment-time state (TLS mode, SNI, credentials — redirects mutate `this.url` mid-lifecycle). A false hit is far worse than a false miss. Completion markers are written only after the last mutation. Any change to cached/serialized output bumps the format version constant in the same PR. File-keyed caches include mtime/size or content hash.

### Error handling

- **Never swallow a failure or signal success on one.** `catch {}`, catch-return-default, discarded I/O results, and unchecked syscall returns convert diagnosable errors into silent corruption. Exit nonzero after printing an error. Never emit artifact paths when the producing write failed; never let a trailing cleanup command be the last statement in a pipeline (it replaces the real exit code). Calibrate loudness to intent: an operation the user explicitly requested fails the whole command on any failure — never warn-and-exit-zero, never a silently degraded result — while best-effort auxiliary steps (hints, optional/peer dependencies) degrade quietly instead of aborting.
- **Error messages are reviewed word-for-word as code.** Name exactly what failed and why: the specific resource (quoted path/URL), the violated constraint with the rejected value echoed back, the underlying system cause (errno, not a generic string), and a concrete remedy listing the valid values. Use user-facing API names, not internal field names. Follow repo voice (no "Please", recovery hints on a `note:` line, quoting via `bun.fmt.quote`). stderr, not stdout. Don't wrap foreign error messages in `new Error()` — the synthesized stack lies about the origin. Re-audit every copy-pasted message for the new context ("in postgres" inside the mysql file). Never genericize a rich existing message during refactors — degrading a message is a blocking bug, fixed by improving the message, not the test.
- **User-reachable failures are recoverable errors, never panics.** Anything reachable from user input, syscalls, network bytes, file contents, CLI args, or env vars must surface as a catchable error — a reachable `unreachable` is release-build UB, and a panic on user input is a DoS. Map unexpected errnos to a real error. Route allocation failure through the OOM handler (`bun_core::handle_oom`) — never absorbed into a generic catch-all arm. Reserve loud descriptive panics for true internal invariants — where they're then required: an "impossible" default branch asserts rather than silently falling through. New invariant checks on existing code default to debug-only unless continuing would corrupt memory — a condition the code previously tolerated must not become a production crash. Don't copy panic-on-error patterns from neighboring legacy code.
- **Every error/abort/timeout path actively completes the operation.** Settle every pending promise slot (an unsettled promise pins objects and hangs callers forever — when adding a new pending-promise slot, grep where siblings are settled on shutdown and add yours). Invoke the done/completion callback on every path. Send protocol cancels; re-arm or clear timers; mirror the success path's release ordering. Set "in-progress"/"sent" flags only after the fallible step succeeds. Do all fallible work before irreversible buffer writes (a half-written packet header desyncs the pooled connection). Move shared setup (abort wiring, listeners) into the operation itself so no dispatch path skips it. Invoke user callbacks through `event_loop.runCallback` so microtasks drain and one throwing callback doesn't skip the rest. Wire failure events to reject any awaited startup signal so it fails fast instead of hanging.
- **Propagate the actual error through typed channels.** Widen the return type and `try` rather than catching locally with a default. Typed errors, never magic sentinels. Route user-facing JS errors through the centralized ErrorCode machinery (`src/jsc/bindings/ErrorCode.ts`, `$ERR_*`) — never inline `new Error` with a hand-assigned `.code`. Pass the original error object through rather than stringifying early (destroys stacks and subclasses). Never substitute a hardcoded error for whatever the callee returned. Map only the specific expected errno (ENOENT) to the benign path and route everything else loud. Returning an error is not triggering recovery: trace where it actually propagates and place validation at the layer whose caller implements the recovery you intend.

### Node/Web compat

- **For `node:*` modules, real Node's observed behavior is the spec** — not docs, @types/node, or intuition. (For Web-standard APIs — fetch, URL, streams — the WHATWG/W3C spec and WPT are the bar instead; Node is not the reference there.) Run the exact scenario under current Node and paste the repro + output in the PR; read the nodejs/node source for the function being emulated and cite permalinks in code comments for every magic constant and counterintuitive choice — "it matches Node" without a link does not unblock a thread. Port bug-for-bug, including grammatically wrong messages; don't modernize or ship accidental extra capabilities. If your fix only works by diverging from Node, suspect the bug is in a different layer. Deliberate divergence is never silent: raise it with reviewers and comment what Node does and why Bun differs.
- **Match Node's full error contract.** The exact `ERR_*` code, the constructor class (TypeError vs RangeError — user code does instanceof), the verbatim message text, the full property set (syscall, errno, the full access path like `options.privateKeyEngine`), the check ORDERING that decides which error wins on doubly-invalid input, and the delivery channel (sync throw vs `error` event vs rejection — for Web APIs the spec dictates this). Use the shared validators (`$ERR_*`, validateString, ErrorCode.ts), never hand-rolled typeof checks. Never validate stricter than Node (extra args don't throw; `{opt: undefined}` equals omitted). Assert `err.code` in tests, not just instanceof.
- **The entire observable surface is compat API.** Property attributes (writable/enumerable/configurable — never tightened for convenience), constructor.name and prototype chains, undocumented underscore internals ecosystem code probes (`_writableState`), documented defaults verbatim (511 not 512), per-instance state where Node uses factories (never module-level singletons — verify with multiple simultaneous instances). Ordering and timing are contract: state mutations relative to event emission are observable because handlers re-enter (set `complete` BEFORE `push(null)`); match sync-vs-nextTick callback timing exactly. If you can't establish Node's exact timing from its source, leave the behavior out rather than approximate. Never let user-visible behavior change as a side effect of unrelated work — dependency upgrades get patched; crashes are never fixed by deleting the feature.
- **The upstream test suite is the bar.** Port Node's own test files (test/js/node/test/parallel/) or WPT instead of hand-writing a small case set; write compat tests with node:test/node:assert so the identical file passes under real Node, and show both outputs. Check whether previously-disabled upstream tests can now be enabled ("does this add any passing node tests?" is a standard review question). Ported upstream files are verbatim-diffable: no edits, not even typos — necessary deviations get an inline comment or upstream-commit citation. Mark known failures in ported suites `test.todo`, never bare `test.skip` — todo flips to a failure when fixed (platform-capability gates still use `test.skipIf` with a reason). Never weaken ported assertions.
- **Port the whole behavior, not the slice the issue mentioned.** Every sibling form (sync/callback/promises — "Don't forget about fs.exists"), the spec's complete enumerations, the full input space the reference accepts (alternative spellings 'IPv4'/'ipv4'/4, fractional and negative numbers — truncate toward zero BEFORE negative-index math, absent-vs-empty distinctions), and real-world values beyond the spec (HTTP 999 exists in the wild). Malformed external input must surface as a catchable error the way Node does — never a panic. Never stub a path with a panic without checking whether real npm packages exercise it.

### API design

- **Make invalid states unrepresentable; declarations exactly as strict as the domain.** Tagged unions over pairs of optionals; two-value enums over bare boolean parameters (nobody can read what a bare `false` means at a call site); explicit Option over in-band sentinels when the sentinel is a legal value; named enums on BOTH sides of FFI, never convention-interpreted ints; owned-vs-borrowed encoded in the type. A cast where the concrete type is statically known is a design smell — change the signature so misuse fails at compile time. Don't over-constrain either: accept every input form that costs nothing; never weaken a type-safety wrapper to silence a compile error — fix the call sites.
- **Manage public surface deliberately, both directions.** Internals behind private symbols or #fields (never underscore identifiers or Symbol.for — user code can forge them); no hidden options in Web-standard APIs; no new globals when an existing namespace fits. Ship no speculative surface: no options nobody asked for ("let someone complain about the lack of it" — an explicit ask in the issue is not speculative) — anything user-reachable becomes de-facto supported forever. But what you DO ship ships complete in the same PR: the natural surfaces for the feature (CLI flag AND programmatic API where both exist), .d.ts types, --help text, docs. Partial surface coverage is blocked at review, not deferred.
- **Every accepted option does what it claims or fails loudly.** Reject values the option cannot honor (a zero or negative where the semantics make it meaningless — not where it's a legal value like a hash seed) at parse time, before any I/O; throw on mutually-exclusive combinations rather than ignoring one; error when an option is accepted in a mode where it can't work; stubs return errors, not empty successes. Distinguish "user explicitly set X" from "X equals the default" before branching on it; undefined means "use the default", null means "explicitly off". Handle every accepted form identically (`--flag value` and `--flag=value`, NO_PROXY and no_proxy).
- **Name from established precedent, in priority order:** Web spec names for Web-standard features (lastModified, not mtime), Node's vocabulary for Node-equivalent features, npm/pnpm/yarn names for package-manager flags. Absent precedent, name for the concrete behavior, never the tool or customer that requested it. Keep camelCase JS options identical across native code, .d.ts, and docs. Public names are forever — propose the convention-matching name first.
- **Never silently break existing users.** Working behavior users plausibly rely on — even undocumented, even spec-noncompliant — cannot be removed or restricted as a side effect ("People use file descriptor numbers. It should be allowed"); the test is whether real code depends on it, not whether docs bless it. No new caps on application-controlled values. Renames of user-facing API keep deprecated aliases. Changing an existing default is a breaking change behind a flag; new behavior-changing options default OFF — if enabling by default breaks any existing test, it breaks users. Explicit user configuration beats newly-added inferred behavior; pin the precedence with a regression test. This contract covers only the user-observable surface: internal native code has no backwards-compat obligation — rename, restructure, and delete non-user-facing code freely.

### Performance: what reviewers block

- **Do each piece of work exactly once; keep the event loop responsive.** Fold new validation into existing loops over the same data — the validation must still happen; what gets blocked is a *separate* O(n) pass when an existing loop already visits the bytes. Combined operations (getIfPropertyExists over has-then-get, getOrPut). Hoist invariant work out of ALL enclosing loop levels (fixes that move it up only one get re-flagged). On per-file/per-entry loops (installs, directory walks), count syscalls — attempt-the-operation-and-branch-on-errno instead of preflight stat/exists probes. Order compound conditions cheapest-first. In production code, no shift()/orderedRemove(0) draining of unbounded queues — accidentally-quadratic use is flagged even on cold paths. Cap bytes per event-loop turn in unbounded write loops. Never run synchronous filesystem calls on the JS thread inside async completion paths.
- **Count the copies and allocations your native code makes.** Write directly into the final destination — never create a temporary and copy, never build a JSString just to read its contents back. Check whether the callee already dupes before duping yourself. Reuse one scratch buffer across loop iterations. Multi-KB scratch comes from the shared pool (`PathBufferPool`), never tens-of-KB stack frames. Preallocate exact capacity when computable. Treat the byte size of frequently-instantiated structs as reviewed: measure `size_of` and state it in the PR; pack bools into existing flag bits; never embed large rarely-used buffers inline.
- **The common case pays zero for rare features.** Gate new allocations, subsystem init, and per-access interception on the precise condition needing them — no Proxies or getOwnPropertySlot hooks on hot paths (defeats inline caching, 10-100x slower); decide once at setup, not per event. Route the disabled case through the pre-existing code path completely unchanged. Gate debug diagnostics behind compile-time flags (`cfg(debug_assertions)`, ASSERT_ENABLED) — an assertion whose condition calls across FFI is NOT compiled out. Fast paths must replicate every observable of the general path (shared-reference identity, state flags/locks, exotic inputs) — verify the precondition covers degenerate inputs or bail to the slow path. Never fix a rare-case bug by adding cost to the hot path.
- **Performance claims need numbers; complexity fixed at the root.** Before/after from the repo's bench suite (`bench/`) covering ALL input classes — both string encodings, short and long inputs; "faster on average" is rejected; must not regress ANY measured case; compare against the previous Bun release and Node. Never port V8/Node micro-optimizations assuming they transfer to JSC ("JavaScriptCore is a different engine. Do you have a benchmark?"). Never change optimization levels, LTO modes, or tuning knobs assuming higher is better — existing settings encode prior measurements. Treat existing perf mechanisms as load-bearing (inline directives, corking flags, odd API variants chosen to skip a copy) — re-add any fast path your rewrite drops. Never cap counts or rate-limit to hide quadratic behavior ("Do not solve quadratic behavior by limiting the count"). Verify complexity claims by doubling inputs and reporting the ratio; adversarially test any memo/cache against inputs that thrash it.
- **JSC binding C++: use the engine's cached fast paths.** LazyClassStructure/cached structures per global — a structure created per instance permanently defeats inline caching. `vm.propertyNames`/BuiltinNames instead of `Identifier::fromString` per call (takes a lock, shows up in profiles). MAKE_STATIC_STRING_IMPL for fixed strings. JSType tag checks over constructor-name comparisons. Internal state in WriteBarrier'd native fields, not observable JS properties. Function-local Meyers singletons over top-level statics. Throw scopes at the top of the function.

### Code style & idioms reviewers enforce

- **In runtime native code, grep for the in-tree helper before hand-writing anything.** File I/O, paths, strings, hashing, formatting, validation, spawning, timers — use the most specific existing helper: `bun.sys`/FD syscall wrappers (never raw std fs/posix — the wrappers preserve errno fidelity and encode platform edge cases), bun_core strings/fmt/Output, shared ref-count helpers (they carry leak tracking), WTF:: containers over std:: in C++ bindings. Being the only file touching a raw primitive is itself a red flag. If you need a new helper, put it on the type that owns the concept; if a maintained equivalent exists in-tree, extend it rather than forking. Verify the helper's actual semantics fit (a sanitizing helper is not a validating one).
- **Match the exact file's local conventions.** The namespace aliases the neighboring lines actually use (a guessed alias can fail to compile on a platform you didn't build), import placement, canonical parameter names, the same error-path sequence as sibling exit sites, formatter output (run it; don't reformat untouched lines). New code is Rust — don't import Zig-era conventions from the `.zig` reference files. Name things truthfully: a function must not match more inputs than its name claims; booleans state the invariant positively; full-teardown names mean full teardown (use detach/release for partial); no numeric-suffix variants (create2); magic numbers become named constants derived from what they describe (`".tgz".len`, not 4) — except identifiers mirroring JS API names keep the JS spelling.
- **Built-in JS modules (`src/js/`) are hot-path code in a hostile environment.** Tamper-resistance: $-prefixed intrinsics and primordial-safe calls (`$isJSArray`, `map.$get`, `$call`), globals captured at module load — user code monkey-patches prototypes; `require` with the `node:` prefix; import from the canonical defining module, not incidental re-exports; never route internal logic through user-overridable machinery (`instanceof` — `Symbol.hasInstance` can throw; `Array.isArray` never `instanceof Array`, cross-realm). Performance: keep heavy requires inside the branch that needs them (`x ??= require(...)`) and reject bot suggestions to hoist them; named functions over inline closures (closures capturing parent scope create leak-prone lexical environments); `Promise.$resolve`/withResolvers over `new Promise` executors; `createFIFO` over `Array#shift` queues; declare every instance field with a default in the class body (late property addition causes hidden-class transitions); cache repeated property reads in locals; loose `== null` for combined null/undefined checks but `===` everywhere else; `process.platform === 'win32'` for platform checks (tree-shaken per platform).
- **Delete dead code in the same PR that makes it dead** (these deletions are required scope, not drive-bys — name them in the description). Superseded implementations after a mid-PR rewrite, helpers whose last caller you rewired, fields nothing reads (plus the writes feeding them), parameters discarded in the body (remove from the signature so call sites stop computing them), guards a new validator makes redundant (a leftover null-check misleads readers into thinking the value can be absent), empty destructors. Public items escape dead-code lints — grep for callers manually. Prefer deleting an unmaintained dead feature over renaming it (renaming launders it into looking maintained).
- **Simplest honest shape; deduplicate within your own diff.** Early returns over else-after-return; `if let`/`?` over null-check-then-unwrap; exhaustive match over equality chains; when a branch matrix grows combinatorially with each new boolean, stop and write the general algorithm. But don't condense working explicit code into clever one-liners, and don't ride file-wide standardization on a focused bugfix. The second time a multi-line block appears in your diff, extract a named helper and use it at EVERY parallel site (N-1 of N is flagged as drift risk). If your fix makes two functions byte-identical, delete one.
- **Comments carry only durable non-obvious content.** Invariants, ownership/lifetime contracts, SAFETY justifications, deliberate deviations from upstream. No narrating what the code does, no bug history, no "we use X because Y was broken" — that belongs in the PR description. Regression tests get exactly one comment: the issue URL. Don't delete existing why-comments in cleanup passes.

### Cross-platform

- **Never assume OS/ABI facts are portable.** errno meanings differ (EPERM is a sharing violation on Windows), event flags differ, Windows env vars are case-insensitive, Windows has no POSIX signals, blocking syscalls retry on EINTR. FFI/ABI: explicit calling conventions on BOTH sides; fixed-width or C-ABI types, never bare int read from c_ulong (LLP64 garbage on Windows); extern declarations diff'd parameter-by-parameter against definitions — they compile cleanly per side and crash only on the platform you didn't build; complete Windows error-translation tables with fallbacks instead of force-unwraps.
- **Platform parity is part of every fix.** When you fix one platform backend (POSIX vs kqueue vs epoll vs libuv), audit every sibling backend for the same defect and apply symmetrically — or state why a backend is unaffected ("kqueue register path is unhandled. You only patched unregister."). A POSIX-only API addition ships its Windows equivalent in the same PR. Enabling a feature on a new platform means grepping every gate, dispatch chain, parallel platform script, test skip, and allowlist. Platform-specific CI failures in files you touched are real merge-blocking bugs, never flakes. Comment WHY on every new platform exclusion.
- **Write tests to pass on every CI platform** (Windows, macOS x64+arm64, Linux glibc and musl). Split on `/\r?\n/` (Windows CRLF); normalize separators in path assertions; never spawn shell builtins (echo, sleep are not programs on Windows — use bunExe() -e); no hardcoded /tmp or /bin; incidental servers bind 127.0.0.1, never ::1 (CI Linux may lack IPv6 — IPv6-specific tests gate on the harness IPv6 helper); exit codes not signal names for "did not crash" (Windows has no signals); when probing a limit, exceed the LARGEST platform limit to trip the guard and stay under the SMALLEST when constructing inputs (macOS PATH_MAX is 1024). Before skipping a platform, verify it genuinely lacks the capability (Windows supports AF_UNIX). Skip narrowly via test.skipIf with a reason; never fix one platform by loosening assertions for all.
- **Decide explicitly: filesystem path or URL-like identifier.** Module specifiers, cache keys, sourcemap paths use forward slashes everywhere (posix path helpers). Filesystem paths use platform path APIs, never literal '/' concatenation. Windows: accept BOTH separators; drive-relative (C:foo) and UNC forms exist; PATH splits on ';'. On POSIX, backslash is a legal filename character. Splitting a posix-normalized string with the platform separator silently no-ops on Windows — feed the other separator style through every new API in tests.
- **Beyond `rust:check-all` (required elsewhere in this file) for platform-gated code:** verify link-time symbol resolution (a POSIX extern must still resolve on Windows even if runtime-gated); audit enum switches duplicated across platform arms; distrust lint sweeps — a cast redundant on your host may be load-bearing on another target. Trick: flip the platform condition locally to force the other branch through the type-checker.

### Architecture & layering

- **Fix bugs at the layer that owns the violated invariant, never where the symptom appears.** If a shared helper produces wrong output, fix the helper, not one call site. Escaping/serialization lives in the output layer that sees every producer. A platform-specific patch for a cross-platform bug is the wrong layer. A downstream null-check or isDead() probe on a possibly-freed object is papering over the defect. Don't take a bug report's suggested fix at face value — verify it's the right layer. Prove the mechanism, don't correlate: "the crash goes away" is not a root cause — reproduce the hypothesized path and be able to explain why the fix works; a fix you can't explain hides an adjacent unhandled case. Before changing anything shared, enumerate every consumer first — crash handlers, --watch restore paths, workers, and the WebSocket client share infrastructure; prefer scoping the change to your one caller via an explicit flag. Never change a Bun-native default to fix Node compatibility — that fix belongs in the node: compat layer.
- **One implementation, in the right place.** Never copy a helper or constant table between modules or between the read and write sides of a format — move to a shared module, or derive mirrored lists from the existing source of truth. When adding a variant of existing behavior, parameterize the existing path rather than cloning a parallel branch; when your change supersedes a mechanism, delete the old path in the same PR — the unfixed twin silently misses every future fix. Place new code in the module that owns the feature, never god files (no new fields on ZigGlobalObject, no bindings in monolithic bindings.cpp). Substantial subsystems get their own globally-unique filename (unique names make CMD+F work). No re-export shim files.
- **Store state on the object whose lifetime matches it.** Per-VM state goes on VirtualMachine/RareData, never process globals or thread-locals (workers share globals; pool threads are reused — a "per-thread" lazy buffer leaks under churn). Per-connection facts live on the socket, never a shared context ("last writer wins" under concurrency was an intermittent TLS race). Reset per-operation state at the start of each use of a reusable object (a flag "only ever set and never reset" made reused HTTP clients skip chunked framing — invisible to single-shot tests). Update every lifecycle method (reset/init/drop/clone) when adding mutable state. Prune bookkeeping keyed by recyclable identifiers (PIDs, fds) on every path that learns of death — stale PID + reuse meant SIGSTOPing an unrelated process. Capture absolute paths at acquisition (cwd changes before cleanup). Don't add fields mirroring recoverable information — compute from the source of truth at use.
- **Use the simplest mechanism the invariants allow.** No vtables when the implementation set is closed at compile time; no bit-packing or lock-free tricks when a stated invariant makes plain code correct; no speculative edge-case handling nobody filed an issue for ("let's wait for someone to file an issue before we add more complexity"). When a heuristic keeps sprouting counterexamples in review, redesign structurally instead of adding tie-breakers. Treat reviewer confusion as a simplification signal: if a maintainer doesn't understand your logic after one explanation, delete or simplify rather than writing a longer justification. New cross-cutting abstractions need maintainer agreement before appearing inside a feature PR.

### Security

- **Validate untrusted input BEFORE any processing, allocation, or side effect.** Verify integrity hashes before extraction; check bounds before base64/decompression allocates; enforce resource limits on bytes actually received, never only a client-declared header. Clamp user-controllable limits (recursion depth, counts) including Infinity and negatives. Attack your own guard with degenerate inputs: empty values that short-circuit a check are bypasses (`.every()` is vacuously true on empty — a blank first Content-Length bypassed smuggling detection); tokens split across read boundaries must still validate. Any string from an archive or lockfile that becomes a path must reject empty, `.`, `..`, NUL, absolute paths, and both separators; lexical containment is defeated by symlinks — re-verify after realpath, prefer O_NOFOLLOW-style atomic flags over check-then-act. Reject embedded NULs in strings passed to C APIs. Never hand-roll security-sensitive parsing — use the hardened in-tree library and replicate the FULL verification path existing clients use (checkServerIdentity with hostname/altnames, not just chain validation).
- **Security checks fail closed and cover every path to the protected effect.** If a check's prerequisite is missing or its setup fails (null TLS handle, OOM), fail the operation — never fall back to a laxer default (a failed custom SSL_CTX must fail the connection, not use the default trust store). Never carry credentials across an https→http downgrade. Key pools/caches on every parameter that influenced establishment; security flags on pooled sessions are monotonic — once tainted, always tainted. When adding a security gate, enumerate every route to the effect (h2/h3, streaming vs buffered, upgrade paths) and enforce through one shared predicate. Never remove a flag you don't understand in a TLS/crypto path.
- **Assume userland is hostile on security-relevant paths.** Prototype-pollution-safe own-property lookups for flags like rejectUnauthorized; merged option objects built with `{ __proto__: null, ... }`; security options read as strict booleans (never `!!`-coerced); never call user-overridable JS methods from native code or builtins — use engine intrinsics.

### Dependencies & vendoring

- **Version bumps are repo-wide, verified operations.** Never merge a pin to an ephemeral artifact (preview tags, unmerged-PR builds) — swap to the merged upstream SHA and verify prebuilt artifacts exist for every platform × flavor before merge. Grep the entire repo for the old version value — build scripts, CI configs, Dockerfiles, and deliberate assertion tables — and update every duplicate in one commit. For vendored bumps: rebase every local patch and verify fetch+patch+compile from a clean state; verify the exact replacement upstream chose before mass-renames (WTF::move, not std::move — a plausible-but-wrong substitution × 300 files cost a 1570-line fixup). Codegen steps declare their input files as dependencies so outputs regenerate; build caches are keyed by compile flags too, not just OS/arch.
- **Adding a dependency is a last resort.** Inline trivial utilities; use the platform's own API or JSC-backed implementation over wrapper packages; every dependency must be traceable to a concrete consumer ("where are they used?"). Include license attribution in the same PR for any copied open-source code. Vendored code (vendor/, WPT fixtures, Node test files) is read-only — no style or typo fixes (copies serve as conformance baselines); exclude vendored dirs from mechanical rewrites. Vendor patches stay small with a comment explaining what upstream behavior they correct, plus the upstream issue link.
- **Dependency ranges follow the audience.** Repo-internal manifests (test fixtures, tooling, CI images) pin exact versions — never ^ or ~, never "tidy" an exact pin into a range. Published packages do the opposite: `*` for @types/node in bun-types, peerDependencies for toolchains users already have, and bundle runtime deps into shipped artifacts — the end-user machine has no node_modules. Overrides/resolutions entries are load-bearing — find out what breakage one prevents before deleting it.

### Docs, types, and comments

- **Sweep the same PR for everything describing the old state.** When behavior, names, or contracts change — including mid-PR pivots — update or delete: comments beyond the hunk, sibling/mirror implementations, JSDoc, "see above" cross-references, READMEs, CLAUDE.md, --help text, error-message hints. A comment contradicting the code is a correctness bug, not a nit — a stale refcount comment invites a future maintainer to "restore" unref() and cause a double-free. Write comments about the code as it now is, never narrating the change.
- **Comments must be load-bearing and true.** Any line correct for a non-obvious reason gets a why-comment: special-case branches (with a triggering input), deliberate deviations from the reference, magic constants (cite the spec line), workarounds (link the upstream issue). When a reviewer asks "is this state possible?" — answer with a code comment, not just a thread reply; articulating the invariant routinely exposes that it doesn't hold. SAFETY comments state the precise invariant and where it's enforced — against every caller — and get re-verified after each refactor. Encode documented preconditions as debug assertions rather than prose.
- **Verify every documentation claim you publish, by execution.** Run each snippet end-to-end exactly as written; fetch every URL; check option names/defaults against the implementation on main; preview rendered markdown (an unbalanced fence swallows everything after it). Replace marketing language with the specific guaranteed property. Never claim full compatibility when partial — enumerate what works. Don't publish claims you haven't verified — verify, scope down, or drop them (an AI-drafted page with unverifiable claims was deleted wholesale, +9/-325). Existing docs you didn't touch are out of scope.
- **TypeScript declarations mirror the runtime exactly, in the same PR.** Declare only what's implemented — verify by running the API, never docs or the PR description; no types for stubbed APIs. Literal unions for fixed string sets (`'A' | 'B' | (string & {})` for open sets); overloads so parameters are only accepted where the runtime accepts them; `prop?: T | undefined` for exactOptionalPropertyTypes; `Uint8Array<ArrayBuffer>` generics (TS 5.9+); new type parameters get defaults so existing call sites compile; no new globals colliding with lib.dom/@types/node (use the Bun namespace); never widen a type or `as any` to silence one call site. No `*/` inside JSDoc (glob patterns break the entire .d.ts parse). Validate by compiling realistic usage in bun-types fixtures under BOTH tsconfigs (with and without DOM).
- **Write JSDoc for a zero-context reader.** Option docs explain what the option DOES — semantics, edge behavior, sentinel meanings (0 = unlimited), when it has no effect, the equivalent CLI flag — never a wordier restatement of the name. The .d.ts JSDoc is the canonical IDE-tooltip surface; constraints documented only in .mdx are invisible at the point of discovery. Security-adjacent examples must be safe to copy verbatim (least privilege, never User=root).

### PR process

- **Re-read your entire diff line-by-line as a reviewer would, before requesting review.** Delete all development residue: debug prints, commented-out code, forced conditionals, scratch files, leftover `.only` and debugging skips (a committed `.only` silently disables every other test in the file in CI), unused imports, AI-generated explanatory padding. Not cleaned up yet → open as draft.
- **Audit the full diff for accidental ride-alongs.** Submodule pointer bumps, lockfile churn from rebases, regenerated snapshots, formatter churn on untouched code, stash leakage. After every merge/rebase with main, re-diff against main: conflict resolution can silently resurrect deleted code or drop your own headline fix while keeping its test (a "one-line test tweak" commit once touched 33 files and reverted the entire production fix). Every file in the diff must be explainable from the PR's stated purpose.
- **The PR description is the permanent squash-commit message — keep it true.** State the root cause and make the exact fixing line identifiable apart from refactoring ("Which line was the fix?"). Name the verifying tests and state they fail on the unfixed build. "Fixes #N" must match the issue's actual repro; a partial fix says so. Re-sync title/description whenever review reworks the change. Every hunk needs an articulable one-sentence justification — pre-empt it in the description or a code comment for anything a reviewer can't explain from context. On large mechanical diffs, leave self-review comments pointing at the load-bearing hunks. Never delete unrelated code, others' TODOs, or debug tooling in passing — deletions your change orphans are required (see "Delete dead code"), but each is intentional and named.
- **Treat every review suggestion — especially from bots — as an unverified hypothesis.** Reproduce or check it against actual API semantics before applying or dismissing. Apply real findings; decline wrong ones in-thread with checkable evidence (file:line, run transcripts) — evidence-backed rebuttals close threads, bare dismissals don't. Never blanket-apply (blindly-applied suggestions have reintroduced known ASAN failures), never resolve threads silently in bulk (a bulk-resolve once swallowed a genuine correctness bug). When a reviewer flags a pattern once, sweep and fix every instance — Jarred leaves one substantive comment then "ditto" on each clone; fixing only the commented line guarantees another round.
- **Green CI on every platform is a hard precondition.** Maintainers file changes-requested reviews consisting solely of "CI is failing". Confirm you changed the implementation that ships (a complete fix to a dormant .zig reference file got the one-line review "redo this PR in Rust"). Regenerate checked-in codegen outputs — again after every rebase. Every failure on your branch but not on main is yours to root-cause; "probably a flake" requires a link to the same failure on main. Check per-job results, not the aggregate icon, and confirm CI actually executed your tests — path filters silently skip them.
- **One concern per PR, scoped to the narrowest change that fixes it.** Fixing every instance of the same bug class is ONE concern (see "Fix the whole class"); drive-by refactors, style cleanups of adjacent code, and vendored upgrades are not. If one part triggers design debate mid-review, carve it out so the uncontroversial part merges. Diff size itself is grounds for changes-requested.
- **Pre-existing bugs surfaced by review: acknowledge, scope, track.** Never silently ignore, never silently widen your diff. State the mechanism in-thread, note your PR doesn't change it, file a tracking issue — "out of scope" without a tracker is not accepted. Exception: if it's the exact bug class your PR claims to eliminate, fix all instances in the same PR ("pre-existing, will follow up" for the same crash class gets "no, fix it.").

## Important Development Notes

1. **Never use `bun test` or `bun <file>` directly** - always use `bun bd test` or `bun bd <command>`. `bun bd` compiles & runs the debug build.
2. **All changes must be tested** - if you're not testing your changes, you're not done.
3. **Get your tests to pass**. If you didn't run the tests, your code does not work.
4. **Follow existing code style** - check neighboring files for patterns
5. **Create tests in the right folder** in `test/` and the test must end in `.test.ts` or `.test.tsx`
6. **Use absolute paths** - Always use absolute paths in file operations
7. **Avoid shell commands** - Don't use `find` or `grep` in tests; use Bun's Glob and built-in tools
8. **Memory management** - Prefer RAII (`Drop`) over manual cleanup. Watch the arena edge case: values allocated in an arena (`Arena<T>`/`bumpalo`) do **not** run `Drop` when the arena is reset — if a type owns a heap allocation or a refcount, it must be freed/deref'd explicitly before the arena resets, mirroring the original Zig `deinit()` order.
9. **Cross-platform** - Run `bun run rust:check-all` to compile across all targets (linux/macos/windows × x64/aarch64) when making platform-specific changes. `#[cfg(...)]`-gated code is not type-checked unless the matching target is built.
10. **Debug builds** - Use `BUN_DEBUG_QUIET_LOGS=1` to disable debug logging, or `BUN_DEBUG_<SCOPE>=1` to enable a specific `bun_core::output` scoped logger
11. **Be humble & honest** - NEVER overstate what you got done or what actually works in commits, PRs or in messages to the user.
12. **Branch names must start with `claude/`** - This is a requirement for the CI to work.

**ONLY** push up changes after running `bun bd test <file>` and ensuring your tests pass.

## Debugging CI Failures

Requires the BuildKite CLI (`brew install buildkite/buildkite/bk`) and a read-scoped token in `BUILDKITE_API_TOKEN`. The repo's `.bk.yaml` sets the org/pipeline so `-p bun` is not needed.

```bash
# Show rendered test-failure output for the current branch's latest build,
# tagged [new] vs [also on main]
bun run ci:errors
bun run ci:errors '#26173'          # or a PR number / URL / branch / build number

# One-screen progress summary (job counts, failed jobs, failing tests so far)
bun run ci:status

# Save full logs for every failed job to ./tmp/ci-<build>/
bun run ci:logs

# Just the build number, for composing with raw `bk`
bun run ci:find
bk job log <job-uuid> -b $(bun run ci:find)

# Watch the current branch's build until it finishes
bun run ci:watch
```

For anything else, use `bk` directly — `bk build list`, `bk api`, `bk artifacts`, etc.

If output from these commands looks wrong — mis-parsed annotation HTML, confusing wording, a field BuildKite changed shape on — fix `scripts/find-build.ts` directly rather than working around it. It's a thin presenter over `bk`; keep it accurate.

## Reading PR Feedback

`gh pr view --comments` is fine for a quick look at the Conversation tab, but it has a footgun worth knowing about: it only returns issue-stream comments and silently omits review summaries and line-level review comments. If a reviewer leaves an inline comment on a specific file line, it will not show up — no error, no hint that anything is missing.

When you want the complete picture — especially when responding to a review or checking whether anyone requested changes — use `bun run pr:comments`. It fetches all three GitHub endpoints (`/issues/N/comments`, `/pulls/N/reviews`, `/pulls/N/comments`) and prints them in one chronological listing, each labelled with its actual type (issue comment, review verdict, line comment, reply, suggestion block).

```bash
bun run pr:comments                    # current branch's PR — XML, resolved threads hidden
bun run pr:comments 28838              # by PR number
bun run pr:comments '#28838'           # also works
bun run pr:comments https://github.com/oven-sh/bun/pull/28838
bun run pr:comments --include-resolved # also show threads already marked resolved

# Machine-readable output for jq pipelines — one object per entry with
# { when, user, tag, state?, suggestion?, location?, body, url?, resolved?, outdated? }.
# Resolved threads and bot noise (robobun's CI status comment, CodeRabbit
# body-level summaries) are filtered out; --include-resolved restores the former.
bun run pr:comments --json | jq '.[] | select(.user == "Jarred-Sumner")'
```
