---
name: Mark a test as a "todo" with the Bun test runner
---

To remind yourself to write a test later, use the `test.todo` function. There's no need to provide a test implementation.

```ts
import { test, expect } from "bun:test";

// write this later
test.todo("unimplemented feature");
```

---

The output of `bun test` indicates how many `todo` tests were encountered.

```sh
$ bun test

test.test.ts:
✓ add [0.03ms]
✓ multiply [0.02ms]
✎ unimplemented feature

 2 pass
 1 todo
 0 fail
 2 expect() calls
Ran 3 tests across 1 files. [74.00ms]
```

---

Optionally, you can provide a test implementation.

```ts
import { test, expect } from "bun:test";

test.todo("unimplemented feature", () => {
  expect(Bun.isAwesome()).toBe(true);
});
```

---

If an implementation is provided, it will be executed and _expected to fail_ by test runner! If a todo test passes, the `bun test` run will return a non-zero exit code to signal the failure.

```sh
$ bun test
$ echo $?
1 # this is the exit code of the previous command
```

---

See also:

- [Skip a test](/guides/test/skip-tests)
- [Docs > Test runner > Writing tests](https://bun.sh/docs/test/writing)
