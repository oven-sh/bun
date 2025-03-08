Bun's bundler API is inspired heavily by [esbuild](https://esbuild.github.io/). Migrating to Bun's bundler from esbuild should be relatively painless. This guide will briefly explain why you might consider migrating to Bun's bundler and provide a side-by-side API comparison reference for those who are already familiar with esbuild's API.

There are a few behavioral differences to note.

- **Bundling by default**. Unlike esbuild, Bun _always bundles by default_. This is why the `--bundle` flag isn't necessary in the Bun example. To transpile each file individually, use [`Bun.Transpiler`](https://bun.sh/docs/api/transpiler).
- **It's just a bundler**. Unlike esbuild, Bun's bundler does not include a built-in development server or file watcher. It's just a bundler. The bundler is intended for use in conjunction with `Bun.serve` and other runtime APIs to achieve the same effect. As such, all options relating to HTTP/file watching are not applicable.

## Performance

With a performance-minded API coupled with the extensively optimized Zig-based JS/TS parser, Bun's bundler is 1.75x faster than esbuild on esbuild's [three.js benchmark](https://github.com/oven-sh/bun/tree/main/bench/bundle).

{% image src="/images/bundler-speed.png" caption="Bundling 10 copies of three.js from scratch, with sourcemaps and minification" /%}

## CLI API

Bun and esbuild both provide a command-line interface.

```bash
$ esbuild <entrypoint> --outdir=out --bundle
$ bun build <entrypoint> --outdir=out
```

In Bun's CLI, simple boolean flags like `--minify` do not accept an argument. Other flags like `--outdir <path>` do accept an argument; these flags can be written as `--outdir out` or `--outdir=out`. Some flags like `--define` can be specified several times: `--define foo=bar --define bar=baz`.

{% table %}

- `esbuild`
- `bun build`

---

- `--bundle`
- n/a
- Bun always bundles, use `--no-bundle` to disable this behavior.

---

- `--define:K=V`
- `--define K=V`
- Small syntax difference; no colon.

  ```bash
  $ esbuild --define:foo=bar
  $ bun build --define foo=bar
  ```

---

- `--external:<pkg>`
- `--external <pkg>`
- Small syntax difference; no colon.

  ```bash
  $ esbuild --external:react
  $ bun build --external react
  ```

---

- `--format`
- `--format`
- Bun supports `"esm"` and `"cjs"` currently, but more module formats are planned. esbuild defaults to `"iife"`.

---

- `--loader:.ext=loader`
- `--loader .ext:loader`
- Bun supports a different set of built-in loaders than esbuild; see [Bundler > Loaders](https://bun.sh/docs/bundler/loaders) for a complete reference. The esbuild loaders `dataurl`, `binary`, `base64`, `copy`, and `empty` are not yet implemented.

  The syntax for `--loader` is slightly different.

  ```bash
  $ esbuild app.ts --bundle --loader:.svg=text
  $ bun build app.ts --loader .svg:text
  ```

---

- `--minify`
- `--minify`
- No differences

---

- `--outdir`
- `--outdir`
- No differences

---

- `--outfile`
- `--outfile`

---

- `--packages`
- `--packages`
- No differences

---

- `--platform`
- `--target`
- Renamed to `--target` for consistency with tsconfig. Does not support `neutral`.

---

- `--serve`
- n/a
- Not applicable

---

- `--sourcemap`
- `--sourcemap`
- No differences

---

- `--splitting`
- `--splitting`
- No differences

---

- `--target`
- n/a
- No supported. Bun's bundler performs no syntactic down-leveling at this time.

---

- `--watch`
- `--watch`
- No differences

---

- `--allow-overwrite`
- n/a
- Overwriting is never allowed

---

- `--analyze`
- n/a
- Not supported

---

- `--asset-names`
- `--asset-naming`
- Renamed for consistency with `naming` in JS API

---

- `--banner`
- `--banner`
- Only applies to js bundles

---

- `--footer`
- `--footer`
- Only applies to js bundles

---

- `--certfile`
- n/a
- Not applicable

---

- `--charset=utf8`
- n/a
- Not supported

---

- `--chunk-names`
- `--chunk-naming`
- Renamed for consistency with `naming` in JS API

---

- `--color`
- n/a
- Always enabled

---

- `--drop`
- `--drop`

---

- `--entry-names`
- `--entry-naming`
- Renamed for consistency with `naming` in JS API

---

- `--global-name`
- n/a
- Not applicable, Bun does not support `iife` output at this time

---

- `--ignore-annotations`
- `--ignore-dce-annotations`

---

- `--inject`
- n/a
- Not supported

---

- `--jsx`
- `--jsx-runtime <runtime>`
- Supports `"automatic"` (uses `jsx` transform) and `"classic"` (uses `React.createElement`)

---

- `--jsx-dev`
- n/a
- Bun reads `compilerOptions.jsx` from `tsconfig.json` to determine a default. If `compilerOptions.jsx` is `"react-jsx"`, or if `NODE_ENV=production`, Bun will use the `jsx` transform. Otherwise, it uses `jsxDEV`. For any to Bun uses `jsxDEV`. The bundler does not support `preserve`.

---

- `--jsx-factory`
- `--jsx-factory`

---

- `--jsx-fragment`
- `--jsx-fragment`

---

- `--jsx-import-source`
- `--jsx-import-source`

---

- `--jsx-side-effects`
- n/a
- JSX is always assumed to be side-effect-free

---

- `--keep-names`
- n/a
- Not supported

---

- `--keyfile`
- n/a
- Not applicable

---

- `--legal-comments`
- n/a
- Not supported

---

- `--log-level`
- n/a
- Not supported. This can be set in `bunfig.toml` as `logLevel`.

---

- `--log-limit`
- n/a
- Not supported

---

- `--log-override:X=Y`
- n/a
- Not supported

---

- `--main-fields`
- n/a
- Not supported

---

- `--mangle-cache`
- n/a
- Not supported

---

- `--mangle-props`
- n/a
- Not supported

---

- `--mangle-quoted`
- n/a
- Not supported

---

- `--metafile`
- n/a
- Not supported

---

- `--minify-whitespace`
- `--minify-whitespace`

---

- `--minify-identifiers`
- `--minify-identifiers`

---

- `--minify-syntax`
- `--minify-syntax`

---

- `--out-extension`
- n/a
- Not supported

---

- `--outbase`
- `--root`

---

- `--preserve-symlinks`
- n/a
- Not supported

---

- `--public-path`
- `--public-path`

---

- `--pure`
- n/a
- Not supported

---

- `--reserve-props`
- n/a
- Not supported

---

- `--resolve-extensions`
- n/a
- Not supported

---

- `--servedir`
- n/a
- Not applicable

---

- `--source-root`
- n/a
- Not supported

---

- `--sourcefile`
- n/a
- Not supported. Bun does not support `stdin` input yet.

---

- `--sourcemap`
- `--sourcemap`
- No differences

---

- `--sources-content`
- n/a
- Not supported

---

- `--supported`
- n/a
- Not supported

---

- `--tree-shaking`
- n/a
- Always `true`

---

- `--tsconfig`
- `--tsconfig-override`

---

- `--version`
- n/a
- Run `bun --version` to see the version of Bun.

{% /table %}

## JavaScript API

{% table %}

- `esbuild.build()`
- `Bun.build()`

---

- `absWorkingDir`
- n/a
- Always set to `process.cwd()`

---

- `alias`
- n/a
- Not supported

---

- `allowOverwrite`
- n/a
- Always `false`

---

- `assetNames`
- `naming.asset`
- Uses same templating syntax as esbuild, but `[ext]` must be included explicitly.

  ```ts
  Bun.build({
    entrypoints: ["./index.tsx"],
    naming: {
      asset: "[name].[ext]",
    },
  });
  ```

---

- `banner`
- n/a
- Not supported

---

- `bundle`
- n/a
- Always `true`. Use [`Bun.Transpiler`](https://bun.sh/docs/api/transpiler) to transpile without bundling.

---

- `charset`
- n/a
- Not supported

---

- `chunkNames`
- `naming.chunk`
- Uses same templating syntax as esbuild, but `[ext]` must be included explicitly.

  ```ts
  Bun.build({
    entrypoints: ["./index.tsx"],
    naming: {
      chunk: "[name].[ext]",
    },
  });
  ```

---

- `color`
- n/a
- Bun returns logs in the `logs` property of the build result.

---

- `conditions`
- n/a
- Not supported. Export conditions priority is determined by `target`.

---

- `define`
- `define`

---

- `drop`
- n/a
- Not supported

---

- `entryNames`
- `naming` or `naming.entry`
- Bun supports a `naming` key that can either be a string or an object. Uses same templating syntax as esbuild, but `[ext]` must be included explicitly.

  ```ts
  Bun.build({
    entrypoints: ["./index.tsx"],
    // when string, this is equivalent to entryNames
    naming: "[name].[ext]",

    // granular naming options
    naming: {
      entry: "[name].[ext]",
      asset: "[name].[ext]",
      chunk: "[name].[ext]",
    },
  });
  ```

---

- `entryPoints`
- `entrypoints`
- Capitalization difference

---

- `external`
- `external`
- No differences

---

- `footer`
- n/a
- Not supported

---

- `format`
- `format`
- Only supports `"esm"` currently. Support for `"cjs"` and `"iife"` is planned.

---

- `globalName`
- n/a
- Not supported

---

- `ignoreAnnotations`
- n/a
- Not supported

---

- `inject`
- n/a
- Not supported

---

- `jsx`
- `jsx`
- Not supported in JS API, configure in `tsconfig.json`

---

- `jsxDev`
- `jsxDev`
- Not supported in JS API, configure in `tsconfig.json`

---

- `jsxFactory`
- `jsxFactory`
- Not supported in JS API, configure in `tsconfig.json`

---

- `jsxFragment`
- `jsxFragment`
- Not supported in JS API, configure in `tsconfig.json`

---

- `jsxImportSource`
- `jsxImportSource`
- Not supported in JS API, configure in `tsconfig.json`

---

- `jsxSideEffects`
- `jsxSideEffects`
- Not supported in JS API, configure in `tsconfig.json`

---

- `keepNames`
- n/a
- Not supported

---

- `legalComments`
- n/a
- Not supported

---

- `loader`
- `loader`
- Bun supports a different set of built-in loaders than esbuild; see [Bundler > Loaders](https://bun.sh/docs/bundler/loaders) for a complete reference. The esbuild loaders `dataurl`, `binary`, `base64`, `copy`, and `empty` are not yet implemented.

---

- `logLevel`
- n/a
- Not supported

---

- `logLimit`
- n/a
- Not supported

---

- `logOverride`
- n/a
- Not supported

---

- `mainFields`
- n/a
- Not supported

---

- `mangleCache`
- n/a
- Not supported

---

- `mangleProps`
- n/a
- Not supported

---

- `mangleQuoted`
- n/a
- Not supported

---

- `metafile`
- n/a
- Not supported

<!-- - `manifest`
- When `manifest` is `true`, the result of `Bun.build()` will contain a `manifest` property. The manifest is compatible with esbuild's metafile format. -->

---

- `minify`
- `minify`
- In Bun, `minify` can be a boolean or an object.

  ```ts
  await Bun.build({
    entrypoints: ['./index.tsx'],
    // enable all minification
    minify: true

    // granular options
    minify: {
      identifiers: true,
      syntax: true,
      whitespace: true
    }
  })
  ```

---

- `minifyIdentifiers`
- `minify.identifiers`
- See `minify`

---

- `minifySyntax`
- `minify.syntax`
- See `minify`

---

- `minifyWhitespace`
- `minify.whitespace`
- See `minify`

---

- `nodePaths`
- n/a
- Not supported

---

- `outExtension`
- n/a
- Not supported

---

- `outbase`
- `root`
- Different name

---

- `outdir`
- `outdir`
- No differences

---

- `outfile`
- `outfile`
- No differences

---

- `packages`
- n/a
- Not supported, use `external`

---

- `platform`
- `target`
- Supports `"bun"`, `"node"` and `"browser"` (the default). Does not support `"neutral"`.

---

- `plugins`
- `plugins`
- Bun's plugin API is a subset of esbuild's. Some esbuild plugins will work out of the box with Bun.

---

- `preserveSymlinks`
- n/a
- Not supported

---

- `publicPath`
- `publicPath`
- No differences

---

- `pure`
- n/a
- Not supported

---

- `reserveProps`
- n/a
- Not supported

---

- `resolveExtensions`
- n/a
- Not supported

---

- `sourceRoot`
- n/a
- Not supported

---

- `sourcemap`
- `sourcemap`
- Supports `"inline"`, `"external"`, and `"none"`

---

- `sourcesContent`
- n/a
- Not supported

---

- `splitting`
- `splitting`
- No differences

---

- `stdin`
- n/a
- Not supported

---

- `supported`
- n/a
- Not supported

---

- `target`
- n/a
- No support for syntax downleveling

---

- `treeShaking`
- n/a
- Always `true`

---

- `tsconfig`
- n/a
- Not supported

---

- `write`
- n/a
- Set to `true` if `outdir`/`outfile` is set, otherwise `false`

---

{% /table %}

## Plugin API

Bun's plugin API is designed to be esbuild compatible. Bun doesn't support esbuild's entire plugin API surface, but the core functionality is implemented. Many third-party `esbuild` plugins will work out of the box with Bun.

{% callout %}
Long term, we aim for feature parity with esbuild's API, so if something doesn't work please file an issue to help us prioritize.

{% /callout %}

Plugins in Bun and esbuild are defined with a `builder` object.

```ts
import type { BunPlugin } from "bun";

const myPlugin: BunPlugin = {
  name: "my-plugin",
  setup(builder) {
    // define plugin
  },
};
```

The `builder` object provides some methods for hooking into parts of the bundling process. Bun implements `onResolve` and `onLoad`; it does not yet implement the esbuild hooks `onStart`, `onEnd`, and `onDispose`, and `resolve` utilities. `initialOptions` is partially implemented, being read-only and only having a subset of esbuild's options; use [`config`](https://bun.sh/docs/bundler/plugins) (same thing but with Bun's `BuildConfig` format) instead.

```ts
import type { BunPlugin } from "bun";
const myPlugin: BunPlugin = {
  name: "my-plugin",
  setup(builder) {
    builder.onResolve(
      {
        /* onResolve.options */
      },
      args => {
        return {
          /* onResolve.results */
        };
      },
    );
    builder.onLoad(
      {
        /* onLoad.options */
      },
      args => {
        return {
          /* onLoad.results */
        };
      },
    );
  },
};
```

### `onResolve`

#### `options`

{% table %}

- 🟢
- `filter`

---

- 🟢
- `namespace`

{% /table %}

#### `arguments`

{% table %}

- 🟢
- `path`

---

- 🟢
- `importer`

---

- 🔴
- `namespace`

---

- 🔴
- `resolveDir`

---

- 🔴
- `kind`

---

- 🔴
- `pluginData`

{% /table %}

#### `results`

{% table %}

- 🟢
- `namespace`

---

- 🟢
- `path`

---

- 🔴
- `errors`

---

- 🔴
- `external`

---

- 🔴
- `pluginData`

---

- 🔴
- `pluginName`

---

- 🔴
- `sideEffects`

---

- 🔴
- `suffix`

---

- 🔴
- `warnings`

---

- 🔴
- `watchDirs`

---

- 🔴
- `watchFiles`

{% /table %}

### `onLoad`

#### `options`

{% table %}

---

- 🟢
- `filter`

---

- 🟢
- `namespace`

{% /table %}

#### `arguments`

{% table %}

---

- 🟢
- `path`

---

- 🔴
- `namespace`

---

- 🔴
- `suffix`

---

- 🔴
- `pluginData`

{% /table %}

#### `results`

{% table %}

---

- 🟢
- `contents`

---

- 🟢
- `loader`

---

- 🔴
- `errors`

---

- 🔴
- `pluginData`

---

- 🔴
- `pluginName`

---

- 🔴
- `resolveDir`

---

- 🔴
- `warnings`

---

- 🔴
- `watchDirs`

---

- 🔴
- `watchFiles`

{% /table %}
