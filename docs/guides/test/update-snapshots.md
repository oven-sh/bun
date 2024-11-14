---
name: Update snapshots in `bun test`
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

The first time this test is executed, Bun will write a snapshot file to disk in a directory called `__snapshots__` that lives alongside the test file.

```txt
test
├── __snapshots__
│   └── snap.test.ts.snap
└── snap.test.ts
```

---

To regenerate snapshots, use the `--update-snapshots` flag.

```sh
$ bun test --update-snapshots
bun test v1.x (9c68abdb)

test/snap.test.ts:
✓ snapshot [0.86ms]

 1 pass
 0 fail
 snapshots: +1 added # the snapshot was regenerated
 1 expect() calls
Ran 1 tests across 1 files. [102.00ms]
```

---

See [Docs > Test Runner > Snapshots](https://bun.sh/docs/test/mocks) for complete documentation on mocking with the Bun test runner.
