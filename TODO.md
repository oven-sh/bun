loc diff: `git diff (git merge-base origin/main HEAD) HEAD --numstat --shortstat -- ":!test" ":!*.ts" ":!*.js" ":!TODO.md"`

# New features:

## Concurrent tests

Concurrent tests allow running multiple async tests at the same time.

```ts
// concurrent.test.ts
test.concurrent("this takes a while 1", async () => {
  await Bun.sleep(1000);
});
test.concurrent("this takes a while 2", async () => {
  await Bun.sleep(1000);
});
test.concurrent("this takes a while 3", async () => {
  await Bun.sleep(1000);
});
```

Without `.concurrent`, this test file takes 3 seconds to run because each one has to wait for the one before it to finish before it can start.

With `.concurrent`, this file takes 1 second because all three sleeps can run at once.

```
$> bun-after test concurrent
concurrent.test.js:
✓ this takes a while 1 [1005.36ms]
✓ this takes a while 2 [1012.51ms]
✓ this takes a while 3 [1013.15ms]

 3 pass
 0 fail
Ran 3 tests across 1 file. [1081.00ms]
```

To run all tests as concurrent, pass the `--concurrent` flag when running tests.

Limitations:

- concurrent tests cannot attribute `expect()` call counts to the test, meaning `expect.assertions()` does not function
- concurrent tests cannot use `toMatchSnapshot`. `toMatchInlineSnapshot` is still supported.
- `beforeAll`/`afterAll` will never be executed concurrently. `beforeEach`/`afterEach` will.

## Chaining

Chaining multiple describe/test qualifiers is now allowed. Previously, it would fail.

```ts
// chaining-test-qualifiers.test.ts
test.failing.each([1, 2, 3])("each %i", async i => {
  throw new Error(i);
});
```

```
$> bun-after test chaining-test-qualifiers
a.test.js:
✓ each 1
✓ each 2
✓ each 3
```

# Breaking changes:

## Describe ordering

Previously, describe callbacks were called immediately. Now, they are deferred until the outer callback has finished running. The previous order matched Jest. The new order is similar to Vitest, but does not match exactly.

```ts
// describe-ordering.test.ts
describe("outer", () => {
  console.log("outer before");
  describe("inner", () => {
    console.log("inner");
  });
  console.log("outer after");
});
```

Before, this would print

```
$> bun-before test describe-ordering
outer before
inner
outer after
```

Now, this will print

```
$> bun-after test describe-ordering
outer before
outer after
inner
```

## Test ordering

Describes are no longer always called before tests. They are now in order.

```ts
// test-ordering.test.ts
test("one", () => {});
describe("scope", () => {
  test("two", () => {});
});
test("three", () => {});
```

Before, this would print

```
$> bun-before test test-ordering
✓ scope > two
✓ one
✓ three
```

Now, this will print

```
$> bun-after test test-ordering
✓ one
✓ scope > two
✓ three
```

## Preload hooks

Previously, beforeAll in a preload ran before the first file and afterAll ran after the last file. Now, beforeAll will run at the start of each file and afterAll will run at the end of each file. This behaviour matches Jest and Vitest.

```ts
// preload.ts
beforeAll(() => console.log("preload: beforeAll"));
afterAll(() => console.log("preload: afterAll"));
```

```ts
// preload-ordering-1.test.ts
test("demonstration file 1", () => {});
```

```ts
// preload-ordering-2.test.ts
test("demonstration file 2", () => {});
```

```
$> bun-before test --preload=./preload preload-ordering
preload-ordering-1.test.ts:
preload: beforeAll
✓ demonstration file 1

preload-ordering-2.test.ts:
✓ demonstration file 2
preload: afterAll
```

```
$> bun-after test --preload=./preload preload-ordering
preload-ordering-1.test.ts:
preload: beforeAll
✓ demonstration file 1
preload: afterAll

preload-ordering-2.test.ts:
preload: beforeAll
✓ demonstration file 2
preload: afterAll
```

## Describe failures

Current behaviour is that when an error is thrown inside a describe callback, none of the tests declared there will run. Now, describes declared inside will also not run. The new behaviour matches the behaviour of Jest and Vitest.

```ts
// describe-failures.test.ts
describe("erroring describe", () => {
  test("this test does not run because its describe failed", () => {
    expect(true).toBe(true);
  });
  describe("inner describe", () => {
    console.log("does the inner describe callback get called?");
    test("does the inner test run?", () => {
      expect(true).toBe(true);
    });
  });
  throw new Error("uh oh!");
});
```

