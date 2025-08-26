Complete before merge:

- [ ] make sure it exits with code 1 on failure
- [ ] add preload hooks
- [x] fix toMatchInlineSnapshot
- [x] make sure error.SnapshotInConcurrentGroup prints well
- [ ] make the summary work again
- [ ] make --bail work again
- [ ] make test filtering work again
- [ ] make sure ScopeFunctions class can finalize (see napi_handle_scope NapiHandleScopeImpl as an example)
  - currently, it never calls its finalize method because it no longer extends from finalize
- [ ] see about caching ScopeFunctions by value maybe?
- [ ] add back bailing after nth failure
- [ ] add back repeating failure/skip messages at the end of the test print
- [ ] make sure failure exits with code 1
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

- [ ] In Execution.zig, rename order: ..., order_index to groups, group_index for consistency.
- [ ] In Execution.zig, change (start, end) to (start, len)
- [ ] In Execution.zig, change order sequence and entries to be slices rather than ArrayLists. We have to rework test() in test().
- [ ] Should make line_no be an enum with a none option and a function to get if line nombers are enabled

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
