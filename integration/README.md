# Tests in Bun

Bun currently has four different kinds of tests

To run the tests:

```bash
make test-all
bun wiptest
```

### Browser tests

Browser tests run end-to-end inside of Puppeteer and execute code transpiled by `bun dev`. These tests are in [./snippets](./snippets).

The interface is:

```js
// this function is called after import()
// if testDone() is never called, the test fails
export function test() {
  return testDone(import.meta.url);
}
```

On success, it saves a snapshot to [./snapshots](./snapshots) which is checked into git.

#### Adding a new test

1. Create a new file in the `snippets` directory.
2. Append the filename to [./scripts/snippets.json](./scripts/snippets.json)
3. Run `bun dev` inside this folder in one terminal window
4. Run `make integration-test-dev`

These tests are run twice. Once with HMR enabled and once with HMR disabled. HMR changes the output enough to warrant it's own special treatment.

#### Running the tests

To run the browser tests with HMR on a production build:

```bash
make test-with-hmr
```

To run the browser tests without HMR on a production build:

```bash
make test-with-no-hmr
```

To run the browser tests with HMR on a debug build:

```bash
make test-dev-with-hmr
```

To run the browser tests without HMR on a debug build:

```bash
make test-dev-no-hmr
```

To run the browser tests on whatever version of bun is running on port 3000:

```bash
make integration-test-dev
```

These were the first tests bun started with

### Runtime tests

These tests are in [./bunjs-only-snippets](./bunjs-only-snippets) and are files which are either `.test.js` or `.test.ts` files.

These test that the runtime behaves as expected. These also test the transpiler, both because test files are transpiled and directly by running the transpiler via `Bun.Transpiler`.

#### Adding a new test

1. Create a new file in [./bunjs-only-snippets](./bunjs-only-snippets/) with `.test` in the name.

These test use `bun:test` as the import (though you can also import from `vitest` or jest and it will work).

This will eventually be a public test runner for bun, but the reporter isn't very good yet and it doesn't run in parallel.

The syntax intends for Jest compatibility.

```ts
import { describe, expect, it } from "bun:test";

describe("Example", () => {
  it("should work", () => {
    expect(1).toBe(1);
  });
});
```

#### Running the tests

Run `bun wiptest ${part-of-file-name}`

If you run the test in the top-level bun repo directory, it will take an extra couple seconds because `bun wiptest` will scan through all of WebKit recursively. Consider running it in the `bunjs-only-snippets` directory instead.

### CLI tests

These run the bash files in the `apps` directory.

They check end-to-end that the CLI works as expected.

```bash
# Install dependencies for running tests
# Does not run tests
make test-install

# Check a Create React App created via `bun create react ./foo` returns HTML
make test-create-react

# Check a Next.js app created via `bun create next ./foo` SSRs successfully
make test-create-next

# Check that bun run works for the same CLI args passed to npm run
make test-bun-run

# Check that "react" installed via bun install loads successfully
# and that deleting/adding updates the lockfile as expected
make test-bun-install

# Check that serving public paths works correctly
# and that files which should be transpiled are transpiled and files which shouldn't be aren't
make test-bun-dev
```

### CLI tests

These run the bash files in the `apps` directory.

They check end-to-end that the CLI works as expected.

```bash
# Install dependencies for running tests
# Does not run tests
make test-install

# Check a Create React App returns HTML
make test-create-react

# Check a Next.js app SSRs successfully
make test-create-next

# Check that bun run works for the same CLI args passed to npm run
make test-bun-run

# Check that "react" installed via bun install loads successfully
# and that deleting/adding updates the lockfile as expected
make test-bun-install

# Check that serving public paths works correctly
# and that files which should be transpiled are transpiled and files which shouldn't be aren't
make test-bun-dev
```

### Zig tests

These tests live in various `.zig` files throughout Bun's codebase, leveraging Zig's builtin `test` keyword.

Currently, they're not run automatically nor is there a simple way to run all of them.

This is an area bun needs to improve in.
