---
name: Run your tests with the Bun test runner
---

Bun has a built-in test runner with a Jest-like `expect` API. To use it, run `bun test` from your project directory. The test runner will search for all files in the directory that match the following patterns:

- `*.test.{js|jsx|ts|tsx}`
- `*_test.{js|jsx|ts|tsx}`
- `*.spec.{js|jsx|ts|tsx}`
- `*_spec.{js|jsx|ts|tsx}`

```sh
$ bun test
bun test v0.8.0 (9c68abdb)

test.test.js:
✓ add [0.87ms]
✓ multiply [0.02ms]

test2.test.js:
✓ add [0.72ms]
✓ multiply [0.01ms]

test3.test.js:
✓ add [0.54ms]
✓ multiply [0.01ms]

 6 pass
 0 fail
 6 expect() calls
Ran 6 tests across 3 files. [9.00ms]
```

---

To only run certain test files, pass a positional argument to `bun test`. The runner will only execute files that contain that argument in their path.

```sh
$ bun test test3
bun test v0.8.0 (9c68abdb)

test3.test.js:
✓ add [1.40ms]
✓ multiply [0.03ms]

 2 pass
 0 fail
 2 expect() calls
Ran 2 tests across 1 files. [15.00ms]
```

---

All tests have a name, defined as the first parameter to the `test` function. Tests can also be inside a `describe` block.

```ts
import { test, expect } from "bun:test";

test("add", () => {
  expect(2 + 2).toEqual(4);
});

test("multiply", () => {
  expect(2 * 2).toEqual(4);
});
```

---

To filter which tests are executed by name, use the `-t`/`--test-name-pattern` flag.

Adding `-t add` will only run tests with "add" in the name. This flag also checks the name of the test suite (the first parameter to `describe`).

```sh
$ bun test -t add
bun test v0.8.0 (9c68abdb)

test.test.js:
✓ add [1.79ms]
» multiply

test2.test.js:
✓ add [2.30ms]
» multiply

test3.test.js:
✓ add [0.32ms]
» multiply

 3 pass
 3 skip
 0 fail
 3 expect() calls
Ran 6 tests across 3 files. [59.00ms]
```

---

See [Docs > Test Runner](/docs/cli/test) for complete documentation on the test runner.
