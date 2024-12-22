Bun provides a universal plugin API that can be used to extend both the _runtime_ and _bundler_.

Plugins intercept imports and perform custom loading logic: reading files, transpiling code, etc. They can be used to add support for additional file types, like `.scss` or `.yaml`. In the context of Bun's bundler, plugins can be used to implement framework-level features like CSS extraction, macros, and client-server code co-location.

## Lifecycle hooks

Plugins can register callbacks to be run at various points in the lifecycle of a bundle:

- [`onStart()`](#onstart): Run once the bundler has started a bundle
- [`onResolve()`](#onresolve): Run before a module is resolved
- [`onLoad()`](#onload): Run before a module is loaded.
- [`onBeforeParse()`](#onbeforeparse): Run zero-copy native addons in the parser thread before a file is parsed.

### Reference

A rough overview of the types (please refer to Bun's `bun.d.ts` for the full type definitions):

```ts
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
    defer: () => Promise<void>,
    callback: (args: { path: string }) => {
      loader?: Loader;
      contents?: string;
      exports?: Record<string, any>;
    },
  ) => void;
  config: BuildConfig;
};

type Loader = "js" | "jsx" | "ts" | "tsx" | "css" | "json" | "toml";
```

## Usage

A plugin is defined as simple JavaScript object containing a `name` property and a `setup` function.

```tsx#myPlugin.ts
import type { BunPlugin } from "bun";

const myPlugin: BunPlugin = {
  name: "Custom loader",
  setup(build) {
    // implementation
  },
};
```

This plugin can be passed into the `plugins` array when calling `Bun.build`.

```ts
await Bun.build({
  entrypoints: ["./app.ts"],
  outdir: "./out",
  plugins: [myPlugin],
});
```

## Plugin lifecycle

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
  defer: () => Promise<void>,
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

const envPlugin: BunPlugin = {
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

Bun.build({
  entrypoints: ["./app.ts"],
  outdir: "./dist",
  plugins: [envPlugin],
});

// import env from "env"
// env.FOO === "bar"
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

## Native plugins

One of the reasons why Bun's bundler is so fast is that it is written in native code and leverages multi-threading to load and parse modules in parallel.

However, one limitation of plugins written in JavaScript is that JavaScript itself is single-threaded.

Native plugins are written as [NAPI](/docs/node-api) modules and can be run on multiple threads. This allows native plugins to run much faster than JavaScript plugins.

In addition, native plugins can skip unnecessary work such as the UTF-8 -> UTF-16 conversion needed to pass strings to JavaScript.

These are the following lifecycle hooks which are available to native plugins:

- [`onBeforeParse()`](#onbeforeparse): Called on any thread before a file is parsed by Bun's bundler.

Native plugins are NAPI modules which expose lifecycle hooks as C ABI functions.

To create a native plugin, you must export a C ABI function which matches the signature of the native lifecycle hook you want to implement.

### Creating a native plugin in Rust

Native plugins are NAPI modules which expose lifecycle hooks as C ABI functions.

To create a native plugin, you must export a C ABI function which matches the signature of the native lifecycle hook you want to implement.

```bash
bun add -g @napi-rs/cli
napi new
```

Then install this crate:

```bash
cargo add bun-native-plugin
```

Now, inside the `lib.rs` file, we'll use the `bun_native_plugin::bun` proc macro to define a function which
will implement our native plugin.

Here's an example implementing the `onBeforeParse` hook:

```rs
use bun_native_plugin::{define_bun_plugin, OnBeforeParse, bun, Result, anyhow, BunLoader};
use napi_derive::napi;

/// Define the plugin and its name
define_bun_plugin!("replace-foo-with-bar");

/// Here we'll implement `onBeforeParse` with code that replaces all occurrences of
/// `foo` with `bar`.
///
/// We use the #[bun] macro to generate some of the boilerplate code.
///
/// The argument of the function (`handle: &mut OnBeforeParse`) tells
/// the macro that this function implements the `onBeforeParse` hook.
#[bun]
pub fn replace_foo_with_bar(handle: &mut OnBeforeParse) -> Result<()> {
  // Fetch the input source code.
  let input_source_code = handle.input_source_code()?;

  // Get the Loader for the file
  let loader = handle.output_loader();


  let output_source_code = input_source_code.replace("foo", "bar");

  handle.set_output_source_code(output_source_code, BunLoader::BUN_LOADER_JSX);

  Ok(())
}
```

And to use it in Bun.build():

```typescript
import myNativeAddon from "./my-native-addon";
Bun.build({
  entrypoints: ["./app.tsx"],
  plugins: [
    {
      name: "my-plugin",

      setup(build) {
        build.onBeforeParse(
          {
            namespace: "file",
            filter: "**/*.tsx",
          },
          {
            napiModule: myNativeAddon,
            symbol: "replace_foo_with_bar",
            // external: myNativeAddon.getSharedState()
          },
        );
      },
    },
  ],
});
```

### `onBeforeParse`

```ts
onBeforeParse(
  args: { filter: RegExp; namespace?: string },
  callback: { napiModule: NapiModule; symbol: string; external?: unknown },
): void;
```

This lifecycle callback is run immediately before a file is parsed by Bun's bundler.

As input, it receives the file's contents and can optionally return new source code.

This callback can be called from any thread and so the napi module implementation must be thread-safe.
