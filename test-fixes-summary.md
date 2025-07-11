# Test Fixes Summary

## Overview

Based on the `test/expectations.txt` file, several tests were expected to fail but were incorrectly marked as `todo` or `skip`, preventing them from running and failing as expected. I've corrected these tests to allow them to run and fail properly so they can be tracked by the test expectations system.

## Tests Fixed

### 1. test/cli/create/create-jsx.test.ts
**Expected failure**: `false > react spa (no tailwind) > build`

**Issue**: The test was marked as `test.todoIf(isWindows)("build", ...)` but should be a regular test that fails.

**Fix**: Changed `test.todoIf(isWindows)("build", ...)` to `test("build", ...)` to allow the test to run and fail as expected.

**Test purpose**: This test checks the build functionality for React SPA projects without Tailwind. It runs `bun create ./index.jsx` and then `bun run build`, expecting a `dist` directory to be created with `.js`, `.html`, and `.css` files.

### 2. test/bundler/native-plugin.test.ts  
**Expected failure**: `prints name when plugin crashes`

**Issue**: The test was marked as `it.skipIf(process.platform === "win32")("prints name when plugin crashes", ...)` but should be a regular test that fails.

**Fix**: Changed `it.skipIf(process.platform === "win32")("prints name when plugin crashes", ...)` to `it("prints name when plugin crashes", ...)` to allow the test to run and fail on all platforms.

**Test purpose**: This test checks that when a native plugin crashes, Bun properly prints the plugin name in the error output. It deliberately causes a plugin crash and expects to see specific error formatting in stderr.

## Tests Already Correctly Configured

The following tests were already set up correctly as regular tests that should fail:

### 3. test/cli/install/bun-run.test.ts
**Expected failure**: `should pass arguments correctly in scripts`

**Test purpose**: Tests that arguments are properly passed and escaped when running scripts via `bun run`. Checks both direct script execution and workspace filtering scenarios.

### 4. test/cli/run/run-crash-handler.test.ts
**Expected failure**: `automatic crash reporter > segfault should report`

**Test purpose**: Tests that the automatic crash reporter correctly reports segfault crashes to a crash reporting server. Part of a suite that tests different crash types (panic, segfault, outOfMemory).

### 5. test/regression/issue/17454/destructure_string.test.ts
**Expected failure**: `destructure string does not become string`

**Test purpose**: Regression test for issue #17454 that checks destructuring of string properties works correctly. Tests that `export const { replace } = "error!";` properly exports the string's `replace` method.

## Testing Strategy

All these tests are now properly configured to:
1. Run during test execution (not skipped or marked as todo)
2. Fail as expected
3. Be tracked by the test expectations system in `test/expectations.txt`

This allows the development team to:
- Monitor when these known issues are fixed
- Prevent regressions if the issues resurface
- Track progress on resolving the underlying bugs

## Running Tests

To run these specific tests:
```bash
# Build and run specific tests
bun bd test test/cli/create/create-jsx.test.ts
bun bd test test/bundler/native-plugin.test.ts
bun bd test test/cli/install/bun-run.test.ts
bun bd test test/cli/run/run-crash-handler.test.ts
bun bd test test/regression/issue/17454/destructure_string.test.ts
```

Note: Building Bun may take up to 2.5 minutes. The `bun bd test` command compiles your code automatically and runs tests with your changes.