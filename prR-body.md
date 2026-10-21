### Problem
- `t.error` in a hook and `details.error` of a `run()` `test:fail` event are the raw thrown value. On Node v26.3.0 both are an `ERR_TEST_FAILURE` whose `cause` is that value.
- A reporter that reads the cause gets nothing: `@reporters/github` prints `undefined` for 3 of 6 failures (Notes).
- `executeTestNode` (`src/js/node/test.ts`) keeps the caught value: `failure = err ?? makeTestFailure("test failed")`. `makeTestFailure` sets no `cause`.

### Fix
- `TestFailure` is Node's `ERR_TEST_FAILURE`: own `code`, `failureType` and `cause`. Each catch site wraps the thrown value. Each runner-made failure has Node's failure type.
- `run()` sends the same error to the parent process. The parent's own errors (a failed file, a cancelled file) are records too.
- `bun test` prints the thrown value as before.
- Verified: `node-test.test.ts`, 18 new tests, 8 new fixtures, 5 also run on Node v26.3.0. Self-reviewed: 14 concerns raised, 12 addressed (Notes).

### Background
- An `afterEach` or `after` hook reads the outcome of its test from `t.error` and `t.passed`.
- No issue reports this. The fixture `15-outcome-in-hooks.js` fails on Node because of it.
- #34515 builds this error where it is read (`wrapTestError`, `wrapHookError`), and `t.error` stays raw there. This PR builds it where the failure is stored. @cirospaciari, which layer do you want?

### Downsides
- Code that compares `t.error` with the thrown error must read `t.error.cause`, as on Node.
- An `expectFailure` validator now gets what Node gives it: the `ERR_TEST_FAILURE` for a hook failure or a timeout. Verdicts that used the raw value change (fixture 38).
- Cost: +4,733 bytes of `node:test` JS. A passing test creates no error.

<details><summary>Notes</summary>

`@reporters/github@2.1.4` on a file with six failing tests (`run()` composed with the reporter, `GITHUB_ACTIONS=1`):

```
Node v26.3.0 and this branch          main
'test timed out after 5ms'            undefined
'plan expected 2 assertions ...'      undefined
Error: x                              Error: x
'str'                                 [Error: str]
'test was expected to fail ...'       undefined
Error: child                          Error: child
```

What a hook reads, for `throw new Error("boom")`:

```
Node v26.3.0 and this branch:  t.error.code === "ERR_TEST_FAILURE", t.error.failureType === "testCodeFailure", t.error.cause === the thrown error
main:                          t.error === the thrown error
```

Scope. This PR changes what the error is, not when a test gets it. The order of the hooks, the hooks that run after a hook throws, and the moment when failed subtests count stay as on main. A follow-up ports `Test.fail()`, `Test.pass()` and Node's hook order on top of this record.

Details of the record:
- The stack of the record is one line, `Error [ERR_TEST_FAILURE]: <message>`. For the two failures that the runner throws into user code (`t.plan()` called twice, the callback called twice) the stack also has the frames of that code, as on Node. No other frame is captured, so a user `Error.prepareStackTrace` does not run when a test fails (`35b-failure-without-user-code.js`).
- `t.error.constructor === Error`, as on Node.
- The reason of an aborted `t.before(fn, { signal })` is stored as it is, with `failureType` `"testAborted"`, as on Node. A frozen reason stays as it is, and a primitive reason becomes the `cause` of an `ERR_TEST_FAILURE`: Node throws a TypeError for both (`35c-values-node-cannot-report.js`).
- The printed error of a plan failure, a timeout or a repeated callback has one more line, `failureType`. For a hook that times out the line says `hookFailed`, in a test, in a suite and at the top level (`37b-hook-timeout-output.js`).
- The stack getter of the two failures that the runner throws into user code calls `String` methods that are captured at module load (`REVIEW.md:55`). `35b-failure-without-user-code.js` patches them.
- The parent of `run()` makes two errors itself: for a file that exits with a failure, and for a file that it cancels. They are records too, so `details.error.cause` is their message. On main they have no `cause`.

Self-review. Addressed: no user code at record time, the `constructor` getter, the stack of the two thrown-into-user-code failures, the abort reason, plain errors for what the parent of `run()` rebuilds from a child, the failure type and the "hook failed" text of printed hook failures, the `expectFailure` validator input (fixture 38), tests for the plan timeout, for hook failures and for top-level `describe`/`it` (fixture 36c), the custom-inspect retry for the message, a table test of the `run()` errors against Node, and the split of the hook-order port into a follow-up. Not done: the `referenceNode` helper stays in the test file, as in #45334 (the same text, so that the PRs merge without a conflict in it). No tracking issue exists for the list below.

Not covered here:
- A verdict that bun:test decides (its 5 second watchdog, an uncaught error) does not reach `t.error`: #43751, #43803.
- A top-level `describe()` has no outcome of its own: #39331.
- A thrown object that is not an Error arrives in the parent of `run()` as an Error, because the events are JSON.
- `run()` counts a timeout as `fail`, Node as `cancelled`: #39286.
- A subtest whose parent has a `before` hook that fails gets no `test:fail` event of its own in `run()`, as on main. Node sends one with `failed running before hook`. The follow-up moves this gate.
- The error of a file that exits with a failure has the stderr text of the file as its message, as on main. Node's message is `test failed`, and its error also has `exitCode` and `signal`.

</details>
