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

**All build scripts support build-then-exec.** Any `bun run build*` command (and `bun bd`) accepts trailing args which are passed to the built executable after building — you never invoke `./build/debug/bun-debug` directly.

```sh
bun bd test foo.test.ts                    # debug build + quiet debug logs
bun run build test foo.test.ts             # debug build
bun run build:release -p 'Bun.version'     # release build
bun run build:local run script.ts          # debug build with local WebKit
```

When exec args are present, build output is suppressed unless the build fails — you see only the binary's output. Build flags (e.g. `--asan=off`) go before the exec args; see `scripts/build.ts` header for the full arg routing rules.

````

### Changes that don't require a build

Edits to **TypeScript type declarations** (`packages/bun-types/**/*.d.ts`) do not touch any compiled code, so `bun bd` is unnecessary. The types test just packs the `.d.ts` files and runs `tsc` against fixtures — it never executes your build. Run it directly with the system Bun (an explicit exception to the "never use `bun test` directly" rule):

```sh
bun test test/integration/bun-types/bun-types.test.ts
````

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

**Exception:** `test/regression/issue/${issueNumber}.test.ts` is reserved for bugs with a GitHub issue number **and** that are true regressions (worked in a previous release, then broke). If the behavior was never correct, it's not a regression — the test belongs in the existing file for that module. The issue number must be **REAL**, not a placeholder.

### Writing Tests

Tests use Bun's Jest-compatible test runner. For **single-file tests**, prefer spawning with `-e`; for **multi-file tests**, prefer `tempDir` and `Bun.spawn`:

```typescript
import { test, expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

  const [stdout, stderr, exitCode] = await Promise.all([
test("(multi-file test) my feature", async () => {
  using dir = tempDir("test-prefix", {
    "index.js": `import { foo } from "./foo.ts"; foo();`,
    "foo.ts": `export function foo() { console.log("foo"); }`,
  });
  // For a single-file test, use: cmd: [bunExe(), "-e", `console.log("foo")`] and omit cwd.
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
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`"foo"`);

  // Assert the exit code last. This gives you a more useful error message on test failure.
  expect(exitCode).toBe(0);
});
```

- Always use `port: 0`. Do not hardcode ports. Do not use your own random port number function.
- Use `normalizeBunSnapshot` to normalize snapshot output of the test.
- NEVER write tests that check for no "panic" or "uncaught exception" or similar in the test output. These tests will never fail in CI.
- Use `tempDir` from `"harness"` to create a temporary directory. **Do not** use `tmpdirSync` or `fs.mkdtempSync` to create temporary directories.
- When spawning processes, tests should expect(stdout).toBe(...) BEFORE expect(exitCode).toBe(0). This gives you a more useful error message on test failure.
- Keep tests fast: budget roughly 1s per test and 10s per file. Debug+ASAN builds run 10-100x slower than release, so a 1s local test can take a minute in CI. Use `test.concurrent` for independent subprocess-spawning tests.
- Never contact the public internet (registry.npmjs.org, github.com, CDNs). Use `VerdaccioRegistry` from `"harness"` for package installs and a local `Bun.serve({ port: 0 })` for HTTP.
- `setDefaultTimeout` is a ceiling, not a target. Leave the default and pass a per-test timeout only for the rare outlier; a 5-minute file default multiplies across retries when one test hangs.
- Leak tests branch their RSS threshold on `isASAN`/`isDebug` and keep the bound well below what the unfixed leak produces. An un-branched absolute delta flakes under ASAN quarantine and GC jitter.
- **CRITICAL**: Do not write flaky tests. Do not use `setTimeout` or `await sleep(N)` to wait for a condition; poll with a deadline or `await` the event itself. You are not testing the TIME PASSING, you are testing the CONDITION.
- **CRITICAL**: Verify your test fails with `USE_SYSTEM_BUN=1 bun test <file>` and passes with `bun bd test <file>`. Your test is NOT VALID if it passes with `USE_SYSTEM_BUN=1`.

## Code Architecture

### Language Structure

- **Rust code** (`src/**/*.rs`): Core runtime, JavaScript bindings, bundler, package manager. This is what compiles and ships.
- **C++ code** (`src/jsc/bindings/*.cpp`): JavaScriptCore bindings, Web APIs
- **TypeScript** (`src/js/`): Built-in JavaScript modules with special syntax (see JavaScript Modules section)
- **Generated code**: Many `.rs` and `.cpp` files are auto-generated from `.classes.ts` and other sources. The build regenerates them automatically when their inputs change.

### Core Source Organization

The Rust side is a Cargo workspace of ~200 crates rooted at `Cargo.toml`. The key ones:

- `src/bun_core/` - The `bun.*`-namespace foundation: strings/`String` (`string/`), formatting (`fmt.rs`), logging (`output.rs`), feature flags, env vars, allocator helpers
- `src/sys/` - Cross-platform syscall wrappers (`file.rs`, `dir.rs`, `fd.rs`, `Error.rs`, `tmp.rs`) — the `bun.sys` equivalent
- `src/collections/`, `src/threading/`, `src/paths/`, `src/semver/`, `src/sourcemap/` - shared utilities
- `src/bun_bin/` - Cargo entrypoint; produces `libbun_rust.a`, linked into the final binary
- `src/runtime/cli/` - CLI argument parsing and command dispatch
- `src/js_parser/`, `src/js_printer/` - JavaScript/TypeScript parsing and printing (each is its own crate; the lexer is `src/js_parser/lexer.rs`)
- `src/transpiler/` - Wrapper around the parser/printer with sourcemap support
- `src/resolver/` - Module resolution system
- `src/ast/` - AST node types and arena allocation
- `src/jsc/bindings/` - C++ JavaScriptCore bindings (generated classes from `.classes.ts` + manual bindings)
- `src/jsc/` - Rust-side JSC glue (`VirtualMachine.rs`, `web_worker.rs`, `event_loop.rs`, FFI imports)
- `src/runtime/api/` - Bun-specific JS-visible APIs (`BunObject.rs`, `JSBundler.rs`, `Glob`, `Archive`, …)
- `src/runtime/server/` - `Bun.serve` HTTP/WebSocket server
- `src/runtime/node/` - Node.js compatibility layer (fs, path, process, Buffer, …)
- `src/runtime/crypto/` - WebCrypto + `node:crypto` (`EVP.rs`, `HMAC.rs`, `CryptoHasher.rs`, …)
- `src/runtime/webcore/` - Web API implementations (`fetch.rs`, `streams.rs`, `Blob.rs`, `Response.rs`, `Request.rs`, …)
- `src/event_loop/` - Event loop and task management
- `src/bundler/` - JavaScript bundler (tree-shaking, CSS processing, HTML handling)
- `src/install/` - Package manager (`lockfile/`, `npm.rs` registry client, `lifecycle_script_runner.rs`)
- `src/shell/` - Cross-platform shell implementation
- `src/css/` - CSS parser and processor
- `src/http/` - HTTP client + `websocket_client/` (WebSocket, deflate)
- `src/sql/` - SQL database integrations (Postgres, MySQL, SQLite)
- `src/bake/` - Server-side rendering / dev server framework

#### Vendored Dependencies (`vendor/`)

Third-party C/C++ libraries are vendored locally and can be read from disk (not git submodules): boringssl (TLS/crypto), brotli, cares (async DNS), hdrhistogram, highway (SIMD), libarchive (tar/zip), libdeflate, libuv (Windows event loop), lolhtml (HTML rewriter), lshpack (HTTP/2 HPACK), lsqpack + lsquic (HTTP/3), mimalloc (allocator), nodejs (headers), picohttpparser, tinycc (FFI JIT, fork: oven-sh/tinycc), WebKit (JavaScriptCore), zlib (zlib-ng), zstd. Build configuration for these is in `scripts/build/deps/*.ts`.

### JavaScript Class Implementation (C++)

When implementing JavaScript classes in C++:

1. Create three classes if there's a public constructor:
   - `class Foo : public JSC::JSDestructibleObject` (if has C++ fields)
   - `class FooPrototype : public JSC::JSNonFinalObject`
   - `class FooConstructor : public JSC::InternalFunction`
2. Define properties using HashTableValue arrays
3. Add iso subspaces for classes with C++ fields
4. Cache structures in `ZigGlobalObject`

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

The code review rules — what blocks merges, distilled from ~2,500 merged PRs — live in `REVIEW.md`. Read it before writing code that makes a non-obvious choice.

Several situational sections live in `.claude/docs/landing-prs.md` — read the relevant one before the work it covers: **Node/Web compat** (touching `node:*` modules, Web APIs, or `src/runtime/node/`), **API design** (adding or changing user-facing API surface), **Performance** (optimizing, touching hot paths, or making perf claims), **Cross-platform** (platform-gated code, FFI/ABI, or platform-sensitive tests), **Dependencies & vendoring** (bumping deps or touching `vendor/`), **Docs, types, and comments** (docs, `.d.ts`, JSDoc), and **PR process** (opening or responding to a PR).

## Important Development Notes

1. **Never use `bun test` or `bun <file>` directly** - always use `bun bd test` or `bun bd <command>`. `bun bd` compiles & runs the debug build.
2. **All changes must be tested** - if you're not testing your changes, you're not done.
3. **Get your tests to pass**. If you didn't run the tests, your code does not work.
4. **Follow existing code style** - check neighboring files for patterns
5. **Create tests in the right folder** in `test/` and the test must end in `.test.ts` or `.test.tsx`
6. **Use absolute paths** - Always use absolute paths in file operations
7. **Avoid shell commands** - Don't use `find` or `grep` in tests; use Bun's Glob and built-in tools
8. **Memory management** - Prefer RAII (`Drop`) over manual cleanup. Arena edge case: values allocated in an arena (`Arena<T>`/`bumpalo`) do **not** run `Drop` on arena reset — types owning a heap allocation or refcount must be freed/deref'd explicitly first, mirroring the original Zig `deinit()` order.
9. **Cross-platform** - Run `bun run rust:check-all` to compile across all targets (linux/macos/windows × x64/aarch64) when making platform-specific changes. `#[cfg(...)]`-gated code is not type-checked unless the matching target is built.
10. **Debug builds** - Use `BUN_DEBUG_QUIET_LOGS=1` to disable debug logging, or `BUN_DEBUG_<SCOPE>=1` to enable a specific `bun_core::output` scoped logger
11. **Be humble & honest** - NEVER overstate what you got done or what actually works in commits, PRs or in messages to the user.
12. **Branch names must start with `claude/`** - This is a requirement for the CI to work.
13. **If you need a paragraph-long comment to justify why the workaround is OK, the code is wrong — fix the code.**.
14. After every code comment you write, ask yourself, "Is this information the next Claude would spend multiple tool calls trying to understand?". If the answer isn't clearly yes, the code comment is noise - delete it.

**ONLY** push up changes after running `bun bd test <file>` and ensuring your tests pass.

## Debugging CI Failures

Requires the BuildKite CLI (`brew install buildkite/buildkite/bk`) and a read-scoped token in `BUILDKITE_API_TOKEN`. The repo's `.bk.yaml` sets the org/pipeline so `-p bun` is not needed.

```bash
bun run ci:errors    # rendered test-failure output for this branch's latest build, [new] vs [also on main]
bun run ci:errors '#26173'          # or a PR number / URL / branch / build number
bun run ci:status    # one-screen progress summary (job counts, failed jobs, failing tests so far)
bun run ci:logs      # save full logs for every failed job to ./tmp/ci-<build>/
bun run ci:find      # just the build number, e.g. bk job log <job-uuid> -b $(bun run ci:find)
bun run ci:watch     # watch the current branch's build until it finishes
```

For anything else, use `bk` directly — `bk build list`, `bk api`, `bk artifacts`, etc.

If output from these commands looks wrong (mis-parsed annotation HTML, a field BuildKite changed shape on), fix `scripts/find-build.ts` directly rather than working around it — it's a thin presenter over `bk`.

## Reading PR Feedback

`gh pr view --comments` silently omits review summaries and line-level review comments. For the complete picture — especially when responding to a review — use `bun run pr:comments`, which fetches issue comments, reviews, and line comments in one chronological, labelled listing.

```bash
bun run pr:comments                    # current branch's PR — resolved threads hidden
bun run pr:comments 28838              # by PR number; '#28838' and full URLs also work
bun run pr:comments --include-resolved # also show threads already marked resolved

# Machine-readable output for jq pipelines — one object per entry.
# Resolved threads and bot noise (robobun CI status, CodeRabbit summaries) are filtered out.
bun run pr:comments --json | jq '.[] | select(.user == "Jarred-Sumner")'
```
