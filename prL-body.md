### Problem
- `t.test()` in an `afterEach` or `after` hook does nothing. Node v26.3.0 runs the subtest, and a failure fails the test with `1 subtest failed`.
- `executeTestNode` (`src/js/node/test.ts`) sets `node.finished = true` before the hooks, so `addTest` drops the call. Node sets `finished` after them, in `postRun()`.
- `before()` in an after hook fails the test: `Cannot call beforeAll() inside a test.`

### Fix
- `finished` is set after the hooks. `executeTestNode` then waits for the subtests that came after the body's wait, within the test timeout, and counts their failures.
- A settled subtest chain is the shared `kSettledChain` promise. The check for a new subtest is one comparison.
- A test that a hook creates with the global `test()` stays as on main: its owner passes (the #32631 review repro).
- Verified: `node-test.test.ts`, 8 new tests, 4 new fixtures that also run on Node v26.3.0. Main fails 3.

### Background
- `t.test()` appends a subtest to the `subtestChain` of its parent. The parent waits for the chain after its body.
- f511e05d6e (#32631) moved `finished` before the hooks, because a subtest from a hook came after the failure count. This PR counts again after the hooks.
- Step 1 of a series. Step 2 reports a subtest created after its parent finished (fixture 16).

### Downsides
- A subtest from a hook that nothing awaits is waited for, up to the test timeout. Node cancels it (fixture 32d).
- Cost: +1,103 bytes of `node:test` JS. One promise less for each test node: 2,040 live promises after 2,001 tests on main, 39 here.

<details><summary>Notes</summary>

The repro: `t.after(async () => { await t.test("fails", () => { throw new Error("x") }) })` in a test. It passes on main, and it fails on Node v26.3.0 and on this branch with `1 subtest failed`.

What Node v26.3.0 and this branch do, and what main does:

```
fixture                          Node v26.3.0                this branch          main
32-subtests-in-hooks.js          pass 9, fail 0              5 pass, 0 fail       3 pass, 2 fail
32b-subtests-in-hooks-fail.js    pass 3, fail 10             1 pass, 5 fail       5 pass, 1 fail
32c-global-test-in-hook.js       pass 4, fail 1 (the file)   3 pass, 0 fail       3 pass, 0 fail
32d-unfinished-subtests.js       pass 1, fail 2, cancelled 2 1 pass, 2 fail       2 pass, 1 fail
```

Node counts subtests, and `bun test` counts top-level tests. In 32b the same five tests fail on Node and on this branch.

Not changed:
- A subtest that is created after its parent finished is dropped, as before. That is step 2 of the series. It needs a decision about how `bun test` reports a test that has no parent left.
- A test that a hook creates with the global `test()` or `describe()` does not run (fixture 32c). Node attaches it to the hook, runs it, and fails the file when it fails. The owner of the hook passes on both runtimes.
- `--retry` behaves as on main. #43751 and #43803 give each attempt its own test node, and they need #38876.
- The after hooks of a suite in a test: only the global `test()` can create a test there.

Differences from Node that remain:
- Node runs a `before` hook at once when an after hook registers it. bun runs it in the order of the subtests of the test. Fixture 32 accepts both orders.
- bun waits for a subtest that nothing awaits, in the body and now in a hook. Node cancels it (#39286 is about the body).
- The wait after the hooks has the timeout of the test again, and not what the body left of it. The difference is a matter of time only, so no test can hold it.

How the wait works:
- `drainSubtestChain()` puts `kSettledChain` back when nothing is left to wait for. Each `t.test()` replaces the chain with a new promise. So `node.subtestChain !== kSettledChain` means that a subtest came after the last wait.
- After a failed body phase the chain is taken as it is, as on main: a body that throws does not wait for its subtests. Only what the hooks add is waited for.
- The last check, the count of failed subtests and `finished = true` run with no await between them.

Each of these single changes to the new code makes a test fail: no guard for the global `test()`, no guard for the global `describe()`, no timeout for the wait, no rule for a failed body phase, no count after the wait, no replacement of the earlier `subtestsFailed` error, no read of the failed `before` hook, one wait and no loop, and a chain that is taken as settled when the hooks start.

Also run: the 25 vendored `test/js/node/test/parallel/test-runner-*` tests.

Other open PRs change the same block of `executeTestNode`: #39286, #43751, #43803 and #45717.

</details>
