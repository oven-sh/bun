# Design review: "node:test: report a subtest created after its parent finished as its own failed test"

Reviewed at ab3e94328c against main b28212a12c: 13 files, +609/-66. Line numbers are at ab3e94328c unless marked "base". Short names used below:

- `test.ts`: /workspace/bun/src/js/node/test.ts
- `jest.rs`: /workspace/bun/src/runtime/test_runner/jest.rs
- `bun_test.rs`: /workspace/bun/src/runtime/test_runner/bun_test.rs
- `Execution.rs`: /workspace/bun/src/runtime/test_runner/Execution.rs
- `test_command.rs`: /workspace/bun/src/runtime/cli/test_command.rs
- driver: /workspace/bun/test/js/node/test_runner/node-test.test.ts (fixtures in /workspace/bun/test/js/node/test_runner/fixtures/)
- docs line: /workspace/bun/docs/runtime/nodejs-compat.mdx:180

## 1. Disposition

**`restructure`**: the false pass is real, the node:test owner recorded it as deferred in #32631 and nothing merged or open fixes it, but this PR bundles separable changes, one of which regresses `--retry` and one of which fails a test the owner said must stay green, so it should land as a short series.

**Desirability: `wanted-in-a-different-shape`** (confidence 0.7), PR disposition `rework`: do not close it and do not merge it as one PR; keep the detached-report path and change what is packaged around it.

**Bigger shape: a series in place of this PR, with the same mechanism and no new public surface.** For a reader who has not opened the diff: a "late subtest" is a `node:test` test or suite created after its parent finished. Main drops it silently at two `return Promise.resolve(undefined)` sites (base test.ts:2579-2583, 2678-2680). The PR reports it as a failed test instead: `addLateSubtest()` (test.ts:2558) calls a new native function, `jsNodeTestReportDetached` (jest.rs:592), which calls `CommandLineReporter::handle_test_completed`. The same diff also carries four other changes:

- It moves `finished = true` to after the afterEach/after hooks (test.ts:2411).
- It creates a new `TestNode` per `--retry` attempt (test.ts:2669-2675).
- It edits four `before()`/`after()` registration conditions (test.ts:1784, 2941, 2943, 2960).
- It runs the body of a late subtest from a module-level promise chain (test.ts:2555, 2621-2622).

Split it as follows.

0. **#38876 first** (bun:test ignores completions from an earlier attempt of a retried test; 14 production lines in Execution.rs and bun_test.rs), or carry its generation check in step 1. Without it, step 1's per-attempt `TestNode` turns a parent with a failing async subtest from exit 1 on main into `(pass) ... (attempt 2)`, exit 0.
1. **Lifecycle PR, JS only**, about +180/-20 over 5 files. In test.ts, set `finished` after the afterEach/after hooks and drain the subtests a hook created (`executeTestNode`, `scheduleSuiteSubtest`). Create a new `TestNode` per `--retry` attempt in `createTopLevelTestRunner`, with the exact text of #43751/#43803 so the hunk merges as an identical change. Fixtures 32, 32b and 33 enforce it.
   - A test that a hook creates with the global `test()` must not fail its owner. These hunks alone already print `(fail) p` on the #32631 review repro (base binary patched with only these hunks, /tmp/probe-sb/bun-LB). Until step 2 reports that test, its failure stays swallowed as on main. List that as a known gap and add a test that the owner stays green.
   - Say that the PR reverses the f511e05d6e hoist from #32631, and paste Node's output for fixture 32b.
   - The four `before()`/`after()` registration edits go in their own small PR with tests.
