# Bun

Bun is a new:

- JavaScript/TypeScript/JSX transpiler
- JavaScript & CSS bundler
- Development server with 60fps Hot Module Reloading (& WIP support for React Fast Refresh)
- JavaScript Runtime Environment (powered by JavaScriptCore, what WebKit/Safari uses)

All in one fast &amp; easy-to-use tool. Instead of 1,000 node_modules for development, you only need Bun.

**Bun is experimental software**. Join [Bun's Discord](https://bun.sh/discord) for help and have a look at [things that don't work yet](#things-that-dont-work-yet).

## Install:

```
# Global install is recommended so bun appears in your $PATH
npm install -g bun-cli
```

## Benchmarks

CSS: [Bun is 14x faster](./bench/hot-module-reloading/css-stress-test) than Next.js at hot reloading CSS. TODO: compare Vite
JavaScript: TODO

### Getting started

## Using Bun with Next.js

In your project folder root (where `package.json` is):

```bash
npm install -D bun-framework-next
bun bun --use next
bun
```

Many of Next.js' features are supported, but not all.

Here's what doesn't work yet:

- `getStaticPaths`
- same-origin `fetch` inside of `getStaticProps` or `getServerSideProps`
- locales, zones, `assetPrefix` (workaround: change `--origin \"http://localhsot:3000/assetPrefixInhere\"`)
- `next/image` is polyfilled to a regular `<img src>` tag.
- `proxy` and anything else in `next.config.js`
- API, catch-all &amp; catch-all fallback routes. Dynamic routes _are_ supported.

When using Next.js, Bun automatically reads configuration from `.env.local`, `.env.development` and `.env` (in that order). `process.env.NEXT_PUBLIC_` and `process.env.NEXT_` automatically are replaced via `--define`.

Currently, any time you import new dependencies from `node_modules`, you will need to re-run `bun bun --use next`. This will eventually be automatic.

## Using Bun with single page apps

In your project folder root (where `package.json` is):

```bash
bun bun ./entry-point-1.js ./entry-point-2.jsx
bun
```

By default, `bun` will look for any HTML files in the `public` directory and serve that. For browsers navigating to the page, the `.html` file extension is optional in the URL, and `index.html` will automatically rewrite for the directory.

Here are examples of routing from `public/` and how they're matched:
| Dev Server URL | File Path |
|----------------|-----------|
| /dir | public/dir/index.html |
| / | public/index.html |
| /index | public/index.html |
| /hi | public/hi.html |
| /file | public/file.html |
| /font/Inter.woff2 | public/font/Inter.woff2 |
| /hello | public/index.html |

If `public/index.html` exists, it becomes the default page instead of a 404 page, unless that pathname has a file extension.

#### Using Bun with Create React App

To use Bun with `create-react-app`, there are two changes you will need to make in `public/index.html`:

1. Replace `%PUBLIC_URL%` with `/`
2. Insert `<script type="module" async src="/src/index.js">` just before `</body>`

These changes are (sadly) necessary until Bun supports parsing &amp; transpiling HTML.

In your project folder root (where `package.json` is):

```bash
bun bun ./src/index.js
bun
```

From there, Bun relies on the filesystem for mapping dev server paths to source files. All URL paths are relative to the project root (where `package.json` is located).

Here are examples of routing source code file paths:

| Dev Server URL             | File Path (relative to cwd) |
| -------------------------- | --------------------------- |
| /src/components/Button.tsx | src/components/Button.tsx   |
| /src/index.tsx             | src/index.tsx               |
| /pages/index.js            | pages/index.js              |

You do not need to include file extensions in `import` paths. CommonJS-style import paths without the file extension works.

You can override the public directory by passing `--public-dir="path-to-folder"`.

If no directory is specified and `./public/` doesn't exist, Bun will try `./static/`. If `./static/` does not exist, but won't serve from a public directory. If you pass `--public-dir=./` Bun will serve from the current directory, but it will check the current directory last instead of first.

## Using Bun with TypeScript

TypeScript just works. There's nothing to configure and nothing extra to install. If you import a `.ts` or `.tsx` file, Bun will transpile it into JavaScript. Bun also transpiles `node_modules` containing `.ts` or `.tsx` files. This is powered by Bun's TypeScript transpiler, so it's fast.

Bun also reads `tsconfig.json`, including `baseUrl` and `paths`.

## Using Tailwind with Bun

[Tailwind](https://tailwindcss.com/) is a popular CSS utility framework. Currently, the easiest way to use Tailwind with Bun is through Tailwind's CLI. That means running both `bun` and `tailwind`, and importing the file `tailwind`'s CLI outputs.

Tailwind's docs talk more about [Tailwind's CLI usage](https://tailwindcss.com/docs/installation#watching-for-changes), but the gist is you'll want to run this:

```bash
npx tailwindcss -i ./src/tailwind.css -o ./dist/tailwind.css --watch
```

From there, make sure to import the `dist/tailwind.css` file (or what you chose as the output).

## Things that don't work yet

Bun is a project with incredibly large scope, and it's early days.

| Feature                                                                                                                | In             |
| ---------------------------------------------------------------------------------------------------------------------- | -------------- |
| ~Symlinks~                                                                                                             | Resolver       |
| [Finish Fast Refresh](https://github.com/Jarred-Sumner/bun/issues/18)                                                  | JSX Transpiler |
| Source Maps                                                                                                            | JavaScript     |
| Source Maps                                                                                                            | CSS            |
| [Private Class Fields](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_class_fields) | JS Transpiler  |
| [Import Assertions](https://github.com/tc39/proposal-import-assertions)                                                | JS Transpiler  |
| [`extends`](https://www.typescriptlang.org/tsconfig#extends) in tsconfig.json                                          | TS Transpiler  |
| [jsx](https://www.typescriptlang.org/tsconfig)\* in tsconfig.json                                                      | TS Transpiler  |
| [TypeScript Decorators](https://www.typescriptlang.org/docs/handbook/decorators.html)                                  | TS Transpiler  |
| `@jsxPragma` comments                                                                                                  | JS Transpiler  |
| JSX source file name                                                                                                   | JS Transpiler  |
| Sharing `.bun` files                                                                                                   | Bun            |
| [Finish fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)                                             | Bun.js         |
| [setTimeout](https://developer.mozilla.org/en-US/docs/Web/API/setTimeout)                                              | Bun.js         |
| `bun run` command                                                                                                      | Bun.js         |

<sup>JS Transpiler == JavaScript Transpiler</sup><br/>
<sup>TS Transpiler == TypeScript Transpiler</sup><br/>
<sup>Bun.js == Bun's JavaScriptCore integration that executes JavaScript. Similar to how Node.js & Deno embed V8.</sup><br/>

### Limitations & intended usage

Bun is great for building websites &amp; webapps. For libraries, consider using Rollup or esbuild instead. Bun currently doesn't minify code and Bun's dead code elimination doesn't look beyond the current file.

Today, Bun is focused on:

- Development, not production
- Compatibility with existing frameworks & tooling

Ideally, most projects can use Bun with their existing tooling while making few changes to their codebase. That means using Bun in development, and continuing to use Webpack, esbuild, or another bundler in production. Using two bundlers might sound strange at first, but after all the production-only AST transforms, minification, and special development/production-only imported files...it's not far from the status quo.

Longer-term, Bun intends to replace Node.js, Webpack, Babel, and PostCSS (in production).

# Configuration

### Loaders

A loader determines how to map imports &amp; file extensions to transforms and output.

Currently, Bun implements the following loaders:

| Input | Loader                        | Output |
| ----- | ----------------------------- | ------ |
| .js   | JSX + JavaScript              | .js    |
| .jsx  | JSX + JavaScript              | .js    |
| .ts   | TypeScript + JavaScript       | .js    |
| .tsx  | TypeScript + JSX + JavaScript | .js    |
| .mjs  | JavaScript                    | .js    |
| .css  | CSS                           | .css   |
| .env  | Env                           | N/A    |
| .\*   | file                          | string |

Everything else is treated as `file`. `file` replaces the import with a URL (or a path).

You can configure which loaders map to which extensions by passing `--loaders` to `bun`. For example:

```
bun --loader=.js:js
```

This will disable JSX transforms for `.js` files.

#### CSS in JS

When importing CSS in JavaScript-like loaders, CSS is treated special.

By default, Bun will transform a statement like this:

```js
import "../styles/global.css";
```

##### When `platform` is `browser`:

```js
globalThis.document?.dispatchEvent(
  new CustomEvent("onimportcss", {
    detail: "http://localhost:3000/styles/globals.css",
  })
);
```

An event handler for turning that into a `<link>` is automatically registered when HMR is enabled. That event handler can be turned off either in a framework's `package.json` or by setting `globalThis["Bun_disableCSSImports"] = true;` in client-side code. Additionally, you can get a list of every .css file imported this way via `globalThis["__BUN"].allImportedStyles`.

##### When `platform` is `bun`:

```js
//@import url("http://localhost:3000/styles/globals.css");
```

Additionally, Bun exposes an API for SSR/SSG that returns a flat list of URLs to css files imported. That function is `Bun.getImportedStyles()`.

```ts
addEventListener("fetch", async (event: FetchEvent) => {
  var route = Bun.match(event);
  const App = await import("pages/_app");

  // This returns all .css files that were imported in the line above.
  // It's recursive, so any file that imports a CSS file will be included.
  const appStylesheets = Bun.getImportedStyles();

  // ...rest of code
});
```

This is useful for preventing flash of unstyled content.

### CSS Loader

Bun bundles `.css` files imported via `@import` into a single file. It doesn't autoprefix or minify CSS today. Multiple `.css` files imported in one JavaScript file will _not_ be bundled into one file. You'll have to import those from a `.css` file.

This input:

```css
@import url("./hi.css");
@import url("./hello.css");
@import url("./yo.css");
```

Becomes:

```css
/* hi.css */
/* ...contents of hi.css */
/* hello.css */
/* ...contents of hello.css */
/* yo.css */
/* ...contents of yo.css */
```

#### CSS runtime

To support hot CSS reloading, Bun inserts `@supports` annotations into CSS that tag which files a stylesheet is composed of. Browsers ignore this, so it doesn't impact styles.

By default, Bun's runtime code automatically listens to `onimportcss` and will insert the `event.detail` into a `<link rel="stylesheet" href={${event.detail}}>` if there is no existing `link` tag with that stylesheet. That's how Bun's equivalent of `style-loader` works.

### Frameworks

Frameworks preconfigure Bun to enable developers to use Bun with their existing tooling.

Frameworks are configured via the `framework` object in the `package.json` of the framework (not in the application's `package.json`):

Here is an example:

```json
{
  "name": "bun-framework-next",
  "version": "0.0.0-18",
  "description": "",
  "framework": {
    "displayName": "Next.js",
    "static": "public",
    "assetPrefix": "_next/",
    "router": {
      "dir": ["pages", "src/pages"],
      "extensions": [".js", ".ts", ".tsx", ".jsx"]
    },
    "css": "onimportcss",
    "development": {
      "client": "client.development.tsx",
      "fallback": "fallback.development.tsx",
      "server": "server.development.tsx",
      "css": "onimportcss",
      "define": {
        "client": {
          ".env": "NEXT_PUBLIC_",
          "defaults": {
            "process.env.__NEXT_TRAILING_SLASH": "false",
            "process.env.NODE_ENV": "\"development\"",
            "process.env.__NEXT_ROUTER_BASEPATH": "''",
            "process.env.__NEXT_SCROLL_RESTORATION": "false",
            "process.env.__NEXT_I18N_SUPPORT": "false",
            "process.env.__NEXT_HAS_REWRITES": "false",
            "process.env.__NEXT_ANALYTICS_ID": "null",
            "process.env.__NEXT_OPTIMIZE_CSS": "false",
            "process.env.__NEXT_CROSS_ORIGIN": "''",
            "process.env.__NEXT_STRICT_MODE": "false",
            "process.env.__NEXT_IMAGE_OPTS": "null"
          }
        },
        "server": {
          ".env": "NEXT_",
          "defaults": {
            "process.env.__NEXT_TRAILING_SLASH": "false",
            "process.env.__NEXT_OPTIMIZE_FONTS": "false",
            "process.env.NODE_ENV": "\"development\"",
            "process.env.__NEXT_OPTIMIZE_IMAGES": "false",
            "process.env.__NEXT_OPTIMIZE_CSS": "false",
            "process.env.__NEXT_ROUTER_BASEPATH": "''",
            "process.env.__NEXT_SCROLL_RESTORATION": "false",
            "process.env.__NEXT_I18N_SUPPORT": "false",
            "process.env.__NEXT_HAS_REWRITES": "false",
            "process.env.__NEXT_ANALYTICS_ID": "null",
            "process.env.__NEXT_CROSS_ORIGIN": "''",
            "process.env.__NEXT_STRICT_MODE": "false",
            "process.env.__NEXT_IMAGE_OPTS": "null",
            "global": "globalThis",
            "window": "undefined"
          }
        }
      }
    }
  }
}
```

Here are type definitions:

```ts
type Framework = Environment & {
  // This changes what's printed in the console on load
  displayName?: string;

  // This allows a prefix to be added (and ignored) to requests.
  // Useful for integrating an existing framework that expects internal routes to have a prefix
  // e.g. "_next"
  assetPrefix?: string;

  development?: Environment;
  production?: Environment;

  // The directory used for serving unmodified assets like fonts and images
  // Defaults to "public" if exists, else "static", else disabled.
  static?: string;

  // "onimportcss" disables the automatic "onimportcss" feature
  // If the framework does routing, you may want to handle CSS manually
  // "facade" removes CSS imports from JavaScript files,
  //    and replaces an imported object with a proxy that mimics CSS module support without doing any class renaming.
  css?: "onimportcss" | "facade";

  // Bun's filesystem router
  router?: Router;
};

type Define = {
  // By passing ".env", Bun will automatically load .env.local, .env.development, and .env if exists in the project root
  //    (in addition to the processes' environment variables)
  // When "*", all environment variables will be automatically injected into the JavaScript loader
  // When a string like "NEXT_PUBLIC_", only environment variables starting with that prefix will be injected

  ".env": string | "*";

  // These environment variables will be injected into the JavaScript loader
  // These are the equivalent of Webpack's resolve.alias and esbuild's --define.
  // Values are parsed as JSON, so they must be valid JSON. The only exception is '' is a valid string, to simplify writing stringified JSON in JSON.
  // If not set, `process.env.NODE_ENV` will be transformed into "development".
  defaults: Record<string, string>;
};

type Environment = {
  // This is a wrapper for the client-side entry point for a route.
  // This allows frameworks to run initialization code on pages.
  client: string;
  // This is a wrapper for the server-side entry point for a route.
  // This allows frameworks to run initialization code on pages.
  server: string;
  // This runs when "server" code fails to load due to an exception.
  fallback: string;

  // This is how environment variables and .env is configured.
  define?: Define;
};

// Bun's filesystem router
// Currently, Bun supports pages by either an absolute match or a parameter match.
// pages/index.tsx will be executed on navigation to "/" and "/index"
// pages/posts/[id].tsx will be executed on navigation to "/posts/123"
// Routes & parameters are automatically passed to `fallback` and `server`.
type Router = {
  // This determines the folder to look for pages
  dir: string[];

  // These are the allowed file extensions for pages.
  extensions?: string[];
};
```

To use a framework, you pass `bun bun --use package-name`.

Your framework's package.json `name` should start with `bun-framework-`. This is so that people can type something like `bun bun --use next` and it will check `bun-framework-next` first. This is similar to how Babel plugins tend to start with `babel-plugin-`.

For developing frameworks, you can also do `bun bun --use ./relative-path-to-framework`.

If you're interested in adding a framework integration, please reach out. There's a lot here and it's not entirely documented yet.

# Reference

### `bun bun`

Run `bun bun ./path-to.js` to generate a `node_modules.bun` file containing all imported dependencies (recursively).

**Why bundle?**

- For browsers, loading entire apps without bundling dependencies is typically slow. With a fast bundler & transpiler, the bottleneck eventually becomes the web browser's ability to run many network requests concurrently. There are many workarounds for this. `<link rel="modulepreload">`, HTTP/3, etc but none are more effective than bundling. If you have reproducible evidence to the contrary, feel free to submit an issue. It would be better if bundling wasn't necessary.
- On the server, bundling reduces the number of filesystem lookups to load JavaScript. While filesystem lookups are faster than HTTP requests, there's still overhead.

**What is `.bun`?**

The `.bun` file contains:

- all the bundled source code
- all the bundled source code metadata
- project metadata & configuration

Here are some of the questions `.bun` files answer:

- when I import `react/index.js`, where in the `.bun` is the code for that? (not resolving, just the code)
- what modules of a package are used?
- what framework is used? (e.g. Next.js)
- where is the routes directory?
- how big is each imported dependency?
- what is the hash of the bundle's contents? (for etags)
- what is the name & version of every npm package exported in this bundle?
- what modules from which packages are used in this project? ("project" defined as all the entry points used to generate the .bun)

All in one file.

It's a little like a build cache, but designed for reuse. I hope people will eventually check it into version control so their coworkers don't have to run `npm install` as often.

##### Position-independent code

From a design perspective, the most important part of the `.bun` format is how code is organized. Each module is exported by a hash like this:

```js
// preact/dist/preact.module.js
export var $eb6819b = $$m({
  "preact/dist/preact.module.js": (module, exports) => {
    var n, l, u, i, t, o, r, f, e = {}, c = [], s = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
    // ... rest of code
```

This makes bundled modules [position-independent](https://en.wikipedia.org/wiki/Position-independent_code). In theory, one could import only the exact modules in-use without reparsing code and without generating a new bundle. One bundle can dynamically become many bundles comprising only the modules in use on the webpage. Thanks to the metadata with the byte offsets, a web server can send each module to browsers [zero-copy](https://en.wikipedia.org/wiki/Zero-copy) using [sendfile](https://man7.org/linux/man-pages/man2/sendfile.2.html). Bun itself is not quite this smart yet, but these optimizations would be useful in production and potentially very useful for React Server Components.

To see the schema inside, have a look at [`JavascriptBundleContainer`](./src/api/schema.d.ts#:~:text=export%20interface-,JavascriptBundleContainer,-%7B). You can find JavaScript bindings to read the metadata in [src/api/schema.js](./src/api/schema.js). This is not really an API yet. It's missing the part where it gets the binary data from the bottom of the file. Someday, I want this to be usable by other tools too.

**Where is the code?**

`.bun` files are marked as executable.

To print out the code, run `./node_modules.bun` in your terminal or run `bun ./path-to-node_modules.bun`.

Here is a copy-pastable example:

```bash
./node_modules.bun > node_modules.js
```

This works because every `.bun` file starts with this:

```bash
#!/usr/bin/env bun
```

To deploy to production with Bun, you'll want to get the code from the `.bun` file and stick that somewhere your web server can find it (or if you're using Vercel or a Rails app, in a `public` folder).

Note that `.bun` is a binary file format, so just opening it in VSCode or vim might render strangely.

**Advanced**

By default, `bun bun` only bundles external dependencies that are `import`ed or `require`d in either app code or another external dependency. An "external depenendency" is defined as, "A JavaScript-like file that has `/node_modules/` in the resolved file path and a corresponding `package.json`".

To force bun to bundle packages which are not located in a `node_modules` folder (i.e. the final, resolved path following all symlinks), add a `bun` section to the root project's `package.json` with `alwaysBundle` set to an array of package names to always bundle. Here's an example:

```json
{
  "name": "my-package-name-in-here",
  "bun": {
    "alwaysBundle": ["@mybigcompany/my-workspace-package"]
  }
}
```

Bundled dependencies are not eligible for Hot Module Reloading. The code is served to browsers & Bun.js verbatim. But, in the future, it may be sectioned off into only parts of the bundle being used. That's possible in the current version of the `.bun` file (so long as you know which files are necessary), but it's not implemented yet. Longer-term, it will include all `import` and `export` of each module inside.

**What is the module ID hash?**

The `$eb6819b` hash used here:

```js
export var $eb6819b = $$m({
```

Is generated like this:

1. Murmur3 32 bit hash of `package.name@package.version`. This is the hash uniquely identifying the npm package.
2. Wyhash 64 of the `package.hash` + `package_path`. `package_path` means "relative to the root of the npm package, where is the module imported?". For example, if you imported `react/jsx-dev-runtime.js`, the `package_path` is `jsx-dev-runtime.js`. `react-dom/cjs/react-dom.development.js` would be `cjs/react-dom.development.js`
3. Truncate the hash generated above to a `u32`

The implementation details of this module ID hash will vary between versions of Bun. The important part is the metadata contains the module IDs, the package paths, and the package hashes so it shouldn't really matter in practice if other tooling wants to make use of any of this.

### Environment variables

- `GOMAXPROCS`: For `bun bun`, this sets the maximum number of threads to use. If you're experiencing an issue with `bun bun`, try setting `GOMAXPROCS=1` to force bun to run single-threaded
- `DISABLE_BUN_ANALYTICS=1` this disables Bun's analytics. Bun records bundle timings (so we can answer with data, "is bun getting faster?") and feature usage (e.g. "are people actually using macros?"). The request body size is about 60 bytes, so it's not a lot of data
- `TMPDIR`: Before `bun bun` completes, it stores the new `.bun` in `$TMPDIR`. If unset, `TMPDIR` defaults to the platform-specific temporary directory (on Linux, `/tmp` and on macOS `/private/tmp`)

# Credits

- While written in Zig instead of Go, Bun's JS transpiler, CSS lexer, and node module resolver source code is based off of @evanw's esbuild project. @evanw did a fantastic job with esbuild.

# License

Bun itself is MIT-licensed.

However, JavaScriptCore (and WebKit) is LGPL-2 and Bun statically links it.

Per LGPL2:

> (1) If you statically link against an LGPL'd library, you must also provide your application in an object (not necessarily source) format, so that a user has the opportunity to modify the library and relink the application.

You can find the patched version of WebKit used by Bun here: https://github.com/jarred-sumner/webkit. If you would like to relink Bun with changes:

- `git submodule update --init --recursive`
- `make jsc`
- `zig build`

This compiles JavaScriptCore, compiles Bun's `.cpp` bindings for JavaScriptCore (which are the object files using JavaScriptCore) and outputs a new `bun` binary with your changes.

To successfully run `zig build`, you will need to install a patched version of Zig available here: https://github.com/jarred-sumner/zig/tree/jarred/zig-sloppy.

Bun also statically links these libraries:

- `libicu`, which can be found here: https://github.com/unicode-org/icu/blob/main/icu4c/LICENSE
- [`picohttp`](https://github.com/h2o/picohttpparser), which is dual-licensed under the Perl License or the MIT License
- [`mimalloc`](https://github.com/microsoft/mimalloc), which is MIT licensed

For compatibiltiy reasons, these NPM packages are embedded into Bun's binary and injected if imported.

- [`assert`](https://npmjs.com/package/assert) (MIT license)
- [`browserify-zlib`](https://npmjs.com/package/browserify-zlib) (MIT license)
- [`buffer`](https://npmjs.com/package/buffer) (MIT license)
- [`constants-browserify`](https://npmjs.com/package/constants-browserify) (MIT license)
- [`crypto-browserify`](https://npmjs.com/package/crypto-browserify) (MIT license)
- [`domain-browser`](https://npmjs.com/package/domain-browser) (MIT license)
- [`events`](https://npmjs.com/package/events) (MIT license)
- [`https-browserify`](https://npmjs.com/package/https-browserify) (MIT license)
- [`os-browserify`](https://npmjs.com/package/os-browserify) (MIT license)
- [`path-browserify`](https://npmjs.com/package/path-browserify) (MIT license)
- [`process`](https://npmjs.com/package/process) (MIT license)
- [`punycode`](https://npmjs.com/package/punycode) (MIT license)
- [`querystring-es3`](https://npmjs.com/package/querystring-es3) (MIT license)
- [`stream-browserify`](https://npmjs.com/package/stream-browserify) (MIT license)
- [`stream-http`](https://npmjs.com/package/stream-http) (MIT license)
- [`string_decoder`](https://npmjs.com/package/string_decoder) (MIT license)
- [`timers-browserify`](https://npmjs.com/package/timers-browserify) (MIT license)
- [`tty-browserify`](https://npmjs.com/package/tty-browserify) (MIT license)
- [`url`](https://npmjs.com/package/url) (MIT license)
- [`util`](https://npmjs.com/package/util) (MIT license)
- [`vm-browserify`](https://npmjs.com/package/vm-browserify) (MIT license)

# Developing Bun

Estimated: 30-90 minutes :(

## macOS

Compile Zig:

```bash
git clone https://github.com/jarred-sumner/zig
cd zig
git checkout jarred/zig-sloppy-with-small-structs
cmake . -DCMAKE_PREFIX_PATH=$(brew --prefix llvm) -DZIG_STATIC_LLVM=ON -DCMAKE_BUILD_TYPE=Release && make -j 16
```

You'll want to make sure `zig` is in `$PATH`. The `zig` binary wil be in the same folder as the newly-cloned `zig` repo. If you use fish, you can run `fish_add_path (pwd)`.

In `bun`:

```bash
git submodule update --init --recursive --progress --depth=1
make vendor
```

Note that `brew install zig` won't work. Bun uses a build of Zig with a couple patches.

Additionally, you'll need `cmake`, `npm` and `esbuild` installed globally.

## Linux

A Dockerfile with the exact version of Zig used is availble at `Dockerfile.zig`. This installs all the system dependencies you'll need excluding JavaScriptCore, but doesn't currently compile Bun in one command. If you're having trouble compiling Zig, it might be helpful to look at.

Compile Zig:

```bash
git clone https://github.com/jarred-sumner/zig --depth=1
cd zig
git checkout jarred/zig-sloppy-with-small-structs
cmake . -DCMAKE_BUILD_TYPE=Release && make -j $(nproc)
```

Compile JavaScriptCore:

```bash
# This will take a few minutes, depending on how fast your internet is
git submodule update --init --recursive --progress --depth=1

# This will take 10-30 minutes, depending on how many cores your CPU has
DOCKER_BUILDKIT=1 docker build -t bun-webkit $(pwd)/src/javascript/jsc/WebKit -f $(pwd)/src/javascript/jsc/WebKit/Dockerfile --progress=plain
docker container create bun-webkit

# Find the docker container ID manually. If you know a better way, please submit a PR!
docker container ls

docker cp DOCKER_CONTAINER_ID_YOU_JUST_FOUND:/output $HOME/webkit-build
```

Compile Bun:

```bash
make vendor dev
```

Run bun:

```bash
packages/debug-bun-cli-darwin-x64/bin/bun-debug
```
