Bun's fast native bundler is now in beta. It can be used via the `bun build` CLI command or the `Bun.build()` JavaScript API.

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './build',
});
```

```sh#CLI
$ bun build ./index.tsx --outdir ./build
```

{% /codetabs %}

It's fast. The numbers below represent performance on esbuild's [three.js benchmark](https://github.com/oven-sh/bun/tree/main/bench/bundle).

{% image src="/images/bundler-speed.png" caption="Bundling 10 copies of three.js from scratch, with sourcemaps and minification" /%}

## Why bundle?

The bundler is a key piece of infrastructure in the JavaScript ecosystem. As a brief overview of why bundling is so important:

- **Reducing HTTP requests.** A single package in `node_modules` may consist of hundreds of files, and large applications may have dozens of such dependencies. Loading each of these files with a separate HTTP request becomes untenable very quickly, so bundlers are used to convert our application source code into a smaller number of self-contained "bundles" that can be loaded with a single request.
- **Code transforms.** Modern apps are commonly built with languages or tools like TypeScript, JSX, and CSS modules, all of which must be converted into plain JavaScript and CSS before they can be consumed by a browser. The bundler is the natural place to configure these transformations.
- **Framework features.** Frameworks rely on bundler plugins & code transformations to implement common patterns like file-system routing, client-server code co-location (think `getServerSideProps` or Remix loaders), and server components.

Let's jump into the bundler API.

{% callout %}
Note that the Bun bundler is not intended to replace `tsc` for typechecking or generating type declarations.
{% /callout %}

## Basic example

Let's build our first bundle. You have the following two files, which implement a simple client-side rendered React app.

{% codetabs %}

```tsx#./index.tsx
import * as ReactDOM from 'react-dom/client';
import {Component} from "./Component"

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<Component message="Sup!" />)
```

```tsx#./Component.tsx
export function Component(props: {message: string}) {
  return <p>{props.message}</p>
}
```

{% /codetabs %}

Here, `index.tsx` is the "entrypoint" to our application. Commonly, this will be a script that performs some _side effect_, like starting a server or—in this case—initializing a React root. Because we're using TypeScript & JSX, we need to bundle our code before it can be sent to the browser.

To create our bundle:

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out
```

{% /codetabs %}

For each file specified in `entrypoints`, Bun will generate a new bundle. This bundle will be written to disk in the `./out` directory (as resolved from the current working directory). After running the build, the file system looks like this:

```ts
.
├── index.tsx
├── Component.tsx
└── out
    └── index.js
```

The contents of `out/index.js` will look something like this:

```js#out/index.js
// ...
// ~20k lines of code
// including the contents of `react-dom/client` and all its dependencies
// this is where the $jsxDEV and $createRoot functions are defined


// Component.tsx
function Component(props) {
  return $jsxDEV("p", {
    children: props.message
  }, undefined, false, undefined, this);
}

// index.tsx
var rootNode = document.getElementById("root");
var root = $createRoot(rootNode);
root.render($jsxDEV(Component, {
  message: "Sup!"
}, undefined, false, undefined, this));
```

{% details summary="Tutorial: Run this file in your browser" %}
We can load this file in the browser to see our app in action. Create an `index.html` file in the `out` directory:

```bash
$ touch out/index.html
```

Then paste the following contents into it:

```html
<html>
  <body>
    <div id="root"></div>
    <script type="module" src="/index.js"></script>
  </body>
</html>
```

Then spin up a static file server serving the `out` directory:

```bash
$ bunx serve out
```

Visit `http://localhost:5000` to see your bundled app in action.

{% /details %}

## Watch mode

Like the runtime and test runner, the bundler supports watch mode natively.

```sh
$ bun build ./index.tsx --outdir ./out --watch
```

## Content types

Like the Bun runtime, the bundler supports an array of file types out of the box. The following table breaks down the bundler's set of standard "loaders". Refer to [Bundler > File types](https://bun.sh/docs/runtime/loaders) for full documentation.

{% table %}

- Extensions
- Details

---

- `.js` `.jsx`, `.cjs` `.mjs` `.mts` `.cts` `.ts` `.tsx`
- Uses Bun's built-in transpiler to parse the file and transpile TypeScript/JSX syntax to vanilla JavaScript. The bundler executes a set of default transforms including dead code elimination and tree shaking. At the moment Bun does not attempt to down-convert syntax; if you use recently ECMAScript syntax, that will be reflected in the bundled code.

