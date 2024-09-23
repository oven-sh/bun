Bun provides a universal plugin API that can be used to extend both the _runtime_ and [_bundler_](https://bun.sh/docs/bundler).

Plugins intercept imports and perform custom loading logic: reading files, transpiling code, etc. They can be used to add support for additional file types, like `.scss` or `.yaml`. In the context of Bun's bundler, plugins can be used to implement framework-level features like CSS extraction, macros, and client-server code co-location.

## Usage

A plugin is defined as simple JavaScript object containing a `name` property and a `setup` function. Register a plugin with Bun using the `plugin` function.

```tsx#myPlugin.ts
import { plugin, type BunPlugin } from "bun";

const myPlugin: BunPlugin = {
  name: "Custom loader",
  setup(build) {
    // implementation
  },
};

plugin(myPlugin);
```

Plugins have to be loaded before any other code runs! To achieve this, use the `preload` option in your [`bunfig.toml`](https://bun.sh/docs/runtime/bunfig). Bun automatically loads the files/modules specified in `preload` before running a file.

```toml
preload = ["./myPlugin.ts"]
```

To preload files before `bun test`:

```toml
[test]
preload = ["./myPlugin.ts"]
```

## Third-party plugins

By convention, third-party plugins intended for consumption should export a factory function that accepts some configuration and returns a plugin object.

```ts
import { plugin } from "bun";
import fooPlugin from "bun-plugin-foo";

plugin(
  fooPlugin({
    // configuration
  }),
);
```

Bun's plugin API is loosely based on [esbuild](https://esbuild.github.io/plugins). Only [a subset](https://bun.sh/docs/bundler/vs-esbuild#plugin-api) of the esbuild API is implemented, but some esbuild plugins "just work" in Bun, like the official [MDX loader](https://mdxjs.com/packages/esbuild/):

```jsx
import { plugin } from "bun";
import mdx from "@mdx-js/esbuild";

plugin(mdx());
```

## Loaders

Plugins are primarily used to extend Bun with loaders for additional file types. Let's look at a simple plugin that implements a loader for `.yaml` files.

```ts#yamlPlugin.ts
import { plugin } from "bun";

await plugin({
  name: "YAML",
  async setup(build) {
    const { load } = await import("js-yaml");

    // when a .yaml file is imported...
    build.onLoad({ filter: /\.(yaml|yml)$/ }, async (args) => {

      // read and parse the file
      const text = await Bun.file(args.path).text();
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

Register this file in `preload`:

```toml#bunfig.toml
preload = ["./yamlPlugin.ts"]
```

Once the plugin is registered, `.yaml` and `.yml` files can be directly imported.

{% codetabs %}

```ts#index.ts
import data from "./data.yml"

console.log(data);
```

```yaml#data.yml
name: Fast X
releaseYear: 2023
```

{% /codetabs %}

Note that the returned object has a `loader` property. This tells Bun which of its internal loaders should be used to handle the result. Even though we're implementing a loader for `.yaml`, the result must still be understandable by one of Bun's built-in loaders. It's loaders all the way down.

In this case we're using `"object"`—a built-in loader (intended for use by plugins) that converts a plain JavaScript object to an equivalent ES module. Any of Bun's built-in loaders are supported; these same loaders are used by Bun internally for handling files of various kinds. The table below is a quick reference; refer to [Bundler > Loaders](https://bun.sh/docs/bundler/loaders) for complete documentation.

{% table %}

- Loader
- Extensions
- Output

---

- `js`
- `.mjs` `.cjs`
- Transpile to JavaScript files

---

- `jsx`
- `.js` `.jsx`
- Transform JSX then transpile

---

- `ts`
- `.ts` `.mts` `.cts`
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

- `napi`
- `.node`
- Import a native Node.js addon

---

- `wasm`
- `.wasm`
- Import a native Node.js addon

---

- `object`
- _none_
- A special loader intended for plugins that converts a plain JavaScript object to an equivalent ES module. Each key in the object corresponds to a named export.

{% /callout %}

Loading a YAML file is useful, but plugins support more than just data loading. Let's look at a plugin that lets Bun import `*.svelte` files.

```ts#sveltePlugin.ts
import { plugin } from "bun";

await plugin({
  name: "svelte loader",
  async setup(build) {
    const { compile } = await import("svelte/compiler");

    // when a .svelte file is imported...
    build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {

      // read and compile it with the Svelte compiler
      const file = await Bun.file(path).text();
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

console.log(MySvelteComponent.render());
```

## Virtual Modules

{% note %}

This feature is currently only available at runtime with `Bun.plugin` and not yet supported in the bundler, but you can mimic the behavior using `onResolve` and `onLoad`.

{% /note %}

To create virtual modules at runtime, use `builder.module(specifier, callback)` in the `setup` function of a `Bun.plugin`.

For example:

```js
import { plugin } from "bun";

plugin({
  name: "my-virtual-module",

  setup(build) {
    build.module(
      // The specifier, which can be any string - except a built-in, such as "buffer"
      "my-transpiled-virtual-module",
      // The callback to run when the module is imported or required for the first time
      () => {
        return {
          contents: "console.log('hello world!')",
          loader: "js",
        };
      },
    );

    build.module("my-object-virtual-module", () => {
      return {
        exports: {
          foo: "bar",
        },
        loader: "object",
      };
    });
  },
});

// Sometime later
// All of these work
import "my-transpiled-virtual-module";
require("my-transpiled-virtual-module");
await import("my-transpiled-virtual-module");
require.resolve("my-transpiled-virtual-module");

import { foo } from "my-object-virtual-module";
const object = require("my-object-virtual-module");
await import("my-object-virtual-module");
require.resolve("my-object-virtual-module");
```

### Overriding existing modules

You can also override existing modules with `build.module`.

```js
import { plugin } from "bun";
build.module("my-object-virtual-module", () => {
  return {
    exports: {
      foo: "bar",
    },
    loader: "object",
  };
});

require("my-object-virtual-module"); // { foo: "bar" }
await import("my-object-virtual-module"); // { foo: "bar" }

build.module("my-object-virtual-module", () => {
  return {
    exports: {
      baz: "quix",
    },
    loader: "object",
  };
});
require("my-object-virtual-module"); // { baz: "quix" }
await import("my-object-virtual-module"); // { baz: "quix" }
```

## Reading the config

Plugins can read and write to the [build config](https://bun.sh/docs/bundler#api) with `build.config`.

```ts
Bun.build({
  entrypoints: ["./app.ts"],
  outdir: "./dist",
  sourcemap: "external",
  plugins: [
    {
      name: "demo",
      setup(build) {
        console.log(build.config.sourcemap); // "external"

        build.config.minify = true; // enable minification

        // `plugins` is readonly
        console.log(`Number of plugins: ${build.config.plugins.length}`);
      },
    },
  ],
});
```

## Reference

```ts
namespace Bun {
  function plugin(plugin: {
    name: string;
    setup: (build: PluginBuilder) => void;
  }): void;
}

type PluginBuilder = {
  onResolve: (
    args: { filter: RegExp; namespace?: string },
    callback: (args: { path: string; importer: string }) => {
      path: string;
      namespace?: string;
    } | void,
  ) => void;
  onLoad: (
    args: { filter: RegExp; namespace?: string },
    callback: (args: { path: string }) => {
      loader?: Loader;
      contents?: string;
      exports?: Record<string, any>;
    },
  ) => void;
  config: BuildConfig;
};

type Loader = "js" | "jsx" | "ts" | "tsx" | "json" | "toml" | "object";
```

The `onLoad` method optionally accepts a `namespace` in addition to the `filter` regex. This namespace will be be used to prefix the import in transpiled code; for instance, a loader with a `filter: /\.yaml$/` and `namespace: "yaml:"` will transform an import from `./myfile.yaml` into `yaml:./myfile.yaml`.
