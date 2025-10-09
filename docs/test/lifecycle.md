The test runner supports the following lifecycle hooks. This is useful for loading test fixtures, mocking data, and configuring the test environment.

| Hook         | Description                 |
| ------------ | --------------------------- |
| `beforeAll`  | Runs once before all tests. |
| `beforeEach` | Runs before each test.      |
| `afterEach`  | Runs after each test.       |
| `afterAll`   | Runs once after all tests.  |

Perform per-test setup and teardown logic with `beforeEach` and `afterEach`.

```ts
import { beforeEach, afterEach } from "bun:test";

beforeEach(() => {
  console.log("running test.");
});

afterEach(() => {
  console.log("done with test.");
});

// tests...
```

Perform per-scope setup and teardown logic with `beforeAll` and `afterAll`. The _scope_ is determined by where the hook is defined. Note that `afterAll` can also be called inside individual tests for test-specific cleanup.

To scope the hooks to a particular `describe` block:

```ts
import { describe, beforeAll } from "bun:test";

describe("test group", () => {
  beforeAll(() => {
    // setup
  });

  // tests...
});
```

To scope the hooks to a test file:

```ts
import { describe, beforeAll } from "bun:test";

beforeAll(() => {
  // setup
});

describe("test group", () => {
  // tests...
});
```

To scope the hooks to an entire multi-file test run, define the hooks in a separate file.

```ts#setup.ts
import { beforeAll, afterAll } from "bun:test";

beforeAll(() => {
  // global setup
});

afterAll(() => {
  // global teardown
});
```

When using `--preload`, `beforeAll` runs before the first test file and `afterAll` runs after the last test file, ensuring proper global setup and teardown across your entire test suite.

Then use `--preload` to run the setup script before any test files.

```ts
$ bun test --preload ./setup.ts
```

To avoid typing `--preload` every time you run tests, it can be added to your `bunfig.toml`:

```toml
[test]
preload = ["./setup.ts"]
```
