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

As with the Bun runtime, Bun's bundler can handle TypeScript and JSX out of the box, with no configuration required. The resulting bundle contains vanilla JavaScript only.

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

### `manifest`

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

  // less important than `inputs`
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

### `sourcemap`

"none" | "inline" | "external"; // default: "none"

### `minify`

boolean;

### `treeshaking`

boolean;

### `external`

Array<string>;

### `origin`

string; // e.g. https://mydomain.com

  <!-- ### `loader` 
  
  `{ [k in string]: Loader }` -->

### `naming`

`string | { entrypoint?: string; chunk?: string; }`. Customizes the generated file names. // default '[name].[ext]'

### `root`

string; // project root

## Reference

```ts
Bun.build({
  entrypoints: string[]; // list of file path
  outdir?: string; // output directory
  target?: "browser" | "bun" | "node"; // default: "browser"
  module?: "esm"; // later: "cjs", "iife"
  naming?: string, // default '[name].[ext]'
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
