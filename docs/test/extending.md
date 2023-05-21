# Lifecycle hooks

Like the runtime, `bun:test` also supports `--preload` scripts. These scripts are loaded before any tests are run. This is useful for setting up test fixtures, mocking, and configuring the test environment.

{% codetab }

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

{% /codetab %}

Test file:

```ts#my-test.test.ts
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

# Configuration

To save yourself from having to type `--preload` every time you run tests, you can add it to your `bunfig.toml`:

```toml
[test]
preload = ["preloaded.ts"]
```

# Loaders & Resolvers

{% note %}
Plugin support is not implemented yet. There is a bug and this feature is not working.
{% /note %}

`bun:test` supports the same plugin API as bun's runtime and bun's bundler. See [Plugins](docs/bundler/plugins#usage) for more information.

## Example loader

{% codetab }

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

{% /codetab %}

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