Before, the inner describe callback would be called and the inner test would run, although the outer test would not:

```
$> bun-before test describe-failures
describe-failures.test.ts:
does the inner describe callback get called?

# Unhandled error between tests
-------------------------------
11 |   throw new Error("uh oh!");
             ^
error: uh oh!
-------------------------------

✓ erroring describe > inner describe > does the inner test run?

 1 pass
 0 fail
 1 error
 1 expect() calls
Ran 1 test across 1 file.
Exited with code [1]
```

Now, the inner describe callback is not called at all.

```
$> bun-after test describe-failures
describe-failures.test.ts:

# Unhandled error between tests
-------------------------------
11 |   throw new Error("uh oh!");
             ^
error: uh oh!
-------------------------------


 0 pass
 0 fail
 1 error
Ran 0 tests across 1 file.
Exited with code [1]
```

## Hook failures

Previously, a beforeAll failure would skip subsequent beforeAll()s, the test, and the afterAll. Now, a beforeAll failure skips any subsequent beforeAll()s and the test, but not the afterAll.

```js
beforeAll(() => {
  throw new Error("before all: uh oh!");
});
test("my test", () => {
  console.log("my test");
});
afterAll(() => console.log("after all"));
```

```
$> bun-before test hook-failures
Error: before all: uh oh!

$> bun-after test hook-failures
Error: before all: uh oh!
after all
```

Previously, an async beforeEach failure would still allow the test to run. Now, an async beforeEach failure will prevent the test from running

```js
beforeEach(() => {
  await 0;
  throw "uh oh!";
});
it("the test", async () => {
  console.log("does the test run?");
});
```

```
$> bun-before test async-beforeeach-failure
does the test run?
error: uh oh!
uh oh!
✗ the test

$> bun-after test async-beforeeach-failure
error: uh oh!
uh oh!
✗ the test
```

## Hook timeouts

Hooks will now time out, and can have their timeout configured in an options parameter

```js
beforeAll(async () => {
  await Bun.sleep(1000);
}, 500);
test("my test", () => {
  console.log("ran my test");
});
```

```
$> bun-before test hook-timeouts
ran my test
Ran 1 test across 1 file. [1011.00ms]

$> bun-after test hook-timeouts
✗ my test [501.15ms]
  ^ a beforeEach/afterEach hook timed out for this test.
```

## Hook execution order

beforeAll will now execute before the tests in the scope, rather than immediately when it is called.

```ts
describe("d1", () => {
  beforeAll(() => {
    console.log("<d1>");
  });
  test("test", () => {
    console.log("  test");
  });
  afterAll(() => {
    console.log("</d1>");
  });
});
describe("d2", () => {
  beforeAll(() => {
    console.log("<d2>");
  });
  test("test", () => {
    console.log("  test");
  });
  afterAll(() => {
    console.log("</d2>");
  });
});
```

```
$> bun-before test ./beforeall-ordering.test.ts
<d1>
<d2>
  test
</d1>
  test
</d2>

$> bun-after test ./beforeall-ordering.test.ts
<d1>
  test
</d1>
<d2>
  test
</d2>
```

## afterAll inside test

afterAll inside a test is no longer allowed

```ts
test("test 1", () => {
  afterAll(() => console.log("afterAll"));
  console.log("test 1");
});
test("test 2", () => {
  console.log("test 2");
});
```

```
$> bun-before
test 1
✓ test 1 [0.05ms]
test 2
✓ test 2
afterAll

$> bun-after
error: Cannot call afterAll() inside a test. Call it inside describe() instead.
✗ test 1 [1.00ms]
test 2
✓ test 2 [0.20ms]
```

## Only is not allowed in CI

(TODO)

# Test failures:

## Real

- [ ] test/js/bun/net/tcp-server.test.ts
  - new flaky failure on windows
  - gc(true) was supposed to fix this. unclear.
- [ ] test/js/node/test/parallel/test-runner-subtest-after-hook.js
  - Instead of this vvvv, we will modify our node:test implementation to support this.
  - Execution: first: \*ConcurrentGroup, current: \*ConcurrentGroup
  - ConcurrentGroup: next: \*ConcurrentGroup, memory-pool
  - ExecutionSequence: first: \*ExecutionEntry, current: \*ExecutionEntry
  - ExecutionEntry: next_orig: \*ExecutionEntry, next: \*ExecutionEntry (on reset, set it back to next_orig)
  - or use indices?
