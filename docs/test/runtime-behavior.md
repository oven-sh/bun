`bun test` is deeply integrated with Bun's runtime. This is part of what makes `bun test` fast and simple to use.

#### `$NODE_ENV` environment variable

`bun test` automatically sets `$NODE_ENV` to `"test"` unless it's already set in the environment or via .env files. This is standard behavior for most test runners and helps ensure consistent test behavior.

```ts
import { test, expect } from "bun:test";

test("NODE_ENV is set to test", () => {
  expect(process.env.NODE_ENV).toBe("test");
});
```

#### `$TZ` environment variable

By default, all `bun test` runs use UTC (`Etc/UTC`) as the time zone unless overridden by the `TZ` environment variable. This ensures consistent date and time behavior across different development environments.

#### Test Timeouts

Each test has a default timeout of 5000ms (5 seconds) if not explicitly overridden. Tests that exceed this timeout will fail. This can be changed globally with the `--timeout` flag or per-test as the third parameter to the test function.

## Error Handling

### Unhandled Errors

`bun test` tracks unhandled promise rejections and errors that occur between tests. If such errors occur, the final exit code will be non-zero (specifically, the count of such errors), even if all tests pass.

This helps catch errors in asynchronous code that might otherwise go unnoticed:

```ts
import { test } from "bun:test";

test("test 1", () => {
  // This test passes
});

// This error happens outside any test
setTimeout(() => {
  throw new Error("Unhandled error");
}, 0);

test("test 2", () => {
  // This test also passes
});

// The test run will still fail with a non-zero exit code
// because of the unhandled error
```

Internally, this occurs with a higher precedence than `process.on("unhandledRejection")` or `process.on("uncaughtException")`, which makes it simpler to integrate with existing code.

## Using General CLI Flags with Tests

Several Bun CLI flags can be used with `bun test` to modify its behavior:

### Memory Usage

- `--smol`: Reduces memory usage for the test runner VM

### Debugging

- `--inspect`, `--inspect-brk`: Attaches the debugger to the test runner process

### Module Loading

- `--preload`: Runs scripts before test files (useful for global setup/mocks)
- `--define`: Sets compile-time constants
- `--loader`: Configures custom loaders
- `--tsconfig-override`: Uses a different tsconfig
- `--conditions`: Sets package.json conditions for module resolution
- `--env-file`: Loads environment variables for tests

### Installation-related Flags

- `--prefer-offline`, `--frozen-lockfile`, etc.: Affect any network requests or auto-installs during test execution

## Watch and Hot Reloading

When running `bun test` with the `--watch` flag, the test runner will watch for file changes and re-run affected tests.

The `--hot` flag provides similar functionality but is more aggressive about trying to preserve state between runs. For most test scenarios, `--watch` is the recommended option.

## Global Variables

The following globals are automatically available in test files without importing (though they can be imported from `bun:test` if preferred):

- `test`, `it`: Define tests
- `describe`: Group tests
- `expect`: Make assertions
- `beforeAll`, `beforeEach`, `afterAll`, `afterEach`: Lifecycle hooks
- `jest`: Jest global object
- `vi`: Vitest compatibility alias for common jest methods
