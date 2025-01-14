# `bun-plugin-yaml`

The official YAML plugin for Bun. Adds support for `.yml`/`.yaml` imports.

## Installation

```sh
bun add bun-plugin-yaml -d
```

## Bundler usage

This plugin can be used to support `.yaml` loaders in Bun's bundler by passing it into the `plugins` array:

```ts
import yamlPlugin from "bun-plugin-yaml";

await Bun.build({
  entrypoints: ["./index.tsx"],
  // other config

  plugins: [yamlPlugin()],
});
```

You can now import `.yaml` files from your source code:

```ts
import data from "./data.yaml";

export function Component() {
  return <div>{data.name}</div>;
}
```

The contents of the `.yaml` file will be inlined into your bundle.

## Runtime usage

To use as a runtime plugin, create a file that registers the plugin:

```ts
// yaml.ts
import yamlPlugin from "bun-plugin-yaml";

Bun.plugin(yamlPlugin());
```

Then preload it in your `bunfig.toml`:

```toml
preload = ["./yaml.ts"]
```

## TypeScript

By default VSCode/TypeScript will not recognize `.yaml` imports. To avoid import errors, add the following to your `tsconfig.json`:

```json-diff
  {
    "compilerOptions": {
      "types": [
        // other packages, e.g. "bun-types",
+       "bun-plugin-yaml"
      ]
    }
  }
```

## Contributing

```bash
$ bun install # project setup
$ bun test # run tests
```