- [x] test/js/bun/http/serve.test.ts
  - unfortunately, afterAll is supported inside of tests concurrently and causes the block to execute at the end
    - if we implement it, we would want it to execute after the test?
    - jest errors "Hooks cannot be defined inside tests. Hook of type "afterAll" is nested within "jkl"."
    - vitest silently ignores the hook
- [x] maybe fixed, maybe not. vendor/elysia/test/validator/params.test.ts
  - probably test() inside test(). should be fixed in elysia unless we want to do the linked list test-in-test support
- [x] test/js/third_party/prisma/prisma.test.ts
  - the issue is that we are async-enqueueing describe()s
  - the error is bad in this case
    "error: Cannot call describe() inside a test. Call it inside describe() instead."
    improved? error:
    "error: describe() was called while test "(test_name)" is running. Call it inside describe() instead."
- [ ] test/cli/install/bun-install-registry.test.ts
  - not sure if this is real or flaky
- [ ] test/js/web/fetch/fetch.stream.test.ts
  - this is usually a flaky failure but was a failure. this is maybe related to missing retry/rerun options.
- [ ] test/js/bun/shell/leak.test.ts
  - likely real leak beacuse of DoneCallback & ScopeFunctions

## Stacktrace

- [ ] test/js/bun/test/test-error-code-done-callback.test.ts
  - stacktrace is messed up. it's including an incorrect item in the stacktrace for some reason.
- [ ] test/js/bun/util/inspect-error.test.js
  - same stacktrace issue
- [ ] test/js/bun/test/stack.test.ts
  - we're adding an extra `at unknown` frame at the end of the stacktrace for some reason. likely same issue as the above stacktrace bugs.

## Flaky on main

- [ ] test/bundler/compile-windows-metadata.test.ts
- [ ] test/js/sql/sql-mysql.test.ts
- [ ] test/js/bun/http/bun-serve-file.test.ts
- [ ] test/cli/inspect/BunFrontendDevServer.test.ts
- [ ] test/bake/dev/stress.test.ts
- [ ] test/js/node/http2/node-http2.test.js
- [ ] test/bake/dev/hot.test.ts
- [ ] test/js/web/websocket/autobahn.test.ts
- [ ] test/js/node/test/parallel/test-child-process-fork-exec-path.js
- [ ] test/js/web/timers/setInterval.test.js
- [ ] test/js/node/test/parallel/test-stdin-pipe-large.js
- [ ] test/napi/napi.test.ts
- [ ] test/js/bun/s3/s3.test.ts
- [ ] test/cli/install/bun-install.test.ts
- [ ] test/bundler/bundler_edgecase.test.ts
- [ ] test/regression/issue/09041.test.ts
- [ ] test/js/web/fetch/fetch.test.ts
- [ ] test/integration/next-pages/test/dev-server-ssr-100.test.ts

# Add features:

- [x] nvm ~~revert how scopefunctions works to how it was before. add all the props to everything. `.skip.only` is the same as `.only.skip`. 32 possible combinations so it's fine.~~
- [ ] need to cache the JSValue created from DoneCallback.callAsFunction
- [ ] test/js/node/http2/node-http2.test.js
  - this spams output with 'killed 1 dangling process' now - consider only showing that for timeout failures
- [ ] change DoneCallback and ScopeFunctions to both use bound functions
  - DoneCallback will hold a jsvalue with the data
  - ScopeFunctions could be implemented by using 3 jsvalues and packing the data
  - A prototype can be set on a bound function for ScopeFunctions
  - We will want to make and reuse a structure (faster than setting the prototype every time?)
  - Easiest way is to change scopefunctions and donecallback to not be callable, then use those as the jsvalues in the binding
  - Implementation path:
    - add a binding for `.bind()`
    - add the function
    - figure out the structure stuff
    - revert the bindgen changes
- [x] The error is duplicated:
  ```js
  test("abc", async () => {
    await (async () => {
      throw new Error("abc");
    })();
  });
  ```
- [x] `done` is missing `.call()`/`.apply()`
- [ ] switch to a memory pool instead of individually-tracked scope allocations
- [x] `describe.skip()` is not displaying the tests it skipped; fix
- [ ] ~~drain microtasks / tick? between callback calls? tickImmediateTasks()? use a Task to queue callback execution? for "unhandled errors between tests are reported"~~
  - instead of this, let's modify the test
