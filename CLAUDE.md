# TASK

Your task is to convert zig 'extern fn's into using the new cpp bindings generator. Convert a few functions, then build bun to make sure there are no errors (`bun bd`), then commit your changes. Repeat.

Here is an example of converting nothrow functions:

```
commit 1c7344abad77307629010bea8501046b432544c7
Author: pfg <pfg@pfg.pw>
Date:   Thu Jul 10 18:43:15 2025 -0700

    example conversion: nothrow

diff --git a/src/ast/Expr.zig b/src/ast/Expr.zig
index d3939cd938..bb52dbdbf8 100644
--- a/src/ast/Expr.zig
+++ b/src/ast/Expr.zig
@@ -3188,14 +3188,12 @@ pub fn StoredData(tag: Tag) type {
     };
 }

-extern fn JSC__jsToNumber(latin1_ptr: [*]const u8, len: usize) f64;
-
 fn stringToEquivalentNumberValue(str: []const u8) f64 {
     // +"" -> 0
     if (str.len == 0) return 0;
     if (!bun.strings.isAllASCII(str))
         return std.math.nan(f64);
-    return JSC__jsToNumber(str.ptr, str.len);
+    return bun.cpp.JSC__jsToNumber(&str.ptr[0], str.len);
 }

 // @sortImports
diff --git a/src/bun.js/bindings/DoubleFormatter.cpp b/src/bun.js/bindings/DoubleFormatter.cpp
index 82266076a2..a0e096d859 100644
--- a/src/bun.js/bindings/DoubleFormatter.cpp
+++ b/src/bun.js/bindings/DoubleFormatter.cpp
@@ -8,7 +8,7 @@ using namespace WTF;

 /// Must be called with a buffer of exactly 124
 /// Find the length by scanning for the 0
-extern "C" size_t WTF__dtoa(char* buf_124_bytes, double number)
+extern "C" [[ZIG_EXPORT(nothrow)]] size_t WTF__dtoa(char* buf_124_bytes, double number)
 {
     NumberToStringBuffer& buf = *reinterpret_cast<NumberToStringBuffer*>(buf_124_bytes);
     return WTF::numberToStringAndSize(number, buf).size();
@@ -17,7 +17,7 @@ extern "C" size_t WTF__dtoa(char* buf_124_bytes, double number)
 /// This is the equivalent of the unary '+' operator on a JS string
 /// See https://262.ecma-international.org/14.0/#sec-stringtonumber
 /// Grammar: https://262.ecma-international.org/14.0/#prod-StringNumericLiteral
-extern "C" double JSC__jsToNumber(char* latin1_ptr, size_t len)
+extern "C" [[ZIG_EXPORT(nothrow)]] double JSC__jsToNumber(const char* latin1_ptr, size_t len)
 {
     return JSC::jsToNumber(WTF::StringView(latin1_ptr, len, true));
 }
diff --git a/src/fmt.zig b/src/fmt.zig
index 2ecd2ce4d0..270bf3f2e4 100644
--- a/src/fmt.zig
+++ b/src/fmt.zig
@@ -1692,10 +1692,8 @@ pub fn double(number: f64) FormatDouble {
 pub const FormatDouble = struct {
     number: f64,

-    extern fn WTF__dtoa(buf_124_bytes: *[124]u8, number: f64) usize;
-
     pub fn dtoa(buf: *[124]u8, number: f64) []const u8 {
-        const len = WTF__dtoa(buf, number);
+        const len = bun.cpp.WTF__dtoa(&buf.ptr[0], number);
         return buf[0..len];
     }

@@ -1704,7 +1702,7 @@ pub const FormatDouble = struct {
             return "-0";
         }

-        const len = WTF__dtoa(buf, number);
+        const len = bun.cpp.WTF__dtoa(&buf.ptr[0], number);
         return buf[0..len];
     }

```

Here is an example of converting a zero_is_throw function:

