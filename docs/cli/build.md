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

## Usage

Let's build our first bundle. You have the following two files, which implement a simple client-side rendered React app.

{% codetabs %}

```tsx#./index.tsx
import {createRoot} from 'react-dom/client';
import {Component} from "./Component"

const rootNode = document.getElementById('root');
const root = ReactDOM.createRoot(rootNode);
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
  target: 'browser',
  outdir: './out',
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --platform browser
```

{% /codetabs %}

Let's break that down.

- `entrypoints: string[]`: An array of paths corresponding to the entrypoints of our application. In this case, we just have one.
- `outdir: string`: The directory where output files will be written.
- `target: "browser" | "bun" | "node"`: The platform our bundle is _targeting_. In this case, our bundle will be executed on the browser, so we set `target: "browser"`.

Our bundle will be generated into `./out/index.js`. The generated bundle that corresponds to `index.tsx` is named `index.js`, as it only contains vanilla JavaScript. To customize this file name:

{% codetabs %}

```ts#JS_API
Bun.build({
  entrypoints: ['./index.tsx'],
  target: 'browser',
  outdir: './out',
  naming: "[name]-[hash].[ext]"
})
```

```bash#CLI
$ bun build ./index.tsx --outdir ./out --platform browser --naming
```

{% /codetabs %}

generates a new bundle for each entrypoint.

## Targets

`browser`

Until this point, Bun has primarily been a server-first runtime. With an integrated bundler, Bun is going fullstack. The `Bun.build` API can be used in conjunction with the rest of Bun's fast native APIs to integrate bundling & routing & HTTP in a single file.

Oh, and it's fast.

{% image src="/images/bundler-speed.png" caption="Placeholder" /%}

We've created a set of sample projects demonstrating how to use the bundler to build fullstack React apps. Use `bun create` to jump into some code.

```bash
# a React single-page app
$ bun create react ./myapp

# a Next.js-like app with a /pages directory
# with SSR and client-side hydration
$ bun create react-ssr ./myapp

# an app that uses React server components!
# this should be considered experimental
$ bun create react-rsc ./myapp
```

## Yes, another bundler

The first incarnation of Bun was a dev server, not a runtime. Most of that functionality is still available under the `bun dev` command. A dev server is kind of like an on-demand, opinionated bundler. As requests come in, the server maps the URL to a source file on disk, bundles/transforms the file, and serves the resulting asset. Bundling has always been in Bun's DNA.

With the new bundler, we're taking the next step. Bundling is now a first-class element of the Bun ecosystem, complete with a top-level `Bun.build` function and a stable plugin system.

There are a few reasons we decided Bun needed its own bundler.

### Cohesiveness

Bundling is too important to be "outsourced". It's a fundamental aspect of modern development in the age of JSX, TypeScript, CSS modules, and server components—all things that require bundler integration to work.

Bun aims integrate the various layers of JavaScript tooling into something that feels fast and cohesive. Bundling is a non-negotiable part of that.

### Performance

This one won't surprise anybody. As a runtime, Bun's codebase already contains the groundwork (implemented in Zig) for quickly parsing and transforming source code. While possible, it would have been hard to integrate with an existing native bundler, and the overhead involved in interprocess communication would hurt performance.

Ultimately the results speak for themselves. In our benchmarks, Bun is X% faster then esbuild, X times faster than Rollup, and X times faster than Webpack.

<!-- Rust-based bundlers meet Bun's high standards of performance; the ones that get closest aren't written in Zig. It would be difficult and inefficient to integrate a third-party bundler written in another language into Bun's toolchain, and the overhead involved in inter-process communication would hurt performance. -->

### Developer experience

<!-- Bundling is a foundational part of modern JavaScript development.  -->

Looking at the APIs of existing bundlers, we saw a lot of room for improvement. No one likes wrestling with bundler configurations. Bun's bundler API is designed to be unambiguous and unsurprising. Speaking of which...

## The API

The API is currently minimal by design. Our goal with this initial release is to implement a minimal feature set that fast, stable, and accommodates most modern use cases without sacrificing performance.

Here is the API as it currently exists:

```ts
Bun.build({
  entrypoints: string[]; // list of file path
  target?: "browser" | "bun" | "node"; // default: "browser"
  format?: "esm"; // later: "cjs", "iife"
  outdir?: string; // output directory
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
  format?: "esm"; // later: "cjs", "iife"
  minify?: boolean;
  treeShaking?: boolean;
});
```

Other bundlers have made poor architectural decisions in the pursuit of feature-completeness that end up crippling performance; this is a mistake we are carefully trying to avoid.

### Module systems

Only `target: "esm"` is supported for now. We plan to add support for other module systems and targets like `cjs` and `iife`, but (as in the runtime) Bun is designed to be ESM-first.

