# Concurrent Test Glob Example

This example demonstrates how to use the `concurrentTestGlob` option to selectively run tests concurrently based on file naming patterns.

## Project Structure

```text
my-project/
├── bunfig.toml
├── tests/
│   ├── unit/
│   │   ├── math.test.ts          # Sequential
│   │   └── utils.test.ts         # Sequential
│   └── integration/
│       ├── concurrent-api.test.ts     # Concurrent
│       └── concurrent-database.test.ts # Concurrent
```

## Configuration

### bunfig.toml

```toml
[test]
# Run all test files with "concurrent-" prefix concurrently
concurrentTestGlob = "**/concurrent-*.test.ts"
```

## Test Files

### Unit Test (Sequential)

`tests/unit/math.test.ts`

```typescript
import { test, expect } from "bun:test";

// These tests run sequentially by default
// Good for tests that share state or have specific ordering requirements
let sharedState = 0;

test("addition", () => {
  sharedState = 5 + 3;
  expect(sharedState).toBe(8);
});

test("uses previous state", () => {
  // This test depends on the previous test's state
  expect(sharedState).toBe(8);
});
```

### Integration Test (Concurrent)

`tests/integration/concurrent-api.test.ts`

```typescript
import { test, expect } from "bun:test";

// These tests automatically run concurrently due to filename matching the glob pattern.
// Using test() is equivalent to test.concurrent() when the file matches concurrentTestGlob.
// Each test is independent and can run in parallel.

test("fetch user data", async () => {
  const response = await fetch("/api/user/1");
  expect(response.ok).toBe(true);
});

test("fetch posts", async () => {
  const response = await fetch("/api/posts");
  expect(response.ok).toBe(true);
});

test("fetch comments", async () => {
  const response = await fetch("/api/comments");
  expect(response.ok).toBe(true);
});
```

## Running Tests

```bash
# Run all tests - concurrent-*.test.ts files will run concurrently
bun test

# Override: Force ALL tests to run concurrently
# Note: This overrides bunfig.toml and runs all tests concurrently, regardless of glob
bun test --concurrent

# Run only unit tests (sequential)
bun test tests/unit

# Run only integration tests (concurrent due to glob pattern)
bun test tests/integration
```

## Benefits

1. **Gradual Migration**: Migrate to concurrent tests file by file by renaming them
2. **Clear Organization**: File naming convention indicates execution mode
3. **Performance**: Integration tests run faster in parallel
4. **Safety**: Unit tests remain sequential where needed
5. **Flexibility**: Easy to change execution mode by renaming files

## Migration Strategy

To migrate existing tests to concurrent execution:

1. Start with independent integration tests
2. Rename files to match the glob pattern: `mv api.test.ts concurrent-api.test.ts`
3. Verify tests still pass
4. Monitor for race conditions or shared state issues
5. Continue migrating stable tests incrementally

## Tips

- Use descriptive prefixes: `concurrent-`, `parallel-`, `async-`
- Keep related sequential tests together
- Document why certain tests must remain sequential
- Use `test.concurrent()` for fine-grained control in sequential files
  (In files matched by `concurrentTestGlob`, plain `test()` already runs concurrently)
- Consider separate globs for different test types:

```toml
[test]
# Multiple patterns for different test categories
concurrentTestGlob = [
  "**/integration/*.test.ts",
  "**/e2e/*.test.ts",
  "**/concurrent-*.test.ts"
]
```
