Complete before merge:

- [ ] add back bailing after nth failure
- [ ] add back repeating failure/skip messages at the end of the test print
- [ ] status printing support failures and other modes
- [ ] make BunTest into a gc object so you can't deinit it while a .then() is still active
- [ ] add back gc cleaning up an unused callback. need to identify when the callback will never be used again and swap it with null.
- [ ] add tests & pass existing tests
- [ ] add gc test (test that items referenced by a test callback are freed after the test is executed)
- [ ] add back associating uncaught exceptions with the active test
- [ ] `test.concurrent.only()`
- [ ] `test.skip.only.concurrent()`. basically we need to make it a class that contains the options.
- [ ] remove describe2.ts
- [ ] remove describe2BeforeAll.ts
- [ ] search for TODOs in the diff and fix them all
- [ ] replace asserts with runtime throws or debug-only asserts (waitForPromise breaks many expectations)
- [ ] check the todo list in https://linear.app/oven/issue/ENG-20152/new-buntest, confirm it fixes all those issues (or doesn't make them worse). add reproductions
- [ ] decide what to do about strong
- [ ] remove TODO.md

Follow-up:

- [ ] console.log headers saying which test it is for
- [ ] 'dot' test reporter like vitest?
- [ ] `.concurrent.test.ts` to make all items concurrent. consider adding a concurrent directory for bunfig.toml?

If this doesn't land:

- [ ] Remove TestRunner.Callback, it doesn't need to exist
