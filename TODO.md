Complete before merge:

- [ ] make sure it exits with code 1 on failure
- [ ] decide on preload behaviour: before first/after last?
  - vitest/jest both do them seperately for each file, which makes sense because of isolation
  - bun does them before the first file and after the last file
- [x] afterEach/afterAll behaviour: forwards order or reverse order? vitest uses reverse order but jest uses forwards order. old bun uses forwards order. we will continue to use forwards order to reduce breakage, although reverse order makes more sense to me.
- [x] announce results of skip/todo with no callback, eg `test.skip("abc")` or `test.todo("def")`
- [x] fix toMatchInlineSnapshot
- [x] make sure error.SnapshotInConcurrentGroup prints well
- [ ] validate uses of sequence.entry_index (entry_index can be >= entries_end)
- [ ] decide on beforeAll/beforeEach behaviour
  - these are all tested flat, not sure if it changes with describe()
  - none
    - jest: beforeAll1 beforeAll2 beforeEach1 beforeEach2 test1 afterEach1 afterEach2 beforeEach1 beforeEach2 test1 afterEach1 afterEach2 afterAll1 afterAll2
    - bun: beforeAll1 beforeAll2 beforeEach1 beforeEach2 test1 afterEach1 afterEach2 beforeEach1 beforeEach2 test1 afterEach1 afterEach2 afterAll1 afterAll2
  - error in beforeAll:
    - jest: <b>beforeAll1</b> beforeAll2 <s>beforeEach1 beforeEach2 test</s> afterEach1 afterEach2 <s>beforeEach1 beforeEach2 test1</s> afterEach1 afterEach2 afterAll1 afterAll2
    - bun: <b>beforeAll1</b> <s>beforeAll2 beforeEach1 beforeEach2 test afterEach1 afterEach2 beforeEach1 beforeEach2 test1 afterEach1 afterEach2 afterAll1 afterAll2</s>
  - error in beforeEach:
    - jest: beforeAll1 beforeAll2 <b>beforeEach1</b> <s>beforeEach2 test1</s> afterEach1 afterEach2 <b>beforeEach1</b> <s>beforeEach2 test1</s> afterEach1 afterEach2 afterAll1 afterAll2
    - bun: beforeAll1 beforeAll2 <b>beforeEach1</b> <s>beforeEach2 test1</s> afterEach1 afterEach2 <b>beforeEach1</b> <s>beforeEach2 test1</s> afterEach1 afterEach2 afterAll1 afterAll2
  - error in afterEach
    - jest: beforeAll1 beforeAll2 beforeEach1 beforeEach2 test1 <b>afterEach1</b> afterEach2 beforeEach1 beforeEach2 test1 <b>afterEach1</b> afterEach2 afterAll1 afterAll2
    - bun: beforeAll1 beforeAll2 beforeEach1 beforeEach2 test1 <b>afterEach1</b> <s>afterEach2</s> beforeEach1 beforeEach2 test1 <b>afterEach1</b> <s>afterEach2</s> afterAll1 afterAll2
- [ ] make the summary work again
- [ ] add timeouts back
- [ ] add retry/run-multiple-times back
- [ ] report expect counts per-test
- [ ] make --bail work again
- [ ] make test filtering work again
- [ ] make sure ScopeFunctions class can finalize (see napi_handle_scope NapiHandleScopeImpl as an example)
  - currently, it never calls its finalize method because it no longer extends from finalize
- [ ] see about caching ScopeFunctions by value maybe?
- [ ] add back bailing after nth failure
- [ ] add back repeating failure/skip messages at the end of the test print
- [ ] make sure failure exits with code 1
- [ ] `test("rerun me", () => { console.log("run one time!"); });` `--rerun-each=3`. works 1, no message 2, fails 3
- [ ] status printing support failures and other modes
- [ ] make BunTest into a gc object so you can't deinit it while a .then() is still active
- [ ] add back gc cleaning up an unused callback. need to identify when the callback will never be used again and swap it with null.
- [ ] add tests & pass existing tests
- [ ] add gc test (test that items referenced by a test callback are freed after the test is executed)
- [ ] add back associating uncaught exceptions with the active test
- [x] `test.concurrent.only()`
- [x] `test.skip.only.concurrent()`. basically we need to make it a class that contains the options.
- [ ] move the testing files into being real behaviour tests
- [ ] search for TODOs in the diff and fix them all
- [ ] replace asserts with runtime throws or debug-only asserts (waitForPromise breaks many expectations)
- [ ] check the todo list in https://linear.app/oven/issue/ENG-20152/new-buntest, confirm it fixes all those issues (or doesn't make them worse). add reproductions
- [ ] remove describe/test functions in jest.zig
- [ ] remove DescribeScope/TestScope in jest.zig
- [ ] remove TestId stuff
- [ ] remove TODO.md

Add tests:

- [ ] test error.SnapshotInConcurrentGroup

Code quality:

- [ ] In Collection.zig, inline enqueueDescribeCallback/enqueueTestCallback/enqueueHookCallback to their callsites maybe?
- [x] In Execution.zig, rename order: ..., order_index to groups, group_index for consistency.
- [ ] In Execution.zig, change (start, end) to (start, len)
- [x] In Execution.zig, modify so groups has a .sequences() fn and sequences has a .entries() fn and index is 0 based
- [x] In Execution.zig, change order sequence and entries to be slices rather than ArrayLists. We have to rework test() in test() anyway.
- [ ] Should make line_no be an enum with a none option and a function to get if line nombers are enabled
- [ ] make Data type-safe. in Execution.zig, it should be a CurrentEntryRef
  - this will help for when we cancel tests due to timeout, because they still might resolve in the future

Follow-up:

- [ ] looks like we don't need to use file_id anymore (remove `bun.jsc.Jest.Jest.runner.?.getOrPutFile(file_path).file_id;`, store the file path directly)
- [ ] CallbackWithArguments is copied like 3 times which copies the arguments list 3 times
- [x] toMatchInlineSnapshot should not call addCount() because it both adds count and determines the name and value_ptr for a non-inline snapshot. we only need to add the count.
- [ ] console.log headers saying which test it is for
  - [ ] refActiveExecutionEntry should also be able to know the current test even in test.concurrent
- [ ] 'dot' test reporter like vitest?
- [ ] `.concurrent.test.ts` to make all items concurrent. consider adding a concurrent directory for bunfig.toml?
- [] `test.failing.if(false)` errors because it can't replace mode 'failing' with mode 'skip' (maybe failing should be a bool?)
- [ ] if we hold a weak reference to the done param, we can gc(true) (if a done param is provided) and then when it is finalized, count that as the function finishing (assuming it's not a promise). that way it fixes the done discard problem without solving waitForPromise.

If this doesn't land:

- [ ] Remove TestRunner.Callback, it doesn't need to exist