- [x] add back vm.auto_killer.kill() https://github.com/oven-sh/bun/blob/973fa98796a3be79b48f0d078485b5833d956593/src/bun.js/test/jest.zig#L1690
- [ ] add retry/repeat back
- [ ] make sure ScopeFunctions class can finalize (see napi_handle_scope NapiHandleScopeImpl as an example)
  - currently, it never calls its finalize method because it no longer extends from finalize
- [ ] make sure DoneCallback class can finalize, same as above
- [x] weak pointers to BunTest
- [ ] fix `test("rerun me", () => { console.log("run one time!"); });` `--rerun-each=3`. works 1, no message 2, fails 3. note that existing behaviour is similar?
- [ ] bun test > support for Github Actions > should annotate a test timeout
- [ ] a failure in beforeAll should prevent tests from running "unhandled errors between tests are reported"

# Add tests:

- [ ] regression test that this doesn't hang forever:
  ```js
  test("uncaught error", async () => {
    setTimeout(() => {
      throw new Error("uncaught error");
    }, 1000);
    await Bun.sleep(2000);
  });
  ```
- [x] what is existing behaviour for an uncaught exception? do we resume execution immediately or later?
- [ ] add tests for re-entry in different scenerios (timeout, done callback, ...) using waitForPromise in expect()
- [ ] validate junit output does not regress (make sure the generated xml files are identical to existing behaviour)
- [ ] add tests for debugger.test_reporter_agent reporting, maybe using `bun-debug x bun-inspect-echo` or using the existing setup but fixing it
- [ ] test passing bad values to describe()/test()
- [ ] move the testing files into being real behaviour tests
- [ ] test that `test.concurrent(() => {}, 200) + test.concurrent(() => {}, 400)` both fail with timeout

# Final validation:

- [ ] consider potential for silently skipped/failing tests that are not skipped on main
- [ ] run benchmarks again
  - benchmark these cases:
    - 1,000,000 tests () on branch vs merge-base (describe.each(1,000) > test.each(1,000))
    - 1,000,000 test.skip() calls (one describe.each over a 1,000,000 item array)
    - test also with the `--concurrent` flag
- [x] remove done_promise, unused.
- [x] remove runErrorHandlerWithDedupe, last_reported_error_for_dedupe
- [ ] eliminate fn bunTest() in Execution.zig
- [ ] validate uses of sequence.entry_index (entry_index can be >= entries_end)
- [ ] replace asserts with runtime throws or debug-only asserts (waitForPromise breaks many expectations)
- [ ] replace debug-only assert with `Bun.Environment.ci_assert` guarded asserts
- [ ] search for TODOs in the diff and fix them all
- [ ] check the todo list in https://linear.app/oven/issue/ENG-20152/new-buntest, confirm it fixes all those issues (or doesn't make them worse). add reproductions
- [ ] look in file:///Users/pfg/Dev/Node/bun-coverage/coverage-html/src/bun.js/test/jest.zig.gcov.html and find things to remove
- [ ] disable the logs by default
- [ ] audit and remove unneeded/outdated comments
- [ ] remove TODO.md

# Other:

- [x] remove TestId stuff
- [x] when a timeout triggers on a function with a done callback because the done callback was never called, note in the error that the function must call the done callback
- [x] support skipping execution if a preload hook fails
- [x] is there a breaking change for:
  - `test("error condition", async () => { setTimeout(() => {throw new Error("0")}, 0); await new Promise(() => {}) })`
  - no change.
- [x] test what happens running a file that uses describe() not in `bun test`. make sure it errors with the correct error. this might have regressed, if so, fix it.
- [x] make sure done callback is supported in hooks
- [x] Add expect counts back
- [x] add back expecting a test to have a certain number of expect calls
- [x] add a test for done callback nexttick after
- [x] Add timeouts back
  - When we begin executing a test group, mark the end_before times of each item in the group
  - Start a timer for the min of these times
  - When a test group ends, cancel the timer
  - When the timer triggers, find any tests which are past their end time. Mark them as timed out.
    - should we advance the sequence in this case or end it completely? not sure. see what vitest/jest do when beforeAll/afterAll exceed the test timeout
  - After this, start the next timer with the new first incomplete test timeout time