---

- `.json`
- JSON files are parsed and inlined into the bundle as a JavaScript object.

  ```ts
  import pkg from "./package.json";
  pkg.name; // => "my-package"
  ```

---

- `.toml`
- TOML files are parsed and inlined into the bundle as a JavaScript object.

  ```ts
  import config from "./bunfig.toml";
  config.logLevel; // => "debug"
  ```

---

- `.txt`
- The contents of the text file are read and inlined into the bundle as a string.

  ```ts
  import contents from "./file.txt";
  console.log(contents); // => "Hello, world!"
  ```

---

- `.node` `.wasm`
- These files are supported by the Bun runtime, but during bundling they are treated as [assets](#assets).

{% /table %}

### Assets

If the bundler encounters an import with an unrecognized extension, it treats the imported file as an _external file_. The referenced file is copied as-is into `outdir`, and the import is resolved as a _path_ to the file.

{% codetabs %}

```ts#Input
// bundle entrypoint
import logo from "./logo.svg";
console.log(logo);
```

```ts#Output
// bundled output
var logo = "./logo-ab237dfe.svg";
console.log(logo);
```

{% /codetabs %}

{% callout %}
The exact behavior of the file loader is also impacted by [`naming`](#naming) and [`publicPath`](#publicpath).
{% /callout %}

Refer to the [Bundler > Loaders](https://bun.sh/docs/bundler/loaders#file) page for more complete documentation on the file loader.

### Plugins

The behavior described in this table can be overridden or extended with [plugins](https://bun.sh/docs/bundler/plugins). Refer to the [Bundler > Loaders](https://bun.sh/docs/bundler/plugins) page for complete documentation.

## API

### `entrypoints`

**Required.** An array of paths corresponding to the entrypoints of our application. One bundle will be generated for each entrypoint.

{% codetabs group="a" %}

```ts#JavaScript
const result = await Bun.build({
  entrypoints: ["./index.ts"],
});
// => { success: boolean, outputs: BuildArtifact[], logs: BuildMessage[] }
```

```bash#CLI
$ bun build --entrypoints ./index.ts
# the bundle will be printed to stdout
# <bundled code>
```

{% /codetabs %}

### `outdir`

The directory where output files will be written.

{% codetabs group="a" %}

```ts#JavaScript
const result = await Bun.build({
  entrypoints: ['./index.ts'],
  outdir: './out'
});
// => { success: boolean, outputs: BuildArtifact[], logs: BuildMessage[] }
```

```bash#CLI
$ bun build --entrypoints ./index.ts --outdir ./out
# a summary of bundled files will be printed to stdout
```

{% /codetabs %}

If `outdir` is not passed to the JavaScript API, bundled code will not be written to disk. Bundled files are returned in an array of `BuildArtifact` objects. These objects are Blobs with extra properties; see [Outputs](#outputs) for complete documentation.

```ts
const result = await Bun.build({
  entrypoints: ["./index.ts"],
});

for (const res of result.outputs) {
  // Can be consumed as blobs
  await res.text();

  // Bun will set Content-Type and Etag headers
  new Response(res);

  // Can be written manually, but you should use `outdir` in this case.
  Bun.write(path.join("out", res.path), res);
}
```

When `outdir` is set, the `path` property on a `BuildArtifact` will be the absolute path to where it was written to.

### `target`

The intended execution environment for the bundle.

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.ts'],
  outdir: './out',
  target: 'browser', // default
})
```

```bash#CLI
$ bun build --entrypoints ./index.ts --outdir ./out --target browser
```

{% /codetabs %}

Depending on the target, Bun will apply different module resolution rules and optimizations.

<!-- - Module resolution. For example, when bundling for the browser, Bun will prioritize the `"browser"` export condition when resolving imports. An error will be thrown if any Node.js or Bun built-ins are imported or used, e.g. `node:fs` or `Bun.serve`. -->

{% table %}

---

- `browser`
- _Default._ For generating bundles that are intended for execution by a browser. Prioritizes the `"browser"` export condition when resolving imports. Importing any built-in modules, like `node:events` or `node:path` will work, but calling some functions, like `fs.readFile` will not work.

---

- `bun`
- For generating bundles that are intended to be run by the Bun runtime. In many cases, it isn't necessary to bundle server-side code; you can directly execute the source code without modification. However, bundling your server code can reduce startup times and improve running performance.

  All bundles generated with `target: "bun"` are marked with a special `// @bun` pragma, which indicates to the Bun runtime that there's no need to re-transpile the file before execution.

  If any entrypoints contains a Bun shebang (`#!/usr/bin/env bun`) the bundler will default to `target: "bun"` instead of `"browser"`.

  When using `target: "bun"` and `format: "cjs"` together, the `// @bun @bun-cjs` pragma is added and the CommonJS wrapper function is not compatible with Node.js.

---

- `node`
- For generating bundles that are intended to be run by Node.js. Prioritizes the `"node"` export condition when resolving imports, and outputs `.mjs`. In the future, this will automatically polyfill the `Bun` global and other built-in `bun:*` modules, though this is not yet implemented.

{% /table %}

### `format`

Specifies the module format to be used in the generated bundles.

Bun defaults to `"esm"`, and provides experimental support for `"cjs"` and `"iife"`.

#### `format: "esm"` - ES Module

This is the default format, which supports ES Module syntax including top-level `await`, import.meta, and more.

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  format: "esm",
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --format esm
```

{% /codetabs %}

To use ES Module syntax in browsers, set `format` to `"esm"` and make sure your `<script type="module">` tag has `type="module"` set.

#### `format: "cjs"` - CommonJS

To build a CommonJS module, set `format` to `"cjs"`. When choosing `"cjs"`, the default target changes from `"browser"` (esm) to `"node"` (cjs). CommonJS modules transpiled with `format: "cjs", target: "node"` can be executed in both Bun and Node.js (assuming the APIs in use are supported by both).

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  format: "cjs",
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --format cjs
```

{% /codetabs %}

#### `format: "iife"` - IIFE

TODO: document IIFE once we support globalNames.

### `splitting`

Whether to enable code splitting.

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  splitting: false, // default
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --splitting
```

{% /codetabs %}

When `true`, the bundler will enable _code splitting_. When multiple entrypoints both import the same file, module, or set of files/modules, it's often useful to split the shared code into a separate bundle. This shared bundle is known as a _chunk_. Consider the following files:

{% codetabs %}

```ts#entry-a.ts
import { shared } from './shared.ts';
```

```ts#entry-b.ts
import { shared } from './shared.ts';
```

```ts#shared.ts
export const shared = 'shared';
```

{% /codetabs %}

To bundle `entry-a.ts` and `entry-b.ts` with code-splitting enabled:

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./entry-a.ts', './entry-b.ts'],
  outdir: './out',
  splitting: true,
})
```

```bash#CLI
$ bun build ./entry-a.ts ./entry-b.ts --outdir ./out --splitting
```

{% /codetabs %}

Running this build will result in the following files:

```txt
.
├── entry-a.tsx
├── entry-b.tsx
├── shared.tsx
└── out
    ├── entry-a.js
    ├── entry-b.js
    └── chunk-2fce6291bf86559d.js

```

The generated `chunk-2fce6291bf86559d.js` file contains the shared code. To avoid collisions, the file name automatically includes a content hash by default. This can be customized with [`naming`](#naming).

### `plugins`

A list of plugins to use during bundling.

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  plugins: [/* ... */],
})
```

```bash#CLI
n/a
```

{% /codetabs %}

Bun implements a universal plugin system for both Bun's runtime and bundler. Refer to the [plugin documentation](https://bun.sh/docs/bundler/plugins) for complete documentation.

<!-- ### `manifest`

Whether to return a build manifest in the result of `Bun.build`.

```ts
const result = await Bun.build({
  entrypoints: ["./index.tsx"],
  outdir: "./out",
  manifest: true, // default is true
});

console.log(result.manifest);
```

{% details summary="Manifest structure" %}

The manifest has the following form:

```ts
export type BuildManifest = {
  inputs: {
    [path: string]: {
      output: {
        path: string;
      };
      imports: {
        path: string;
        kind: ImportKind;
        external?: boolean;
      }[];
    };
  };
  outputs: {
    [path: string]: {
      type: "chunk" | "entry-point" | "asset";
      inputs: { path: string }[];
      imports: {
        path: string;
        kind: ImportKind;
        external?: boolean;
        asset?: boolean;
      }[];
      exports: string[];
    };
  };
};

export type ImportKind =
  | "entry-point-build"
  | "entry-point-run"
  | "import-statement"
  | "require-call"
  | "dynamic-import"
  | "require-resolve"
  | "import-rule"
  | "url-token";
```

{% /details %}

By design, the manifest is a simple JSON object that can easily be serialized or written to disk. It is also compatible with esbuild's [`metafile`](https://esbuild.github.io/api/#metafile) format. -->

### `env`

Controls how environment variables are handled during bundling. Internally, this uses `define` to inject environment variables into the bundle, but makes it easier to specify the environment variables to inject.

#### `env: "inline"`

Injects environment variables into the bundled output by converting `process.env.FOO` references to string literals containing the actual environment variable values.

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  env: "inline",
})
```

```bash#CLI
$ FOO=bar BAZ=123 bun build ./index.tsx --outdir ./out --env inline
```

{% /codetabs %}

For the input below:

```js#input.js
console.log(process.env.FOO);
console.log(process.env.BAZ);
```

The generated bundle will contain the following code:

```js#output.js
console.log("bar");
console.log("123");
```

#### `env: "PUBLIC_*"` (prefix)

Inlines environment variables matching the given prefix (the part before the `*` character), replacing `process.env.FOO` with the actual environment variable value. This is useful for selectively inlining environment variables for things like public-facing URLs or client-side tokens, without worrying about injecting private credentials into output bundles.

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',

  // Inline all env vars that start with "ACME_PUBLIC_"
  env: "ACME_PUBLIC_*",
})
```

```bash#CLI
$ FOO=bar BAZ=123 ACME_PUBLIC_URL=https://acme.com bun build ./index.tsx --outdir ./out --env 'ACME_PUBLIC_*'
```

{% /codetabs %}

For example, given the following environment variables:

```bash
$ FOO=bar BAZ=123 ACME_PUBLIC_URL=https://acme.com
```

And source code:

```ts#index.tsx
console.log(process.env.FOO);
console.log(process.env.ACME_PUBLIC_URL);
console.log(process.env.BAZ);
```

The generated bundle will contain the following code:

```js
console.log(process.env.FOO);
console.log("https://acme.com");
console.log(process.env.BAZ);
```

#### `env: "disable"`

Disables environment variable injection entirely.

For example, given the following environment variables:

```bash
$ FOO=bar BAZ=123 ACME_PUBLIC_URL=https://acme.com
```

And source code:

```ts#index.tsx
console.log(process.env.FOO);
console.log(process.env.ACME_PUBLIC_URL);
console.log(process.env.BAZ);
```

The generated bundle will contain the following code:

```js
console.log(process.env.FOO);
console.log(process.env.BAZ);
```

### `sourcemap`

Specifies the type of sourcemap to generate.

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  sourcemap: 'linked', // default 'none'
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --sourcemap=linked
```

