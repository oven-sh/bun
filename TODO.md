- [ ] add tests
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