- [x] make sure junit works
- [x] support having both a done callback and a promise result
- [x] support expect counter
- [x] support `expect.assertions()` in non-concurrent tests
- [x] test behaviour of `expect.assertions()` in concurrent tests
- [x] test what happens when done callback is called after the test fails to timeout, or promise resolves after. make sure we match existing behaviour
- [x] finalize describe call order. ideally `A[B, C], D[E, F[G]]` will run in normal order rather than `A, D, B, C, E, F, G`
- [x] sometimes error messages aren't printing!
- [x] make sure it exits with code 1 on failure
- [x] decide on preload behaviour: before first/after last?
  - vitest/jest both do them seperately for each file, which makes sense because of isolation
  - bun does them before the first file and after the last file
- [x] add back debugger.test_reporter_agent reporting
- [x] afterEach/afterAll behaviour: forwards order or reverse order? vitest uses reverse order but jest uses forwards order. old bun uses forwards order. we will continue to use forwards order to reduce breakage, although reverse order makes more sense to me.
- [x] announce results of skip/todo with no callback, eg `test.skip("abc")` or `test.todo("def")`
- [x] fix toMatchInlineSnapshot
- [x] make sure error.SnapshotInConcurrentGroup prints well
- [x] test error.SnapshotInConcurrentGroup
- [x] decide on beforeAll/beforeEach behaviour
  - decide if beforeEach/beforeAll/afterEach/afterAll should skip executing the test and when. do we match existing behaviour, jest, vitest, or diverge? what does existing behaviour/jest/vitest do?
  - these are all tested flat, not sure if it changes with describe()
  - none
    - jest: beforeAll1 beforeAll2 beforeEach1 beforeEach2 test1 afterEach1 afterEach2 beforeEach1 beforeEach2 test1 afterEach1 afterEach2 afterAll1 afterAll2
    - vitest: beforeAll1 beforeAll2 beforeEach1 beforeEach2 test1 afterEach2 afterEach1 beforeEach1 beforeEach2 test1 afterEach2 afterEach1 afterAll2 afterAll1
    - bun: beforeAll1 beforeAll2 beforeEach1 beforeEach2 test1 afterEach1 afterEach2 beforeEach1 beforeEach2 test1 afterEach1 afterEach2 afterAll1 afterAll2
  - error in beforeAll:
    - jest: <b>beforeAll1</b> beforeAll2 <s>beforeEach1 beforeEach2 test</s> afterEach1 afterEach2 <s>beforeEach1 beforeEach2 test1</s> afterEach1 afterEach2 afterAll1 afterAll2
    - vitest: <b>beforeAll1</b> <s>beforeAll2 beforeEach1 beforeEach2 test1 afterEach2 afterEach1 beforeEach1 beforeEach2 test1 afterEach2 afterEach1</s> afterAll2 afterAll1
    - bun: <b>beforeAll1</b> <s>beforeAll2 beforeEach1 beforeEach2 test afterEach1 afterEach2 beforeEach1 beforeEach2 test1 afterEach1 afterEach2 afterAll1 afterAll2</s>
  - error in beforeEach:
    - jest: beforeAll1 beforeAll2 <b>beforeEach1</b> <s>beforeEach2 test1</s> afterEach1 afterEach2 <b>beforeEach1</b> <s>beforeEach2 test1</s> afterEach1 afterEach2 afterAll1 afterAll2
    - vitest: beforeAll1 beforeAll2 <b>beforeEach1</b> <s>beforeEach2 test1</s> afterEach2 afterEach1 <b>beforeEach1</b> <s>beforeEach2 test1</s> afterEach2 afterEach1 afterAll2 afterAll1
    - bun: beforeAll1 beforeAll2 <b>beforeEach1</b> <s>beforeEach2 test1</s> afterEach1 afterEach2 <b>beforeEach1</b> <s>beforeEach2 test1</s> afterEach1 afterEach2 afterAll1 afterAll2
  - error in afterEach
    - jest: beforeAll1 beforeAll2 beforeEach1 beforeEach2 test1 <b>afterEach1</b> afterEach2 beforeEach1 beforeEach2 test1 <b>afterEach1</b> afterEach2 afterAll1 afterAll2
    - vitest: beforeAll1 beforeAll2 beforeEach1 beforeEach2 test1 <b>afterEach2</b> <s>afterEach1</s> beforeEach1 beforeEach2 test1 <b>afterEach2</b> <s>afterEach1</s> afterAll2 afterAll1
    - bun: beforeAll1 beforeAll2 beforeEach1 beforeEach2 test1 <b>afterEach1</b> <s>afterEach2</s> beforeEach1 beforeEach2 test1 <b>afterEach1</b> <s>afterEach2</s> afterAll1 afterAll2
