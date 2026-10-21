### Problem
- `t.test()` in an `afterEach` or `after` hook does nothing. Node v26.3.0 runs the subtest and counts its failure.
- `executeTestNode` (`src/js/node/test.ts`) sets `node.finished = true` before the hooks, so `addTest` drops the call. Node sets it after them.
- `before()` in an after hook fails: `Cannot call beforeAll() inside a test.`

### Fix
- `finished` is set after the hooks. The after hooks and the wait for their subtests take turns, then failed subtests are counted again.
- A subtest that then needs more than microtasks fails its parent, as when Node cancels it. A todo subtest or a hook does not.
- A global `test()` in an after hook stays as on main.
- Verified: `node-test.test.ts`: 8 new tests, 4 fixtures that run on Node v26.3.0 too. Main fails 4.

### Background
- `t.test()` appends a subtest to its parent's `subtestChain`. A settled chain is now one shared promise, so the check is one comparison.
- f511e05d6e (#32631) moved `finished` before the hooks. @cirospaciari, your reason was that Node does not run `t.test()` from `after`. It does (Notes). Can it move back?
- Step 1 of a series: step 2 reports a subtest created after its parent finished.

### Downsides
- `--retry`: a hook subtest that failed in attempt 1 fails each later attempt, as a body subtest does on main (#43751, #38876).
- A subtest that a hook leaves runs on in the background. #39286 cancels it.
- Cost: +1,808 bytes of `node:test` JS. One promise less per test node (2,040 live promises after 2,001 tests on main, 39 here).

<details><summary>Notes</summary>

**The repro, and the answer to https://github.com/oven-sh/bun/pull/32631#discussion_r3575360298**

That comment says: "The sibling `executeTestNode` hoist in f511e05d stands on its own: it's the `t.test()`-from-`after` path, where Node genuinely does resolve the promise without running the body (`16-plan-and-late-subtest.js` pins that against the binary)."

```js
const { test } = require("node:test")
test("p", t => {
  t.after(async () => {
    await t.test("from after", () => {
      console.log("BODY RAN")
      throw new Error("boom")
    })
  })
})
```

```
node v26.3.0            main               this branch
BODY RAN                (pass) p           BODY RAN
▶ p                     1 pass, 0 fail     error: 1 subtest failed
  ✖ from after                             error: boom
✖ p                                        (fail) p
tests 2, pass 0, fail 2                    0 pass, 1 fail
```

In `Test.run()` Node calls `this.pass()`, then awaits `afterEach()` and `after()`. `postRun()` follows, and `finalize()` sets `finished` (`lib/internal/test_runner/test.js`). Fixture 16 is another path: `saved.test()` after the parent finished. The ruling of that comment that does hold is kept: a test from the global `test()` in a hook does not fail the owner of the hook.

**Fixtures on Node v26.3.0, on this branch and on main**

```
fixture                          Node v26.3.0                 this branch       main
39-subtests-in-hooks.js          pass 18, fail 0              11 pass, 0 fail   9 pass, 2 fail
39b-subtests-in-hooks-fail.js    pass 3, fail 15, cancelled 4 1 pass, 9 fail    8 pass, 2 fail
39c-failed-body-and-hooks.js     pass 2, cancelled 2          1 pass, 1 fail    0 pass, 2 fail
39d-differences-from-node.js     pass 8, fail 7               5 pass, 5 fail    8 pass, 2 fail
```

Node counts subtests, and `bun test` counts top-level tests. In 39b the same nine top-level tests fail on Node and on this branch. In 39c the same test fails on Node and on this branch. On main the subtest of its hook does not run, so the check of the hooks fails too.

**Order with the open PRs**

- `--retry` is not changed here. A retry runs on the same test node, so `t.test()` is dropped in attempt 2 and the failed subtests of attempt 1 still count. #43751 and #43803 give each attempt a new node. That needs #38876 first: without it bun:test takes the `done()` of attempt 1 as the end of attempt 2, and a test whose async subtest fails on every attempt is reported as `(pass) (attempt 2)`. An earlier version of this PR had the new node, and a review found that false pass.
- #39286 replaces the wait after the hooks with Node's cancellation of each subtest, and counts the failed subtests once, after the hooks. Its `cancelledByParentFailure` is the same text here. The error that fixture 39b holds for a subtest that is not finished is the one that #39286 gives.
- #45717 changes how a failure is stored, in the same function. The two conflict in 2 hunks.
- #35135 starts the body of a subtest inside `t.test()`. It turns one case of fixture 39d into Node's result.
- #34515 reads `finished` in three more places. A merge of the two needs a look at an uncaught error that is raised while an after hook runs.

**Differences from Node that remain (fixture 39d holds each for both runtimes)**

- A test from the global `test()` or `describe()` in the after hook of a test does not run. Node gives it to the hook, runs it, and fails the file when it fails. The owner of the hook passes on both.
- Node starts the body of a subtest inside `t.test()`. bun starts it after the hook returns, so a hook that closes something after the call makes the subtest fail.
- After a body that threw, Node keeps a subtest from a hook behind the subtest that the body left. bun starts it at once.
- An expected failure whose hook leaves a subtest passes on both. Node then fails the file.
- `t.describe()` is not in Node. On bun a suite from it counts for its parent as a subtest does.
- bun waits for a subtest of the body that nothing awaits, as before. Node cancels it.
- Node cancels a subtest that a hook leaves. bun fails the parent in the same way and does not stop the subtest: it runs on in the background, and under `run()` its own event comes after the event of its parent. A subtest that a failed body leaves does the same on main.

**Not changed**

- A subtest that is created after its parent finished is dropped. That is step 2. Fixture 16 awaits such a subtest, and on Node v26.3.0 that await does not settle, so the fixture has a comment that says so.
- In the other kinds of hook (`before`, `beforeEach`, `afterEach`, and the hooks of a suite in a test) a test from the global `test()` is handled as on main. In the after hook of a suite it runs with no one to wait for it, and the result of the owner depends on timing.
- `after(async t => { await t.test(...) })` at the top level of a file fails with `Cannot call test() inside a test`, as on main. Node runs the subtest.

**Step 2, not in this PR: a subtest that is created after its parent finished**

- On main such a subtest is dropped. Node fails it (`test could not be started because its parent finished`, failure type `parentAlreadyFinished`), and the run fails. The example under "Extraneous asynchronous activity" in Node's documentation exits 0 on bun for this reason.
- bun:test has no place for a result that comes after its test is done. There are three ways to report it, and the owner of `node:test` has to choose one before step 2 is built:
  1. A native entry point that hands one more result to the reporter of `bun test`. It gives a line for each late subtest and Node's totals. A prototype exists.
  2. A file-level `afterAll` in the shim that throws the recorded errors. It needs no native code, and it gives one failed line with no name for all of them.
  3. Registration with bun:test after the tests of the file are built, as the "Not covered" note of #32631 says.

**How the wait works**

- `drainSubtestChain()` puts `kSettledChain` back when nothing is left to wait for, and each `t.test()` replaces the chain with a new promise. So `node.subtestChain !== kSettledChain` means that something came after the last wait. That is true for what a hook creates, and for what the body creates after its own wait is over (`t.test("first").then(() => t.test("second"))` with no await).
- The wait is a race of the chain with `process.nextTick`. The tick runs when the microtasks are done, before a timer, an immediate or the end of an I/O call. A subtest that a hook awaited is settled already. A subtest that nothing awaits and that has a synchronous body settles in those microtasks. Anything else is left, however fast it is, so the result does not depend on the speed of the machine. An earlier version raced with `setImmediate`: bun handles the end of an fs read before an immediate, so a fast read gave a result that changed from run to run.
- `unfinishedSubtests` counts the subtests of a node that are scheduled and not done, without the todo ones and the skipped ones. When something is left, that number is added to the failed subtests, with Node's error `test did not finish before its parent and was cancelled`. A `t.before()` that an after hook registers is on the chain too, but it is not a subtest: when only that is left, the test passes, as on Node.
- A subtest can register an after hook on its parent, and an after hook can create a subtest. So the two take turns until no hook is left and the chain is settled. The last check, the count and `finished = true` have no await between them.
- After a body phase that failed, the chain and the count start again: a subtest that the body left does not hold what the hooks create.

**Tests**

- Each of these single changes to the new code makes a test fail: `finished` never set, no rule for the global `test()` (3 variants), `t.test()` or `t.describe()` treated as the global spelling, no new chain after a failed body, what is left not counted, counted as one, or with no error, no tick in the race, no count after the wait, no replacement of the earlier `subtestsFailed` error, no read of the failed `before` hook, no exception for an expected failure, no second turn for the hooks, a todo subtest or a todo suite counted, a subtest or a suite not counted, a subtest or a suite that stays counted when it is done, and a drain that does not put `kSettledChain` back.
- Also run: the 25 vendored `test/js/node/test/parallel/test-runner-*` tests.

**Cost**

- Module load: +5 functions and +1 promise.
- `TestNode` is 224 bytes before and after, with one more field. The promise that each node owned is gone.
- The stack of each `N subtests failed` error has one more frame, `at makeSubtestsFailure`.

</details>
