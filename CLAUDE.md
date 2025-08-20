This is the Bun repository - an all-in-one JavaScript runtime & toolkit designed for speed, with a bundler, test runner, and Node.js-compatible package manager. It's written primarily in Zig with C++ for JavaScriptCore integration, powered by WebKit's JavaScriptCore engine.

## Building and Running Bun

### Build Commands

- **Build debug version**: `bun bd`
  - Creates a debug build at `./build/debug/bun-debug`
  - **CRITICAL**: DO NOT set a build timeout. Compilation takes ~5 minutes. Be patient.
- **Run tests with your debug build**: `bun bd test <test-file>`
  - **CRITICAL**: Never use `bun test` directly - it won't include your changes
- **Run any command with debug build**: `bun bd <command>`

### Other Build Variants

- `bun run build:release` - Release build

Address sanitizer is enabled by default in debug builds of Bun.

## Testing

### Running Tests

- **Single test file**: `bun bd test test/js/bun/http/serve.test.ts`
- **Fuzzy match test file**: `bun bd test http/serve.test.ts`
- **With filter**: `bun bd test test/js/bun/http/serve.test.ts -t "should handle"`

### Test Organization

- `test/js/bun/` - Bun-specific API tests (http, crypto, ffi, shell, etc.)
- `test/js/node/` - Node.js compatibility tests
- `test/js/web/` - Web API tests (fetch, WebSocket, streams, etc.)
- `test/cli/` - CLI command tests (install, run, test, etc.)
- `test/regression/issue/` - Regression tests (create one per bug fix)
- `test/bundler/` - Bundler and transpiler tests
- `test/integration/` - End-to-end integration tests
- `test/napi/` - N-API compatibility tests
- `test/v8/` - V8 C++ API compatibility tests

### Writing Tests

Tests use Bun's Jest-compatible test runner with proper test fixtures:

```typescript
import { test, expect } from "bun:test";
import {
  bunEnv,
  bunExe,
  normalizeBunSnapshot,
  tempDirWithFiles,
} from "harness";

test("my feature", async () => {
  // Create temp directory with test files
  const dir = tempDirWithFiles("test-prefix", {
    "index.js": `console.log("hello");`,
  });

  // Spawn Bun process
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  // Prefer snapshot tests over expect(stdout).toBe("hello\n");
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`"hello"`);
});
```

- Always use `port: 0`. Do not hardcode ports. Do not use your own random port number function.
- Use `normalizeBunSnapshot` to normalize snapshot output of the test.
- NEVER write tests that check for no "panic" or "uncaught exception" or similar in the test output. That is NOT a valid test.

## Code Architecture

### Language Structure

- **Zig code** (`src/*.zig`): Core runtime, JavaScript bindings, package manager
- **C++ code** (`src/bun.js/bindings/*.cpp`): JavaScriptCore bindings, Web APIs
- **TypeScript** (`src/js/`): Built-in JavaScript modules with special syntax (see JavaScript Modules section)
- **Generated code**: Many files are auto-generated from `.classes.ts` and other sources

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

## Development Workflow

### Code Formatting

- `bun run prettier` - Format JS/TS files
- `bun run zig-format` - Format Zig files
- `bun run clang-format` - Format C++ files

### Watching for Changes

- `bun run watch` - Incremental Zig compilation with error checking
- `bun run watch-windows` - Windows-specific watch mode

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

### Special Syntax in Built-in Modules

1. **`$` prefix** - Access to private properties and JSC intrinsics:

   ```js
   const arr = $Array.from(...);  // Private global
   map.$set(...);                 // Private method
   const arr2 = $newArrayWithSize(5); // JSC intrinsic
   ```

2. **`require()`** - Must use string literals, resolved at compile time:

   ```js
   const fs = require("fs"); // Directly loads by numeric ID
   ```

3. **Debug helpers**:
   - `$debug()` - Like console.log but stripped in release builds
   - `$assert()` - Assertions stripped in release builds
   - `if($debug) {}` - Check if debug env var is set

4. **Platform detection**: `process.platform` and `process.arch` are inlined and dead-code eliminated

5. **Export syntax**: Use `export default` which gets converted to a return statement:
   ```js
   export default {
     readFile,
     writeFile,
   };
   ```

Note: These are NOT ES modules. The preprocessor converts `$` to `@` (JSC's actual syntax) and handles the special functions.

## CI

Bun uses BuildKite for CI. To get the status of a PR, you can use the following command:

```bash
bun ci
```

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
10. **Debug builds** - Use `BUN_DEBUG_QUIET_LOGS=1` to disable debug logging, or `BUN_DEBUG_<scope>=1` to enable specific scopes
11. **Be humble & honest** - NEVER overstate what you got done or what actually works in commits, PRs or in messages to the user.
12. **Branch names must start with `claude/`** - This is a requirement for the CI to work.

## Key APIs and Features

### Bun-Specific APIs

- **Bun.serve()** - High-performance HTTP server
- **Bun.spawn()** - Process spawning with better performance than Node.js
- **Bun.file()** - Fast file I/O operations
- **Bun.write()** - Unified API for writing to files, stdout, etc.
- **Bun.$ (Shell)** - Cross-platform shell scripting
- **Bun.SQLite** - Native SQLite integration
- **Bun.FFI** - Call native libraries from JavaScript
- **Bun.Glob** - Fast file pattern matching
