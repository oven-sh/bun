---
name: Use snapshot testing in `bun test`
---

Bun's test runner supports Jest-style snapshot testing via `.toMatchSnapshot()`.

{% callout %}
The `.toMatchInlineSnapshot()` method is not yet supported.
{% /callout %}

```ts#snap.test.ts
import { test, expect } from "bun:test";

test("snapshot", () => {
  expect({ foo: "bar" }).toMatchSnapshot();
});
```

---

The first time this test is executed, Bun will evaluate the value passed into `expect()` and write it to disk in a directory called `__snapshots__` that lives alongside the test file. (Note the `snapshots: +1 added` line in the output.)

```sh
$ bun test test/snap
bun test v1.x (9c68abdb)

test/snap.test.ts:
✓ snapshot [1.48ms]

 1 pass
 0 fail
 snapshots: +1 added
 1 expect() calls
Ran 1 tests across 1 files. [82.00ms]
```

---

The `__snapshots__` directory contains a `.snap` file for each test file in the directory.

```txt
test
├── __snapshots__
│   └── snap.test.ts.snap
└── snap.test.ts
```

---

The `snap.test.ts.snap` file is a JavaScript file that exports a serialized version of the value passed into `expect()`. The `{foo: "bar"}` object has been serialized to JSON.

```js
// Bun Snapshot v1, https://goo.gl/fbAQLP

exports[`snapshot 1`] = `
{
  "foo": "bar",
}
`;
```

---

Later, when this test file is executed again, Bun will read the snapshot file and compare it to the value passed into `expect()`. If the values are different, the test will fail.

```sh
$ bun test
bun test v1.x (9c68abdb)

test/snap.test.ts:
✓ snapshot [1.05ms]

 1 pass
 0 fail
 1 snapshots, 1 expect() calls
Ran 1 tests across 1 files. [101.00ms]
```

---

To update snapshots, use the `--update-snapshots` flag.

```sh
$ bun test --update-snapshots
bun test v1.x (9c68abdb)

test/snap.test.ts:
✓ snapshot [0.86ms]

 1 pass
 0 fail
 snapshots: +1 added  # the snapshot was regenerated
 1 expect() calls
Ran 1 tests across 1 files. [102.00ms]
```

---

See [Docs > Test Runner > Snapshots](https://bun.sh/docs/test/mocks) for complete documentation on mocking with the Bun test runner.