- [x] make the summary work again
- [x] support the default per-test timeout
- [x] report expect counts per-test
- [x] make --bail work again
- [x] update types for `test.concurrent.skip.only()`
- [x] make test filtering work again
- [x] add back repeating failure/skip messages at the end of the test print
- [x] make sure failure exits with code 1
- [x] status printing support failures and other modes
- [x] add back associating uncaught exceptions with the active test
- [x] `test.concurrent.only()`
- [x] `test.skip.only.concurrent()`. basically we need to make it a class that contains the options.
- [x] remove describe/test functions in jest.zig
- [x] remove DescribeScope/TestScope in jest.zig

# Code quality:

- [ ] consider migrating CallbackWithArgs to be a bound function. the length of the bound function can exclude the specified args.
- [ ] consider changing done so instead of the complex ref-counted thing, it is instead made by wrapping the return value of the function with a promise that resolves when the done callback is called
  - in this case, the done function is instead a binding to a function with `[promise] (error) => error != null ? promise.$reject(error) : promise.$resolve()`
  - this significantly simplifies implementation in exchange for runtime cost
- [ ] migrate RefData to bun.ptr.Strong
- [ ] setting both result and maybe_skip is not ideal, maybe there should be a function to do both at once?
- [ ] try using a linked list rather than arraylist for describe/test children, see how it affects performance
- [ ] consider a memory pool for describescope/executionentry. test if it improves performance.
- [ ] consider making RefDataValue methods return the reason for failure rather than ?value. that way we can improve error messages. the reason could be a string or it could be a defined error set
- [ ] instead of 'description orelse (unnamed)', let's have description default to 'unnamed' and not free it if it === the global that defines that
- [x] switch to bun.ptr.shared weak ptr
- [x] need to weakly hold BunTestFile from ref()
  - two tests for comparing performance
    - 1: as-is
    - 2: rather than holding JSValues as Strongs, we hold them as indices into a JSArray that is visited by BunTestFile
    - 3: do that but in a class
    - 4: what if DescribeScope/ExecutionEntry have their own JSValues
    - call gc(true) often during the benchmark
  - have the global object hold the buntest which holds the buntestfile
  - needs a cpp binding?
  - the cpp binding
  - write barriers tell gc to revisit the object. write barrier when adding/removing a callback
  - vector needs to have a lock because visit is called concurrently
  - fully eliminates protect/unprotect
  - the plan:
    - cpp class that holds a list of jsvalues
    - you can add and remove from it. when doing that it marks itself as needing re-visitation
    - someone owns it (easiest option for now is .protect())
    - benchmark this vs the version that is only .protect()
  - the problem with .protect() is that every protected value is visited by the gc every gc, which is slow
  - basically we make BunTestFile into a class. BunTest is a class that holds BunTestFile. Expect holds a weak reference to BunTest
  - an alternative option is making BunTestFile a jsobject that holds a jsarray rather than protect/unprotect ← do the c++ class

- [ ] Add a phase before ordering results that inherits properties to the parents. (eg inherit only from the child and inherit has_callback from the child. and has_callback can be on describe/test individually rather than on base). then we won't have that happening in an init() function (terrible!)
- [x] rename sequence.index to sequence.active_index because it is misleading.
- [x] concurrent tests have an n^2 problem because each time a test completes it needs to loop over every test to advance.
  - this shouldn't be necessary, it should be possible to step the current execution sequence and only check if we need to advance if the current sequence is done.
  - or even keep a number of how many sequences are complete and only advance once that number is equal to the number of sequences
  - if we have 1,000,000 concurrent tests, there is no need to be looping over all 1,000,000 every time any of them completes
  - with the current n^2 behaviour, it is 2.13x slower to run 20,000 empty async concurrent tests than 1,000,000 empty async regular tests. that's 50x less tests taking twice as long to run.
  - now that we have the new thing this can be fixed. fix it.
  - this is fixed now. running 1,000,000 empty async concurrent tests is now 1.08x slower than 1,000,000 empty async regular tests
    - empty noasync
    - 1.17x slower: empty async
    - 1.25x slower: empty concurrent
    - 1.34x slower: 1.2.20 empty noasync
    - 1.38x slower: 1.2.0 empty async
