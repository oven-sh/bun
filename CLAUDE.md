This is the Bun repository - an all-in-one JavaScript runtime & toolkit designed for speed, with a bundler, test runner, and Node.js-compatible package manager. It's written primarily in Zig with C++ for JavaScriptCore integration, powered by WebKit's JavaScriptCore engine.

## Building and Running Bun

### Build Commands

- **Build Bun**: `bun bd`
  - Creates a debug build at `./build/debug/bun-debug`
  - **CRITICAL**: do not set a timeout when running `bun bd`
- **Run tests with your debug build**: `bun bd test <test-file>`
  - **CRITICAL**: Never use `bun test` directly - it won't include your changes
- **Run any command with debug build**: `bun bd <command>`

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

### Directory Structure Overview

The codebase is organized so you can **guess where code lives**:

| Task                  | Location                            |
| --------------------- | ----------------------------------- |
| Fix the transpiler    | `src/transpiler/`                   |
| Fix the test runner   | `src/test_runner/`                  |
| Fix the bundler       | `src/bundler/`                      |
| Fix bun install       | `src/install/`                      |
| Fix CSS parsing       | `src/css/`                          |
| Fix the shell         | `src/shell/`                        |
| Fix Postgres          | `src/sql/postgres/`                 |
| Fix MySQL             | `src/sql/mysql/`                    |
| Fix Valkey/Redis      | `src/valkey/`                       |
| Fix S3                | `src/s3/` or `src/buntime/api/s3/`  |
| Fix Bake              | `src/bake/`                         |
| Fix Bun.serve()       | `src/buntime/api/server/`           |
| Fix fetch()           | `src/buntime/web/fetch/`            |
| Fix WebSocket         | `src/buntime/web/websocket/`        |
| Fix node:fs           | `src/buntime/node/fs/`              |
| Fix node:crypto       | `src/buntime/node/crypto/`          |
| Fix crypto.subtle     | `src/buntime/web/webcrypto/`        |
| Fix N-API             | `src/buntime/compat/napi/`          |
| Fix V8 compat         | `src/buntime/compat/v8/`            |

### Language Structure

- **Zig code** (`src/*.zig`): Core runtime, JavaScript bindings, package manager
- **C++ code** (`src/buntime/**/*.cpp`): JavaScriptCore bindings, Web APIs
- **TypeScript** (`src/js/`): Built-in JavaScript modules with special syntax
- **Generated code**: Auto-generated from `.classes.ts` files during build

### Top-Level Source Organization

```
src/
├── transpiler/           # JS/TS transpiler (js_parser, js_lexer, js_printer)
├── test_runner/          # bun:test implementation
├── bundler/              # bun build
├── resolver/             # Module resolution
├── install/              # Package manager (bun install)
├── css/                  # CSS parser
├── shell/                # Bun.$ shell
├── bake/                 # Bake framework
├── sql/                  # SQL clients (postgres/, mysql/)
├── s3/                   # S3 core
├── valkey/               # Valkey/Redis
├── http/                 # HTTP client
├── string/               # String utilities
├── ast/                  # AST types
├── js/                   # TypeScript built-in modules
│
└── buntime/              # JavaScript runtime
    ├── api/              # Bun.* APIs
    │   ├── server/       # Bun.serve()
    │   ├── console/      # console.*
    │   ├── inspector/    # Debugger, profiler
    │   ├── error/        # Error handling, stack traces
    │   ├── cookie/       # Cookie parsing
    │   ├── s3/           # S3 JS bindings
    │   ├── ffi/          # Bun.FFI
    │   ├── sqlite/       # bun:sqlite
    │   ├── sql/          # SQL bindings
    │   ├── shell/        # Shell bindings
    │   ├── ipc/          # IPC
    │   ├── plugin/       # Bundler plugins
    │   ├── secrets/      # Secrets API
    │   └── test/         # Test helpers
    │
    ├── web/              # Web Standards
    │   ├── fetch/        # Fetch API
    │   ├── url/          # URL, URLSearchParams
    │   ├── blob/         # Blob, File, FormData
    │   ├── encoding/     # TextEncoder/Decoder
    │   ├── compression/  # CompressionStream
    │   ├── events/       # EventTarget, CustomEvent
    │   ├── streams/      # ReadableStream, WritableStream
    │   ├── performance/  # Performance API
    │   ├── websocket/    # WebSocket
    │   └── webcrypto/    # crypto.subtle
    │
    ├── node/             # Node.js Compatibility
    │   ├── buffer/       # Buffer
    │   ├── process/      # process.*
    │   ├── vm/           # node:vm
    │   ├── crypto/       # node:crypto
    │   ├── http/         # node:http
    │   ├── fs/           # node:fs helpers
    │   ├── os/           # node:os
    │   ├── path/         # node:path
    │   ├── util/         # node:util
    │   ├── timers/       # Timers
    │   ├── async_hooks/  # AsyncLocalStorage
    │   ├── perf_hooks/   # Performance hooks
    │   └── constants/    # Constants
    │
    ├── compat/           # Native Addon Compatibility
    │   ├── napi/         # N-API
    │   ├── v8/           # V8 C++ API
    │   ├── libuv/        # libuv polyfills
    │   └── windows/      # Windows-specific
    │
    ├── jsc/              # JavaScriptCore Integration
    │   ├── types/        # JSValue, JSString, JSArray, etc.
    │   ├── global/       # ZigGlobalObject, BunGlobalScope
    │   ├── gc/           # GC helpers, weak refs
    │   ├── interop/      # C++/Zig bindings, IDL
    │   └── generated/    # Generated bindings
    │
    ├── module/           # Module system (CommonJS, ESM)
    ├── event_loop/       # Event loop, tasks, timers
    └── core/             # VirtualMachine, config
```

### Code Generation

Code generation happens automatically during build. Main scripts:

- `src/codegen/generate-classes.ts` - Generates Zig & C++ from `*.classes.ts`
- `src/codegen/generate-jssink.ts` - Stream-related classes
- `src/codegen/bundle-modules.ts` - Built-in modules like `node:fs`
- `src/codegen/bundle-functions.ts` - Global functions like `ReadableStream`

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
