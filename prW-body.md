### Problem
- `t.workerId` is `undefined` under `bun test`. On Node v26.3.0 it is the id of the worker: 1 for a file that runs alone.
- `get workerId()` (`src/js/node/test.ts`) reads only `NODE_TEST_WORKER_ID`, and bun never sets that variable.
- The fixture `15-outcome-in-hooks.js` asserted `undefined`. Node fails it.

### Fix
- When `NODE_TEST_WORKER_ID` is set, the getter returns its number, as before. When it is not set, the getter returns the index of the `--parallel` worker (`BUN_TEST_WORKER_ID`), or 1 in a serial run.
- `run()` gives each file that it starts `NODE_TEST_WORKER_ID=1`, as Node's runner does for one file.
- Verified: `node-test.test.ts`, 5 new tests. `34-worker-id.js` and the `workerId` case of fixture 15 also pass on Node v26.3.0.
- Self-reviewed: the first version set the variable in every `bun test` process. The review rejected that.

### Background
- Node's runner writes the id of the worker into `NODE_TEST_WORKER_ID` before a test file loads. `context.workerId` reads it.
- `bun test --parallel` gives each worker its 1-based index in `BUN_TEST_WORKER_ID` and `JEST_WORKER_ID`. A serial run sets neither.
- Not chosen: the variable in every `bun test` process. Libraries take it as the sign of Node's runner. With it, `console-fail-test@0.10.0` stops working in a file that imports only `bun:test` (Notes).

### Downsides
- `process.env.NODE_TEST_WORKER_ID` stays unset under `bun test`, outside a file that `run()` starts. Code that reads the variable gets `undefined`.
- After a test deletes the variable, `t.workerId` is the worker index again. On Node it is `undefined`.
- A `bun test` that a test starts under `--parallel` inherits `BUN_TEST_WORKER_ID`, so its `t.workerId` is the outer index.

<details><summary>Notes</summary>

No issue reports this. It was found because the fixture fails under `node --test`.

`console-fail-test@0.10.0`, `cft()` with auto-detection, in a file that imports only `bun:test` and has one test that calls `console.error`:

```
                                        serial            --parallel=2 (two files)
main                                    1 pass, 1 fail    2 pass, 2 fail
NODE_TEST_WORKER_ID in every process    2 pass, 0 fail    4 pass, 0 fail
this branch                             1 pass, 1 fail    2 pass, 2 fail
```

The failing test is the intended result: the library fails a test that logs to the console. Its `node:test` detector returns early unless `NODE_TEST_CONTEXT` or `NODE_TEST_WORKER_ID` is set, and it runs before the jest detector. bun runs the module-level `beforeEach`/`afterEach` hooks of `node:test` only for `node:test` tests, so that adapter does nothing in a `bun:test` file.

The test for `--parallel` does not depend on timing: each of its two files ends only after it saw the other file start, so the files run on two workers at the same time, and each prints `t.workerId`, `BUN_TEST_WORKER_ID` and `JEST_WORKER_ID`.

The new helper `referenceNode` / `runTestsOnNode` in `node-test.test.ts` is the same text as in #45334.

</details>