{% /codetabs %}

{% table %}

---

- `"none"`
- _Default._ No sourcemap is generated.

---

- `"linked"`
- A separate `*.js.map` file is created alongside each `*.js` bundle using a `//# sourceMappingURL` comment to link the two. Requires `--outdir` to be set. The base URL of this can be customized with `--public-path`.

  ```ts
  // <bundled code here>

  //# sourceMappingURL=bundle.js.map
  ```

---

- `"external"`
- A separate `*.js.map` file is created alongside each `*.js` bundle without inserting a `//# sourceMappingURL` comment.

{% /table %}

{% callout %}

Generated bundles contain a [debug id](https://sentry.engineering/blog/the-case-for-debug-ids) that can be used to associate a bundle with its corresponding sourcemap. This `debugId` is added as a comment at the bottom of the file.

```ts
// <generated bundle code>

//# debugId=<DEBUG ID>
```

---

- `"inline"`
- A sourcemap is generated and appended to the end of the generated bundle as a base64 payload.

  ```ts
  // <bundled code here>

  //# sourceMappingURL=data:application/json;base64,<encoded sourcemap here>
  ```

  The associated `*.js.map` sourcemap will be a JSON file containing an equivalent `debugId` property.

{% /callout %}

### `minify`

Whether to enable minification. Default `false`.

{% callout %}
When targeting `bun`, identifiers will be minified by default.
{% /callout %}

To enable all minification options:

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  minify: true, // default false
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --minify
```

{% /codetabs %}

To granularly enable certain minifications:

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  minify: {
    whitespace: true,
    identifiers: true,
    syntax: true,
  },
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --minify-whitespace --minify-identifiers --minify-syntax
```

{% /codetabs %}

<!-- ### `treeshaking`

boolean; -->

### `external`

A list of import paths to consider _external_. Defaults to `[]`.

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  external: ["lodash", "react"], // default: []
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --external lodash --external react
```

{% /codetabs %}

An external import is one that will not be included in the final bundle. Instead, the `import` statement will be left as-is, to be resolved at runtime.

For instance, consider the following entrypoint file:

```ts#index.tsx
import _ from "lodash";
import {z} from "zod";

const value = z.string().parse("Hello world!")
console.log(_.upperCase(value));
```

Normally, bundling `index.tsx` would generate a bundle containing the entire source code of the `"zod"` package. If instead, we want to leave the `import` statement as-is, we can mark it as external:

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  external: ['zod'],
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --external zod
```

{% /codetabs %}

The generated bundle will look something like this:

```js#out/index.js
import {z} from "zod";

// ...
// the contents of the "lodash" package
// including the `_.upperCase` function

var value = z.string().parse("Hello world!")
console.log(_.upperCase(value));
```

To mark all imports as external, use the wildcard `*`:

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  external: ['*'],
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --external '*'
```

{% /codetabs %}

### `packages`

Control whatever package dependencies are included to bundle or not. Possible values: `bundle` (default), `external`. Bun treats any import which path do not start with `.`, `..` or `/` as package.

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.ts'],
  packages: 'external',
})
```

```bash#CLI
$ bun build ./index.ts --packages external
```

{% /codetabs %}

### `naming`

Customizes the generated file names. Defaults to `./[dir]/[name].[ext]`.

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  naming: "[dir]/[name].[ext]", // default
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --entry-naming [dir]/[name].[ext]
```

{% /codetabs %}

By default, the names of the generated bundles are based on the name of the associated entrypoint.

```txt
.
├── index.tsx
└── out
    └── index.js
```

With multiple entrypoints, the generated file hierarchy will reflect the directory structure of the entrypoints.

```txt
.
├── index.tsx
└── nested
    └── index.tsx
└── out
    ├── index.js
    └── nested
        └── index.js
```

The names and locations of the generated files can be customized with the `naming` field. This field accepts a template string that is used to generate the filenames for all bundles corresponding to entrypoints. where the following tokens are replaced with their corresponding values:

- `[name]` - The name of the entrypoint file, without the extension.
- `[ext]` - The extension of the generated bundle.
- `[hash]` - A hash of the bundle contents.
- `[dir]` - The relative path from the project root to the parent directory of the source file.

For example:

{% table %}

- Token
- `[name]`
- `[ext]`
- `[hash]`
- `[dir]`

---

- `./index.tsx`
- `index`
- `js`
- `a1b2c3d4`
- `""` (empty string)

---

- `./nested/entry.ts`
- `entry`
- `js`
- `c3d4e5f6`
- `"nested"`

{% /table %}

We can combine these tokens to create a template string. For instance, to include the hash in the generated bundle names:

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  naming: 'files/[dir]/[name]-[hash].[ext]',
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --entry-naming [name]-[hash].[ext]
```

{% /codetabs %}

This build would result in the following file structure:

```txt
.
├── index.tsx
└── out
    └── files
        └── index-a1b2c3d4.js
```

When a `string` is provided for the `naming` field, it is used only for bundles _that correspond to entrypoints_. The names of [chunks](#splitting) and copied assets are not affected. Using the JavaScript API, separate template strings can be specified for each type of generated file.

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  naming: {
    // default values
    entry: '[dir]/[name].[ext]',
    chunk: '[name]-[hash].[ext]',
    asset: '[name]-[hash].[ext]',
  },
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --entry-naming "[dir]/[name].[ext]" --chunk-naming "[name]-[hash].[ext]" --asset-naming "[name]-[hash].[ext]"
```

{% /codetabs %}

### `root`

The root directory of the project.

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./pages/a.tsx', './pages/b.tsx'],
  outdir: './out',
  root: '.',
})
```

```bash#CLI
n/a
```

{% /codetabs %}

If unspecified, it is computed to be the first common ancestor of all entrypoint files. Consider the following file structure:

```txt
.
└── pages
  └── index.tsx
  └── settings.tsx
```

We can build both entrypoints in the `pages` directory:

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./pages/index.tsx', './pages/settings.tsx'],
  outdir: './out',
})
```

```bash#CLI
$ bun build ./pages/index.tsx ./pages/settings.tsx --outdir ./out
```

{% /codetabs %}

This would result in a file structure like this:

```txt
.
└── pages
  └── index.tsx
  └── settings.tsx