```
commit 9cc95f9fef1839f6c947c4c5944a964c12a2d8db
Author: pfg <pfg@pfg.pw>
Date:   Thu Jul 10 18:42:09 2025 -0700

    example conversion: fromJSHostCall

diff --git a/src/bun.js/bindings/BunString.cpp b/src/bun.js/bindings/BunString.cpp
index 06dd56be67..16a45bc5fd 100644
--- a/src/bun.js/bindings/BunString.cpp
+++ b/src/bun.js/bindings/BunString.cpp
@@ -84,7 +84,7 @@ extern "C" BunString BunString__tryCreateAtom(const char* bytes, size_t length)
     return { BunStringTag::Dead, {} };
 }

-extern "C" JSC::EncodedJSValue BunString__createUTF8ForJS(JSC::JSGlobalObject* globalObject, const char* ptr, size_t length)
+extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue BunString__createUTF8ForJS(JSC::JSGlobalObject* globalObject, const char* ptr, size_t length)
 {
     auto& vm = JSC::getVM(globalObject);
     auto scope = DECLARE_THROW_SCOPE(vm);
diff --git a/src/string.zig b/src/string.zig
index 8fcd3d3cfb..71eedfb97d 100644
--- a/src/string.zig
+++ b/src/string.zig
@@ -837,11 +837,10 @@ pub const String = extern struct {
     extern fn BunString__toJSDOMURL(globalObject: *JSC.JSGlobalObject, in: *String) JSC.JSValue;
     extern fn Bun__parseDate(*JSC.JSGlobalObject, *String) f64;
     extern fn BunString__toWTFString(this: *String) void;
-    extern fn BunString__createUTF8ForJS(globalObject: *JSC.JSGlobalObject, ptr: [*]const u8, len: usize) JSC.JSValue;

     pub fn createUTF8ForJS(globalObject: *JSC.JSGlobalObject, utf8_slice: []const u8) bun.JSError!JSC.JSValue {
         JSC.markBinding(@src());
-        return bun.jsc.fromJSHostCall(globalObject, @src(), BunString__createUTF8ForJS, .{ globalObject, utf8_slice.ptr, utf8_slice.len });
+        return bun.cpp.BunString__createUTF8ForJS(globalObject, &utf8_slice.ptr[0], utf8_slice.len);
     }

     pub fn createFormatForJS(globalObject: *JSC.JSGlobalObject, comptime fmt: [:0]const u8, args: anytype) bun.JSError!JSC.JSValue {
@@ -849,7 +848,7 @@ pub const String = extern struct {
         var builder = std.ArrayList(u8).init(bun.default_allocator);
         defer builder.deinit();
         builder.writer().print(fmt, args) catch bun.outOfMemory();
-        return bun.jsc.fromJSHostCall(globalObject, @src(), BunString__createUTF8ForJS, .{ globalObject, builder.items.ptr, builder.items.len });
+        return bun.cpp.BunString__createUTF8ForJS(globalObject, &builder.items.ptr[0], builder.items.len);
     }

     pub fn parseDate(this: *String, globalObject: *JSC.JSGlobalObject) f64 {
```

To convert fromJSHostCallGeneric, use [[ZIG_EXPORT(check_slow)]]

# About Bun

This is the Bun repository - an all-in-one JavaScript runtime & toolkit designed for speed, with a bundler, test runner, and Node.js-compatible package manager. It's written primarily in Zig with C++ for JavaScriptCore integration, powered by WebKit's JavaScriptCore engine.

## Building and Running Bun

### Build Commands

- **Build debug version**: `bun bd` or `bun run build:debug`
  - Creates a debug build at `./build/debug/bun-debug`
  - Compilation takes ~2.5 minutes
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
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

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
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toBe("hello\n");
});
```

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
2. **Use `await using`** for proper resource cleanup with Bun APIs (Bun.spawn, Bun.serve, Bun.connect, etc.)
3. **Follow existing code style** - check neighboring files for patterns
4. **Create regression tests** in `test/regression/issue/` when fixing bugs
5. **Use absolute paths** - Always use absolute paths in file operations
6. **Avoid shell commands** - Don't use `find` or `grep` in tests; use Bun's Glob and built-in tools
7. **Memory management** - In Zig code, be careful with allocators and use defer for cleanup
8. **Cross-platform** - Test on macOS, Linux, and Windows when making platform-specific changes
9. **Debug builds** - Use `BUN_DEBUG_QUIET_LOGS=1` to disable debug logging, or `BUN_DEBUG_<scope>=1` to enable specific scopes
10. **Transpiled source** - Find transpiled files in `/tmp/bun-debug-src/` for debugging

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
