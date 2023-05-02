Bun's bundler API is inspired heavily by [esbuild](https://esbuild.github.io/). Migrating to Bun's bundler from esbuild should be relatively painless. This guide will briefly explain why you might consider migrating to Bun's bundler and provide a side-by-side API comparison reference for those who are already familiar with esbuild's API.

## Performance

This is the simplest reason to migrate to Bun's bundler. Bun borrowed heavily from esbuild's design while avoiding some architectural issues that limit its maximum performance. Plus, Bun's bundler takes full advantage of the extensive optimization work that's been done on Bun's internal JS/TS parser.

In the end,

## CLI

Bun and esbuild both provide a command-line interface.

```bash
$ esbuild <entrypoint> --outdir=out --bundle
$ bun build <entrypoint> --outdir=out
```

There are a few behavioral differences to note.

- **Bundling by default**. Bun _always bundles by default_. This is why the `--bundle` flag isn't necessary in the Bun example.
- **It's just a bundler**. Bun's bundler does not include a built-in development server or file watcher. It's just a bundler. The bundler is intended for use in conjunction with `Bun.serve` and other runtime APIs to achieve the same effect. As such, all options relating to HTTP/file watching are not applicable.
- **CLI flags**. In Bun's CLI, simple boolean flags like `--minify` do not accept an argument. Other flags like `--outdir <path>` do accept an argument; these flags can be written as `--outdir out` or `--outdir=out`. Some flags like `--define` can be specified several times: `--define foo=bar --define bar=baz`.

{% table %}

- `esbuild`
- `bun build`

---

- `--bundle`
- n/a
- Not necessary, `bun build` always bundles.

---

- `--define:K=V`
- `--define K=V`
- Small syntax difference; no colon.

  ```bash
  $ esbuild --define:K=V
  $ bun build --define K=V
  ```

---

- `--external:<pkg>`
- `--external <pkg>`
- Small syntax difference; no colon.

---

- `--format`
- `--format`
- Bun only supports `"esm"` currently but other module formats are planned. esbuild defaults to `"iife"`.

---

- `--loader`
- `--loader`
- Small syntax difference.

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
- n/a
- Not supported

---

- `--platform`
- `--target`
- Renamed to `--target` for consistency with tsconfig

---

- `--serve`
- n/a
- Not applicable.

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
- No supported. Bun's bundler performs no syntactic downleveling at this time.

---

- `--watch`
- n/a
- Not applicable.

---

- `--allow-overwrite`
- n/a
- Overwriting is always allowed

---

- `--analyze`
- n/a
- Not supported. Use `--manifest` to generate a manifest file.

---

- `--asset-names`
- `--asset-naming`
- Renamed for consistency with `naming` in JS API

---

- `--banner`
- n/a
- Not supported

---

- `--certfile`
- n/a
- Not applicable, Bun's bundler does

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
- n/a
- Not supported

---

- `--entry-names`
- `--entry-naming`
- Renamed for consistency with `naming` in JS API

---

- `--footer`
- n/a
- Not supported

---

- `--global-name`
- n/a
- Not applicable, Bun does not support `iife` output at this time.

---

- `--ignore-annotations`
- n/a
- Not supported

---

- `--inject`
- n/a
- Not supported

---

- `--jsx`
- `--jsx-runtime`
- Supports `"automatic"` (uses `jsx` transform) and `"classic"` (uses `React.createElement`)

---

- `--jsx-dev`
- n/a
- Bun uses `jsxDEV` by default. Set `NODE_ENV=production` to use the production `jsx` transform instead.

---

- `--jsx-factory`
- `--jsx-factory`
- ***

- `--jsx-fragment`
- `--jsx-fragment`

---

- `--jsx-import-source`
- `--jsx-import-source`

---

- `--jsx-side-effects`
- n/a
- JSX is always assumed to be side-effect-free.

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
- `--manifest`

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
- Not supported

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
- Always enabled

---

- `--tsconfig`
- `--tsconfig-override`

---

- `--version`
- n/a
- Run `bun --version` to see the version of Bun.

{% /table %}

## JS API

## Plugins

Bun's plugin API is designed to be esbuild compatible. Bun doesn't support esbuild's entire plugin API surface, but the core functionality is implemented. Many third-party `esbuild` plugins will work out of the box with Bun.

{% callout %}
Long term, we aim for feature parity with esbuild's API, so if something doesn't work please file an issue to help us prioritize.

{% /callout %}

Plugins in Bun and esbuild consist of a set of `onResolve` and `onLoad` hooks.

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
