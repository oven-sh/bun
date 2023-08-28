---
name: Skip tests with the Bun test runner
---

To skip a test with the Bun test runner, use the `test.skip` function.

```ts
import { test } from "bun:test";

test.skip("unimplemented feature", () => {
  expect(Bun.isAwesome()).toBe(true);
});
```

---

Running `bun test` will not execute this test. It will be marked as skipped in the terminal output.

```sh
$ bun test

test.test.ts:
✓ add [0.03ms]
✓ multiply [0.02ms]
» unimplemented feature

 2 pass
 1 skip
 0 fail
 2 expect() calls
Ran 3 tests across 1 files. [74.00ms]
```

---

See also:

- [Mark a test as a todo](/guides/test/todo-tests)
- [Docs > Test runner > Writing tests](/docs/test/writing)