2. **Report-only sink PR**, about +220/-20 more, of which +76/-28 is Rust: `addLateSubtest()` in test.ts, `jsNodeTestReportDetached(name, status, error)` in jest.rs, `handle_test_completed`. Changes against this diff:
   - Remove `lateBodies`, the `preset` parameter of `executeTestNode`, `kRunnerDone`, the state return and the name-less branch. Say that the body of a late subtest does not run.
   - Report a hook-created global `test()` as its own result.
   - Save and restore the reporter's pending `test_failure` around the detached report, with a JUnit test whose parent also fails.
   - Do not call a subtest late under a `concurrency` ancestor. Decide Node's second condition (`buildPhaseFinished`): the `describe()`/`it()` spelling behaves on the diff exactly as on main.
   - Settle the drain in the same PR, one of two ways:
     - Run the existing per-file drain (`should_drain_event_loop` / `vm.on_before_exit`, test_command.rs:3053) when `reporter.jest.node_test_used`. That is the design of open #35401 (+125/-38).
     - Or state in the docs line that a late subtest is reported only while `bun test` is still in that file.
   - Put the seam to the node:test owner as the first question of the PR. The choice is this native sink (a named line per late test and Node's totals) or a JS-only file-level `afterAll` that throws the recorded errors (no Rust, but one `(fail) (unnamed)` line for all late subtests).
   - Correct the docs sentence and the "Node fails it too" line against the counterexamples in section 2.

**First step:** open a JS-only PR against main, ordered behind #38876, that sets `finished` after the hooks and creates a new `TestNode` per `--retry` attempt (text of #43751/#43803) in /workspace/bun/src/js/node/test.ts. It carries fixtures 32, 32b and 33 and a test that the owner stays green when a hook calls the global `test()`.

Probe files from this review are under /tmp/disp.

## 2. Why

Evidence basis:

- **Re-run.** I re-ran every exit code in the table, and every probe quoted with a result in section 3, on /tmp/base/rel-main/bun (main), /tmp/D/rel-D/bun (diff) and Node v26.3.0.
- **Lane.** Figures marked "(lane)" come from the review lanes and I did not repeat them.
- **Tracker.** The GitHub API was rate-limited when I wrote this, so PR and issue states are as the lanes recorded them. The exceptions are the #32631 squash message (read from local git) and the #34583 close comment (read from the cached response).

| Probe | main | diff | Node v26.3.0 |
|---|---|---|---|
| Node's documented example (fixture 30c) | exit 0, "0 fail" | exit 1 | exit 1 |
| Fixture 32: awaited `t.test()` in after/afterEach hooks | exit 1 | exit 0 | exit 0 |
| Fixture 32b: failing `t.test()` in `t.after()` | exit 0 | exit 1 | exit 1 |
| `--retry 1`, subtest always fails after a timer (/tmp/disp/retry/failing-async-sub.test.js) | exit 1 | exit 0, `(pass) ... (attempt 2)` | no `--retry`; plain run exits 1 |
| #32631 review repro, global `test()` in an inline suite's `after` hook (/tmp/disp/hook/ciro.test.js) | `(pass) p`, exit 0 | `(fail) p`, exit 1 | `p` passes, file entry fails, exit 1 |
| Timer-late subtest, 29 ms sibling (/tmp/disp/race/race.test.js) | exit 0 in 12 of 12 | exit 1 in 6 of 12; 8 of 8 with `BUN_TEST_DRAIN_EVENT_LOOP=1` | exit 1 |
| `concurrency: true` suite (/tmp/disp/green/conc.test.js) | exit 0 | exit 1 | exit 0 |
| Continuation attached in a finished test to an outside promise (/tmp/disp/green/adv1.test.js) | exit 0 | exit 1 | exit 0 |
| `describe()` + `setImmediate` + `it()` (/tmp/disp/built/describe-late.test.js) | fails `unrelated top-level` | same as main | fails `it created too late` |
| Failing subtest 3 or 4 awaits after the body (/tmp/r2probe/p3/aw3, aw4) | exit 0 | exit 0 | exit 1 |

**The gap is real, deferred and uncovered, so the work should exist.**
- Fixture 30c is the example under "Extraneous asynchronous activity" in Node's docs, which upstream pins in output.js:194-200 with a snapshot. It exits 0 on every bun from v1.4.0 to v1.4.3.
- The drop came in with #32631 (1b2bb4eb15). Its message lists the case under "Not covered": "Surfacing it needs the late subtest registered with bun:test after the file's tests are built, so it is deferred."
- A search for `parentAlreadyFinished` returns three PRs: #32631 (merged), #34515 (open, keeps the drop) and #34583 (the same fix). #34583 was closed on 2026-09-13 by a stale sweep whose text says "This is not a judgment on the fix itself".
- The strongest case for yes: "The owner of node:test recorded this exact gap as deferred work in the merged PR that created it and described the fix as surfacing the late test as its own failure through bun:test, no merged or open PR does that, and until one does `bun test` prints "0 fail" and exits 0 on the failing example from Node's own node:test documentation."

**Nobody asked for it, and no existing suite changes verdict.**
- No issue reports a dropped late subtest. The only human-filed issue in the family, #20087 (open since 2025-05-30), asks for late-registered tests to run. Its node:test twin still ends "Ran 0 tests", exit 0 on the diff (lane).
- 178 in-repo node:test files and 163 upstream Node fixtures give the same result on both builds, except bun's own fixture 16 (lane).
- A silent false pass produces no reports, so this is no reason to close. It is the reason the fix must not arrive as +609/-66 with a native seam.
- It would be the 21st open PR on test.ts, where nothing functional has merged since #34444 on 2026-07-23 and where #34583 and #35137 were swept without human review (lane).
- The PR text needs a "Not changed" section that names #20087 and #35137.

**Two lifecycle fixes stand alone.**
- Fixture 32 fails on main and passes on Node; 32b is the reverse.
- Under `--retry 1`, main prints `(pass) parent (attempt 2)` for a parent whose subtest asserts 1 === 2 (/tmp/disp/retry2/flaky-body-failing-sub.test.js).
- /tmp/probe-sb/bun-LB, the base binary with only the three lifecycle hunks, gives fixture 32 three passes, fixture 32b exit 1 and fixture 33 its second-attempt subtest, with no Rust.
- Counted from the PR's own hunks (lane): lifecycle only is 5 files, +178/-21; with the report-only sink on top the total is 10 files, +397/-40.
- The four hook-registration edits belong to neither half. Both halves pass without them (58 of 58 on /tmp/probe-sb/bun-S4, lane) and no test covers them.

**The `--retry` hunk is open twice already and regresses alone.**
- #43751 and #43803 carry the same per-attempt node; their text also copies `filePath` (/tmp/disp/43751.diff).
- Without #38876 the hunk turns exit 1 into exit 0 (table row 4; /tmp/probe-sb/bun-LB does the same).
- #39286 rewrites the same post-hook block with the opposite `finished` order.
- Trial merges show 10 currently clean node:test PRs start to conflict (lane). The PR body names only #34583.

**The native seam is the owner's call, and most of its value is reachable without Rust.** This is the one design-blocker.
- After the recommended trims the PR is still +574/-60 (lane).
- The Rust half is a synthetic `ExecutionEntry` through `handle_test_completed`, the `print_error` split, and `ExecutionEntry::create` widened to `pub(crate)`. It buys the name on the status line and separate skip/todo lines and counts.
- A file-level `afterAll` that throws the recorded errors gives the error, a `(fail)` line, a JUnit failure, `--bail` and exit 1 with no native hook (emulated in /tmp/disp/afterall/aa.test.js).
- #34444 called this seam "a maintainer design call" (lane). REVIEW.md:66 says "New cross-cutting abstractions need maintainer agreement before appearing inside a feature PR". No maintainer has accepted or rejected it.
- The owner's own note describes a third shape, "registered with bun:test after the file's tests are built". Name it in the question.

**The diff fails the owner test on the one case the owner wrote down.**
- #32631 says of exactly this repro: "the late test is counted as its own failure; neither runtime fails the owning test".
- The cause: `runHook` runs a hook body in its owner's store (test.ts:2232). Once `finished` moves after the hooks, a global `test()` in the hook becomes the owner's subtest.
- Reversing the f511e05d6e hoist is right (fixture 32b), but the PR does it without saying so.

**The runner's per-file loop decides what a late subtest does, and the diff leaves it alone.**
- `bun test` leaves a file after `Phase::Done` plus one `tick_immediate_tasks` (test_command.rs:3028-3047).
- The drain at test_command.rs:3053 runs only under `BUN_TEST_DRAIN_EVENT_LOOP=1`, which `run()` children (test.ts:479) and the vendored lane (/workspace/bun/scripts/runner.node.ts:1066) set.
- So a timer-late subtest is reported only while another test still runs (table row 6).
- The late body has no owner. With /tmp/disp/body/a.test.js alone, the body prints "body start" and is cut off at its first await. Followed by b.test.js, the rest runs inside `B slow`. With the drain flag it completes.
- Main never starts the body; Node finishes it before the next file.
- The lane claim that this fails `B slow` did not reproduce with that probe: `B slow` passed.

**"Node fails it too" is false in both directions.**
- The strongest case for no: "The PR's licence to turn green files red without a flag is "Node fails it too", and reproduced inputs show it false both ways: programs that pass under node --test v26.3.0 and exit 0 on main now exit 1 with a wrong "parent finished" error, while the commonest late shapes that Node always fails still exit 0 or flip between 0 and 1 from run to run [...]".
- Table rows 7 and 8 are Node-green inputs that turn red; section 3 item 4 lists three more.
- Rows 6, 9 and 10 are Node-red inputs that stay green or flaky.
- The diff ports one of the two conditions of Node's predicate, `this.finished || this.buildPhaseFinished` (test.js:1031).
- A phase enum is not the fix, because Node's `Test` has none. The two facts bun does not own are a postRun step and `buildPhaseFinished`.
- The docs sentence says "is reported as a failed test, as on Node.js" with no carve-out.

**The sink itself holds up, with one defect.**
- On fixture 30c, `--bail=1`, `--dots`, `--only-failures`, `--isolate`, `--parallel=2` and JUnit all report the late subtest and exit 1.
- The defect is the shared JUnit failure slot (section 3 item 1).
- Keep the sink single-purpose; do not widen it to ordinary subtests.

**Two side issues to record.**
- Fixtures are checked against Node by hand. A 34-line table prototype flags exactly fixtures 01, 02, 15 and 16 (lane). Land one shared `referenceNode` helper and one table (open #45334 carries the helper) in place of a fourth copy plus five hand-written "on node" tests.
- Awaiting a late subtest never settles on Node v24 and later, which is an unreported upstream defect. Keep bun's "resolves at once", state it as a deviation, and file the nodejs/node issue. The fixture comment "on Node this never finishes" is not true for v22 (lane).

## 3. If it proceeds anyway: execution concerns

Each item names the PR of the series it belongs to.

### Should-fix

**1. "The detached report takes the JUnit failure of the test that is still completing." (sink PR)**
- Evidence:
  - The reporter has one `test_failure` slot (test_command.rs:965-968). `print_error(.., of_test = true)` records into it (bun_test.rs:1326-1355), and `handle_test_completed` takes it for whatever result it is handed (test_command.rs:1361).
  - The new caller prints at jest.rs:613 and completes at jest.rs:632 while a running test's failure can be pending.
  - /tmp/disp/steal/steal3.test.js with `--reporter=junit`: the diff writes `message="B failed"` under `<testcase name="late">` and `<failure type="Error" />` under `B`. Main records `B` correctly.
  - The synthetic entry has no parent scope and no line (jest.rs:615-622). /tmp/prD-round3-probes/junitsplit.test.js comes out as two `<testsuite name="X">` with `late` between them.
  - The SAFETY comment at test_command.rs:377-379 still names `on_uncaught_exception` as the setter.
- Do:
  - In `js_node_test_report_detached`, take `reporter.test_failure` after `name.to_utf8(global)?` (jest.rs:609) and before the error branch, so skip and todo reports are covered. Put it back after `handle_test_completed`. The cleaner form passes a slot into `print_error` in place of `of_test: bool`.
  - Rewrite the SAFETY comment for both callers and pass `line_no` at jest.rs:620.
  - Add a JUnit test with a failing parent, a late subtest from an un-awaited promise chain, and a `{ skip: true }` variant.
  - Keep print-at-creation. A queue is only correct if it flushes as the last statement before `exit_file`, after `tick_immediate_tasks` (test_command.rs:3047). Flushed at `Phase::Done` it drops fixture 30c's subtest.

**2. "The per-attempt `TestNode` makes a failing test print `(pass) (attempt 2)`." (lifecycle PR)**
- Evidence:
  - Every top-level node:test test reports failure through `done(failure)` (test.ts:2691, 2696).
  - `done(err)` raises an uncaught exception first (bun_test.rs:818), which ends attempt 1 and starts attempt 2 (Execution.rs:540-545). The same callback then queues a second completion (bun_test.rs:845-846), which bun:test accepts as attempt 2's.
  - With `--retry 1`, /tmp/prD-round3-probes/retrysubonly.test.js, retry33bad.test.js and retry16b.test.js each exit 1 on main and 0 on the diff.
  - Fixture 33 cannot detect this because its subtest is synchronous.
- Do:
  - Land #38876 first, or carry its generation check.
  - A JS-only alternative from the review, not built: complete through the promise the runner returns, and keep `done` only for `markCurrentResult`.
  - Add two fixtures that fail on ab3e94328c: fixture 33 with an awaited timer in the subtest (expect "sub 2" in EVENTS), and a test that fails after an await on every attempt (expect `(fail) ... (attempt 2)`, exit 1).

**3. "A late subtest of a retried attempt is a failure no retry count can absorb." (sink PR)**
- Evidence:
  - /tmp/probeRetry/p/nt-timeout-zombie.test.js with `--retry 1`: main exits 0. The diff prints `(pass) integration (attempt 2)`, then `(fail) step 1` and `(fail) step 2`, exit 1.
  - The replaced node stays `finished` and reachable through its `t` (test.ts:2669-2675). The detached result bypasses the retry decision (Execution.rs:536-556).
- Do: mark the replaced node superseded in `createTopLevelTestRunner`. In the late branch, return the resolved promise without a report when the finished parent or an ancestor is superseded, as main does. Add the test and a Downsides line.

**4. "'Node fails it too' is not true. Report only where bun can prove Node's verdict." (sink PR)**
- Evidence: each input below exits 0 on main and on Node and 1 on the diff, with "test could not be started because its parent finished".
  - **Inferred parent.** Only `t.test()`/`t.describe()` pass a parent (test.ts:1843-1851). The global spellings use `executionParent ?? currentNode()` (test.ts:2711, 2809), which is AsyncLocalStorage; Node follows the async-id trigger chain (harness.js:392). Probes: /tmp/disp/green/adv1.test.js and /tmp/hgprobe/after-timer-pass.test.js (an immediate started inside `t.after`).
  - **`concurrency` ancestor.** bun runs subtests serially (test.ts:1560-1561), so its `finished` comes earlier than Node's (test.js:983-1010, 1611). Probe: /tmp/disp/green/conc.test.js.
  - **`t.after()` hooks.** bun reaches `finished = true` (test.ts:2411) in fewer turns per hook than Node. /tmp/prD-round3-probes/ticks3.test.js fails on the diff at H=1 with K=7 and 8, and at H=2 with K=9 and 15.
  - **`t.signal`.** Node aborts it before `finished` (test.js:1427-1431, nodejs/node#48827); bun never aborts it. /tmp/prD-round3-probes/signal.test.js prints a `(fail) tick N` line per interval tick.
- Do:
  - In `addTest` and `addSuite` (test.ts:2713, 2810), call `addLateSubtest` only when `executionParent !== undefined` and no ancestor has `concurrency === true` or above 1. Otherwise keep main's `Promise.resolve(undefined)`.
  - A prototype of this gate removed all 20 Node-green failures the lanes measured and kept fixtures 16, 30 and 30c. Four further inputs still failed under it (lane), so replace "Node fails it too" with the measured scope.
  - For the hook window, hold `finished` until a macrotask boundary when `node.hooks.after.length > 0`, or resolve and ignore there.
  - For `t.signal`, carry #39287's abort-at-finish (about 20 lines: abort after the after-hooks loop at test.ts:2392-2398 and before 2411, not for suites), or land after it.
  - No flag or env var is needed. #32631 and #38442 changed node:test exit codes without one (lane).
  - With this gate, the late-suite branch, `isLate` and the cancelled-child events can be deleted. That removes items 10 and 17 and most of item 11.

**5. "A global `test()` created in a hook fails the wrong test." (lifecycle PR, then sink PR)**
- Evidence: table row 5. Node attaches such a test to the `TestHook` (test.js:1700, harness.js:392). It counts and sets the exit code, the owner passes, and no line is printed for it.
- Do: keep the owner green in step 1 and report the test through the sink in step 2. Say in the PR that the named line is bun's presentation, because Node prints none.
- One execution reviewer argued for keeping the diff's behaviour because the exit code already equals Node's. The owner's sentence in #32631 settles it the other way.

**6. "The report is deterministic only under `BUN_TEST_DRAIN_EVENT_LOOP=1`, and neither the docs nor a test says so." (sink PR)**
- Evidence: test_command.rs:932-948, 3047, 3053; table row 6. Plain `bun test` behaves like `node --test --test-force-exit` plus one immediate tick. Three shapes have no test and no line in the PR:
  - A timer-late subtest after the last test: exit 0 where Node exits 1.
  - An un-awaited subtest created in `t.after`: awaited on the diff, cancelled on Node (lane).
  - A late subtest printed, and recorded in JUnit, under the next file (lane).
- Do: settle the drain as in section 1. Add one late-subtest test under the drain regime (the timer shape with the env var, or through `run()`), so #35401 cannot move the drain unnoticed. Pin the three shapes as known differences with a Node reference test each.

**7. "The late-body path runs user code the runner does not own, and nothing tests it." (sink PR)**
- Evidence: the per-file-loop paragraph in section 2. jest.rs:604 returns DONE from the phase alone, and test.ts:2621-2622 starts the body on it. The name-less branch at jest.rs:605-608 has no caller: the one call site, test.ts:2534, always passes `node.name`.
- Do: delete `lateBodies` (test.ts:2555), `preset` (test.ts:2284, 2367, 2422), `kRunnerDone` (test.ts:1658), the state return and jest.rs:605-608. State that the body does not run.
- If the body run stays: return DONE only when `phase == Done && should_drain_event_loop()`, reset the chain per file, and add a test that asserts the events.

**8. "The new post-hook drain is outside the test's timeout." (lifecycle PR)**
- Evidence:
  - `stop?.dispose()` runs at test.ts:2357, before the hooks. `await drainSubtestChain(node)` at test.ts:2402 is raced against nothing.
  - /tmp/probeR4/fx/zombie-hookwindow.test.js, a `{ timeout: 50 }` test: main reports at 124 ms, the diff at 1621 ms.
  - zombie-never.test.js: main says "test timed out after 50ms" at 92 ms. The diff reports at 5000 ms with bun:test's "remove the last parameter from the test callback function".
  - With `{ timeout: Infinity }` nothing bounds it (test.ts:2644-2646).
- Do: bound the drain with what the body left of the timeout, as #39286 does (`stop.remaining()`). Set `node.finished = true` whether or not the drain completed. Surface "test timed out after Nms" when the bound wins.

**9. "A failing subtest created 3 or 4 awaits after the body still passes silently." (lifecycle PR)**
- Evidence:
  - /tmp/r2probe/p3/aw1 to aw6: 1 or 2 awaits fail the parent, 3 or 4 exit 0 (Node exits 1), 5 or more are reported late.
  - The last drain check is at test.ts:2467. The snapshot at test.ts:2378 already holds the new link, so the comparison at test.ts:2401 is false and `failedSubtests` is not read again.
- Do: after the hooks, loop `while (node.subtestChain !== settled) { settled = node.subtestChain; await settled }`, with no await between the last check, the recount and `finished = true`. Do the same for inline suites (test.ts:2491-2502). Add a fixture that also runs on Node.
- Cost to state: a passing subtest created one turn later is awaited where Node cancels it.

**10. "The late-suite branch decides by shape where Node decides by phase, and it swallows the callback's throw." (sink PR)**
- Evidence:
  - `isLate()` (test.ts:2527-2531, one caller at 2567) is true for any child of a node that hangs on the root. A late suite gets `finished = true` before its callback runs (test.ts:2606-2612). A test created in that suite's context after the callback returned is therefore dropped, exit 0 where Node exits 1 (lane).
  - The callback's synchronous throw is discarded by `catch {}` (test.ts:2611-2614). /tmp/probeD/fx/late-suite-throws.test.js prints only the parentAlreadyFinished error on the diff; Node reports "thrown by the suite callback" (test.js:1809-1814).
- Do, if the branch survives item 4:
  - Replace `isLate()` with a `lateBuild` flag, set before the callback at test.ts:2612 and cleared when it returns or settles.
  - Run the callback before computing `failure`, `status` and `printed`, and make a synchronous throw the node's failure.

**11. "The diff adds a fourth and fifth hand-built copy of the run() payload, and both already differ from Node." (sink PR)**
- Evidence:
  - Copies exist at test.ts:707-718, 730-741 and 2505-2515 on base. The diff adds 2537-2549 and 2572-2583 (REVIEW.md:57, 64).
  - `republishChildEvent` counts a `cancelledByParent` event as failed (test.ts:641). /tmp/probeRC/run-summary.js on fixture 30b gives "fail 4, cancelled 0" on the diff and "fail 3, cancelled 1" on Node.
  - `fileFailed` is `exitCode !== 0 && fileCounts.failed === 0` (test.ts:552), so a file whose only failure is a late suite gets a second, false file-level `testCodeFailure`. Probe: /tmp/edgeprobe/pr-run.js on /tmp/probeD/fx/only-late-suite.test.js.
  - The PR's one run() test compares only the list of failed events, on a fixture with other failures.
- Do:
  - Add `cancelledByParentFailure()` beside `makeSubtestsFailure` and use it at test.ts:428 and 2581.
  - Report late nodes through `reportNodeToRunParent`.
  - Add Node's cancelled arm (runner.js:128-129) to the counter.
  - Derive `fileFailed` and `success` (test.ts:552, 575) from a per-file "child reported a failure" flag.
  - Take the hunks from #39286 so the rebase is identical.

**12. "`|| owner.finished` in module-level `before()`/`after()` drops a cleanup hook without a word." (own PR)**
- Evidence: test.ts:2941, 2960. The only reader of `owner.hooks.after`, the loop at test.ts:2392-2398, has already run, so the hook never runs. /tmp/probeAH/v6-then-in-stale-context.test.js: Node and main print "after() hook ran"; the diff does not.
- Do: move the four edits to their own PR, with a fixture for the stale-hooks shape and the Done-phase shape, so reverting any of them fails a test.

**13. "Two thirds of the added clauses can be deleted with the suite still green." (both PRs)**
- Evidence:
  - 35 of 53 single-clause mutants of the added node:test code survive all 58 tests, and applying every survivor at once still gives 58 pass (lane).
  - The survivors cover the whole late-body path, all four hook-registration hunks, both post-hook drains, and the late skip/todo/expectFailure branches.
  - No test passes `--bail`, `--dots`, `--only-failures`, `--parallel` or `--isolate` on the detached path. The driver passes only `--reporter=junit` (driver:468-469) and `--retry 1` (driver:544).
  - REVIEW.md:10 requires that deleting each load-bearing clause breaks a test.
- Do:
  - Add one `test.each` over `--dots`, `--only-failures`, `--bail=1` and `--isolate` on 30c. Each exits 0 on base.
  - For `--dots` and `--only-failures`, also assert that the file header precedes the error. That pins `on_before_print()` at jest.rs:612.
  - Add one `--parallel=2` case with 30c and 30.
  - Add fixtures for hooks on a finished node, hook-window failures, and late `skip`/`todo`/`expectFailure`.

### Consider

**14. Docs sentence.** The new sentence at the docs line is 32 words, passive, and makes three points. That breaks the Voice rules (/workspace/bun/docs/project/contributing.mdx:389, 391, 396; /workspace/bun/.claude/docs/landing-prs.md:56). Its "but" clause reads as Node's behaviour. Drop the parity half and state only the remaining limitation, in one short active sentence with Bun as the actor.

**15. Integer tables.** `kDetachedFail/Pass/Skip/Todo` and `kRunnerDone` (test.ts:1653-1658) mirror bare literals and a `_ => Fail` catch-all in jest.rs:597-599 and 625-630. No test pins Pass = 1 or Done = 2 (lane). Return a boolean, or nothing once item 7 lands. Pass the status as a string decoded with `comptime_string_map!`, as `expect.rs` does.

**16. Upstream scorecard.** The PR never says whether it changes any upstream Node test. It does not: 0 flips in 164 upstream files, and the vendored count stays 25 of 78 (lane). Say so. Also say that of Node's two late-subtest cases the diff fixes output.js:195 and not describe_it.js:178.

**17. Late-suite depth.** The late-suite branch stops at depth 1. A nested `describe()` callback never runs and the late suite's before/after hooks never run, where Node builds and cancels the whole subtree (lane). Build the subtree or list the difference; no fixture has a second level.

### Nit

**18. Binding style.** Bind `jsNodeTestReportDetached` as a top-level `const`, like `fileGeneration` and `markCurrentResult` (test.ts:1642, 1646). The lazy `??=` wrapper (test.ts:1648-1652) saves nothing, and its optional parameters serve only the caller-less state query.

## 4. What was checked and held up

- **Prior art in other runtimes.** Node has shipped `parentAlreadyFinished` since the first node:test release and has not changed it. Nothing there argues against reporting.
- **A userland workaround in place of the change.** Probed; it does not replace the fix.
- **A bigger drain or a general sink.** The existing per-file drain is enough for node:test, and the sink has no second consumer that would justify a general reporter API.
- **Other sinks.** An errors-counter sink, a warn tier for unprovable late subtests and a stale-root guard were each examined and not adopted. A file-level `afterAll` sink was refuted 2 of 2 as an execution alternative; it remains only as the seam question for the owner in section 1.
- **Reporter side effects outside this PR.** The inspector's TestReporterAgent gets no event for a detached result, and the GitHub Actions annotation has no location for it. Both are accurate and out of scope.
- **Smaller items.** `#[inline(never)]` on `handle_test_completed` (test_command.rs:1264) is a redundant-annotation nit. The placement of `referenceNode`, making fixture 16 runnable on Node, and the `buntest.get()` aliasing pattern are pre-existing or organisational. No CI run of ab3e94328c exists, so the ASAN cost of the new tests is an estimate.

The JUnit files from my re-runs are in /tmp/synth-D (`steal.main.xml`, `steal.diff.xml`, `split.main.xml`, `split.diff.xml`, `30c.xml`).