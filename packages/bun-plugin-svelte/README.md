<p align="center">
  <a href="https://bun.com"><img src="https://github.com/user-attachments/assets/50282090-adfd-4ddb-9e27-c30753c6b161" alt="Logo" height=170></a>
</p>
<h1 align="center"><code>bun-plugin-svelte</code></h1>

The official [Svelte](https://svelte.dev/) plugin for [Bun](https://bun.com/).

## Installation

```sh
$ bun add -D bun-plugin-svelte
```

## Dev Server Usage

`bun-plugin-svelte` integrates with Bun's [Fullstack Dev Server](https://bun.com/docs/bundler/fullstack), giving you
HMR when developing your Svelte app.

Start by registering it in your [bunfig.toml](https://bun.com/docs/runtime/bunfig):

```toml
[serve.static]
plugins = ["bun-plugin-svelte"]
```

Then start your dev server:

```
$ bun index.html
```

See the [example](https://github.com/oven-sh/bun/tree/main/packages/bun-plugin-svelte/example) for a complete example.

## Bundler Usage

`bun-plugin-svelte` lets you bundle Svelte components with [`Bun.build`](https://bun.com/docs/bundler).

```ts
// build.ts
// to use: bun run build.ts
import { SveltePlugin } from "bun-plugin-svelte"; // NOTE: not published to npm yet

Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "browser",
  sourcemap: true, // sourcemaps not yet supported
  plugins: [
    SveltePlugin({
      development: true, // turn off for prod builds. Defaults to false
    }),
  ],
});
```

## Server-Side Usage

`bun-plugin-svelte` does not yet support server-side imports (e.g. for SSR).
This will be added in the near future.

## Not Yet Supported

Support for these features will be added in the near future

- Server-side imports/rendering
- Source maps
- CSS extensions (e.g. tailwind) in `<style>` blocks
- TypeScript-specific features (e.g. enums and namespaces). If you're using
  TypeScript 5.8, consider enabling [`--erasableSyntaxOnly`](https://devblogs.microsoft.com/typescript/announcing-typescript-5-8-beta/#the---erasablesyntaxonly-option)
