{% callout %}
**Note** — Available in the Bun v0.6.0 nightly. Run `bun upgrade --canary` to try it out.
{% /callout %}

Bun's fast native bundler is now in beta. It can be used via the `bun build` CLI command or the `Bun.build()` JavaScript API.

{% codetabs %}

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

## Why bundle?

The bundler is a key piece of infrastructure in the JavaScript ecosystem. As a brief overview of why bundling is so important:

- **Reducing HTTP requests.** A single package in `node_modules` may consist of hundreds of files, and large applications may have dozens of such dependencies. Loading each of these files with a separate HTTP request becomes untenable very quickly, so bundlers are used to convert our application source code into a smaller number of self-contained "bundles" that can be loaded with a single request.
- **Code transforms.** Modern apps are commonly built with languages or tools like TypeScript, JSX, and CSS modules, all of which must be converted into plain JavaScript and CSS before they can be consumed by a browser. The bundler is the natural place to configure these transformations.
- **Framework features.** Frameworks rely on bundler plugins & code transformations to implement common patterns like file-system routing, client-server code co-location (think `getServerSideProps` or Remix loaders), and server components.

Let's jump into the bundler API.

## Basic example

Let's build our first bundle. You have the following two files, which implement a simple client-side rendered React app.

{% codetabs %}

```tsx#./index.tsx
import * as ReactDOM from 'react-dom/client';
import {Component} from "./Component"

const root = ReactDOM.createRoot(document.getElementById('root'));
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

{% codetabs %}

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

The contents of the `out/index.js` file looks something like this:

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

## Content types

Like the Bun runtime, the bundler supports an array of file types out of the box. The following table breaks down the bundler's set of standard "loaders". Refer to [Bundler > File types](/docs/runtime/loaders) for full documentation.

{% table %}

- Extensions
- Details

---

- `.js` `.cjs` `.mjs` `.mts` `.cts` `.ts` `.tsx`
- Uses Bun's built-in transpiler to parse the file and transpile TypeScript/JSX syntax to vanilla JavaScript. The bundler executes a set of default transforms, including dead code elimination, tree shaking, and environment variable inlining. At the moment Bun does not attempt to down-convert syntax; if you use recently ECMAScript syntax, that will be reflected in the bundled code.

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

{% /table %}

### Assets

If the bundler encounters an import with an unrecognized extension, it treats the imported file as an _external file_. The referenced file is copied as-is into `outdir`, and the import is resolved as a _path_ to the file.

{% codetabs %}

```ts#Build file
await Bun.build({
  entrypoints: ['./index.ts'],
  outdir: './out'
})
```

```ts#Input
import logo from "./logo.svg";
console.log(logo);
```

```ts#Output
var logo = "./logo-ab237dfe.svg";
console.log(logo);
```

{% /codetabs %}

{% callout %}
The exact behavior of the file loader is also impacted by [`naming`](#naming) and [`publicPath`](#publicpath).
{% /callout %}

Refer to the [Bundler > Loaders](/docs/bundler/loaders#file) page for more complete documentation on the file loader.

### Plugins

The behavior described in this table can be overridden with [plugins](/docs/bundler/plugins). Refer to the [Bundler > Loaders](/docs/bundler/plugins) page for complete documentation.

## API

### `entrypoints`

**Required.** An array of paths corresponding to the entrypoints of our application. One bundle will be generated for each entrypoint.

{% codetabs %}

```ts#JavaScript
const result = await Bun.build({
  entrypoints: ['./index.ts']
}); // => Promise

await result;
// => { outputs: Array<{ path: string; result: Blob }> }
```

```bash#CLI
$ bun build --entrypoints ./index.ts
# the bundle will be printed to stdout
# <bundled code>
```

{% /codetabs %}

### `outdir`

The directory where output files will be written.

{% codetabs %}

```ts#JavaScript
const result = await Bun.build({
  entrypoints: ['./index.ts'],
  outdir: './out'
});

result;
// => { outputs: Array<{ path: string; result: BunFile }> }
```

```bash#CLI
$ bun build --entrypoints ./index.ts --outdir ./out
# the bundle will be printed to stdout
# ...
```

{% /codetabs %}

When `outdir` is specified:

- The JavaScript API will write the generated bundles to the appropriate location in `outdir`. The result of the `Bun.build()` call will contain `BunFile` instances corresponding to the new files.

  ```ts
  const result = await Bun.build({
    /* ... */
  });
  // => { outputs: Array<{ path: string; result: BunFile }> }

  for (const { path, result } of result.outputs) {
    console.log(`Wrote file: ${path}`);
  }
  ```

- The CLI will print a summary of the written files. The bundled code will not be written to `stdout`.

### `target`

The intended execution environment for the bundle.

{% codetabs %}

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
- _Default._ For generating bundles that are intended for execution by a browser. Prioritizes the `"browser"` export condition when resolving imports. An error will be thrown if any Node.js or Bun built-ins are imported or used, e.g. `node:fs` or `Bun.serve`.

---

- `bun`
- For generating bundles that are intended to be run by the Bun runtime. In many cases, it isn't necessary to bundle server-side code; you can directly execute the source code without modification. However, bundling your server code can reduce startup times and improve running performance.

  All bundles generated with `target: "bun"` are marked with a special `// @bun` pragma, which indicates to the Bun runtime that there's no need to re-transpile the file before execution.

