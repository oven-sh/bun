{% callout %}
**Note** — Added in Bun v0.6.0
{% /callout %}

Bun's fast native bundler is now in beta. It can be used via the `bun build` CLI command or the new `Bun.build()` JavaScript API.

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

Bundling is a key piece of infrastructure in the JavaScript ecosystem. As a brief overview of why bundling is so important:

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
Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out
```

{% /codetabs %}

Let's break that down.

- `entrypoints` — **Required.** An array of paths corresponding to the entrypoints of our application. In this case, we just have one.
- `outdir` — **Required.** The directory where output files will be written.

Running this build will generate a new file `./out/index.js`.

```ts
.
├── index.tsx
├── Component.tsx
└── out
    └── index.js
```

It looks something like this:

```js#out/index.js
// ...
// ~20k lines of code
// including the contents of `react-dom/client` and all its dependencies
// this is where the $jsx and $createRoot functions are defined


// Component.tsx
function Component(props) {
  return $jsx("p", {
    children: props.message
  }, undefined, false, undefined, this);
}

// index.tsx
var rootNode = document.getElementById("root");
var root = $createRoot(rootNode);
root.render($jsx(Component, {
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
</div>
```

Then spin up a static file server serving the `out` directory:

```bash
$ bunx serve out
```

Visit `http://localhost:5000` to see your bundled app in action.

{% /details %}

## Content types

The bundler supports the same set of file types as the runtime. Refer to [Bundler > File types](/docs/runtime/loaders) for full documentation. The following table breaks down the bundler's set of standard "loaders". These are the file types that Bun can handle out of the box, with no configuration required.

{% table %}

- Loader
- Input extensions
- Output extension
- Description

---

- `js`
- `*.{cjs|mjs}`
- `.js`
- **JavaScript.** Parses the code and applies a set if default transforms, like dead-code elimination, tree shaking, and environment variable inlining. Note that Bun does not attempt to down-convert syntax at the moment. & transpiled to Contents are parsed and converted to ECMAScript 2020 syhtax. TypeScript files are transpiled to vanilla JavaScript.

---

- `jsx`
- `*.{js|jsx}`
- `*.js`
- **JavaScript + JSX.** Same as the `js` loader, but JSX syntax is supported. By default, JSX is downconverted to `createElement` syntax and a `jsx` factory is injected into the bundle. This can be configured using the relevant `jsx*` compiler options in `tsconfig.json`. to vanilla `createElement` calls. The

### JavaScript (`js`)

All `*.{js|cjs|mjs}` files are transpiled using Bun's `js` loader.

### TypeScript (`ts`)

All `*.ts` files are transpiled with Bun's `ts` loader. All TypeScript syntax is stripped out, leaving vanilla JavaScript. No typechecking is performed.

### JSX (`jsx`)

All `*.jsx`
All `*.{js|ts}` files will be transpiled to vanilla JavaScript. Features roughly targeting ECMAScript features
As with the Bun runtime, Bun's bundler handles common file types out of the box, with no configuration required. The following loaders are implemented:

## API

## `entrypoints`

**Required.** Accepts `string[]`.

An array of paths corresponding to the entrypoints of our application. One bundle will be generated for each entrypoint.

## `outdir`

**Required.** Accepts `string`. The directory where output files will be written.

## `target`

Accepts `"browser" | "bun" | "node"`. Defaults to `"browser"`.

Use this to indicate how the generated bundle will be executed. Depending on the target, Bun will apply different optimizations and transformations.

<!-- - Module resolution. For example, when bundling for the browser, Bun will prioritize the `"browser"` export condition when resolving imports. An error will be thrown if any Node.js or Bun built-ins are imported or used, e.g. `node:fs` or `Bun.serve`. -->

{% table %}

---

- `browser`
- _Default._ For generating bundles that are intended for execution by a browser. Prioritizes the `"browser"` export condition when resolving imports. An error will be thrown if any Node.js or Bun built-ins are imported or used, e.g. `node:fs` or `Bun.serve`.

---

- `bun`
- For generating bundles that are intended to be run by the Bun runtime. In many cases, it isn't necessary to bundle server-side code; you can directly execute the source code without modification. However, bundling your server code can reduce startup times and improve running performance.

  All bundles generated with `target: "bun"` are marked with a special `// @bun` pragma, which indicates to the Bun runtime that there's no need to re-transpile the file before execution. This

---

- `node`
- For generating bundles that are intended to be run by Node.js. Prioritizes the `"node"` export condition when resolving imports. In the future, this will automatically polyfill the `Bun` global and other built-in `bun:*` modules, though this is not yet implemented.

{% /table %}

## `module`

Accepts `"esm"`. Defaults to `"esm"`.

Specifies the module format used in the the generated bundles. Currently the bundler only supports one module format: `"esm"`. Support for `"cjs"` and `"iife"` are planned.

{% codetabs %}

```ts#Bun.build
Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  module: "esm",
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --module esm
```

{% /codetabs %}

## `bundling`

Accepts `boolean`. Defaults to `true`.

Set to `false` to disable bundling. Instead, files will be transpiled and individually written to `outdir`.

{% codetabs %}

```ts#JavaScript
Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  bundling: false,
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --no-bundling
```

{% /codetabs %}

## `splitting`

Accepts `boolean`. Defaults to `false`. Whether to enable code splitting.

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
Bun.build({
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

## `plugins`

Accepts `BunPlugin[]`. A list of plugins to use during bundling.

Bun implements a univeral plugin system for both Bun's runtime and bundler. Refer to the [plugin documentation](/docs/bundler/plugins) for complete documentation.

## `manifest`

Accepts `boolean`. Defaults to `true`. Whether to return a build manifest in the result of `Bun.build`.

```ts
const result = await Bun.build({
  entrypoints: ["./index.tsx"],
  outdir: "./out",
  manifest: true,
});

console.log(result.manifest);
```

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

## `sourcemap`

Specifies the type of sourcemap to generate.

```ts
sourcemap?: "none" | "inline" | "external";
```

{% table %}

---

- `"none"`
- _Default._ No sourcemap is generated.

---

- `"inline"`
- A sourcemap is generated and appended to the end of the generated bundle as a base64 payload inside a `//# sourceMappingURL= ` comment.

---

- `"external"`
- A separate `*.js.map` file is created alongside each `*.js` bundle.

{% /table %}

## `minify`

```ts
minify?: boolean | {
  whitespace?: boolean;
  identifiers?: boolean;
  syntax?: boolean
}
```

Defaults to `false`. Whether to minify the generated bundles.

{% codetabs %}

```ts#JavaScript
Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  minify: true,
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --minify
```

{% /codetabs %}

This will enable all minification options. To granularly enable certain minifications:

{% codetabs %}

```ts#JavaScript
Bun.build({
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

<!-- ## `treeshaking`

boolean; -->

## `external`

Accepts `Array<string>`. Defaults to `[]`. A list of import paths to consider _external_. An external import is one that will not be included in the final bundle. Instead, the `import` statement will be left as-is, to be resolved at runtime.

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
Bun.build({
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

## `naming`

Customizes the generated file names. Defaults to `[dir]/[name].[ext]`.

```ts
naming?: string | {
  entrypoint?: string;
  chunk?: string;
  asset?: string;
}
```

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

The names of these files can be customized with the `naming` field. This field accepts a template string that is used to generate the filenames for all bundles corresponding to entrypoints. where the following tokens are replaced with their corresponding values:

- `[name]` - The name of the entrypoint file, without the extension, e.g. `index`
- `[ext]` - The extension of the generated bundle, e.g. `js`
- `[hash]` - A hash of the bundle contents, e.g. `a1b2c3d4`
- `[dir]` - The relative path from the build [`root`](#root) to the parent directory of the file, e.g. `nested`

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
Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  naming: '[dir]/[name]-[hash].[ext]',
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
    └── index-a1b2c3d4.js
```

{% callout %}

When a `string` is provided for the `naming` field, it is used only for bundles _that correspond to entrypoints_. The names of [chunks](#splitting) and copied assets are not affected. Using the JavaScript API, separate template strings can be specified for each type of generated file.

{% codetabs %}

```ts#JavaScript
Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  naming: {
    entrypoint: '[dir]/[name]-[hash].[ext]',
    chunk: '[dir]/[name]-[hash].[ext]',
    asset: '[dir]/[name]-[hash].[ext]',
  },
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --naming-entrypoint [dir]/[name].[ext] --naming-chunk [dir]/[name]-[hash].[ext] --naming-asset [dir]/[name]-[hash].[ext]
```

{% /codetabs %}

## `root`

Accepts `string`. This is the directory that should be considered the "project root". By default, this is computed to be the first common ancestor of all entrypoint files.

Consider the following file structure:

```txt
.
└── pages
  └── index.tsx
  └── settings.tsx
```

We can build both entrypoints in the `pages` directory:

{% codetabs %}

```ts#JavaScript
Bun.build({
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
Bun.build({
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

## `origin`

Accepts `string`. Used to generate absolute asset URLs.

When the bundler encounters an unknown file type, it defaults to using the `"asset"` loader. This converts the import path to an absolute URL that can be referenced in the file. This is useful for referencing images, fonts, and other static assets.

```tsx#Input
import logo from "./images/logo.svg";

export function Logo(){
  return <img src={logo} />
}
```

In the absence of a plugin that overrides `*.svg` loading, the `logo` import will be converted to an absolute path, as resolved relative to the project root.

```ts
var logo = "/logo.svg";

export function Logo() {
  return React.create;
}
```

This is fine for local development, but in production, we want to serve the assets from a CDN. To do this, we can specify the `origin` option:

{% codetabs %}

```ts#JavaScript
Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  origin: 'https://cdn.mydomain.com',
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --origin https://cdn.mydomain.com
```

{% /codetabs %}

With `origin` set to this value, the value of `logo` will become `https://cdn.mydomain.com/logo.svg`.

## Reference

```ts
Bun.build({
  entrypoints: string[]; // list of file path
  outdir?: string; // output directory
  target?: "browser" | "bun" | "node"; // default: "browser"
  module?: "esm"; // later: "cjs", "iife"
  naming?: string, // default '[dir]/[name].[ext]'
  root?: string; // project root
  transform?: boolean, // default: false, transform instead of bundling
  splitting?: boolean, // default true, enable code splitting
  plugins?: BunPlugin[];
  manifest?: boolean; // whether to return manifest
  external?: Array<string | RegExp>;
  origin?: string; // e.g. http://mydomain.com
  loader?: { [k in string]: Loader };
  sourcemap?: "none" | "inline" | "external"; // default: "none"
  minify?: boolean;
  treeshaking?: boolean;
});
```
