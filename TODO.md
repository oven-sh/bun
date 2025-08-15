Complete before merge:

- [ ] add tests & pass existing tests
- [ ] add gc test (test that items referenced by a test callback are freed after the test is executed)
- [ ] remove describe2.ts
- [ ] remove describe2BeforeAll.ts
- [ ] search for TODOs in the diff and fix them all
- [ ] remove TODO.md

Overview:

- collect tests
- execute tests

node:test is different, it does not have a seperate collection step

a collection step is required for:

- allowing 'beforeEach/beforeAll/afterAll/afterEach' to be called after a test
- allowing 'only' to be used without a `--only` flag

Concurrent test execution:

- All of the concurrent tests need to be started at once and
- async context can be used for associating console.logs with a concurrent test
- describe.concurrent will mark all the tests inside it as concurrent
- vitest uses the argument to test() for `When running concurrent tests, Snapshots and Assertions must use expect from the local Test Context to ensure the right test is detected.`, rather than for `(done) => done()`. That is important to know.
  - this is incompatible with how jest uses the argument

Status:

- [ ] clean up / make the code more robust
- [ ] add test timeouts
- [ ] are there hook timeouts?
- [ ] use the new owned pointer types?
- [ ] make a new jsc.strong / jsc.strong.optional class that uses .protect()/.unprotect() and in debug builds allocates something for leak checking

Design:

- collect tests
  - The test runner must do a first pass where it calls describes, but only queues tests
- flatten
  - Once collection is done, callbacks are flattened into a list
  - Complications: tests that execute repeatedly need to also run their beforeEach/afterEach handlers
- execute tests
  - Items in the list are executed
- promise handling
  - then and catch are assigned to functions in BunTest which submit the results
  - Complications: concurrent tests will need to handle this differently
    - there will be seperate callbacks for resolveConcurrent and rejectConcurrent
    - once all of them are resolved, we can call the main resolve function to continue
    - this doesn't seem too complicated. pretty simple actually.
    - note that jest currently skips beforeEach/afterEach calls for concurrent tests <https://github.com/jestjs/jest/issues/7997>
    - check what vitest does
- multi-file
  - not implemented yet but we'll try to have a different BunTest for each file?
