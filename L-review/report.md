## 1. Disposition

`merge-after-changes`: keep this as its own PR and land it first, because the false pass it fixes reproduces against Node v26.3.0 and no merged or open PR fixes it, but only after it carries the per-attempt `--retry` lines, answers the node:test owner's written objection, and corrects the statements in its body and fixtures that measurement contradicts.

Desirability verdict: `wanted` (confidence 0.78), pr_disposition `rework`: the production diff and its place as a separate first step stay; the retry hunk, the PR body and three test details change.

**What the PR is.** It is +54/-23 lines of JS in `/workspace/bun/src/js/node/test.ts` (6 files, +335/-25 with tests; no native code, no public surface).
- `executeTestNode` sets `node.finished = true` after a test's afterEach and after hooks instead of before them.
- It then waits for what the hooks put on the test's subtest chain and counts failed subtests again.
- `addTest` and `addSuite` get a `hasResult()` guard, so a global `test()` or `describe()` called in a test's after hook is still dropped and the test stays green.

**Why it is not folded into #39286, although two surviving concerns prefer that.** This PR is the first half of Node's `postRun()` order. The second half is #39286: +503/-109, conflicted, untouched since 2026-08-16, reviewed only by bots, and its head still sets `finished` before the hooks. Folding ties a false-pass fix to a larger, unreviewed behaviour change.

**Required before it goes up.**
1. Add the per-attempt `TestNode` lines of #43751/#43803 to `createTopLevelTestRunner` verbatim (+12/-1; the text is the diff between `/tmp/th-lane/test.change.ts` and `/tmp/th-lane/test.change+retrynode.ts`). Add a `--retry` fixture in which a hook subtest and a body subtest fail on attempt 1 only.
2. In the body, quote and answer https://github.com/oven-sh/bun/pull/32631#discussion_r3575360298 with Node's output, and ask cirospaciari directly.
3. In the body, replace "(#39286 is about the body)" and "`--retry` behaves as on main" with the order against the open PRs and the measured gaps:
   - an async `t.before` that an after hook registers fails a test that passes on Node and on main;
   - a hook subtest that never settles holds the run for 5 s;
   - the new wait is one more path to the stale `done()` that #38876 fixes.
4. Correct the header of fixture 32c, say "after hook" where only an after hook is meant, and make `reportOf()` keep a result line that has no time.

## 2. Why

**Conventions.**
- `test.ts:N` is `/workspace/bun/src/js/node/test.ts` at 3795e1f53f.
- `node-test.test.ts:N` is `/workspace/bun/test/js/node/test_runner/node-test.test.ts` at 3795e1f53f.
- `test.js:N` is Node v26.3.0 `lib/internal/test_runner/test.js` (copy at `/tmp/rcn/node-v26.3.0-test.js`).
- "Body line N" is the PR body at `/tmp/notes/prL-body.md`.
- "Main" is the release build `/tmp/base/rel-main/bun` (b28212a12; its `test.ts` is identical to 017b2439a7).
- "The change" is that binary with the bundled node:test text of 3795e1f53f written into it. It is not a build of 3795e1f53f.
- I re-ran every probe cited with a path, except where marked "lane result".
- PR states come from GitHub responses saved earlier in this run; the API was rate-limited when I tried to refresh them.

**The bug is a silent false pass.** The repro is a failing `t.test()` created in `t.after()` (`/tmp/disp-final/p/a1.test.js`).
- Node runs the subtest and fails the test, exit 1. Its stack goes from `TestHook.run` through `TestContext.test` and `Test.start` to `Test.run`.
- Main never runs it and prints `1 pass, 0 fail`, exit 0.
- The change prints `error: 1 subtest failed`, exit 1.

