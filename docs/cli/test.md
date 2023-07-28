Bun ships with a fast built-in test runner. Tests are executed with the Bun runtime, and support the following features.

- TypeScript and JSX
- Lifecycle hooks
- Snapshot testing
- UI & DOM testing
- Watch mode with `--watch`
- Script pre-loading with `--preload`

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

You can filter the set of tests to run by passing additional positional arguments to `bun test`. Any file in the directory with an _absolute path_ that contains one of the filters will run. Commonly, these filters will be file or directory names; glob patterns are not yet supported.

```bash
$ bun test <filter> <filter> ...
```

The test runner runs all tests in a single process. It loads all `--preload` scripts (see [Lifecycle](/docs/test/lifecycle) for details), then runs all tests. If a test fails, the test runner will exit with a non-zero exit code.

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

These hooks can be define inside test files, or in a separate file that is preloaded with the `--preload` flag.

```ts
$ bun test --preload ./setup.ts
```

See [Test > Lifecycle](/docs/test/lifecycle) for complete documentation.

## Mocks

Create mocks with the `mock` function. Mocks are automatically reset between tests.

```ts
import { test, expect, mock } from "bun:test";
const random = mock(() => Math.random());

test("random", async () => {
  const val = random();
  expect(val).toBeGreaterThan(0);
  expect(random).toHaveBeenCalled();
  expect(random).toHaveBeenCalledTimes(1);
});
```

See [Test > Mocks](/docs/test/mocks) for complete documentation.

## Snapshot testing

Snapshots are supported by `bun test`. See [Test > Snapshots](/docs/test/snapshots) for complete documentation.

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
