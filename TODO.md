Complete before merge:

- [ ] add back gc cleaning up an unused callback. need to identify when the callback will never be used again and swap it with null.
- [ ] add tests & pass existing tests
- [ ] add gc test (test that items referenced by a test callback are freed after the test is executed)
- [ ] remove describe2.ts
- [ ] remove describe2BeforeAll.ts
- [ ] search for TODOs in the diff and fix them all
- [ ] replace asserts with runtime throws or debug-only asserts
- [ ] decide what to do about strong
- [ ] remove TODO.md

Follow-up:

- [ ] console.log headers saying which test it is for
- [ ] 'dot' test reporter like vitest?
- [ ] `.concurrent.test.ts` to make all items concurrent. consider adding a concurrent directory for bunfig.toml?
