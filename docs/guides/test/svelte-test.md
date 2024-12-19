---
name: "Test Svelte components with bun:test"
description: "import & require .svelte files in your tests in bun's jest-compatible test api, bun:test"
---

Bun's [Plugin API](/docs/runtime/plugins) lets you add custom loaders to your project and the `test.preload` option in `bunfig.toml` lets you ensure your loaders start before your tests run.

To support tests that import or require `*.svelte` files

Save the following plugin in your project:

```ts#svelte-loader.js
// TODO: make this an npm package instead of a file
import { plugin } from "bun";
import { compile } from "svelte/compiler";
import { readFileSync } from "fs";

plugin({
  name: "svelte loader",
  setup(builder) {
    builder.onLoad({ filter: /\.svelte(\?[^.]+)?$/ }, ({ path }) => ({
      contents: compile(
        readFileSync(path.substring(0, path.includes("?") ? path.indexOf("?") : path.length), "utf-8"),
        {
          filename: path,
          generate: "server",
          dev: false,
        },
      ).js.code,
      loader: "js",
    }));
  },
});
```

---

Add it as a `test.preload` in `bunfig.toml`:

```toml
[test]
preload = ["./svelte-loader.js"]
```

---

Write a test that imports or requires a `*.svelte` file:

```ts#hello-svelte.test.ts
import { test, expect } from "bun:test";
import App from "./my-component.svelte";

test("svelte", () => {
  expect(App).toBeDefined();
});
```

---

Run your tests:

```bash
$ bun test
```

---

You can also try `bun test --preload=./svelte-loader.js` if you don't want to save a bunfig.toml file.
