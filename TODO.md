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

- [ ] clean up the code
- [ ] add test timeouts
- [ ] are there hook timeouts?
