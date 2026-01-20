To run tests:

```sh
bun bd test <...test file>
```

To run a command with your debug build of Bun:

```sh
bun bd <...cmd>
```

Note that compiling Bun may take up to 2.5 minutes. It is slow!

**CRITICAL**: Do not use `bun test` to run tests. It will not have your changes. `bun bd test <...test file>` is the correct command, which compiles your code automatically.

## Testing style

Use `bun:test` with files that end in `*.test.{ts,js,jsx,tsx,mjs,cjs}`. If it's a test/js/node/test/{parallel,sequential}/\*.js without a .test.extension, use `bun bd <file>` instead of `bun bd test <file>` since those expect exit code 0 and don't use bun's test runner.

- **Do not write flaky tests**. Unless explicitly asked, **never wait for time to pass in tests**. Always wait for the condition to be met instead of waiting for an arbitrary amount of time. **Never use hardcoded port numbers**. Always use `port: 0` to get a random port.
- **Prefer concurrent tests over sequential tests**: When multiple tests in the same file spawn processes or write files, make them concurrent with `test.concurrent` or `describe.concurrent` unless it's very difficult to make them concurrent.

### Spawning processes

#### Spawning Bun in tests

When spawning Bun processes, use `bunExe` and `bunEnv` from `harness`. This ensures the same build of Bun is used to run the test and ensures debug logging is silenced.

##### Use `-e` for single-file tests

```ts
import { bunEnv, bunExe, tempDir } from "harness";
import { test, expect } from "bun:test";

test("single-file test spawns a Bun process", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('Hello, world!')"],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(stdout).toBe("Hello, world!\n");
  expect(exitCode).toBe(0);
});
```

##### When multi-file tests are required:

```ts
import { bunEnv, bunExe, tempDir } from "harness";
import { test, expect } from "bun:test";

test("multi-file test spawns a Bun process", async () => {
  // If a test MUST use multiple files:
  using dir = tempDir("my-test-prefix", {
    "my.fixture.ts": `
      import { foo } from "./foo.ts";
      foo();
    `,
    "foo.ts": `
      export function foo() {
        console.log("Hello, world!");
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "my.fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
  });

  const [stdout, stderr, exitCode] = await Promise.all([

    // ReadableStream in Bun supports:
    //  - `await stream.text()`
    //  - `await stream.json()`
    //  - `await stream.bytes()`
    //  - `await stream.blob()`
    proc.stdout.text(),
    proc.stderr.text(),

    proc.exitCode,
  ]);

  expect(stdout).toBe("Hello, world!");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
```

When a test file spawns a Bun process, we like for that file to end in `*-fixture.ts`. This is a convention that helps us identify the file as a test fixture and not a test itself.

Generally, `await using` or `using` is a good idea to ensure proper resource cleanup. This works in most Bun APIs like Bun.listen, Bun.connect, Bun.spawn, Bun.serve, etc.

#### Async/await in tests

Prefer async/await over callbacks.

When callbacks must be used and it's just a single callback, use `Promise.withResolvers` to create a promise that can be resolved or rejected from a callback.

```ts
const ws = new WebSocket("ws://localhost:8080");
const { promise, resolve, reject } = Promise.withResolvers<void>(); // Can specify any type here for resolution value
ws.onopen = resolve;
ws.onclose = reject;
await promise;
```

If it's several callbacks, it's okay to use callbacks. We aren't a stickler for this.

### No timeouts

**CRITICAL**: Do not set a timeout on tests. Bun already has timeouts.

### Use port 0 to get a random port

Most APIs in Bun support `port: 0` to get a random port. Never hardcode ports. Avoid using your own random port number function.

### Creating temporary files

Use `tempDirWithFiles` to create a temporary directory with files.

```ts
import { tempDir } from "harness";
import path from "node:path";

test("creates a temporary directory with files", () => {
  using dir = tempDir("my-test-prefix", {
    "file.txt": "Hello, world!",
  });

  expect(await Bun.file(path.join(String(dir), "file.txt")).text()).toBe(
    "Hello, world!",
  );
});
```

### Strings

To create a repetitive string, use `Buffer.alloc(count, fill).toString()` instead of `"A".repeat(count)`. "".repeat is very slow in debug JavaScriptCore builds.

### Test Organization

- Use `describe` blocks for grouping related tests
- Regression tests for specific issues go in `/test/regression/issue/${issueNumber}.test.ts`. If there's no issue number, do not put them in the regression directory.
- Unit tests for specific features are organized by module (e.g., `/test/js/bun/`, `/test/js/node/`)
- Integration tests are in `/test/integration/`

### Nested/complex object equality

Prefer usage of `.toEqual` rather than many `.toBe` assertions for nested or complex objects.

<example>

BAD (try to avoid doing this):

```ts
expect(result).toHaveLength(3);
expect(result[0].optional).toBe(null);
expect(result[1].optional).toBe("middle-value"); // CRITICAL: middle item's value must be preserved
expect(result[2].optional).toBe(null);
```

**GOOD (always prefer this):**

```ts
expect(result).toEqual([
  { optional: null },
  { optional: "middle-value" }, // CRITICAL: middle item's value must be preserved
  { optional: null },
]);
```

</example>

### Common Imports from `harness`

```ts
import {
  bunExe, // Path to Bun executable
  bunEnv, // Environment variables for Bun
  tempDirWithFiles, // Create temporary test directories with files
  tmpdirSync, // Create empty temporary directory
  isMacOS, // Platform checks
  isWindows,
  isPosix,
  gcTick, // Trigger garbage collection
  withoutAggressiveGC, // Disable aggressive GC for performance tests
} from "harness";
```

### Error Testing

Always check exit codes and test error scenarios:

```ts
test("handles errors", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "invalid.js"],
    env: bunEnv,
  });

  const exitCode = await proc.exited;
  expect(exitCode).not.toBe(0);

  // For synchronous errors
  expect(() => someFunction()).toThrow("Expected error message");
});
```

### Avoid dynamic import & require

**Only** use dynamic import or require when the test is specifically testing something relataed to dynamic import or require. Otherwise, **always use module-scope import statements**.

**BAD, do not do this**:

```ts
test("foo", async () => {
  // BAD: Unnecessary usage of dynamic import.
  const { readFile } = await import("node:fs");

  expect(await readFile("ok.txt")).toBe("");
});
```

**GOOD, do this:**

```ts
import { readFile } from "node:fs";
test("foo", async () => {
  expect(await readFile("ok.txt")).toBe("");
});
```

### Test Utilities

- Use `describe.each()` for parameterized tests
- Use `toMatchSnapshot()` for snapshot testing
- Use `beforeAll()`, `afterEach()`, `beforeEach()` for setup/teardown
- Track resources (servers, clients) in arrays for cleanup in `afterEach()`
