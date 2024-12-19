---
name: "import, require, and test Svelte components with bun:test"
---

Bun's [Plugin API](/docs/runtime/plugins) lets you add custom loaders to your project and the `test.preload` option in `bunfig.toml` lets you ensure your loaders start before your tests run.

To get started, save this plugin in your project.

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

Add this to `bunfig.toml` to tell Bun to preload the plugin, so it loads before your tests run.

```toml#bunfig.toml
[test]
# Tell Bun to load this plugin before your tests run
preload = ["./svelte-loader.js"]

# This also works:
# test.preload = ["./svelte-loader.js"]
```

---

Now you can `import` or `require` `*.svelte` files in your tests, and it will load the Svelte component as a JavaScript module.

```ts#hello-svelte.test.ts
import { test, expect } from "bun:test";
import App from "./my-component.svelte";

test("svelte", () => {
  expect(App).toBeDefined();
});
```

---

To run your tests:

```bash
$ bun test
```

---

You can also try `bun test --preload=./svelte-loader.js` if you don't want to save a bunfig.toml file.
