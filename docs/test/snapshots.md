Snapshot testing saves the output of a value and compares it against future test runs. This is particularly useful for UI components, complex objects, or any output that needs to remain consistent.

## Basic snapshots

Snapshot tests are written using the `.toMatchSnapshot()` matcher:

```ts
import { test, expect } from "bun:test";

test("snap", () => {
  expect("foo").toMatchSnapshot();
});
```

The first time this test is run, the argument to `expect` will be serialized and written to a special snapshot file in a `__snapshots__` directory alongside the test file. On future runs, the argument is compared against the snapshot on disk. Snapshots can be re-generated with the following command:

```bash
$ bun test --update-snapshots
```

## Inline snapshots

For smaller values, you can use inline snapshots with `.toMatchInlineSnapshot()`. These snapshots are stored directly in your test file:

```ts
import { test, expect } from "bun:test";

test("inline snapshot", () => {
  // First run: snapshot will be inserted automatically
  expect({ hello: "world" }).toMatchInlineSnapshot();

  // After first run, the test file will be updated to:
  // expect({ hello: "world" }).toMatchInlineSnapshot(`
  //   {
  //     "hello": "world",
  //   }
  // `);
});
```

When you run the test, Bun automatically updates the test file itself with the generated snapshot string. This makes the tests more portable and easier to understand, since the expected output is right next to the test.

### Using inline snapshots

1. Write your test with `.toMatchInlineSnapshot()`
2. Run the test once
3. Bun automatically updates your test file with the snapshot
4. On subsequent runs, the value will be compared against the inline snapshot

Inline snapshots are particularly useful for small, simple values where it's helpful to see the expected output right in the test file.

## Error snapshots

You can also snapshot error messages using `.toThrowErrorMatchingSnapshot()` and `.toThrowErrorMatchingInlineSnapshot()`:

```ts
import { test, expect } from "bun:test";

test("error snapshot", () => {
  expect(() => {
    throw new Error("Something went wrong");
  }).toThrowErrorMatchingSnapshot();

  expect(() => {
    throw new Error("Another error");
  }).toThrowErrorMatchingInlineSnapshot();
});
```