---

- `node`
- For generating bundles that are intended to be run by Node.js. Prioritizes the `"node"` export condition when resolving imports. In the future, this will automatically polyfill the `Bun` global and other built-in `bun:*` modules, though this is not yet implemented.

{% /table %}

<!-- ### `module`

Specifies the module format to be used in the generated bundles.

Currently the bundler only supports one module format: `"esm"`. Support for `"cjs"` and `"iife"` are planned.

{% codetabs %}

```ts#Bun.build
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  format: "esm",
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --format esm
```

{% /codetabs %} -->

<!-- ### `bundling`

Whether to enable bundling.

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  bundling: true, // default
})
```

```bash#CLI
# bundling is enabled by default
$ bun build ./index.tsx --outdir ./out
```

{% /codetabs %}

Set to `false` to disable bundling. Instead, files will be transpiled and individually written to `outdir`.

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  bundling: false,
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --no-bundling
```

{% /codetabs %} -->

### `splitting`

Whether to enable code splitting.

{% codetabs %}

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

{% codetabs %}

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

{% codetabs %}

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

Bun implements a univeral plugin system for both Bun's runtime and bundler. Refer to the [plugin documentation](/docs/bundler/plugins) for complete documentation.

### `manifest`

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
  | "entry-point"
  | "import-statement"
  | "require-call"
  | "dynamic-import"
  | "require-resolve"
  | "import-rule"
  | "url-token";
```

{% /details %}

By design, the manifest is a simple JSON object that can easily be serialized or written to disk. It is also compatible with esbuild's [`metafile`](https://esbuild.github.io/api/#metafile) format.

### `sourcemap`

Specifies the type of sourcemap to generate.

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  sourcemap: "inline", // default "none"
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --sourcemap=inline
```

{% /codetabs %}

{% table %}

---

- `"none"`
- _Default._ No sourcemap is generated.

---

- `"inline"`
- A sourcemap is generated and appended to the end of the generated bundle as a base64 payload inside a `//# sourceMappingURL=` comment.

---

- `"external"`
- A separate `*.js.map` file is created alongside each `*.js` bundle.

{% /table %}

### `minify`

Whether to enable minification. Default `false`.

{% callout %}
When targeting `bun`, identifiers will be minified by default.
{% /callout %}

To enable all minification options:

{% codetabs %}

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

{% codetabs %}

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

{% codetabs %}

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

{% codetabs %}

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

### `naming`

Customizes the generated file names. Defaults to `./[dir]/[name].[ext]`.

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  naming: "./[dir]/[name].[ext]", // default
})
```

```bash#CLI
n/a
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
- `[dir]` - The relative path from the build root to the parent directory of the file.

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

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  naming: 'files/[dir]/[name]-[hash].[ext]',
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --naming [name]-[hash].[ext]
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

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  naming: {
    // default values
    entrypoint: '[dir]/[name].[ext]',
    chunk: '[name]-[hash].[ext]',
    asset: '[name]-[hash].[ext]',
  },
})
```

```bash#CLI
n/a
```

{% /codetabs %}

<!-- ### `root`

The root directory of the project.

{% codetabs %}

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

{% codetabs %}

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

{% codetabs %}

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
``` -->

### `publicPath`

A prefix to be appended to any import paths in bundled code.

<!-- $ bun build ./index.tsx --outdir ./out --publicPath https://cdn.example.com -->

In many cases, generated bundles will contain no `import` statements. After all, the goal of bundling is to combine all of the code into a single file. However there are a number of cases with the generated bundles will contain `import` statements.

- **Asset imports** — When importing an unrecognized file type like `*.svg`, the bundler defers to the [`file` loader](/docs/bundler/loaders#file), which copies the file into `outdir` as is. The import is converted into a variable
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

{% codetabs %}

```ts#JavaScript
await Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  publicPath: 'https://cdn.example.com/', // default is undefined
})
```

```bash#CLI
n/a
```

{% /codetabs %}

The output file would now look something like this.

```ts-diff#Output
- var logo = './logo-a7305bdef.svg';
+ var logo = 'https://cdn.example.com/logo-a7305bdef.svg';
```

## Reference

```ts
await Bun.build({
  entrypoints: string[]; // list of file path
  outdir?: string; // default to in-memory build
  target?: "browser" | "bun" | "node"; // default: "browser"
  splitting?: boolean; // default true
  plugins?: BunPlugin[];
  manifest?: boolean; // default false
  external?: string[];
  naming?: string | {
    entrypoint?: string; // default '[dir]/[name].[ext]'
    chunk?: string; // default '[name]-[hash].[ext]'
    asset?: string; // default '[name]-[hash].[ext]'
  };
  publicPath?: string; // e.g. http://mydomain.com/
  minify?: boolean | { // default false
    identifiers?: boolean;
    whitespace?: boolean;
    syntax?: boolean;
  };
});
```

<!--
root?: string; // project root
format?: "esm"; // later: "cjs", "iife"
loader?: { [k in string]: Loader };
sourcemap?: "none" | "inline" | "external"; // default: "none"
treeshaking?: boolean;
-->
