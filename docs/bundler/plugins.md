Bun provides a universal plugin API that can be used to extend both the _runtime_ and _bundler_.

Plugins intercept imports and perform custom loading logic: reading files, transpiling code, etc. They can be used to add support for additional file types, like `.scss` or `.yaml`. In the context of Bun's bundler, plugins can be used to implement framework-level features like CSS extraction, macros, and client-server code co-location.

For more complete documentation of the Plugin API, see [Runtime > Plugins](https://bun.sh/docs/runtime/plugins).

## Usage

A plugin is defined as simple JavaScript object containing a `name` property and a `setup` function. Register a plugin with Bun using the `plugin` function.

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
Bun.build({
  entrypoints: ["./app.ts"],
  outdir: "./out",
  plugins: [myPlugin],
});
```
