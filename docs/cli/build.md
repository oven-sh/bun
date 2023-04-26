{% callout %}
**Note** — Added in Bun v0.6.0
{% /callout %}

Bun's fast native bundler is now in beta. It can be used via the `bun build` CLI command or the new `Bun.build()` JavaScript API.

{% codetabs %}

```ts#JavaScript
Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './build',
  minify: true,
});
```

```sh#CLI
$ bun build ./index.tsx --outdir ./build --minify
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

```ts#JS_API
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

## API

To generate a simple bundle:

{% codetabs %}

```ts#JS_API
Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out
```

{% /codetabs %}

### `entrypoints`

`string[]` **Required.** An array of paths corresponding to the entrypoints of our application. One bundle will be generated for each entrypoint.

### `outdir`

`string` **Required.** The directory where output files will be written.

### `target`

`"browser" | "bun" | "node"` Defaults to `"browser"`. Use this to indicate how the generated bundle will be executed. This may affect the bundling process in a few ways:

- Module resolution. For example, when bundling for the browser, Bun will prioritize the `"browser"` export condition when resolving imports. An error will be thrown if any Node.js or Bun built-ins are imported or used, e.g. `node:fs` or `Bun.serve`.

{% table %}

---

- `browser`
- _Default._ Generates a bundle that is intended for execution in a browser environment. Prioritizes the `"browser"` export condition when resolving imports. An error will be thrown if any Node.js or Bun built-ins are imported or used, e.g. `node:fs` or `Bun.serve`.

---

- `bun`
- For generating bundles that are intended to be run by the Bun runtime. In many cases, it isn't necessary to bundle server-side code; you can directly execute the source code without modification. However, bundling your server code can reduce startup times and improve running performance.

  All bundles generated with `target: "bun"` are marked with a special `// @bun` pragma, which indicates to the Bun runtime that there's no need to re-transpile the file before execution. This

---

- `node`
- ???

{% /table %}

### `module`

`string`. Defaults to `"esm"`.

Specifies the module format used in the the generated bundles. Currently the bundler only supports one module format: `"esm"`. Support for `"cjs"` and `"iife"` are planned.

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

### `transform`

`boolean`. Defaults to `false`.

Set to `true` to disable bundling. Instead, files are transpiled and individually written to `outdir`.

{% codetabs %}

```ts#JS_API
Bun.build({
  entrypoints: ['./index.tsx'],
  outdir: './out',
  transform: true,
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out
```

{% /codetabs %}

### `splitting`

boolean, // default true, enable code splitting

### `plugins`

BunPlugin[];

### `naming`

`string | { entrypoint?: string; chunk?: string; }`. Customizes the generated file names. // default '[name].[ext]'

### `root`

string; // project root

### `manifest`

boolean; // whether to return manifest

### `external`

Array<string>;

### `origin`

string; // e.g. https://mydomain.com

### `assetOrigin`

string; // e.g. https://assets.mydomain.com

  <!-- ### `loader` 
  
  `{ [k in string]: Loader }` -->

### `sourcemap`

"none" | "inline" | "external"; // default: "none"

### `minify`

boolean;

### `treeshaking`

boolean;

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
  assetOrigin?: string; // e.g. http://assets.mydomain.com
  loader?: { [k in string]: Loader };
  sourcemap?: "none" | "inline" | "external"; // default: "none"
  minify?: boolean;
  treeShaking?: boolean;
});
```
