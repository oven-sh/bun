Like the runtime, `bun:test` also supports `--preload` scripts. These scripts are loaded before any tests are run. This is useful for setting up test fixtures, mocking, and configuring the test environment.

{% codetabs %}

```ts#preloaded.ts
import { beforeAll, beforeEach, afterEach, afterAll } from "bun:test";

beforeAll(() => {
  console.log("beforeAll");
});

beforeEach(() => {
  console.log("beforeEach");
});

afterEach(() => {
  console.log("afterEach");
});

afterAll(() => {
  console.log("afterAll");
});
```

{% /codetabs %}

Test file:

```ts
import { expect, test } from "bun:test";

test("1 + 1", () => {
  expect(1 + 1).toEqual(2);
  console.log("1 + 1");
});
```

Run the test with `--preload`:

```sh
$ bun test --preload=preloaded.ts
```

It outputs:

```sh
beforeAll
beforeEach
1 + 1
afterEach
afterAll
```

## List of lifecycle hooks

The following lifecycle hooks are available in `--preload`:

| Hook         | Description                 |
| ------------ | --------------------------- |
| `beforeAll`  | Runs once before all tests. |
| `beforeEach` | Runs before each test.      |
| `afterEach`  | Runs after each test.       |
| `afterAll`   | Runs once after all tests.  |

Calling `expect`, `test`, or any other test function inside a lifecycle hook will throw an error. Calling `test` inside `beforeAll`, `afterAll`, `beforeEach` or `afterEach` will also throw an error.

You can use `console.log` or any other function otherwise inside a lifecycle hook.

We haven't implemented timer simulation, test isolation, or `Math.random` mocking yet. If you need these features, please [open an issue](https://bun.sh/issues).

### The lifecycle of bun:test

The test runner is a single process that runs all tests. It loads all `--preload` scripts, then runs all tests. If a test fails, the test runner will exit with a non-zero exit code.

Before running each test, it transpiles the source code and all dependencies into vanilla JavaScript using Bun's transpiler and module resolver. This means you can use TypeScript, JSX, ESM, and CommonJS in your tests.

#### Globals

Like Jest, you can use `describe`, `test`, `expect`, and other functions without importing them.

But unlike Jest, they are not globals. They are imported from `bun:test` and are exclusively available in test files or when preloading scripts.

```ts
typeof globalThis.describe; // "undefined"
typeof describe; // "function"
```

This works via a transpiler integration in Bun. This transpiler plugin is only enabled inside test files and when preloading scripts. If you try to use these functions otherwise, you will get an error.

Every `describe`, `test`, and `expect` is scoped to the current test file. Importing from `"bun:test"` creates a new scope. This means you can't use `describe` from one test file in another test file because belong to different scopes.

## Configuration

To save yourself from having to type `--preload` every time you run tests, you can add it to your `bunfig.toml`:

```toml
[test]
preload = ["./preloaded.ts"]
```

## Loaders & Resolvers

{% note %}
Plugin support is not implemented yet. **There is a bug and this feature is not working**.
{% /note %}

`bun:test` supports the same plugin API as bun's runtime and bun's bundler. See [Plugins](/docs/bundler/plugins#usage) for more information.

## Example loader

{% codetabs %}

```ts#loader.ts
import { plugin } from 'bun';

plugin({
  name: 'My loader',
  setup(build) {
    build.onResolve({ filter: /\.txt$/ }, (args) => {
      return {
        path: args.path,
        namespace: 'my-loader',
      };
    });

    build.onLoad({ filter: /my-loader:.txt$/  }, (args) => {
      return {
        contents: 'Hello world!',
        loader: 'text',
      };
    });
  },
});
```

{% /codetabs %}

Now in your test file, you can import `.txt` files:

```ts#my-test.test.ts
import { expect, test } from "bun:test";
import text from "./hello.txt";

test("text is 'Hello world!'", () => {
  expect(text).toEqual("Hello world!");
});
```

To run the test, you need to add `loader.ts` to `preload`:

```toml
[test]
preload = ["loader.ts"]
```

Or you can pass --preload to the command line:

```sh
$ bun test --preload=loader.ts
```

TODO: `expect.extend`
