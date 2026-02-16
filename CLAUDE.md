This is the Bun repository - an all-in-one JavaScript runtime & toolkit designed for speed, with a bundler, test runner, and Node.js-compatible package manager. It's written primarily in Zig with C++ for JavaScriptCore integration, powered by WebKit's JavaScriptCore engine.

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

## Testing

### Running Tests

- **Single test file**: `bun bd test test/js/bun/http/serve.test.ts`
- **Fuzzy match test file**: `bun bd test http/serve.test.ts`
- **With filter**: `bun bd test test/js/bun/http/serve.test.ts -t "should handle"`

### Test Organization

If a test is for a specific numbered GitHub Issue, it should be placed in `test/regression/issue/${issueNumber}.test.ts`. Ensure the issue number is **REAL** and not a placeholder!

If no valid issue number is provided, find the best existing file to modify instead, such as;

- `test/js/bun/` - Bun-specific API tests (http, crypto, ffi, shell, etc.)
- `test/js/node/` - Node.js compatibility tests
- `test/js/web/` - Web API tests (fetch, WebSocket, streams, etc.)
- `test/cli/` - CLI command tests (install, run, test, etc.)
- `test/bundler/` - Bundler and transpiler tests. Use `itBundled` helper.
- `test/integration/` - End-to-end integration tests
- `test/napi/` - N-API compatibility tests
- `test/v8/` - V8 C++ API compatibility tests

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

- **Zig code** (`src/*.zig`): Core runtime, JavaScript bindings, package manager
- **C++ code** (`src/bun.js/bindings/*.cpp`): JavaScriptCore bindings, Web APIs
- **TypeScript** (`src/js/`): Built-in JavaScript modules with special syntax (see JavaScript Modules section)
- **Generated code**: Many files are auto-generated from `.classes.ts` and other sources. Bun will automatically rebuild these files when you make changes to them.

### Core Source Organization

#### Runtime Core (`src/`)

- `bun.zig` - Main entry point
- `cli.zig` - CLI command orchestration
- `js_parser.zig`, `js_lexer.zig`, `js_printer.zig` - JavaScript parsing/printing
- `transpiler.zig` - Wrapper around js_parser with sourcemap support
- `resolver/` - Module resolution system
- `allocators/` - Custom memory allocators for performance

#### JavaScript Runtime (`src/bun.js/`)

- `bindings/` - C++ JavaScriptCore bindings
  - Generated classes from `.classes.ts` files
  - Manual bindings for complex APIs
- `api/` - Bun-specific APIs
  - `server.zig` - HTTP server implementation
  - `FFI.zig` - Foreign Function Interface
  - `crypto.zig` - Cryptographic operations
  - `glob.zig` - File pattern matching
- `node/` - Node.js compatibility layer
  - Module implementations (fs, path, crypto, etc.)
  - Process and Buffer APIs
- `webcore/` - Web API implementations
  - `fetch.zig` - Fetch API
  - `streams.zig` - Web Streams
  - `Blob.zig`, `Response.zig`, `Request.zig`
- `event_loop/` - Event loop and task management

#### Build Tools & Package Manager

- `src/bundler/` - JavaScript bundler
  - Advanced tree-shaking
  - CSS processing
  - HTML handling
- `src/install/` - Package manager
  - `lockfile/` - Lockfile handling
  - `npm.zig` - npm registry client
  - `lifecycle_script_runner.zig` - Package scripts

#### Other Key Components

- `src/shell/` - Cross-platform shell implementation
- `src/css/` - CSS parser and processor
- `src/http/` - HTTP client implementation
  - `websocket_client/` - WebSocket client (including deflate support)
- `src/sql/` - SQL database integrations
- `src/bake/` - Server-side rendering framework

### JavaScript Class Implementation (C++)

When implementing JavaScript classes in C++:

1. Create three classes if there's a public constructor:
   - `class Foo : public JSC::JSDestructibleObject` (if has C++ fields)
   - `class FooPrototype : public JSC::JSNonFinalObject`
   - `class FooConstructor : public JSC::InternalFunction`

2. Define properties using HashTableValue arrays
3. Add iso subspaces for classes with C++ fields
4. Cache structures in ZigGlobalObject

### Code Generation

Code generation happens automatically as part of the build process. The main scripts are:

- `src/codegen/generate-classes.ts` - Generates Zig & C++ bindings from `*.classes.ts` files
- `src/codegen/generate-jssink.ts` - Generates stream-related classes
- `src/codegen/bundle-modules.ts` - Bundles built-in modules like `node:fs`
- `src/codegen/bundle-functions.ts` - Bundles global functions like `ReadableStream`

In development, bundled modules can be reloaded without rebuilding Zig by running `bun run build`.

## JavaScript Modules (`src/js/`)

Built-in JavaScript modules use special syntax and are organized as:

- `node/` - Node.js compatibility modules (`node:fs`, `node:path`, etc.)
- `bun/` - Bun-specific modules (`bun:ffi`, `bun:sqlite`, etc.)
- `thirdparty/` - NPM modules we replace (like `ws`)
- `internal/` - Internal modules not exposed to users
- `builtins/` - Core JavaScript builtins (streams, console, etc.)

## Important Development Notes

1. **Never use `bun test` or `bun <file>` directly** - always use `bun bd test` or `bun bd <command>`. `bun bd` compiles & runs the debug build.
2. **All changes must be tested** - if you're not testing your changes, you're not done.
3. **Get your tests to pass**. If you didn't run the tests, your code does not work.
4. **Follow existing code style** - check neighboring files for patterns
5. **Create tests in the right folder** in `test/` and the test must end in `.test.ts` or `.test.tsx`
6. **Use absolute paths** - Always use absolute paths in file operations
7. **Avoid shell commands** - Don't use `find` or `grep` in tests; use Bun's Glob and built-in tools
8. **Memory management** - In Zig code, be careful with allocators and use defer for cleanup
9. **Cross-platform** - Run `bun run zig:check-all` to compile the Zig code on all platforms when making platform-specific changes
10. **Debug builds** - Use `BUN_DEBUG_QUIET_LOGS=1` to disable debug logging, or `BUN_DEBUG_<scopeName>=1` to enable specific `Output.scoped(.${scopeName}, .visible)`s
11. **Be humble & honest** - NEVER overstate what you got done or what actually works in commits, PRs or in messages to the user.
12. **Branch names must start with `claude/`** - This is a requirement for the CI to work.

**ONLY** push up changes after running `bun bd test <file>` and ensuring your tests pass.

## Debugging CI Failures

Use `scripts/buildkite-failures.ts` to fetch and analyze CI build failures:

```bash
# View failures for current branch
bun run scripts/buildkite-failures.ts

# View failures for a specific build number
bun run scripts/buildkite-failures.ts 35051

# View failures for a GitHub PR
bun run scripts/buildkite-failures.ts #26173
bun run scripts/buildkite-failures.ts https://github.com/oven-sh/bun/pull/26173

# Wait for build to complete (polls every 10s until pass/fail)
bun run scripts/buildkite-failures.ts --wait
```

The script fetches logs from BuildKite's public API and saves complete logs to `/tmp/bun-build-{number}-{platform}-{step}.log`. It displays a summary of errors and the file path for each failed job. Use `--wait` to poll continuously until the build completes or fails.
