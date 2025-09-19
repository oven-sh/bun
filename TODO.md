loc diff: `git diff (git merge-base origin/main HEAD) HEAD --numstat --shortstat -- ":!test" ":!*.ts" ":!*.js" ":!TODO.md"`

# Test failures:

## Flaky on main

- [ ] test/js/web/fetch/fetch.stream.test.ts
  - this is usually a flaky failure but was a failure. this is maybe related to missing retry/rerun options.
  - maybe it just ran the test 5 times and had a failure each time
- [ ] test/js/bun/shell/leak.test.ts
  - probably flaky
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
- [ ] test/js/sql/sql-mysql.helpers.test.ts
- [ ] test/js/bun/glob/scan.test.ts
- [ ] test/js/web/fetch/fetch.tls.test.ts
- [ ] test/js/web/fetch/chunked-trailing.test.js
- [ ] test/js/node/test/parallel/test-worker-heap-snapshot.js
- [ ] test/js/bun/s3/s3.leak.test.ts
- [ ] test/regression/issue/11297/11297.test.ts
- [ ] test/js/node/dns/node-dns.test.js
- [ ] test/js/node/test/parallel/test-stream-readable-unpipe-resume.js
- [ ] test/cli/hot/hot.test.ts
- [ ] test/bundler/bundler_splitting.test.ts
- [ ] test/cli/hot/watch-many-dirs.test.ts
- [ ] test/js/node/test/parallel/test-worker-uncaught-exception-async.js
- [ ] test/js/bun/css/doesnt_crash.test.ts
- [ ] test/js/third_party/@duckdb/node-api/duckdb.test.ts
- [ ] test/js/node/child_process/child_process_ipc.test.js
- [ ] test/bake/dev/css.test.ts
- [ ] test/cli/run/require-cache.test.ts
- [ ] test/js/node/zlib/bytesWritten.test.ts
- [ ] test/js/bun/util/bun-file.test.ts

## Real

- [ ] test/js/bun/net/socket.test.ts
  - new failure on windows. same issue as below. it already waits 1000ms to check the heapstats.
- [x] test/cli/install/bun-install-registry.test.ts
  - not sure if this is real or flaky
- [ ] test/js/bun/net/tcp-server.test.ts
  - new flaky failure on windows. same issue as above.
- [ ] (maybe flaky) test/js/web/fetch/abort-signal-leak.test.ts
- [ ] (maybe flaky) test/js/node/http/node-http-primoridals.test.ts
- [x] test/js/bun/test/concurrent.test.ts
  - this test is relying on timings. we should fix it to be guaranteed order.
- [x] test/js/web/fetch/client-fetch.test.ts
  - re-entry issue? it's with .resolves.toPass
  - gc(true) was supposed to fix this. unclear.
- [x] test/js/node/test/parallel/test-runner-subtest-after-hook.js
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

## Stacktrace

- [ ] test/js/bun/test/test-error-code-done-callback.test.ts
  - stacktrace is messed up. it's including an incorrect item in the stacktrace for some reason.
  - this one is still failing. it could be because we throw the uncaught exception as soon as done() is called? maybe we need to delay it to the nextTick also. and delay appending the result too.
- [x] test/js/bun/util/inspect-error.test.js
  - same stacktrace issue
- [x] test/js/bun/test/stack.test.ts
  - we're adding an extra `at unknown` frame at the end of the stacktrace for some reason. likely same issue as the above stacktrace bugs.

# Add features:

- [x] todo/skip tests used to print dim but now print white bold. fix.
- [ ] fix

  ```js
  test.concurrent("abc", () => {
    throw new Error("abc");
  });
  test.concurrent("def", () => {
    throw new Error("def");
  });
  test.concurrent("ghi", () => {
    throw new Error("ghi");
  });
  ```

  this should output in order:
  - err: abc. ✗ abc. err: def. ✗ def. err: ghi. ✗ ghi.

  instead of:
  - err: abc. err: def. err: ghi. ✗ abc. ✗ def. ✗ ghi.

  the reason it is outputting like this currently is because in the inner loop it spawns all the callbacks but it doesn't use the results until the outer loop.
  fixing this would mean spawning one concurrent test at a time? not really sure

  fixing this would mean going back to allowing immediate advancements. or alternatively we can go back to a callback queue but always prefer to advance over running the next callback if there are queued advancement.s