- [x] in test_command.zig, it has `const converted_status: TestRunner.Test.Status = switch (status) {`. instead, change junit writeTestCase to accept the new status type.
- [x] BunTestFile is called buntest. what is BunTest called? rename these. maybe BunTestFile -> BunTest and BunTest -> BunTestAllFiles? or BunTestRoot?
- [x] Add private fields in SafeStrong.zig
- [x] In Collection.zig, consider inlining enqueueDescribeCallback/enqueueTestCallback/enqueueHookCallback to their callsites?
- [x] In Execution.zig, rename order: ..., order_index to groups, group_index for consistency.
- [x] ~~In Execution.zig, change (start, end) to (start, len)~~ did not do this, (start, end) works better for this use-case
- [x] In Execution.zig, modify so groups has a .sequences() fn and sequences has a .entries() fn and index is 0 based
- [x] In Execution.zig, change order sequence and entries to be slices rather than ArrayLists. We have to rework test() in test() anyway.
- [x] make Data type-safe. in Execution.zig, it should be a CurrentEntryRef
  - this will help for when we cancel tests due to timeout, because they still might resolve in the future
  - this will help for the done callback, which could be called multiple times by the user. it can be stored as a js value and gc'd.

# Follow-up:

- [ ] fix rerun-each. implement retry and rerun params for tests.
- [ ] Remove finalizer on ScopeFunctions.zig by storing the data in 3 jsvalues passed in bind rather than using a custom class. Class generator can pass the this value into the function and it can extract the data from bind.
- [ ] concurrent limit
- [ ] `test.failing` should have its own style in the same way `test.todo` passing marks as 'todo' insetead of 'passing'
- [ ] remove all instances of bun.jsc.Jest.Jest.current
  - [ ] test options should be in BunTestRoot
  - [ ] we will need one global still, stored in the globalobject/vm/?. but it should not be a Jest instance.
- [ ] a flag or path for tests which are default concurrent
- [ ] consider memory pool + linked lists, or just 'next': usize rather than incrementing an index. this is to allow inserting items during test execution.
- [ ] consider using a jsc Bound Function rather than callback with args. bound functions allow adding arguments.
- [ ] consider modifying the junit reporter to print the whole describe tree at the end instead of trying to output as test results come in. and move it into its own file.
- [ ] strong.list should only have one jsvalue (or be removed fully)
- [ ] expect_call_count/expect_assertions is confusing. rename to `expect_calls`, `assert_expect_calls`. or something.
- [ ] Should make line_no be an enum with a none option and a function to get if line nombers are enabled
- [ ] limit the number of concurrent tests that run at once
- [ ] looks like we don't need to use file_id anymore (remove `bun.jsc.Jest.Jest.runner.?.getOrPutFile(file_path).file_id;`, store the file path directly)
- [ ] CallbackWithArguments is copied like 3 times which copies the arguments list 3 times
- [x] toMatchInlineSnapshot should not call addCount() because it both adds count and determines the name and value_ptr for a non-inline snapshot. we only need to add the count.
- [ ] console.log headers saying which test it is for
  - [ ] refActiveExecutionEntry should also be able to know the current test even in test.concurrent
- [ ] 'dot' test reporter like vitest?
- [ ] `.concurrent.test.ts` to make all items concurrent. consider adding a concurrent directory for bunfig.toml?
- [] `test.failing.if(false)` errors because it can't replace mode 'failing' with mode 'skip' (maybe failing should be a bool?)
- [ ] if we hold a weak reference to the done param, we can gc(true) (if a done param is provided) and then when it is finalized, count that as the function finishing (assuming it's not a promise). that way it fixes the done discard problem without solving waitForPromise.
- [ ] trigger timeout termination exception for `while(true) {}`
- [ ] support test() inside test()
- [ ] add a warning message when a test resolves after it times out
- [ ] note interesting behaviour if DoneCallback gets garbage collected and then after that, the promise resolves, then the test will complete. but in the other order, it won't. interesting.
- [ ] add back gc cleaning up unused callbacks. need to identify when the callback will never be used again and swap it with null.
  - [ ] add gc test (test that items referenced by a test callback are freed after the test is executed)

If this doesn't land:

- [ ] Remove TestRunner.Callback, it doesn't need to exist
