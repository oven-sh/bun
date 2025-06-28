---
name: "import, require, and test Svelte components with bun test"
---

Bun's [Plugin API](/docs/runtime/plugins) lets you add custom loaders to your project. The `test.preload` option in `bunfig.toml` lets you configure your loader to start before your tests run.

Firstly, install `@testing-library/svelte`, `svelte`, and `@happy-dom/global-registrator`.

```bash
$ bun add @testing-library/svelte svelte@4 @happy-dom/global-registrator
```

Then, save this plugin in your project.

```ts#svelte-loader.js
import { plugin } from "bun";
import { compile } from "svelte/compiler";
import { readFileSync } from "fs";
import { beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeEach(async () => {
  await GlobalRegistrator.register();
});

afterEach(async () => {
  await GlobalRegistrator.unregister();
});

plugin({
  name: "svelte loader",
  setup(builder) {
    builder.onLoad({ filter: /\.svelte(\?[^.]+)?$/ }, ({ path }) => {
      try {
        const source = readFileSync(
          path.substring(
            0,
            path.includes("?") ? path.indexOf("?") : path.length
          ),
          "utf-8"
        );

        const result = compile(source, {
          filename: path,
          generate: "client",
          dev: false,
        });

        return {
          contents: result.js.code,
          loader: "js",
        };
      } catch (err) {
        throw new Error(`Failed to compile Svelte component: ${err.message}`);
      }
    });
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

Add an example `.svelte` file in your project.

```html#Counter.svelte
<script>
  export let initialCount = 0;
  let count = initialCount;
</script>

<button on:click={() => (count += 1)}>+1</button>
```

---

Now you can `import` or `require` `*.svelte` files in your tests, and it will load the Svelte component as a JavaScript module.

```ts#hello-svelte.test.ts
import { test, expect } from "bun:test";
import { render, fireEvent } from "@testing-library/svelte";
import Counter from "./Counter.svelte";

test("Counter increments when clicked", async () => {
  const { getByText, component } = render(Counter);
  const button = getByText("+1");

  // Initial state
  expect(component.$$.ctx[0]).toBe(0); // initialCount is the first prop

  // Click the increment button
  await fireEvent.click(button);

  // Check the new state
  expect(component.$$.ctx[0]).toBe(1);
});
```

---

Use `bun test` to run your tests.

```bash
$ bun test
```

---
