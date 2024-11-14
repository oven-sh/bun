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

## Reading or modifying the config

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

{% callout %}

**NOTE**: Plugin lifcycle callbacks (`onStart()`, `onResolve()`, etc.) do not have the ability to modify the `build.config` object in the `setup()` function. If you want to mutate `build.config`, you must do so directly in the `setup()` function:

```ts
Bun.build({
  entrypoints: ["./app.ts"],
  outdir: "./dist",
  sourcemap: "external",
  plugins: [
    {
      name: "demo",
      setup(build) {
        // ✅ good! modifying it directly in the setup() function
        build.config.minify = true;

        build.onStart(() => {
          // 🚫 uh-oh! this won't work!
          build.config.minify = false;
        });
      },
    },
  ],
});
```

{% /callout %}

## Lifecycle callbacks

Plugins can register callbacks to be run at various points in the lifecycle of a bundle:

- [`onStart()`](#onstart): Run once the bundler has started a bundle
- [`onResolve()`](#onresolve): Run before a module is resolved
- [`onLoad()`](#onload): Run before a module is loaded.

A rough overview of the types (please refer to Bun's `bun.d.ts` for the full type definitions):

```ts
namespace Bun {
  function plugin(plugin: {
    name: string;
    setup: (build: PluginBuilder) => void;
  }): void;
}

type PluginBuilder = {
  onStart(callback: () => void): void;
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

type Loader = "js" | "jsx" | "ts" | "tsx" | "css" | "json" | "toml" | "object";
```

### Namespaces

`onLoad` and `onResolve` accept an optional `namespace` string. What is a namespaace?

Every module has a namespace. Namespaces are used to prefix the import in transpiled code; for instance, a loader with a `filter: /\.yaml$/` and `namespace: "yaml:"` will transform an import from `./myfile.yaml` into `yaml:./myfile.yaml`.

The default namespace is `"file"` and it is not necessary to specify it, for instance: `import myModule from "./my-module.ts"` is the same as `import myModule from "file:./my-module.ts"`.

Other common namespaces are:

- `"bun"`: for Bun-specific modules (e.g. `"bun:test"`, `"bun:sqlite"`)
- `"node"`: for Node.js modules (e.g. `"node:fs"`, `"node:path"`)

### `onStart`

```ts
onStart(callback: () => void): Promise<void> | void;
```

Registers a callback to be run when the bundler starts a new bundle.

```ts
import { plugin } from "bun";

plugin({
  name: "onStart example",

  setup(build) {
    build.onStart(() => {
      console.log("Bundle started!");
    });
  },
});
```

The callback can return a `Promise`. After the bundle process has initialized, the bundler waits until all `onStart()` callbacks have completed before continuing.

For example:

```ts
const result = await Bun.build({
  entrypoints: ["./app.ts"],
  outdir: "./dist",
  sourcemap: "external",
  plugins: [
    {
      name: "Sleep for 10 seconds",
      setup(build) {
        build.onStart(async () => {
          await Bunlog.sleep(10_000);
        });
      },
    },
    {
      name: "Log bundle time to a file",
      setup(build) {
        build.onStart(async () => {
          const now = Date.now();
          await Bun.$`echo ${now} > bundle-time.txt`;
        });
      },
    },
  ],
});
```

In the above example, Bun will wait until the first `onStart()` (sleeping for 10 seconds) has completed, _as well as_ the second `onStart()` (writing the bundle time to a file).

Note that `onStart()` callbacks (like every other lifecycle callback) do not have the ability to modify the `build.config` object. If you want to mutate `build.config`, you must do so directly in the `setup()` function.

### `onResolve`

```ts
onResolve(
  args: { filter: RegExp; namespace?: string },
  callback: (args: { path: string; importer: string }) => {
    path: string;
    namespace?: string;
  } | void,
): void;
```

To bundle your project, Bun walks down the dependency tree of all modules in your project. For each imported module, Bun actually has to find and read that module. The "finding" part is known as "resolving" a module.

The `onResolve()` plugin lifecycle callback allows you to configure how a module is resolved.

The first argument to `onResolve()` is an object with a `filter` and [`namespace`](#what-is-a-namespace) property. The filter is a regular expression which is run on the import string. Effectively, these allow you to filter which modules your custom resolution logic will apply to.

The second argument to `onResolve()` is a callback which is run for each module import Bun finds that matches the `filter` and `namespace` defined in the first argument.

The callback receives as input the _path_ to the matching module. The callback can return a _new path_ for the module. Bun will read the contents of the _new path_ and parse it as a module.

For example, redirecting all imports to `images/` to `./public/images/`:

```ts
import { plugin } from "bun";

plugin({
  name: "onResolve example",
  setup(build) {
    build.onResolve({ filter: /.*/, namespace: "file" }, args => {
      if (args.path.startsWith("images/")) {
        return {
          path: args.path.replace("images/", "./public/images/"),
        };
      }
    });
  },
});
```

### `onLoad`

```ts
onLoad(
  args: { filter: RegExp; namespace?: string },
  callback: (args: { path: string, importer: string, namespace: string, kind: ImportKind  }) => {
    loader?: Loader;
    contents?: string;
    exports?: Record<string, any>;
  },
): void;
```

After Bun's bundler has resolved a module, it needs to read the contents of the module and parse it.

The `onLoad()` plugin lifecycle callback allows you to modify the _contents_ of a module before it is read and parsed by Bun.

Like `onResolve()`, the first argument to `onLoad()` allows you to filter which modules this invocation of `onLoad()` will apply to.

The second argument to `onLoad()` is a callback which is run for each matching module _before_ Bun loads the contents of the module into memory.

This callback receives as input the _path_ to the matching module, the _importer_ of the module (the module that imported the module), the _namespace_ of the module, and the _kind_ of the module.

The callback can return a new `contents` string for the module as well as a new `loader`.

For example:

```ts
import { plugin } from "bun";

plugin({
  name: "env plugin",
  setup(build) {
    build.onLoad({ filter: /env/, namespace: "file" }, args => {
      return {
        contents: `export default ${JSON.stringify(process.env)}`,
        loader: "js",
      };
    });
  },
});
```

This plugin will transform all imports of the form `import env from "env"` into a JavaScript module that exports the current environment variables.

#### `.defer()`

One of the arguments passed to the `onLoad` callback is a `defer` function. This function returns a `Promise` that is resolved when all _other_ modules have been loaded.

This allows you to delay execution of the `onLoad` callback until all other modules have been loaded.

This is useful for returning contens of a module that depends on other modules.

##### Example: tracking and reporting unused exports

```ts
import { plugin } from "bun";

plugin({
  name: "track imports",
  setup(build) {
    const transpiler = new Bun.Transpiler();

    let trackedImports: Record<string, number> = {};

    // Each module that goes through this onLoad callback
    // will record its imports in `trackedImports`
    build.onLoad({ filter: /\.ts/ }, async ({ path }) => {
      const contents = await Bun.file(path).arrayBuffer();

      const imports = transpiler.scanImports(contents);

      for (const i of imports) {
        trackedImports[i.path] = (trackedImports[i.path] || 0) + 1;
      }

      return undefined;
    });

    build.onLoad({ filter: /stats\.json/ }, async ({ defer }) => {
      // Wait for all files to be loaded, ensuring
      // that every file goes through the above `onLoad()` function
      // and their imports tracked
      await defer();

      // Emit JSON containing the stats of each import
      return {
        contents: `export default ${JSON.stringify(trackedImports)}`,
        loader: "json",
      };
    });
  },
});
```

Note that the `.defer()` function currently has the limitation that it can only be called once per `onLoad` callback.