└── out
  └── index.js
  └── settings.js
```

Since the `pages` directory is the first common ancestor of the entrypoint files, it is considered the project root. This means that the generated bundles live at the top level of the `out` directory; there is no `out/pages` directory.

This behavior can be overridden by specifying the `root` option:

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./pages/index.tsx', './pages/settings.tsx'],
  outdir: './out',
  root: '.',
})
```

```bash#CLI
$ bun build ./pages/index.tsx ./pages/settings.tsx --outdir ./out --root .
```

{% /codetabs %}

By specifying `.` as `root`, the generated file structure will look like this:

```txt
.
└── pages
  └── index.tsx
  └── settings.tsx
└── out
  └── pages
    └── index.js
    └── settings.js
```

### `publicPath`

A prefix to be appended to any import paths in bundled code.

In many cases, generated bundles will contain no `import` statements. After all, the goal of bundling is to combine all of the code into a single file. However there are a number of cases with the generated bundles will contain `import` statements.

- **Asset imports** — When importing an unrecognized file type like `*.svg`, the bundler defers to the [`file` loader](https://bun.sh/docs/bundler/loaders#file), which copies the file into `outdir` as is. The import is converted into a variable
- **External modules** — Files and modules can be marked as [`external`](#external), in which case they will not be included in the bundle. Instead, the `import` statement will be left in the final bundle.
- **Chunking**. When [`splitting`](#splitting) is enabled, the bundler may generate separate "chunk" files that represent code that is shared among multiple entrypoints.

In any of these cases, the final bundles may contain paths to other files. By default these imports are _relative_. Here is an example of a simple asset import:

{% codetabs %}

```ts#Input
import logo from './logo.svg';
console.log(logo);
```

```ts#Output
// logo.svg is copied into <outdir>
// and hash is added to the filename to prevent collisions
var logo = './logo-a7305bdef.svg';
console.log(logo);
```

{% /codetabs %}

Setting `publicPath` will prefix all file paths with the specified value.

{% codetabs group="a" %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  publicPath: 'https://cdn.example.com/', // default is undefined
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --public-path https://cdn.example.com/
```

{% /codetabs %}

The output file would now look something like this.

```ts-diff#Output
- var logo = './logo-a7305bdef.svg';
+ var logo = 'https://cdn.example.com/logo-a7305bdef.svg';
```

### `define`

A map of global identifiers to be replaced at build time. Keys of this object are identifier names, and values are JSON strings that will be inlined.

{% callout }
This is not needed to inline `process.env.NODE_ENV`, as Bun does this automatically.
{% /callout %}

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  define: {
    STRING: JSON.stringify("value"),
    "nested.boolean": "true",
  },
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --define 'STRING="value"' --define "nested.boolean=true"
```

{% /codetabs %}

### `loader`

A map of file extensions to [built-in loader names](https://bun.sh/docs/bundler/loaders#built-in-loaders). This can be used to quickly customize how certain files are loaded.

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  loader: {
    ".png": "dataurl",
    ".txt": "file",
  },
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --loader .png:dataurl --loader .txt:file
```

{% /codetabs %}

### `banner`

A banner to be added to the final bundle, this can be a directive like "use client" for react or a comment block such as a license for the code.

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  banner: '"use client";'
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --banner "\"use client\";"
```

{% /codetabs %}

### `footer`

A footer to be added to the final bundle, this can be something like a comment block for a license or just a fun easter egg.

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  footer: '// built with love in SF'
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --footer="// built with love in SF"
```

{% /codetabs %}

### `drop`

Remove function calls from a bundle. For example, `--drop=console` will remove all calls to `console.log`. Arguments to calls will also be removed, regardless of if those arguments may have side effects. Dropping `debugger` will remove all `debugger` statements.

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  drop: ["console", "debugger", "anyIdentifier.or.propertyAccess"],
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --drop=console --drop=debugger --drop=anyIdentifier.or.propertyAccess
```

{% /codetabs %}

## Outputs

The `Bun.build` function returns a `Promise<BuildOutput>`, defined as:

```ts
interface BuildOutput {
  outputs: BuildArtifact[];
  success: boolean;
  logs: Array<object>; // see docs for details
}

interface BuildArtifact extends Blob {
  kind: "entry-point" | "chunk" | "asset" | "sourcemap";
  path: string;
  loader: Loader;
  hash: string | null;
  sourcemap: BuildArtifact | null;
}
```

The `outputs` array contains all the files that were generated by the build. Each artifact implements the `Blob` interface.

```ts
const build = await Bun.build({
  /* */
});

for (const output of build.outputs) {
  await output.arrayBuffer(); // => ArrayBuffer
  await output.bytes(); // => Uint8Array
  await output.text(); // string
}
```

Each artifact also contains the following properties:

{% table %}

---

- `kind`
- What kind of build output this file is. A build generates bundled entrypoints, code-split "chunks", sourcemaps, bytecode, and copied assets (like images).

---

- `path`
- Absolute path to the file on disk

---

- `loader`
- The loader was used to interpret the file. See [Bundler > Loaders](https://bun.sh/docs/bundler/loaders) to see how Bun maps file extensions to the appropriate built-in loader.

---

- `hash`
- The hash of the file contents. Always defined for assets.

---

- `sourcemap`
- The sourcemap file corresponding to this file, if generated. Only defined for entrypoints and chunks.

{% /table %}

Similar to `BunFile`, `BuildArtifact` objects can be passed directly into `new Response()`.

```ts
const build = await Bun.build({
  /* */
});

const artifact = build.outputs[0];

// Content-Type header is automatically set
return new Response(artifact);
```

The Bun runtime implements special pretty-printing of `BuildArtifact` object to make debugging easier.

{% codetabs %}

```ts#Build_script
// build.ts
const build = await Bun.build({/* */});

const artifact = build.outputs[0];
console.log(artifact);
```

```sh#Shell_output
$ bun run build.ts
BuildArtifact (entry-point) {
  path: "./index.js",
  loader: "tsx",
  kind: "entry-point",
  hash: "824a039620219640",
  Blob (114 bytes) {
    type: "text/javascript;charset=utf-8"
  },
  sourcemap: null
}
```

{% /codetabs %}

### Bytecode

The `bytecode: boolean` option can be used to generate bytecode for any JavaScript/TypeScript entrypoints. This can greatly improve startup times for large applications. Only supported for `"cjs"` format, only supports `"target": "bun"` and dependent on a matching version of Bun. This adds a corresponding `.jsc` file for each entrypoint.

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ["./index.tsx"],
  outdir: "./out",
  bytecode: true,
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --bytecode
```

{% /codetabs %}

### Executables

Bun supports "compiling" a JavaScript/TypeScript entrypoint into a standalone executable. This executable contains a copy of the Bun binary.

```sh
$ bun build ./cli.tsx --outfile mycli --compile
$ ./mycli
```

Refer to [Bundler > Executables](https://bun.sh/docs/bundler/executables) for complete documentation.

## Logs and errors

<!-- 1.2 documentation -->

On failure, `Bun.build` returns a rejected promise with an `AggregateError`. This can be logged to the console for pretty printing of the error list, or programmatically read with a `try`/`catch` block.

```ts
try {
  const result = await Bun.build({
    entrypoints: ["./index.tsx"],
    outdir: "./out",
  });
} catch (e) {
  // TypeScript does not allow annotations on the catch clause
  const error = e as AggregateError;
  console.error("Build Failed");

  // Example: Using the built-in formatter
  console.error(error);

  // Example: Serializing the failure as a JSON string.
  console.error(JSON.stringify(error, null, 2));
}
```

{% callout %}

Most of the time, an explicit `try`/`catch` is not needed, as Bun will neatly print uncaught exceptions. It is enough to just use a top-level `await` on the `Bun.build` call.

{% /callout %}

Each item in `error.errors` is an instance of `BuildMessage` or `ResolveMessage` (subclasses of Error), containing detailed information for each error.

```ts
class BuildMessage {
  name: string;
  position?: Position;
  message: string;
  level: "error" | "warning" | "info" | "debug" | "verbose";
}

class ResolveMessage extends BuildMessage {
  code: string;
  referrer: string;
  specifier: string;
  importKind: ImportKind;
}
```

On build success, the returned object contains a `logs` property, which contains bundler warnings and info messages.

```ts
const result = await Bun.build({
  entrypoints: ["./index.tsx"],
  outdir: "./out",
});

if (result.logs.length > 0) {
  console.warn("Build succeeded with warnings:");
  for (const message of result.logs) {
    // Bun will pretty print the message object
    console.warn(message);
  }
}
```

## Reference

```ts
interface Bun {
  build(options: BuildOptions): Promise<BuildOutput>;
}

interface BuildConfig {
  entrypoints: string[]; // list of file path
  outdir?: string; // output directory
  target?: Target; // default: "browser"
  /**
   * Output module format. Top-level await is only supported for `"esm"`.
   *
   * Can be:
   * - `"esm"`
   * - `"cjs"` (**experimental**)
   * - `"iife"` (**experimental**)
   *
   * @default "esm"
   */
  format?: "esm" | "cjs" | "iife";
  naming?:
    | string
    | {
        chunk?: string;
        entry?: string;
        asset?: string;
      };
  root?: string; // project root
  splitting?: boolean; // default true, enable code splitting
  plugins?: BunPlugin[];
  external?: string[];
  packages?: "bundle" | "external";
  publicPath?: string;
  define?: Record<string, string>;
  loader?: { [k in string]: Loader };
  sourcemap?: "none" | "linked" | "inline" | "external" | "linked" | boolean; // default: "none", true -> "inline"
  /**
   * package.json `exports` conditions used when resolving imports
   *
   * Equivalent to `--conditions` in `bun build` or `bun run`.
   *
   * https://nodejs.org/api/packages.html#exports
   */
  conditions?: Array<string> | string;

  /**
   * Controls how environment variables are handled during bundling.
   *
   * Can be one of:
   * - `"inline"`: Injects environment variables into the bundled output by converting `process.env.FOO`
   *   references to string literals containing the actual environment variable values
   * - `"disable"`: Disables environment variable injection entirely
   * - A string ending in `*`: Inlines environment variables that match the given prefix.
   *   For example, `"MY_PUBLIC_*"` will only include env vars starting with "MY_PUBLIC_"
   */
  env?: "inline" | "disable" | `${string}*`;
  minify?:
    | boolean
    | {
        whitespace?: boolean;
        syntax?: boolean;
        identifiers?: boolean;
      };
  /**
   * Ignore dead code elimination/tree-shaking annotations such as @__PURE__ and package.json
   * "sideEffects" fields. This should only be used as a temporary workaround for incorrect
   * annotations in libraries.
   */
  ignoreDCEAnnotations?: boolean;
  /**
   * Force emitting @__PURE__ annotations even if minify.whitespace is true.
   */
  emitDCEAnnotations?: boolean;

  /**
   * Generate bytecode for the output. This can dramatically improve cold
   * start times, but will make the final output larger and slightly increase
   * memory usage.
   *
   * Bytecode is currently only supported for CommonJS (`format: "cjs"`).
   *
   * Must be `target: "bun"`
   * @default false
   */
  bytecode?: boolean;
  /**
   * Add a banner to the bundled code such as "use client";
   */
  banner?: string;
  /**
   * Add a footer to the bundled code such as a comment block like
   *
   * `// made with bun!`
   */
  footer?: string;

  /**
   * Drop function calls to matching property accesses.
   */
  drop?: string[];

  /**
   * When set to `true`, the returned promise rejects with an AggregateError when a build failure happens.
   * When set to `false`, the `success` property of the returned object will be `false` when a build failure happens.
   *
   * This defaults to `false` in Bun 1.1 and will change to `true` in Bun 1.2
   * as most usage of `Bun.build` forgets to check for errors.
   */
  throw?: boolean;
}

interface BuildOutput {
  outputs: BuildArtifact[];
  success: boolean;
  logs: Array<BuildMessage | ResolveMessage>;
}

interface BuildArtifact extends Blob {
  path: string;
  loader: Loader;
  hash: string | null;
  kind: "entry-point" | "chunk" | "asset" | "sourcemap" | "bytecode";
  sourcemap: BuildArtifact | null;
}

type Loader =
  | "js"
  | "jsx"
  | "ts"
  | "tsx"
  | "json"
  | "toml"
  | "file"
  | "napi"
  | "wasm"
  | "text";

interface BuildOutput {
  outputs: BuildArtifact[];
  success: boolean;
  logs: Array<BuildMessage | ResolveMessage>;
}

declare class ResolveMessage {
  readonly name: "ResolveMessage";
  readonly position: Position | null;
  readonly code: string;
  readonly message: string;
  readonly referrer: string;
  readonly specifier: string;
  readonly importKind:
    | "entry_point"
    | "stmt"
    | "require"
    | "import"
    | "dynamic"
    | "require_resolve"
    | "at"
    | "at_conditional"
    | "url"
    | "internal";
  readonly level: "error" | "warning" | "info" | "debug" | "verbose";

  toString(): string;
}
```

{% bunCLIUsage command="build" /%}