### Targets

Three "targets" are supported: `browser` (the default), `bun`, and `node`.

#### `target: "browser"`

- TypeScript and JSX are automatically transpiled to vanilla JavaScript. All source code is downleveled to ES6 syntax.
- Modules are resolved using the `"browser"` condition when availabile
- Usage of the Bun global and imports from `node:*`/`bun:*` are prohibited. In some select cases (e.g. `node:crypto`), Bun will automatically polyfill the missing APIs.

#### `target: "bun"`

- Bun and Node.js APIs are supported and left untouched.
- Modules are resolved using the default resolution algorithm used by Bun's runtime.
- The generated bundles are marked with a special `// @bun` pragma comment to indicate that they were generated by Bun. This indicates to Bun's runtime that the file does not need to be re-transpiled before execution. Synergy!

#### `target: "node"`

???

### File types

The bundler supports the following file types:

- `.js` `.jsx` `.ts` `.tsx` - JavaScript and TypeScript files. Duh.
- `.txt` — Plain text files. These are inlined as strings.
- ` .json` `.toml` — These are parsed at compile time and inlined as JSON.
- `.css` — When a `.css` import is encountered, Bun reads the `.css` file and resolves any `@import` statements within them. The "bundled" CSS file is written to the build directory. All traces of the import are removed from the JavaScript bundle.
- _Unknown file types_ — These are copied into the `outdir` as-is, and the import is replaced with an asolute URL to the file, e.g. `/images/logo.png`. Specify `assetOrigin` to convert this to a fully-qualified URL like `https://mydomain.com/images/logo.png`.

As with the runtime itself, the bundler is designed to be extensible via plugins. In fact, there's no different at all between a runtime plugin and a bundler plugin.

```ts
import YamlPlugin from "bun-plugin-yaml";

const plugin = YamlPlugin();

// register a runtime plugin
Bun.plugin(plugin);

// register a bundler plugin
Bun.build({
  entrypoints: ["./src/index.tsx"],
  plugins: [plugin],
});
```

## Usage

With the `Bun.build` API living right alongside `Bun.serve` and the rest of Bun's runtime APIs, you can express complex build steps and workflows in a remarkably readable way.

Want to bundle some React components and spin up a static file server to serve them? No problem.

```ts
const BUILD_DIR = import.meta.dir + "/build";

const router = new Bun.FileSystemRouter({
  dir: "./components",
});

const files = Object.values(router.routes);

const { manifest } = await Bun.build({
  entrypoints: files,
  target: "browser",
  outdir: BUILD_DIR,
});

Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);
    const match = manifest.outputs[url.pathname];
    if (match) return new Response(Bun.file(BUILD_DIR + "/" + url.pathname));
    return new Response("Not found", { status: 404 });
  },
});
```

## Sneak peek: `Bun.App`

The bundler is just laying the groundwork for a more ambitious effort. In the next couple months, we'll be announcing `Bun.App`: a "super-API" that stitches together Bun's native-speed bundler, HTTP server, and file system router into a cohesive whole.

The goal is to make it easy to express any kind of app with Bun with just a few lines of code:

{% codetabs %}

```ts#Static_file_server
new Bun.App({
 bundlers: [
   {
     name: "static-server",
     outdir: "./out",
   },
 ],
 routers: [
   {
     mode: "static",
     dir: "./public",
     build: "static-server",
   },
 ],
});

app.serve();
app.build();
```

```ts#API_server
const app = new Bun.App({
 configs: [
   {
     name: "simple-http",
     target: "bun",
     outdir: "./.build/server",
     // bundler config...
   },
 ],
 routers: [
   {
     mode: "handler",
     handler: "./handler.tsx", // automatically included as entrypoint
     prefix: "/api",
     build: "simple-http",
   },
 ],
});

app.serve();
app.build();
```

```ts#Next.js-style_framework
const projectRoot = process.cwd();

const app = new Bun.App({
 configs: [
   {
     name: "react-ssr",
     target: "bun",
     outdir: "./.build/server",
     // bundler config
   },
   {
     name: "react-client",
     target: "browser",
     outdir: "./.build/client",
     transform: {
       exports: {
         pick: ["default"],
       },
     },
   },
 ],
 routers: [
   {
     mode: "handler",
     handler: "./handler.tsx",
     build: "react-ssr",
     style: "nextjs",
     dir: projectRoot + "/pages",
   },
   {
     mode: "build",
     build: "react-client",
     dir: "./pages",
     // style: "build",
     // dir: projectRoot + "/pages",
     prefix: "_pages",
   },
 ],
});

app.serve();
app.build();
```

{% /codetabs %}

This API is still under [active discussion](https://github.com/oven-sh/bun/pull/2551) and subject to change.