- [x] nvm ~~revert how scopefunctions works to how it was before. add all the props to everything. `.skip.only` is the same as `.only.skip`. 32 possible combinations so it's fine.~~
- [x] test/js/node/http2/node-http2.test.js
  - this spams output with 'killed 1 dangling process' now - consider only showing that for timeout failures
- [x] change DoneCallback and ScopeFunctions to both use bound functions
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
- [x] add back vm.auto_killer.kill() https://github.com/oven-sh/bun/blob/973fa98796a3be79b48f0d078485b5833d956593/src/bun.js/test/jest.zig#L1690
- [x] never had ~~add retry/repeat back~~
- [x] make sure ScopeFunctions class can finalize (see napi_handle_scope NapiHandleScopeImpl as an example)
  - currently, it never calls its finalize method because it no longer extends from finalize
- [x] make sure DoneCallback class can finalize, same as above
- [x] weak pointers to BunTest
- [x] bug to fix for later ~~fix `test("rerun me", () => { console.log("run one time!"); });` `--rerun-each=3`. works 1, no message 2, works 3. note that existing behaviour is similar?~~
- [x] bun test > support for Github Actions > should annotate a test timeout
- [x] a failure in beforeAll should prevent tests from running "unhandled errors between tests are reported"

# Add tests:

