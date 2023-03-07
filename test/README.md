# Tests

## Finding tests

Tests are located in the [`test/`](test/) directory and are organized using the following structure:

* `test/`
  * `js/` - tests for JavaScript APIs.
  * `cli/` - tests for commands, configs, and stdout.
  * `bundler/` - tests for the transpiler/bundler.
  * `regression/` - tests that reproduce a specific issue.
  * `harness.ts` - utility functions that can be imported from any test.

The tests in [`test/js/`](test/js/) directory are further categorized by the type of API. 

* `test/js/`
  * `bun/` - tests for `Bun`-specific APIs.
  * `node/` - tests for Node.js APIs.
  * `web/` - tests for Web APIs, like `fetch()`.
  * `first_party/` - tests for npm packages that are built-in, like `undici`. 
  * `third_party/` - tests for npm packages that are not built-in, but are popular, like `esbuild`.

## Running tests

To run a test, use Bun's built-in test command: `bun test`.

```sh
bun test # Run all tests
bun test js/bun # Only run tests in a directory
bun test sqlite.test.ts # Only run a specific test
```

If you encounter lots of errors, try running `bun install`, then trying again.

## Writing tests

Tests are written in TypeScript (preferred) or JavaScript using Jest's `describe()`, `test()`, and `expect()` APIs. 

```ts
import { describe, test, expect } from "bun:test";
import { gcTick } from "harness";

describe("TextEncoder", () => {
  test("can encode a string", async () => {
    const encoder = new TextEncoder();
    const actual = encoder.encode("bun");
    await gcTick();
    expect(actual).toBe(new Uint8Array([0x62, 0x75, 0x6E]));
  });
});
```

If you are fixing a bug that was reported from a GitHub issue, remember to add a test in the `test/regression/` directory.

```ts
// test/regression/issue/02005.test.ts

import { it, expect } from "bun:test";

it("regex literal should work with non-latin1", () => {
  const text = "这是一段要替换的文字";
  expect(text.replace(new RegExp("要替换"), "")).toBe("这是一段的文字");
  expect(text.replace(/要替换/, "")).toBe("这是一段的文字");
});
```

In the future, a bot will automatically close or re-open issues when a regression is detected or resolved.

## Zig tests

These tests live in various `.zig` files throughout Bun's codebase, leveraging Zig's builtin `test` keyword.

Currently, they're not run automatically nor is there a simple way to run all of them. We will make this better soon.