| Fixture | Node v26.3.0 | main | the change |
|---|---|---|---|
| 32 | pass 9, fail 0 | 3 pass, 2 fail | 5 pass, 0 fail |
| 32b | pass 3, fail 10 | 5 pass, 1 fail | 1 pass, 5 fail |
| 32c | pass 4, fail 1 (the file) | 3 pass, 0 fail | 3 pass, 0 fail |
| 32d | pass 1, fail 2, cancelled 2 | 2 pass, 1 fail | 1 pass, 2 fail |

Node counts subtests and `bun test` counts top-level tests. In 32b the same five top-level tests fail on Node and on the change.

**Nothing merged or open fixes it.**
- `git log --all --since=2026-07-01 -G'Mark finished before hooks' -- src/js/node/test.ts` returns only f511e05d6e, its squash 1b2bb4eb15 (#32631) and this author's three commits.
- The heads of #39286 (e991e7ee12, `test.ts:2392-2394`) and #34515 (ab4d970620, `test.ts:2995-2997`) still set `finished` before the hooks.
- #39286's head alone gives 3/2, 4/2, 3/0 and 2/1 on the four fixtures.

**The two steelman cases.**
- For: "Main never runs a failing `t.test()` that an `after` hook creates and reports the test as passed, Node v24 and v26 run it and fail the test, the only recorded reason for main's behaviour is a claim about Node that running Node refutes, and no merged or open PR fixes it (all 11 that edit `executeTestNode`, #39286 included, keep the hoist)."
- Against: "About 44 of the diff's 54 production lines and its 32d assertion are interim by the surviving evidence's own count: the same author's open #39286 already has the post-hook settle at those lines with Node's cancel behaviour, and it needs only 10 added and 5 removed lines of this diff to give the same results on fixtures 32, 32b and 32c."
- The case against concedes that every objection is about packaging, wording or the retry hunk. That is why the answer is changes and not a fold.

**The PR deletes a line the owner defended in writing and does not answer him.** cirospaciari wrote in discussion_r3575360298: "The sibling `executeTestNode` hoist in f511e05d stands on its own: it's the `t.test()`-from-`after` path, where Node genuinely does resolve the promise without running the body (`16-plan-and-late-subtest.js` pins that against the binary)."
- That is false on Node. `test.js:1406-1408` is `this.pass(); await afterEach(); await after();`, `postRun()` follows at `test.js:1447`, and `finalize()` sets `finished` at `test.js:1611`.
- Fixture 16 is `saved.test()` after the parent finished, a different path. It does not finish on Node v26.3.0 at all (killed at 12 s here).
- His first commit 9cb1fad90d had `finished` after the hooks. The hoist is f511e05d6e, +6/-3 with no test.
- The PR keeps his ruling that does hold: "Node keeps `p` green" (fixture 32c).
- Body line 14 names only the commit and a mechanical reason, and his open #34515 still carries the line. The likely outcome is a close as "decided in #32631", or the hoist coming back on his rebase.
- Also correct "in `postRun()`" in body line 3 and in the comment at `test.ts:2396`.

**`--retry` is a regression the body denies.** The probe is `/tmp/th-lane/p/r1-hook-subtest-flaky.test.js` with `--retry 2`.
- Main exits 0.
- The change prints `1 subtest failed` on all three attempts while the subtest body runs once, then `(fail) flaky hook subtest (attempt 3)`, exit 1.
- With the +12/-1 lines it passes at attempt 2.
- The cause is that `createTopLevelTestRunner` (`test.ts:2565-2592`) reuses one `TestNode` for every attempt. From attempt 2 on, the hook's `t.test()` is dropped again.
- The diff has no line containing `retry`, and body line 40 says "`--retry` behaves as on main".
- Stale completion: `/tmp/th-lane/p/s1-stale-done-from-hook-wait.test.js` with `--retry 1 --timeout 1000` reports attempt 2 as `(pass)` and then prints `error: attempt 2 really fails`, exit 0. Main has the same false pass through the body wait. Only #38876 (open) fixes it.

**The post-hook wait is interim, and the body misstates the queue.**
- #39286's `settleSubtests()` sits at the same position. On its head this PR reduces to five hunks, +10/-5 (`diff /tmp/pseq/k39286_test.ts /tmp/pseq/f39286_test.ts`).
- That fold gives the same totals on 32, 32b and 32c, and Node's result on 32d: `error: test did not finish before its parent and was cancelled`.
- This PR's test at `node-test.test.ts:458-469` pins `error: test timed out after 50ms` instead, so it is written to be inverted.
- Trial merges: #39286 conflicts in 5 hunks and #45717 in 2.
- #43803 merges clean by git but wrong. Its `createStopController()` takes no argument and must be armed with `.arm(timeout)`, so the wait at `test.ts:2399` loses its timeout (`/tmp/pseq/merge_43803_test.ts:2169-2184`, `2415`).
- #35135 (start a subtest inside the `t.test()` call) is not cited.
- Body line 45 says "#39286 is about the body" and line 57 lists four PRs with no order. The body needs an order section.

**#34515 is missing from the trial merges.** This is a lane result, not re-run (`/tmp/p34515/NOTES.txt`; JS on main's native code with two stubs).
- #34515 reads `finished` in three more places (`test.ts:2794`, `2807`, `2883` at ab4d970620).
- The port makes its `run()` and standalone output match Node for hook subtests.
- The natural both-sides merge loses an uncaught error raised during an after hook: exit 1 becomes exit 0. Git flags three hunks and none of the three reads, and no test in either PR fails.
- Add it to the trial merges with that result, and get the owner's agreement to the rule on this PR.

**The rule for a global `test()` is narrower than its wording.** A lane ran a failing created test across 16 combinations of hook kind and owner (`/tmp/probe-ioc/cells.txt`; not re-run).
- Node keeps the owner green in all 16.
- bun keeps it green with exit 0 in two, fails the owner in ten, and throws `Cannot call test() inside a test.` in four. Main and the change are identical, so nothing regresses.
- The file root is the unfixed twin. `after(async t => { await t.test(...) })` at file level is pass 2, exit 0 on Node and exit 1 on main and the change (`/tmp/rhc-q5/p/R1-root-after-ttest.test.js`).
- Add these to "Not changed", and put the guard clause in one predicate that `addTest` (`test.ts:2606`) and `addSuite` (`test.ts:2708`) both call.

**Smaller premise points.**
- **Two roll-up sites.** The PR keeps the early `failedSubtests` read (`test.ts:2359-2362`) and adds a second after the hooks (`test.ts:2410-2416`). Node counts once (`test.js:1484-1503`). A single read below the hooks was checked and is not regression-free, so leave it to #39286 and say so in the order section.
- **Test shape.** Fold the four "on node" tests into one `test.skipIf(!referenceNode).each` table. Say in the body that fixture 16 does not finish on Node as written.
- **Cost.** It is no reason to hold the PR: one JS file and +1,103 bytes of bundled JS. The one visible text change is a new `at makeSubtestsFailure` frame in each `N subtests failed` stack.

## 3. If it proceeds: execution concerns

Items 1 to 3 are regressions against main. Fix them in this PR.

### Should fix

**1. After a failed body, hooks queue behind what the body abandoned** (merges three surviving concerns).

- **Pushback.** `test.ts:2365` keeps the stale chain, so a hook's `t.test()` (`test.ts:2454`) or `t.before()` (`test.ts:2252`) starts only after the abandoned subtest. The hook loop has no bound (`test.ts:2390`). The comment at `test.ts:2364` and body line 50 say the opposite.
- **Evidence.** Probes are in `/tmp/arc-k3/p` and `/tmp/rcn/p`; the "reset" column is `/tmp/arc-k3/bin/bun-alt`.

| Probe | Node | main | the change | reset |
|---|---|---|---|---|
| `stuck.test.js`: `timeout: 50`, body leaves a subtest that never settles, after hook awaits `t.test()` | `test timed out after 50ms`, both hooks run | same, hook subtest dropped | 5,000 ms watchdog with the done-callback message; second after hook not run | as Node |
| `mockleak.test.js` | next test sees `real` | `real` | `mocked by p` | `real` |
| `stuck-throw.test.js`: body throws, no timeout | never ends | `from the body`, 42 ms | 5,000 ms watchdog, error replaced | `from the body` |
| `stuck-throw-inf.test.js`: same with `timeout: Infinity` | not run | 39 ms | never ends | 110 ms |
| `gate2.test.js`: body throws, leftover still running | leftover, then hook subtest | hook subtest dropped | as Node | hook subtest first |

  The reset variant passes all 53 tests (`/tmp/rcn/suite.reset.1.out`), so nothing pins this line.
- **The reviewers split.** One said keep the chain, because it is Node's queue order, and bound it as Node does with the parent's timeout (`test.js:636`). The other said reset. That bound is out of scope here, and its prototype fails this PR's own 32d test (`/tmp/rcn/suite.inherit.out`). Without the bound, Node's order is the regression.
- **Recommendation.** Take the reset:

```ts
// test.ts:2364-2365
if (failure !== undefined) node.subtestChain = kSettledChain;
// test.ts:2397-2398
if (node.subtestChain !== kSettledChain) {
```

  - Add `stuck.test.js` plus the mock check as a fixture that also runs on Node.
  - Record the `gate2.test.js` order as a remaining difference, with a Node twin.
  - Resetting only after a timeout (`/tmp/rcn/bin/bun-hybrid`) keeps Node's order but leaves `stuck-throw.test.js` at the watchdog.

**2. With the timeout off, the new wait has no bound.**

- **Pushback.** Body line 18 says "up to the test timeout". `createStopController` returns `undefined` for `Infinity` (`test.ts:2165-2168`), and bun:test's watchdog is off for `{ timeout: Infinity }` (`test.ts:2545-2548`) and under `--timeout 0`.
- **Evidence.** `/tmp/tinf-q5/p/a-inf-after.test.js`: main exits 0 in 40 ms, Node fails it as `cancelledByParent`, and the change was killed at 12 s. `e-notimeout.test.js --timeout 0` behaves the same. The body-position hang already exists on main and Node; the position after the hooks is new.
- **Recommendation.** Give the block a finite fallback when the test has no finite `timeout`. The prototype `/tmp/tinf-q5/edits_bounded.py` keeps the four fixtures' results. Add an `Infinity` fixture.

**3. After hooks registered during the new wait are accepted and never run.**

- **Pushback.** The wait (`test.ts:2396-2417`) runs user code after the after loop (`test.ts:2388-2394`) has ended, and `t.after` pushes unconditionally (`test.ts:1788-1790`).
- **Evidence.** `/tmp/lar-k9/p/leak.test.js` passes on Node and main; on the change the next test fails on leaked state. In `lateafter.test.js` Node runs all four registered hooks and the change runs two.
- **Recommendation.** Alternate the after loop and the drain until neither adds anything, under one stop controller. `/tmp/lar-k9/bin/bun-altloop` passes both probes. Add the two missing shapes to fixture 32.

**4. A `t.before()` registered in a teardown hook now decides the verdict.**

- **Pushback.** Moving `finished` routes it through `scheduleImmediateBeforeHook` (`test.ts:1782-1784`, `2251-2259`, `2842-2843`) and the wait reads `hookFailure` (`test.ts:2411`). The fixtures only cover synchronous hooks, and body line 44 calls it an ordering difference.
- **Evidence.** Probes are in `/tmp/disp-final/p`, and Node and main pass all three.
  - `c2`: the change fails with `late before failure`.
  - `c1`: the change fails with `test timed out after 50ms`, though no user code fails.
  - `c3`: the change fails after 5,000 ms.
- **Recommendation.**
  - Keep the hook on the chain. The off-chain prototype passes nested cases Node fails (lane result, `/tmp/tbh/bin/bun-oc`).
  - List it under "Differences from Node that remain" and correct "a matter of time only" (body line 46).
  - Pin it with two async cases beside 32b case 5.

**5. `reportOf()` drops any result line without a time** (also on the required list).

- **Pushback.** The lookahead at `node-test.test.ts:376` needs ` [`, and `/workspace/bun/src/runtime/cli/test_command.rs:1141` writes the suffix only above 10 microseconds.
- **Evidence.** On the release binary 32d's last line printed `[0.02ms]` in 4 of 8 runs. A file of eight empty tests prints no time from the fourth on.
- **Recommendation.** Use `normalizeBunSnapshot(stderr)` (`/workspace/bun/test/harness.ts:2286`) and match whole lines.

**6. Fixture 32c case 3 holds by a race, and its header is false** (also on the required list).

- **Pushback.** In a suite's after hook the guard never fires; `suite.passed` is read at `test.ts:2506-2507` before the created test's failure is counted at `test.ts:2449-2450`. The created body does run, so "bun does not run it" (32c header, body line 39) is wrong.
- **Evidence.** `/tmp/tkc/p/matrix.test.js`: 13 of 21 owners fail on main and the change alike, for example with `{ timeout }` on the hook or a second after hook. Node fails only the `t.describe()` row. `/tmp/tkc/p/race.test.js`, 20 runs: main 16 pass and 4 fail, the change 19 pass and 1 fail.
- **Recommendation.** Correct the header, line 39 and the title at `node-test.test.ts:438`. If the title stays a rule, set a teardown flag in `scheduleSuiteSubtest` and keep tests created under it out of `failedSubtests`, with no drain.

**7. The mutation claim covers chosen clauses only.**

- **Pushback.** Body line 53 reads as coverage of the new block.
- **Evidence.** In `/tmp/cgsm/out` (lane result; I read the output files) ten of 29 single-clause mutants keep 53 pass. They include deleting `node.finished = true` (`test.ts:2418`), both `!acceptedXfail` guards (`test.ts:2406`, `2410`) and the `addSuite` clause (`test.ts:2708`).
- **Recommendation.** Add the six cases of `/tmp/cgsm/p/kill.test.js` to the fixtures and reword the sentence.

### Consider

**8. A hook subtest still starts late.**

- **Pushback.** `test.ts:2454` and `2441` defer the body, and Node runs it inside the `t.test()` call (`test.js:1242`).
- **Evidence.** Ten shapes in `/tmp/hsb-q1/p/variants.test.js` and `variants2.test.js` pass on Node and main and fail on the change with `1 subtest failed`.
- **Recommendation.** Add it as a fourth remaining difference, with one fixture case for the #35135 rebase to flip.

## 4. What was checked and held up

- **Whether the PR should exist.** The demand-signal (refuted 4 of 4), counterfactual and value-versus-cost angles were argued and dropped.
- **Node as the reference.** v26.3.0 is bun's reported Node version and the CI pin. The new cases were also run on official v20, v22 and v24 builds. No vendored upstream test changes result.
- **Bigger shapes.** Starting the first subtest synchronously in every phase did not apply. Inheriting the parent's timeout, a single count after the hooks, and running a hook-created global `test()` uncounted were each refuted as out of scope or not regression-free.
- **Bounds.** The 5 s hold with no `timeout` option, the post-hook timer against bun:test's watchdog, and the late-subtest window moving with `timeout` are what main already does for body subtests.
- **Test conventions.** The four 30 s timeouts with eight concurrent children, a `run()`-events oracle, and substring matches in the Node assertions were refuted as preferences or nits.
- **`--concurrent`.** Failure attribution under it needs no code change here.

Scratch files I added are in `/tmp/syn-rv`.