Bun ships with a fast, built-in, Jest-compatible test runner. Tests are executed with the Bun runtime, and support the following features.

- TypeScript and JSX
- Lifecycle hooks
- Snapshot testing
- UI & DOM testing
- Watch mode with `--watch`
- Script pre-loading with `--preload`

{% callout %}
Bun aims for compatibility with Jest, but not everything is implemented. To track compatibility, see [this tracking issue](https://github.com/oven-sh/bun/issues/1825).
{% /callout %}

## Run tests

```bash
$ bun test
```

Tests are written in JavaScript or TypeScript with a Jest-like API. Refer to [Writing tests](/docs/test/writing) for full documentation.

```ts#math.test.ts
import { expect, test } from "bun:test";

test("2 + 2", () => {
  expect(2 + 2).toBe(4);
});
```

The runner recursively searches the working directory for files that match the following patterns:

- `*.test.{js|jsx|ts|tsx}`
- `*_test.{js|jsx|ts|tsx}`
- `*.spec.{js|jsx|ts|tsx}`
- `*_spec.{js|jsx|ts|tsx}`

You can filter the set of _test files_ to run by passing additional positional arguments to `bun test`. Any test file with a path that matches one of the filters will run. Commonly, these filters will be file or directory names; glob patterns are not yet supported.

```bash
$ bun test <filter> <filter> ...
```

To filter by _test name_, use the `-t`/`--test-name-pattern` flag.

```sh
# run all tests or test suites with "addition" in the name
$ bun test --test-name-pattern addition
```

To run a specific file in the test runner, make sure the path starts with `./` or `/` to distinguish it from a filter name.

```bash
$ bun test ./test/specific-file.test.ts
```

The test runner runs all tests in a single process. It loads all `--preload` scripts (see [Lifecycle](/docs/test/lifecycle) for details), then runs all tests. If a test fails, the test runner will exit with a non-zero exit code.

## Timeouts

Use the `--timeout` flag to specify a _per-test_ timeout in milliseconds. If a test times out, it will be marked as failed. The default value is `5000`.

```bash
# default value is 5000
$ bun test --timeout 20
```

## Rerun tests

Use the `--rerun-each` flag to run each test multiple times. This is useful for detecting flaky or non-deterministic test failures.

```sh
$ bun test --rerun-each 100
```

## Bail out with `--bail`

Use the `--bail` flag to abort the test run early after a pre-determined number of test failures. By default Bun will run all tests and report all failures, but sometimes in CI environments it's preferable to terminate earlier to reduce CPU usage.

```sh
# bail after 1 failure
$ bun test --bail

# bail after 10 failure
$ bun test --bail 10
```

## Watch mode

Similar to `bun run`, you can pass the `--watch` flag to `bun test` to watch for changes and re-run tests.

```bash
$ bun test --watch
```

## Lifecycle hooks

Bun supports the following lifecycle hooks:

| Hook         | Description                 |
| ------------ | --------------------------- |
| `beforeAll`  | Runs once before all tests. |
| `beforeEach` | Runs before each test.      |
| `afterEach`  | Runs after each test.       |
| `afterAll`   | Runs once after all tests.  |

These hooks can be defined inside test files, or in a separate file that is preloaded with the `--preload` flag.

```ts
$ bun test --preload ./setup.ts
```

See [Test > Lifecycle](/docs/test/lifecycle) for complete documentation.

## Mocks

{% callout %}
Module mocking (`jest.mock()`) is not yet supported. Track support for it [here](https://github.com/oven-sh/bun/issues/5394).
{% /callout %}

Create mock functions with the `mock` function. Mocks are automatically reset between tests.

```ts
import { test, expect, mock } from "bun:test";
const random = mock(() => Math.random());

test("random", () => {
  const val = random();
  expect(val).toBeGreaterThan(0);
  expect(random).toHaveBeenCalled();
  expect(random).toHaveBeenCalledTimes(1);
});
```

Alternatively, you can use `jest.fn()`, it behaves identically.

```ts-diff
- import { test, expect, mock } from "bun:test";
+ import { test, expect, jest } from "bun:test";

- const random = mock(() => Math.random());
+ const random = jest.fn(() => Math.random());
```

See [Test > Mocks](/docs/test/mocks) for complete documentation.

## Snapshot testing

Snapshots are supported by `bun test`.

```ts
// example usage of toMatchSnapshot
import { test, expect } from "bun:test";

test("snapshot", () => {
  expect({ a: 1 }).toMatchSnapshot();
});
```

To update snapshots, use the `--update-snapshots` flag.

```sh
$ bun test --update-snapshots
```

See [Test > Snapshots](/docs/test/snapshots) for complete documentation.

## UI & DOM testing

Bun is compatible with popular UI testing libraries:

- [HappyDOM](https://github.com/capricorn86/happy-dom)
- [DOM Testing Library](https://testing-library.com/docs/dom-testing-library/intro/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro)

See [Test > DOM Testing](/docs/test/dom) for complete documentation.

## Performance

Bun's test runner is fast.

{% image src="/images/buntest.jpeg" caption="Running 266 React SSR tests faster than Jest can print its version number." /%}

<!--
Consider the following directory structure:

```
.
├── a.test.ts
├── b.test.ts
├── c.test.ts
└── foo
    ├── a.test.ts
    └── b.test.ts
```

To run both `a.test.ts` files:

```
$ bun test a
```

To run all tests in the `foo` directory:

```
$ bun test foo
```

Any test file in the directory with an _absolute path_ that contains one of the targets will run. Glob patterns are not yet supported. -->