- [x] regression test that this doesn't hang forever:
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

    ```
    Benchmark 1: /Users/pfg/Dev/Node/bun/build/release/bun test ./1m_regular.test.ts
      Time (mean ± σ):      1.452 s ±  0.013 s    [User: 1.269 s, System: 0.322 s]
      Range (min … max):    1.430 s …  1.474 s    10 runs

    Benchmark 2: /Users/pfg/Dev/Node/bun/build/release/bun test ./1m_done.test.ts
      Time (mean ± σ):      1.870 s ±  0.013 s    [User: 1.798 s, System: 0.356 s]
      Range (min … max):    1.853 s …  1.896 s    10 runs

    Benchmark 3: /Users/pfg/Dev/Node/bun/build/release/bun test ./1m_async.test.ts
      Time (mean ± σ):      1.773 s ±  0.011 s    [User: 1.705 s, System: 0.341 s]
      Range (min … max):    1.757 s …  1.794 s    10 runs

    Benchmark 4: /Users/pfg/Dev/Node/bun/build/release/bun test ./1k_by_1k_regular.test.ts
      Time (mean ± σ):     673.2 ms ±   4.5 ms    [User: 411.1 ms, System: 265.6 ms]
      Range (min … max):   666.4 ms … 679.3 ms    10 runs

    Benchmark 5: /Users/pfg/Dev/Node/bun/build/release/bun test ./1k_by_1k_done.test.ts
      Time (mean ± σ):     895.0 ms ±   8.9 ms    [User: 624.3 ms, System: 274.7 ms]
      Range (min … max):   882.8 ms … 910.8 ms    10 runs

    Benchmark 6: /Users/pfg/Dev/Node/bun/build/release/bun test ./1k_by_1k_async.test.ts
      Time (mean ± σ):     803.1 ms ±   6.5 ms    [User: 541.4 ms, System: 275.0 ms]
      Range (min … max):   793.7 ms … 813.0 ms    10 runs

    Benchmark 7: /Users/pfg/Dev/Node/bun/build/release/bun test
      Time (mean ± σ):      8.362 s ±  0.077 s    [User: 7.422 s, System: 1.775 s]
      Range (min … max):    8.258 s …  8.503 s    10 runs

    Benchmark 8: bun test ./1m_regular.test.ts
      Time (mean ± σ):      1.488 s ±  0.017 s    [User: 1.088 s, System: 0.481 s]
      Range (min … max):    1.462 s …  1.518 s    10 runs

    Benchmark 9: bun test ./1m_done.test.ts
      Time (mean ± σ):      1.731 s ±  0.016 s    [User: 1.369 s, System: 0.505 s]
      Range (min … max):    1.704 s …  1.752 s    10 runs

    Benchmark 10: bun test ./1m_async.test.ts
      Time (mean ± σ):      1.627 s ±  0.023 s    [User: 1.387 s, System: 0.498 s]
      Range (min … max):    1.598 s …  1.676 s    10 runs

    Benchmark 11: bun test ./1k_by_1k_regular.test.ts
      Time (mean ± σ):     885.2 ms ±   6.2 ms    [User: 453.6 ms, System: 436.3 ms]
      Range (min … max):   874.9 ms … 894.0 ms    10 runs

    Benchmark 12: bun test ./1k_by_1k_done.test.ts
      Time (mean ± σ):      1.008 s ±  0.010 s    [User: 0.571 s, System: 0.445 s]
      Range (min … max):    0.998 s …  1.030 s    10 runs

    Benchmark 13: bun test ./1k_by_1k_async.test.ts
      Time (mean ± σ):     915.4 ms ±   5.1 ms    [User: 489.7 ms, System: 439.3 ms]
      Range (min … max):   907.4 ms … 921.8 ms    10 runs

    Benchmark 14: bun test
      Time (mean ± σ):      7.431 s ±  0.080 s    [User: 4.965 s, System: 2.740 s]
      Range (min … max):    7.355 s …  7.593 s    10 runs

    /Users/pfg/Dev/Node/bun/build/release/bun test ./1k_by_1k_regular.test.ts ran
    1.19 ± 0.01 times faster than /Users/pfg/Dev/Node/bun/build/release/bun test ./1k_by_1k_async.test.ts
    1.31 ± 0.01 times faster than bun test ./1k_by_1k_regular.test.ts
    1.33 ± 0.02 times faster than /Users/pfg/Dev/Node/bun/build/release/bun test ./1k_by_1k_done.test.ts
    1.36 ± 0.01 times faster than bun test ./1k_by_1k_async.test.ts
    1.50 ± 0.02 times faster than bun test ./1k_by_1k_done.test.ts
    2.16 ± 0.02 times faster than /Users/pfg/Dev/Node/bun/build/release/bun test ./1m_regular.test.ts
    2.21 ± 0.03 times faster than bun test ./1m_regular.test.ts
    2.42 ± 0.04 times faster than bun test ./1m_async.test.ts
    2.57 ± 0.03 times faster than bun test ./1m_done.test.ts
    2.63 ± 0.02 times faster than /Users/pfg/Dev/Node/bun/build/release/bun test ./1m_async.test.ts
    2.78 ± 0.03 times faster than /Users/pfg/Dev/Node/bun/build/release/bun test ./1m_done.test.ts
    11.04 ± 0.14 times faster than bun test
    12.42 ± 0.14 times faster than /Users/pfg/Dev/Node/bun/build/release/bun test
    ```

- [x] remove done_promise, unused.
- [x] remove runErrorHandlerWithDedupe, last_reported_error_for_dedupe
- [ ] eliminate fn bunTest() in Execution.zig
- [ ] validate uses of sequence.entry_index (entry_index can be >= entries_end)
- [ ] replace asserts with runtime throws or debug-only asserts (waitForPromise breaks many expectations)
- [ ] replace debug-only assert with `Bun.Environment.ci_assert` guarded asserts
- [x] search for TODOs in the diff and fix them all
- [x] check the todo list in https://linear.app/oven/issue/ENG-20152/new-buntest, confirm it fixes all those issues (or doesn't make them worse). add reproductions
- [x] look in file:///Users/pfg/Dev/Node/bun-coverage/coverage-html/src/bun.js/test/jest.zig.gcov.html and find things to remove
- [x] disable the logs by default
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

- [ ] Do the structure cache thing for better performance for ScopeFunctions
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
