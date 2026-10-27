<p align="center">
  <a href="https://bun.com"><img src="https://github.com/user-attachments/assets/50282090-adfd-4ddb-9e27-c30753c6b161" alt="Logo" height=170></a>
</p>
<h1 align="center"><code>bun-plugin-tailwind</code></h1>

The official [Tailwind CSS](https://tailwindcss.com/) plugin for [Bun](https://bun.com/). It works with Tailwind 4.1 and
later.

## Installation

```sh
$ bun add -D bun-plugin-tailwind tailwindcss
```

```css
/* index.css */
@import "tailwindcss";
```

## Dev Server Usage

`bun-plugin-tailwind` integrates with Bun's [Fullstack Dev Server](https://bun.com/docs/bundler/fullstack). Register it
in your [bunfig.toml](https://bun.com/docs/runtime/bunfig):

```toml
[serve.static]
plugins = ["bun-plugin-tailwind"]
```

Then start your dev server:

```
$ bun index.html
```

## Bundler Usage

```ts
// build.ts
// to use: bun run build.ts
import tailwind from "bun-plugin-tailwind";

await Bun.build({
  entrypoints: ["src/index.html"],
  outdir: "dist",
  minify: true,
  plugins: [tailwind],
});
```

## How it works

1. A native hook (`onBeforeParse`) scans the files that the bundler parses for class names, on the bundler's threads. A
   file of a dependency that your code imports is scanned too, with no `@source` for it. Stylesheets, common binary
   assets and modules that another plugin makes up (a namespace other than `file`) are not scanned.
2. Each `.css` file is compiled with `@tailwindcss/node`, from the class names of the module graph and from the ones
   that Tailwind's [source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files) finds on disk.
   `source(none)`, `source("./dir")` and `@source not` apply to both.
3. Bun's CSS parser lowers and minifies the result. A stylesheet that does not use Tailwind is left to Bun as it is.

Set `DEBUG=tailwindcss` to print how long each step takes.

On a platform that the native hook is not built for, the plugin still works: it only finds the class names of files on
disk.

### Known limitations

- The dev server does not watch what only Tailwind reads: a stylesheet that Tailwind inlines for `@import`, a `@config`
  or `@plugin` file, a template that only `@source` reaches. An edit of one shows up with the next edit of a file that
  Bun does watch.
- After Tailwind rejects a stylesheet, the dev server reports the error once and goes on with the last CSS that worked,
  until the stylesheet or a file that it already depended on changes.
- `import css from "./index.css" with { type: "text" }` does not give the generated CSS as a string: Bun does not tell a
  plugin about the `type`.

## Development

The plugin is TypeScript that Bun runs as it is (`src/`), and one small Rust crate for the native hook (`native/`). The
crate uses Tailwind's scanner, [`tailwindcss-oxide`](https://github.com/tailwindlabs/tailwindcss/tree/main/crates/oxide),
unchanged.

```sh
$ bun install
$ bun run build:native   # needs rustup; writes bun-plugin-tailwind.<platform>.node
$ bun test
```

### Updating Tailwind

A new Tailwind release reaches users without a release of this package: `@tailwindcss/node`, `@tailwindcss/oxide` and
`tailwindcss` are ordinary dependencies with a `^` range. Only the scanner inside the native hook is pinned. To move it:

1. In `native/Cargo.toml`, set `rev` of `tailwindcss-oxide` to the commit of the release tag.
2. `cargo update --manifest-path native/Cargo.toml -p tailwindcss-oxide`
3. `bun update`, so that the tests run with that release.
4. Set `channel` in `rust-toolchain.toml` to the one in Tailwind's `rust-toolchain.toml` at that tag.

### Releasing

1. Raise `version` in `package.json`.
2. Run the [`bun-plugin-tailwind` workflow](https://github.com/oven-sh/bun/actions/workflows/bun-plugin-tailwind.yml) on
   `main`. It builds the native hook for every platform.
3. Put the nine `.node` files of its artifacts into this directory:
   `gh run download <run id> --dir artifacts && mv artifacts/*/*.node .`
4. `bun publish`

## License

MIT. `src/index.ts` follows [`@tailwindcss/vite`](https://github.com/tailwindlabs/tailwindcss/tree/main/packages/%40tailwindcss-vite),
which is MIT licensed, Copyright (c) Tailwind Labs, Inc.
