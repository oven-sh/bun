{% callout %}
**Note** — Introduced in Bun v0.1.11.
{% /callout %}

Bun's runtime can be extended to support additional file types using _plugins_. Plugins can intercept imports and perform custom loading logic: reading files, transpiling code, etc. They can be used to extend Bun's runtime with _loaders_ for additional file types.

## Usage

A plugin is defined as simple JavaScript object containing a `name` property and a `setup` function. Register a plugin with Bun using the `plugin` function.

```tsx#yamlPlugin.ts
import { plugin } from "bun";

plugin({
  name: "YAML loader",
  setup(build) {
    // implementation
  },
});
```

To consume this plugin, import it at the top of your project's entrypoint, before any application code is imported.

```ts#app.ts
import "./yamlPlugin.ts";
import { config } from "./config.yml";

console.log(config);
```

By convention, third-party plugins intended for consumption should export a factory function that accepts some configuration and returns a plugin object.

```ts
import { plugin } from "bun";
import fooPlugin from "bun-plugin-foo";

plugin(
  fooPlugin({
    // configuration
  }),
);

// application code
```

Bun's plugin API is based on [esbuild](https://esbuild.github.io/plugins). Only a subset of the esbuild API is implemented, but some esbuild plugins "just work" in Bun, like the official [MDX loader](https://mdxjs.com/packages/esbuild/):

```jsx
import { plugin } from "bun";
import mdx from "@mdx-js/esbuild";

plugin(mdx());

import { renderToStaticMarkup } from "react-dom/server";
import Foo from "./bar.mdx";
console.log(renderToStaticMarkup(<Foo />));
```

## Loaders

<!-- The plugin logic is implemented in the `setup` function using the builder provided as the first argument (`build` in the example above). The `build` variable provides two methods: `onResolve` and `onLoad`. -->

<!-- ## `onResolve` -->

<!-- The `onResolve` method lets you intercept imports that match a particular regex and modify the resolution behavior, such as re-mapping the import to another file. In the simplest case, you can simply remap the matched import to a new path.

```ts
import { plugin } from "bun";

plugin({
  name: "YAML loader",
  setup(build) {
    build.onResolve();
    // implementation
  },
});
``` -->

<!--
Internally, Bun's transpiler automatically turns `plugin()` calls into separate files (at most 1 per file). This lets loaders activate before the rest of your application runs with zero configuration. -->

Plugins are primarily used to extend Bun with loaders for additional file types. Let's look at a simple plugin that exposes envLet's look at a sample plugin that implements a loader for `.yaml` files.

```ts#yamlPlugin.ts
import { plugin } from "bun";

plugin({
  name: "YAML",
  async setup(build) {
    const { load } = await import("js-yaml");
    const { readFileSync } = await import("fs");

    // when a .yaml file is imported...
    build.onLoad({ filter: /\.(yaml|yml)$/ }, (args) => {

      // read and parse the file
      const text = readFileSync(args.path, "utf8");
      const exports = load(text) as Record<string, any>;

      // and returns it as a module
      return {
        exports,
        loader: "object", // special loader for JS objects
      };
    });
  },
});
```

With this plugin, data can be directly imported from `.yaml` files.

{% codetabs %}

```ts#index.ts
import "./yamlPlugin.ts"
import {name, releaseYear} from "./data.yml"

console.log(name, releaseYear);
```

```yaml#data.yml
name: Fast X
releaseYear: 2023
```

{% /codetabs %}

Note that the returned object has a `loader` property. This tells Bun which of its internal loaders should be used to handle the result. Even though we're implementing a loader for `.yaml`, the result must still be understandable by one of Bun's built-in loaders. It's loaders all the way down.

In this case we're using `"object"`—a special loader (intended for use by plugins) that converts a plain JavaScript object to an equivalent ES module. Any of Bun's built-in loaders are supported; these same loaders are used by Bun internally for handling files of various extensions.

{% table %}

- Loader
- Extensions
- Output

---

- `js`
- `.js` `.mjs` `.cjs`
- Transpile to JavaScript files

---

- `jsx`
- `.jsx`
- Transform JSX then transpile

---

- `ts`
- `.ts` `.mts` `cts`
- Transform TypeScript then transpile

---

- `tsx`
- `.tsx`
- Transform TypeScript, JSX, then transpile

---

- `toml`
- `.toml`
- Parse using Bun's built-in TOML parser

---

- `json`
- `.json`
- Parse using Bun's built-in JSON parser

---

- `object`
- —
- A special loader intended for plugins that converts a plain JavaScript object to an equivalent ES module. Each key in the object corresponds to a named export.

{% /callout %}

Loading a YAML file is useful, but plugins support more than just data loading. Lets look at a plugin that lets Bun import `*.svelte` files.

```ts#sveltePlugin.ts
import { plugin } from "bun";

await plugin({
  name: "svelte loader",
  async setup(build) {
    const { compile } = await import("svelte/compiler");
    const { readFileSync } = await import("fs");

    // when a .svelte file is imported...
    build.onLoad({ filter: /\.svelte$/ }, ({ path }) => {

      // read and compile it with the Svelte compiler
      const file = readFileSync(path, "utf8");
      const contents = compile(file, {
        filename: path,
        generate: "ssr",
      }).js.code;

      // and return the compiled source code as "js"
      return {
        contents,
        loader: "js",
      };
    });
  },
});
```

> Note: in a production implementation, you'd want to cache the compiled output and include additional error handling.

The object returned from `build.onLoad` contains the compiled source code in `contents` and specifies `"js"` as its loader. That tells Bun to consider the returned `contents` to be a JavaScript module and transpile it using Bun's built-in `js` loader.

With this plugin, Svelte components can now be directly imported and consumed.

```js
import "./sveltePlugin.ts";
import MySvelteComponent from "./component.svelte";

console.log(mySvelteComponent.render());
```

## Reference

```ts
namespace Bun {
  function plugin(plugin: { name: string; setup: (build: PluginBuilder) => void }): void;
}

type PluginBuilder = {
  onLoad: (
    args: { filter: RegExp; namespace?: string },
    callback: (args: { path: string }) => {
      loader?: "js" | "jsx" | "ts" | "tsx" | "json" | "yaml" | "object";
      contents?: string;
      exports?: Record<string, any>;
    },
  ) => void;
};
```

The `onLoad` method optionally accepts a `namespace` in addition to the `filter` regex. This namespace will be be used to prefix the import in transpiled code; for instance, a loader with a `filter: /\.yaml$/` and `namespace: "yaml:"` will transform an import from `./myfile.yaml` into `yaml:./myfile.yaml`.
