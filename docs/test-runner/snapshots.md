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
