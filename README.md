# bun

bun is a new:

- JavaScript/TypeScript/JSX transpiler
- JavaScript & CSS bundler
- Development server with 60fps Hot Module Reloading (& WIP support for React Fast Refresh)
- JavaScript Runtime Environment (powered by JavaScriptCore, what WebKit/Safari uses)
- Task runner for package.json scripts
- npm-compatible package manager

All in one fast &amp; easy-to-use tool. Instead of 1,000 node_modules for development, you only need bun.

**bun is experimental software**. Join [bun’s Discord](https://bun.sh/discord) for help and have a look at [things that don’t work yet](#things-that-dont-work-yet).

## Install

Native: (macOS x64 & Silicon, Linux x64, Windows Subsystem for Linux)

```sh
curl -fsSL https://bun.sh/install | bash
```

Docker: (Linux x64)

```sh
docker pull jarredsumner/bun:edge
docker run --rm --init --ulimit memlock=-1:-1 jarredsumner/bun:edge
```

## Table of Contents

- [Install](#install)
- [Benchmarks](#benchmarks)
- [Using bun as a package manager](#using-bun-as-a-package-manager)
- [Using bun as a task runner](#using-bun-as-a-task-runner)
- [Using bun with Next.js](#using-bun-with-nextjs)
- [Using bun with single page apps](#using-bun-with-single-page-apps)
  - [Using bun with Create React App](#using-bun-with-create-react-app)
- [Using bun with TypeScript](#using-bun-with-typescript)
- [Using Tailwind with bun](#using-tailwind-with-bun)
- [Things that don’t work yet](#things-that-dont-work-yet)
  - [Limitations & intended usage](#limitations--intended-usage)
- [Configuration](#configuration)
  - [Loaders](#loaders)
  - [CSS in JS](#css-in-js)
  - [CSS Loader](#css-loader)
  - [CSS Runtime](#css-runtime)
  - [Frameworks](#frameworks)
- [Troubleshooting](#troubleshooting)
- [Reference](#reference)
  - [`bun install`](#bun-install)
  - [`bun run`](#bun-run)
  - [`bun create`](#bun-run)
  - [`bun bun`](#bun-bun)
  - [`bun completions`](#bun-completions)
  - [`Bun.Transpiler`](#buntranspiler)
    - [`transformSync`](#buntranspilertransformsync)
    - [`transform`](#buntranspilertransform)
    - [`scan`](#buntranspilerscan)
    - [`scanImports`](#buntranspilerscanimports)
- [Environment variables](#environment-variables)
- [Credits](#credits)
- [License](#license)
- [Developing bun](#developing-bun)
  - [VSCode Dev Container](#vscode-dev-container-linux)
  - [MacOS](#macos)
- [vscode-zig](#vscode-zig)

## Benchmarks

**CSS**: [bun is 14x faster](./bench/hot-module-reloading/css-stress-test) than Next.js at hot reloading CSS. TODO: compare Vite

**JavaScript**: TODO

## Using bun as a package manager

On Linux, `bun install` tends to install packages 20x - 100x faster than `npm install`. On macOS, it’s more like 4x - 80x.

<img src="https://user-images.githubusercontent.com/709451/147004342-571b6123-17a9-49a2-8bfd-dcfc5204047e.png" height="200" />

To install packages from package.json:

```bash
bun install
```

To add or remove packages from package.json:

```bash
bun remove react
bun add preact
```

## Using bun as a task runner

Instead of waiting 170ms for your npm client to start for each task, you wait 6ms for bun.

To use bun as a task runner, run `bun run` instead of `npm run`.

```bash
# Instead of "npm run clean"
bun run clean

# This also works
bun clean
```

Assuming a package.json with a `"clean"` command in `"scripts"`:

```json
{
  "name": "myapp",
  "scripts": {
    "clean": "rm -rf dist out node_modules"
  }
}
```

## Using bun with Next.js

To create a new Next.js app with bun:

```bash
bun create next ./app
cd app
bun
```

To use an existing Next.js app with bun:

```bash
npm install bun-framework-next
bun bun --use next
bun
```

Many of Next.js’ features are supported, but not all.

Here’s what doesn’t work yet:

- `getStaticPaths`
- same-origin `fetch` inside of `getStaticProps` or `getServerSideProps`
- locales, zones, `assetPrefix` (workaround: change `--origin \"http://localhost:3000/assetPrefixInhere\"`)
- `next/image` is polyfilled to a regular `<img src>` tag.
- `proxy` and anything else in `next.config.js`
- API routes, middleware (middleware is easier to support though! similar SSR API)
- styled-jsx (technically not Next.js but often used with it)

When using Next.js, bun automatically reads configuration from `.env.local`, `.env.development` and `.env` (in that order). `process.env.NEXT_PUBLIC_` and `process.env.NEXT_` automatically are replaced via `--define`.

Currently, any time you import new dependencies from `node_modules`, you will need to re-run `bun bun --use next`. This will eventually be automatic.

## Using bun with single page apps

In your project folder root (where `package.json` is):

```bash
bun bun ./entry-point-1.js ./entry-point-2.jsx
bun
```

By default, `bun` will look for any HTML files in the `public` directory and serve that. For browsers navigating to the page, the `.html` file extension is optional in the URL, and `index.html` will automatically rewrite for the directory.

Here are examples of routing from `public/` and how they’re matched:
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

### Using bun with Create React App

To create new a React app:

```bash
bun create react ./app
cd app
bun
```

To use an existing React app:

```bash
# To enable React Fast Refresh, ensure "react-refresh" is installed
npm install -D react-refresh

# Generate a bundle for your entry point(s)
bun bun ./src/index.js # jsx, tsx, ts also work. can be multiple files

# Start the dev server
bun
```

From there, bun relies on the filesystem for mapping dev server paths to source files. All URL paths are relative to the project root (where `package.json` is located).

Here are examples of routing source code file paths:

| Dev Server URL             | File Path (relative to cwd) |
| -------------------------- | --------------------------- |
| /src/components/Button.tsx | src/components/Button.tsx   |
| /src/index.tsx             | src/index.tsx               |
| /pages/index.js            | pages/index.js              |

You do not need to include file extensions in `import` paths. CommonJS-style import paths without the file extension works.

You can override the public directory by passing `--public-dir="path-to-folder"`.

If no directory is specified and `./public/` doesn’t exist, bun will try `./static/`. If `./static/` does not exist, but won’t serve from a public directory. If you pass `--public-dir=./` bun will serve from the current directory, but it will check the current directory last instead of first.

## Using bun with TypeScript

TypeScript just works. There’s nothing to configure and nothing extra to install. If you import a `.ts` or `.tsx` file, bun will transpile it into JavaScript. bun also transpiles `node_modules` containing `.ts` or `.tsx` files. This is powered by bun’s TypeScript transpiler, so it’s fast.

bun also reads `tsconfig.json`, including `baseUrl` and `paths`.

## Using Tailwind with bun

[Tailwind](https://tailwindcss.com/) is a popular CSS utility framework. Currently, the easiest way to use Tailwind with bun is through Tailwind’s CLI. That means running both `bun` and `tailwind`, and importing the file `tailwind`’s CLI outputs.

Tailwind’s docs talk more about [Tailwind’s CLI usage](https://tailwindcss.com/docs/installation#watching-for-changes), but the gist is you’ll want to run this:

```bash
npx tailwindcss -i ./src/tailwind.css -o ./dist/tailwind.css --watch
```

From there, make sure to import the `dist/tailwind.css` file (or what you chose as the output).

## Things that don’t work yet

bun is a project with incredibly large scope, and it’s early days.

| Feature                                                                                                                | In              |
| ---------------------------------------------------------------------------------------------------------------------- | --------------- |
| ~Symlinks~                                                                                                             | Resolver        |
| [Finish Fast Refresh](https://github.com/Jarred-Sumner/bun/issues/18)                                                  | JSX Transpiler  |
| Source Maps                                                                                                            | JavaScript      |
| Source Maps                                                                                                            | CSS             |
| [Private Class Fields](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_class_fields) | JS Transpiler   |
| [Import Assertions](https://github.com/tc39/proposal-import-assertions)                                                | JS Transpiler   |
| [`extends`](https://www.typescriptlang.org/tsconfig#extends) in tsconfig.json                                          | TS Transpiler   |
| [jsx](https://www.typescriptlang.org/tsconfig)\* in tsconfig.json                                                      | TS Transpiler   |
| [TypeScript Decorators](https://www.typescriptlang.org/docs/handbook/decorators.html)                                  | TS Transpiler   |
| `@jsxPragma` comments                                                                                                  | JS Transpiler   |
| JSX source file name                                                                                                   | JS Transpiler   |
| Sharing `.bun` files                                                                                                   | bun             |
| [Finish fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)                                             | bun.js          |
| [setTimeout](https://developer.mozilla.org/en-US/docs/Web/API/setTimeout)                                              | bun.js          |
| [workspace: dependencies](https://github.com/Jarred-Sumner/bun/issues/83)                                              | Package manager |
| [git: dependencies](https://github.com/Jarred-Sumner/bun/issues/82)                                                    | Package manager |
| [github: dependencies](https://github.com/Jarred-Sumner/bun/issues/81)                                                 | Package manager |
| [link: dependencies](https://github.com/Jarred-Sumner/bun/issues/81)                                                   | Package manager |
| [global installs](https://github.com/Jarred-Sumner/bun/issues/84)                                                      | Package manager |

<small>
JS Transpiler == JavaScript Transpiler
<br/>
TS Transpiler == TypeScript Transpiler
<br/>
Package manager == `bun install`
<br/>
bun.js == bun’s JavaScriptCore integration that executes JavaScript. Similar to how Node.js & Deno embed V8.
</small>

### Limitations & intended usage

bun is great for building websites &amp; webapps. For libraries, consider using Rollup or esbuild instead. bun currently doesn’t minify code and bun’s dead code elimination doesn’t look beyond the current file.

Today, bun is focused on:

- Development, not production
- Compatibility with existing frameworks & tooling

Ideally, most projects can use bun with their existing tooling while making few changes to their codebase. That means using bun in development, and continuing to use Webpack, esbuild, or another bundler in production. Using two bundlers might sound strange at first, but after all the production-only AST transforms, minification, and special development/production-only imported files...it’s not far from the status quo.

Longer-term, bun intends to replace Node.js, Webpack, Babel, and PostCSS (in production).

## Configuration

### Loaders

A loader determines how to map imports &amp; file extensions to transforms and output.

Currently, bun implements the following loaders:

| Input | Loader                        | Output |
| ----- | ----------------------------- | ------ |
| .js   | JSX + JavaScript              | .js    |
| .jsx  | JSX + JavaScript              | .js    |
| .ts   | TypeScript + JavaScript       | .js    |
| .tsx  | TypeScript + JSX + JavaScript | .js    |
| .mjs  | JavaScript                    | .js    |
| .cjs  | JavaScript                    | .js    |
| .mts  | TypeScript                    | .js    |
| .cts  | TypeScript                    | .js    |
| .css  | CSS                           | .css   |
| .env  | Env                           | N/A    |
| .\*   | file                          | string |

Everything else is treated as `file`. `file` replaces the import with a URL (or a path).

You can configure which loaders map to which extensions by passing `--loaders` to `bun`. For example:

```sh
bun --loader=.js:js
```

This will disable JSX transforms for `.js` files.

### CSS in JS

When importing CSS in JavaScript-like loaders, CSS is treated special.

By default, bun will transform a statement like this:

```js
import "../styles/global.css";
```

##### When `platform` is `browser`

```js
globalThis.document?.dispatchEvent(
  new CustomEvent("onimportcss", {
    detail: "http://localhost:3000/styles/globals.css",
  })
);
```

An event handler for turning that into a `<link>` is automatically registered when HMR is enabled. That event handler can be turned off either in a framework’s `package.json` or by setting `globalThis["Bun_disableCSSImports"] = true;` in client-side code. Additionally, you can get a list of every .css file imported this way via `globalThis["__BUN"].allImportedStyles`.

##### When `platform` is `bun`

```js
//@import url("http://localhost:3000/styles/globals.css");
```

Additionally, bun exposes an API for SSR/SSG that returns a flat list of URLs to css files imported. That function is `bun.getImportedStyles()`.

```ts
addEventListener("fetch", async (event: FetchEvent) => {
  var route = bun.match(event);
  const App = await import("pages/_app");

  // This returns all .css files that were imported in the line above.
  // It’s recursive, so any file that imports a CSS file will be included.
  const appStylesheets = bun.getImportedStyles();

  // ...rest of code
});
```

This is useful for preventing flash of unstyled content.

### CSS Loader

bun bundles `.css` files imported via `@import` into a single file. It doesn’t autoprefix or minify CSS today. Multiple `.css` files imported in one JavaScript file will _not_ be bundled into one file. You’ll have to import those from a `.css` file.

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

### CSS runtime

To support hot CSS reloading, bun inserts `@supports` annotations into CSS that tag which files a stylesheet is composed of. Browsers ignore this, so it doesn’t impact styles.

By default, bun’s runtime code automatically listens to `onimportcss` and will insert the `event.detail` into a `<link rel="stylesheet" href={${event.detail}}>` if there is no existing `link` tag with that stylesheet. That’s how bun’s equivalent of `style-loader` works.

### Frameworks

Frameworks preconfigure bun to enable developers to use bun with their existing tooling.

Frameworks are configured via the `framework` object in the `package.json` of the framework (not in the application’s `package.json`):

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
  // This changes what’s printed in the console on load
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

  // bun’s filesystem router
  router?: Router;
};

type Define = {
  // By passing ".env", bun will automatically load .env.local, .env.development, and .env if exists in the project root
  //    (in addition to the processes’ environment variables)
  // When "*", all environment variables will be automatically injected into the JavaScript loader
  // When a string like "NEXT_PUBLIC_", only environment variables starting with that prefix will be injected

  ".env": string | "*";

  // These environment variables will be injected into the JavaScript loader
  // These are the equivalent of Webpack’s resolve.alias and esbuild’s --define.
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

// bun’s filesystem router
// Currently, bun supports pages by either an absolute match or a parameter match.
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

Your framework’s `package.json` `name` should start with `bun-framework-`. This is so that people can type something like `bun bun --use next` and it will check `bun-framework-next` first. This is similar to how Babel plugins tend to start with `babel-plugin-`.

For developing frameworks, you can also do `bun bun --use ./relative-path-to-framework`.

If you’re interested in adding a framework integration, please reach out. There’s a lot here and it’s not entirely documented yet.

## Troubleshooting

### bun not running on an M1 (or Apple Silicon)

If you see a message like this

> [1] 28447 killed bun create next ./test

It most likely means you’re running bun’s x64 version on Apple Silicon. This happens if bun is running via Rosetta. Rosetta is unable to emulate AVX2 instructions, which bun indirectly uses.

The fix is to ensure you installed a version of bun built for Apple Silicon.

### error: Unexpected

If you see an error like this:

![image](https://user-images.githubusercontent.com/709451/141210854-89434678-d21b-42f4-b65a-7df3b785f7b9.png)

It usually means the max number of open file descriptors is being explicitly set to a low number. By default, bun requests the max number of file descriptors available (which on macOS, is something like 32,000). But, if you previously ran into ulimit issues with e.g. Chokidar, someone on The Internet may have advised you to run `ulimit -n 8096`.

That advice unfortunately **lowers** the hard limit to `8096`. This can be a problem in large repositories or projects with lots of dependencies. Chokidar (and other watchers) don’t seem to call `setrlimit`, which means they’re reliant on the (much lower) soft limit.

To fix this issue:

1. Remove any scripts that call `ulimit -n` and restart your shell.
2. Try agin, and if the error still occurs, try setting `ulimit -n` to an absurdly high number, such as `ulimit -n 2147483646`
3. Try again, and if that still doesn’t fix it, open an issue

## Reference

### `bun install`

`bun install` is a fast package manager & npm client.

Environment variables

| Name                             | Description                                                   |
| -------------------------------- | ------------------------------------------------------------- |
| BUN_CONFIG_REGISTRY              | Set an npm registry (default: <https://registry.npmjs.org>)   |
| BUN_CONFIG_TOKEN                 | Set an auth token (currently does nothing)                    |
| BUN_CONFIG_LOCKFILE_SAVE_PATH    | File path to save the lockfile to (default: bun.lockb)        |
| BUN_CONFIG_YARN_LOCKFILE         | Save a Yarn v1-style yarn.lock                                |
| BUN_CONFIG_LINK_NATIVE_BINS      | Point `bin` in package.json to a platform-specific dependency |
| BUN_CONFIG_SKIP_SAVE_LOCKFILE    | Don’t save a lockfile                                         |
| BUN_CONFIG_SKIP_LOAD_LOCKFILE    | Don’t load a lockfile                                         |
| BUN_CONFIG_SKIP_INSTALL_PACKAGES | Don’t install any packages                                    |

bun always tries to use the fastest available installation method for the target platform. On macOS, that’s `clonefile` and on Linux, that’s `hardlink`. You can change which installation method is used with the `--backend` flag. When unavailable or on error, `clonefile` and `hardlink` fallsback to a platform-specific implementation of copying files.

bun stores installed packages from npm in `~/.bun/install/cache/${name}@${version}`. Note that if the semver version has a `build` or a `pre` tag, it is replaced with a hash of that value instead. This is to reduce chances of errors from long file paths, but unfortunately complicates figuring out where a package was installed on disk.

When the `node_modules` folder exists, before installing, bun checks if the `"name"` and `"version"` in `package/package.json` in the expected node_modules folder matches the expected `name` and `version`. This is how it determines whether or not it should install. It uses a custom JSON parser which stops parsing as soon as it finds `"name"` and `"version"`.

When a `bun.lockb` doesn’t exist or `package.json` has changed dependencies, tarballs are downloaded & extracted eagerly while resolving.

When a `bun.lockb` exists and `package.json` hasn’t changed, bun downloads missing dependencies lazily. If the package with a matching `name` & `version` already exists in the expected location within `node_modules`, bun won’t attempt to download the tarball.

#### Platform-specific dependencies?

bun stores normalized `cpu` and `os` values from npm in the lockfile, along with the resolved packages. It skips downloading, extracting, and installing packages disabled for the current target at runtime. This means the lockfile won’t change between platforms/architectures even if the packages ultimately installed do change.

#### Peer dependencies?

Peer dependencies are handled similarly to yarn. `bun install` does not automatically install peer dependencies and will try to choose an existing dependency.

#### Lockfile

`bun.lockb` is bun’s binary lockfile format.

#### Why is it binary?

In a word: Performance. bun’s lockfile saves & loads incredibly quickly, and saves a lot more data than what is typically inside lockfiles.

#### How do I inspect it?

For now, the easiest thing is to run `bun install -y`. That prints a Yarn v1-style yarn.lock file.

#### What does the lockfile store?

Packages, metadata for those packages, the hoisted install order, dependencies for each package, what packages those dependencies resolved to, an integrity hash (if available), what each package was resolved to and which version (or equivalent)

#### Why is it fast?

It uses linear arrays for all data. [Packages](https://github.com/Jarred-Sumner/bun/blob/be03fc273a487ac402f19ad897778d74b6d72963/src/install/install.zig#L1825) are referenced by auto-incrementing integer ID or a hash of the package name. Strings longer than 8 characters are de-duplicated. Prior to saving on disk, the lockfile is garbage-collected & made deterministic by walking the package tree and cloning the packages in dependency order.

#### Cache

To delete the cache:

```bash
rm -rf ~/.bun/install/cache
```

#### npm registry metadata

bun uses a binary format for caching NPM registry responses. This loads much faster than JSON and tends to be smaller on disk.
You will see these files in `~/.bun/install/cache/*.npm`. The filename pattern is `${hash(packageName)}.npm`. It’s a hash so that extra directories don’t need to be created for scoped packages

bun’s usage of `Cache-Control` ignores `Age`. This improves performance, but means bun may be about 5 minutes out of date to receive the the latest package version metadata from npm.

### `bun run`

`bun run` is a fast `package.json` scripts runner. Instead of waiting 170ms for your npm client to start every time, you wait 6ms for bun.

By default, `bun run` prints the script that will be invoked:

```bash
bun run clean
$ rm -rf node_modules/.cache dist
```

You can disable that with `--silent`

```bash
bun run --silent clean
```

To print a list of `scripts`, `bun run` without additional args:

```bash
# This command
bun run

# Prints this
hello-create-react-app scripts:

bun run start
react-scripts start

bun run build
react-scripts build

bun run test
react-scripts test

bun run eject
react-scripts eject

4 scripts
```

`bun run` automatically loads environment variables from `.env` into the shell/task. `.env` files are loaded with the same priority as the rest of bun, so that means:

1. `.env.local` is first
2. if (`$NODE_ENV` === `"production"`) `.env.production` else `.env.development`
3. `.env`

If something is unexpected there, you can run `bun run env` to get a list of environment variables.

The default shell it uses is `bash`, but if that’s not found, it tries `sh` and if still not found, it tries `zsh`. This is not configurable right now, but if you care file an issue.

`bun run` automatically adds any parent `node_modules/.bin` to `$PATH` and if no scripts match, it will load that binary instead. That means you can run executables from packages too.

```bash
# If you use Relay
bun run relay-compiler

# You can also do this, but:
# - It will only lookup packages in `node_modules/.bin` instead of `$PATH`
# - It will start bun’s dev server if the script name doesn’t exist (`bun` starts the dev server by default)
bun relay-compiler
```

To pass additional flags through to the task or executable, there are two ways:

```bash
# Explicit: include "--" and anything after will be added. This is the recommended way because it is more reliable.
bun run relay-compiler -- -–help

# Implicit: if you do not include "--", anything *after* the script name will be passed through
# bun flags are parsed first, which means e.g. `bun run relay-compiler --help` will print bun’s help instead of relay-compiler’s help.
bun run relay-compiler --schema foo.graphql
```

`bun run` supports lifecycle hooks like `post${task}` and `pre{task}`. If they exist, they will run matching the behavior of npm clients. If the `pre${task}` fails, the next task will not be run. There is currently no flag to skip these lifecycle tasks if they exist, if you want that file an issue.

### `bun create`

`bun create` is a fast way to create a new project from a template.

At the time of writing, `bun create react app` runs ~11x faster on my local computer than `yarn create react-app app`. `bun create` currently does no caching (though your npm client does)

#### Usage

Create a new Next.js project:

```bash
bun create next ./app
```

Create a new React project:

```bash
bun create react ./app
```

Create from a GitHub repo:

```bash
bun create ahfarmer/calculator ./app
```

To see a list of examples, run:

```bash
bun create
```

Format:

```bash
bun create github-user/repo-name destination
bun create local-example-or-remote-example destination
bun create /absolute/path/to-template-folder destination
bun create https://github.com/github-user/repo-name destination
bun create github.com/github-user/repo-name destination
```

Note: you don’t need `bun create` to use bun. You don’t need any configuration at all. This command exists to make it a little easier.

#### Local templates

If you have your own boilerplate you prefer using, copy it into `$HOME/.bun-create/my-boilerplate-name`.

Before checking bun’s examples folder, `bun create` checks for a local folder matching the input in:

- `$BUN_CREATE_DIR/`
- `$HOME/.bun-create/`
- `$(pwd)/.bun-create/`

If a folder exists in any of those folders with the input, bun will use that instead of a remote template.

To create a local template, run:

```bash
mkdir -p $HOME/.bun-create/new-template-name
echo '{"name":"new-template-name"}' > $HOME/.bun-create/new-template-name/package.json
```

This lets you run:

```bash
bun create new-template-name ./app
```

Now your new template should appear when you run:

```bash
bun create
```

Warning: unlike with remote templates, **bun will delete the entire destination folder if it already exists.**

#### Flags

| Flag         | Description                            |
| ------------ | -------------------------------------- |
| --npm        | Use `npm` for tasks & install          |
| --yarn       | Use `yarn` for tasks & install         |
| --pnpm       | Use `pnpm` for tasks & install         |
| --force      | Overwrite existing files               |
| --no-install | Skip installing `node_modules` & tasks |
| --no-git     | Don’t initialize a git repository      |
| --open       | Start & open in-browser after finish   |

| Environment Variables | Description                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| GITHUB_API_DOMAIN     | If you’re using a GitHub enterprise or a proxy, you can change what the endpoint requests to GitHub go |
| GITHUB_API_TOKEN      | This lets `bun create` work with private repositories or if you get rate-limited                       |

By default, `bun create` will cancel if there are existing files it would overwrite and its a remote template. You can pass `--force` to disable this behavior.

#### Publishing a new template

Clone this repository and a new folder in `examples/` with your new template. The `package.json` must have a `name` that starts with `@bun-examples/`. Do not worry about publishing it, that will happen automaticallly after the PR is merged.

Make sure to include a `.gitignore` that includes `node_modules` so that `node_modules` aren’t checked in to git when people download the template.

#### Testing your new template

To test your new template, add it as a local template or pass the absolute path.

```bash
bun create /path/to/my/new/template destination-dir
```

Warning: **This will always delete everything in destination-dir**.

#### Config

The `bun-create` section of `package.json` is automatically removed from the `package.json` on disk. This lets you add create-only steps without waiting for an extra package to install.

There are currently two options:

- `postinstall`
- `preinstall`

They can be an array of strings or one string. An array of steps will be executed in order.

Here is an example:

```json
{
  "name": "@bun-examples/next",
  "version": "0.0.31",
  "main": "index.js",
  "dependencies": {
    "next": "11.1.2",
    "react": "^17.0.2",
    "react-dom": "^17.0.2",
    "react-is": "^17.0.2"
  },
  "devDependencies": {
    "@types/react": "^17.0.19",
    "bun-framework-next": "^0.0.0-21",
    "typescript": "^4.3.5"
  },
  "bun-create": {
    "postinstall": ["bun bun --use next"]
  }
}
```

By default, all commands run inside the environment exposed by the auto-detected npm client. This incurs a significant performance penalty, something like 150ms spent waiting for the npm client to start on each invocation.

Any command that starts with `"bun "` will be run without npm, relying on the first `bun` binary in `$PATH`.

#### How `bun create` works

When you run `bun create ${template} ${destination}`, here’s what happens:

IF remote template

1. GET `registry.npmjs.org/@bun-examples/${template}/latest` and parse it
2. GET `registry.npmjs.org/@bun-examples/${template}/-/${template}-${latestVersion}.tgz`
3. Decompress & extract `${template}-${latestVersion}.tgz` into `${destination}`

   - If there are files that would overwrite, warn and exit unless `--force` is passed

IF github repo

1. Download the tarball from GitHub’s API
2. Decompress & extract into `${destination}`

   - If there are files that would overwrite, warn and exit unless `--force` is passed

ELSE IF local template

1. Open local template folder
2. Delete destination directory recursively
3. Copy files recursively using the fastest system calls available (on macOS `fcopyfile` and Linux, `copy_file_range`). Do not copy or traverse into `node_modules` folder if exists (this alone makes it faster than `cp`)

4. Parse the `package.json` (again!), update `name` to be `${basename(destination)}`, remove the `bun-create` section from the `package.json` and save the updated `package.json` to disk.
   - IF Next.js is detected, add `bun-framework-next` to the list of dependencies
   - IF Create React App is detected, add the entry point in /src/index.{js,jsx,ts,tsx} to `public/index.html`
   - IF Relay is detected, add `bun-macro-relay` so that Relay works
5. Auto-detect the npm client, preferring `pnpm`, `yarn` (v1), and lastly `npm`
6. Run any tasks defined in `"bun-create": { "preinstall" }` with the npm client
7. Run `${npmClient} install` unless `--no-install` is passed OR no dependencies are in package.json
8. Run any tasks defined in `"bun-create": { "preinstall" }` with the npm client
9. Run `git init; git add -A .; git commit -am "Initial Commit";`

   - Rename `gitignore` to `.gitignore`. NPM automatically removes `.gitignore` files from appearing in packages.
   - If there are dependencies, this runs in a separate thread concurrently while node_modules are being installed
   - Using libgit2 if available was tested and performed 3x slower in microbenchmarks

10. Done

`misctools/publish-examples.js` publishes all examples to npm.

### `bun bun`

Run `bun bun ./path-to.js` to generate a `node_modules.bun` file containing all imported dependencies (recursively).

#### Why bundle?

- For browsers, loading entire apps without bundling dependencies is typically slow. With a fast bundler & transpiler, the bottleneck eventually becomes the web browser’s ability to run many network requests concurrently. There are many workarounds for this. `<link rel="modulepreload">`, HTTP/3, etc but none are more effective than bundling. If you have reproducible evidence to the contrary, feel free to submit an issue. It would be better if bundling wasn’t necessary.
- On the server, bundling reduces the number of filesystem lookups to load JavaScript. While filesystem lookups are faster than HTTP requests, there’s still overhead.

#### What is `.bun`?

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
- what is the hash of the bundle’s contents? (for etags)
- what is the name & version of every npm package exported in this bundle?
- what modules from which packages are used in this project? ("project" defined as all the entry points used to generate the .bun)

All in one file.

It’s a little like a build cache, but designed for reuse. I hope people will eventually check it into version control so their coworkers don’t have to run `npm install` as often.

#### Position-independent code

From a design perspective, the most important part of the `.bun` format is how code is organized. Each module is exported by a hash like this:

```js
// preact/dist/preact.module.js
export var $eb6819b = $$m({
  "preact/dist/preact.module.js": (module, exports) => {
    var n, l, u, i, t, o, r, f, e = {}, c = [], s = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
    // ... rest of code
```

This makes bundled modules [position-independent](https://en.wikipedia.org/wiki/Position-independent_code). In theory, one could import only the exact modules in-use without reparsing code and without generating a new bundle. One bundle can dynamically become many bundles comprising only the modules in use on the webpage. Thanks to the metadata with the byte offsets, a web server can send each module to browsers [zero-copy](https://en.wikipedia.org/wiki/Zero-copy) using [sendfile](https://man7.org/linux/man-pages/man2/sendfile.2.html). bun itself is not quite this smart yet, but these optimizations would be useful in production and potentially very useful for React Server Components.

To see the schema inside, have a look at [`JavascriptBundleContainer`](./src/api/schema.d.ts#:~:text=export%20interface-,JavascriptBundleContainer,-%7B). You can find JavaScript bindings to read the metadata in [src/api/schema.js](./src/api/schema.js). This is not really an API yet. It’s missing the part where it gets the binary data from the bottom of the file. Someday, I want this to be usable by other tools too.

#### Where is the code?

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

To deploy to production with bun, you’ll want to get the code from the `.bun` file and stick that somewhere your web server can find it (or if you’re using Vercel or a Rails app, in a `public` folder).

Note that `.bun` is a binary file format, so just opening it in VSCode or vim might render strangely.

#### Advanced

By default, `bun bun` only bundles external dependencies that are `import`ed or `require`d in either app code or another external dependency. An "external depenendency" is defined as, "A JavaScript-like file that has `/node_modules/` in the resolved file path and a corresponding `package.json`".

To force bun to bundle packages which are not located in a `node_modules` folder (i.e. the final, resolved path following all symlinks), add a `bun` section to the root project’s `package.json` with `alwaysBundle` set to an array of package names to always bundle. Here’s an example:

```json
{
  "name": "my-package-name-in-here",
  "bun": {
    "alwaysBundle": ["@mybigcompany/my-workspace-package"]
  }
}
```

Bundled dependencies are not eligible for Hot Module Reloading. The code is served to browsers & bun.js verbatim. But, in the future, it may be sectioned off into only parts of the bundle being used. That’s possible in the current version of the `.bun` file (so long as you know which files are necessary), but it’s not implemented yet. Longer-term, it will include all `import` and `export` of each module inside.

#### What is the module ID hash?

The `$eb6819b` hash used here:

```js
export var $eb6819b = $$m({
```

Is generated like this:

1. Murmur3 32 bit hash of `package.name@package.version`. This is the hash uniquely identifying the npm package.
2. Wyhash 64 of the `package.hash` + `package_path`. `package_path` means "relative to the root of the npm package, where is the module imported?". For example, if you imported `react/jsx-dev-runtime.js`, the `package_path` is `jsx-dev-runtime.js`. `react-dom/cjs/react-dom.development.js` would be `cjs/react-dom.development.js`
3. Truncate the hash generated above to a `u32`

The implementation details of this module ID hash will vary between versions of bun. The important part is the metadata contains the module IDs, the package paths, and the package hashes so it shouldn’t really matter in practice if other tooling wants to make use of any of this.

### `bun completions`

This command installs completions for `zsh` and/or `fish`. It’s run automatically on every `bun upgrade` and on install. It reads from `$SHELL` to determine which shell to install for. It tries several common shell completion directories for your shell and OS.

If you want to copy the completions manually, run `bun completions > path-to-file`. If you know the completions directory to install them to, run `bun completions /path/to/directory`.

### `Bun.Transpiler`

`Bun.Transpiler` lets you use Bun's transpiler from JavaScript (available in Bun.js)

````ts
type Loader = "jsx" | "js" | "ts" | "tsx";

interface TranspilerOptions {
  // Replace key with value. Value must be a JSON string.
  // @example
  // ```
  // { "process.env.NODE_ENV": "\"production\"" }
  // ```
  define: Record<string, string>,

  // What is the default loader used for this transpiler?
  loader: Loader,

  // What platform are we targeting? This may affect how import and/or require is used
  platform: "browser" | "bun" | "macro" | "node",

  // TSConfig.json file as stringified JSON or an object
  // Use this to set a custom JSX factory, fragment, or import source
  // For example, if you want to use Preact instead of React. Or if you want to use Emotion.
  tsconfig: string | TSConfig,

  // Replace imports with macros
  macros: MacroMap,
}

// This lets you use macros
interface MacroMap {
  // @example
  // ```
  // {
  //   "react-relay": {
  //     "graphql": "bun-macro-relay/bun-macro-relay.tsx"
  //   }
  // }
  // ```
  [packagePath: string]: {
    [importItemName: string]: string,
  },
}

class Bun.Transpiler {
  constructor(options: Bun.TranspilerOptions)

  transform(code: string, loader?: Loader): Promise<string>
  transformSync(code: string, loader?: Loader): string

  scan(code: string): {exports: string[], imports: Import}
  scanImports(code: string): Import[]
}

type Import = {
  path: string,
  kind:
  // import foo from 'bar'; in JavaScript
  | "import-statement"
  // require("foo") in JavaScript
  | "require-call"
  // require.resolve("foo") in JavaScript
  | "require-resolve"
  // Dynamic import() in JavaScript
  | "dynamic-import"
  // @import() in CSS
  | "import-rule"
  // url() in CSS
  | "url-token"
  // The import was injected by Bun
  | "internal"
  // Entry point
  // Probably won't see this one
  | "entry-point"
}

const transpiler = new Bun.Transpiler({ loader: "jsx" });
````

#### `Bun.Transpiler.transformSync`

This lets you transpile JavaScript, TypeScript, TSX, and JSX using Bun's transpiler. It does not resolve modules.

It is synchronous and runs in the same thread as other JavaScript code.

```js
const transpiler = new Bun.Transpiler({ loader: "jsx" });
transpiler.transformSync("<div>hi!</div>");
```

This outputs the following:
Note that it automatically imports the modern JSX runtime

```js
import { __require as require } from "bun:wrap";
import * as JSX from "react/jsx-dev-runtime";
var jsx = require(JSX).jsxDEV;

export default jsx(
  "div",
  {
    children: "hi!",
  },
  undefined,
  false,
  undefined,
  this
);
```

If a macro is used, it will be run in the same thread as the transpiler, but in a separate event loop from the rest of your application. Currently, globals between macros and regular code are shared, which means it is possible (but not recommended) to share state between macros and regular code. Attempting to use AST nodes outside of a macro is undefined behavior.

#### `Bun.Transpiler.transform`

This lets you transpile JavaScript, TypeScript, TSX, and JSX using Bun's transpiler. It does not resolve modules.

It is async and automatically runs in Bun's worker threadpool. That means if you run it 100 times, it will run it across `Math.floor($cpu_count * 0.8)` threads without blocking the main JavaScript thread.

If code uses a macro, it will potentially spawn a new copy of Bun.js' JavaScript runtime environment in that new thread.

Unless you're transpiling _many_ large files, you should probably use `Bun.Transpiler.transformSync`. The cost of the threadpool will often take longer than actually transpiling code.

```js
const transpiler = new Bun.Transpiler({ loader: "jsx" });
await transpiler.transform("<div>hi!</div>");
```

This outputs the following:
<sup>Note that it automatically imports the modern JSX runtime</sup>

```js
import { __require as require } from "bun:wrap";
import * as JSX from "react/jsx-dev-runtime";
var jsx = require(JSX).jsxDEV;

export default jsx(
  "div",
  {
    children: "hi!",
  },
  undefined,
  false,
  undefined,
  this
);
```

You can also pass a `Loader` as a string

```js
await transpiler.transform("<div>hi!</div>", "tsx");
```

#### `Bun.Transpiler.scan`

This is a fast way to get a list of imports & exports used in a JavaScript/jsx or TypeScript/tsx file.

This function is synchronous.

```ts
const transpiler = new Bun.Transpiler({ loader: "ts" });

transpiler.scan(`
import React from 'react';
import Remix from 'remix';
import type {ReactNode} from 'react';

export const loader = () => import('./loader');
`);
```

```ts
{
  "exports": [
    "loader"
  ],
  "imports": [
    {
      "kind": "import-statement",
      "path": "react"
    },
    {
      "kind": "import-statement",
      "path": "remix"
    },
    {
      "kind": "dynamic-import",
      "path": "./loader"
    }
  ]
}

```

#### `Bun.Transpiler.scanImports`

This is a fast path for getting a list of imports used in a JavaScript/jsx or TypeScript/tsx file. It skips the visiting pass, which means it is faster but less accurate. You probably won't notice a difference between `Bun.Transpiler.scan` and `Bun.Transpiler.scanImports` often. You might notice it for very large files (megabytes).

This function is synchronous.

```ts
const transpiler = new Bun.Transpiler({ loader: "ts" });

transpiler.scanImports(`
import React from 'react';
import Remix from 'remix';
import type {ReactNode} from 'react';

export const loader = () => import('./loader');
`);
```

```json
[
  {
    "kind": "import-statement",
    "path": "react"
  },
  {
    "kind": "import-statement",
    "path": "remix"
  },
  {
    "kind": "dynamic-import",
    "path": "./loader"
  }
]
```

## Environment variables

- `GOMAXPROCS`: For `bun bun`, this sets the maximum number of threads to use. If you’re experiencing an issue with `bun bun`, try setting `GOMAXPROCS=1` to force bun to run single-threaded
- `DISABLE_BUN_ANALYTICS=1` this disables bun’s analytics. bun records bundle timings (so we can answer with data, "is bun getting faster?") and feature usage (e.g. "are people actually using macros?"). The request body size is about 60 bytes, so it’s not a lot of data
- `TMPDIR`: Before `bun bun` completes, it stores the new `.bun` in `$TMPDIR`. If unset, `TMPDIR` defaults to the platform-specific temporary directory (on Linux, `/tmp` and on macOS `/private/tmp`)

## Credits

- While written in Zig instead of Go, bun’s JS transpiler, CSS lexer, and node module resolver source code is based off of @evanw’s esbuild project. @evanw did a fantastic job with esbuild.
- The idea for the name "bun" came from [@kipply](https://github.com/kipply)

## License

bun itself is MIT-licensed.

However, JavaScriptCore (and WebKit) is LGPL-2 and bun statically links it.

Per LGPL2:

> (1) If you statically link against an LGPL’d library, you must also provide your application in an object (not necessarily source) format, so that a user has the opportunity to modify the library and relink the application.

You can find the patched version of WebKit used by bun here: <https://github.com/jarred-sumner/webkit>. If you would like to relink bun with changes:

- `git submodule update --init --recursive`
- `make jsc`
- `zig build`

This compiles JavaScriptCore, compiles bun’s `.cpp` bindings for JavaScriptCore (which are the object files using JavaScriptCore) and outputs a new `bun` binary with your changes.

bun also statically links these libraries:

- `libicu` 66.1, which can be found here: <https://github.com/unicode-org/icu/blob/main/icu4c/LICENSE>
- [`picohttp`](https://github.com/h2o/picohttpparser), which is dual-licensed under the Perl License or the MIT License
- [`mimalloc`](https://github.com/microsoft/mimalloc), which is MIT licensed
- [`zlib-cloudflare`](https://github.com/cloudflare/zlib), which is zlib licensed
- [`boringssl`](https://boringssl.googlesource.com/boringssl/), which has [several licenses](https://boringssl.googlesource.com/boringssl/+/refs/heads/master/LICENSE)
- [`libarchive`](https://github.com/libarchive/libarchive), which has [several licenses](https://github.com/libarchive/libarchive/blob/master/COPYING)
- [`libiconv`](https://www.gnu.org/software/libiconv/), which is LGPL2. It’s a dependency of libarchive.

For compatibiltiy reasons, these NPM packages are embedded into bun’s binary and injected if imported.

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

## Developing bun

Estimated: 30-90 minutes :(

### VSCode Dev Container (Linux)

The VSCode Dev Container in this repository is the easiest way to get started. It comes with Zig, JavaScriptCore, Zig Language Server, vscode-zig, and more pre-installed on an instance of Ubuntu.

<img src="https://user-images.githubusercontent.com/709451/147319227-6446589c-a4d9-480d-bd5b-43037a9e56fd.png" />

To get started, install the devcontainer cli:

```bash
npm install -g @vscode/dev-container-cli
```

Then, in the `bun` repository locally run:

```bash
devcontainer build
devcontainer open
```

You will need to clone the GitHub repository inside that container, which also requires authenticating with GitHub (until bun's repository is public). Make sure to login with a Personal Access Token rather than a web browser.

Inside the container, run this:

```bash
# First time setup
gh auth login
gh repo clone Jarred-Sumner/bun . -- --depth=1 --progress -j8

# update all submodules except webkit because webkit takes awhile and it's already compiled for you.
git -c submodule."src/javascript/jsc/WebKit".update=none submodule update --init --recursive --depth=1 --progress

# Compile bun dependencies (zig is already compiled)
make devcontainer

# Build bun for development
make dev

# Run bun
bun-debug
```

It is very similar to my own development environment.

### MacOS

Install LLVM 13 and homebrew dependencies:

```bash
brew install llvm@13 coreutils libtool cmake libiconv automake openssl@1.1 ninja gnu-sed pkg-config
```

bun (& the version of Zig) need LLVM 13 and Clang 13 (clang is part of LLVM). Weird build & runtime errors will happen otherwise.

Make sure LLVM 13 is in your `$PATH`:

```bash
which clang-13
```

If it is not, you will have to run this to link it:

```bash
export PATH=$(brew --prefix llvm@13)/bin:$PATH
export LDFLAGS="$LDFLAGS -L$(brew --prefix llvm@13)/lib"
export CPPFLAGS="$CPPFLAGS -I$(brew --prefix llvm@13)/include"
```

On fish that looks like `fish_add_path (brew --prefix llvm@13)/bin`

You’ll want to make sure `zig` is in `$PATH`. The specific version of Zig expected is the HEAD in [Jarred-Sumner/zig](https://github.com/Jarred-Sumner/zig).

#### Build bun (macOS)

If you’re building on an Apple Silicon device, you’ll need to do is ensure you have set an environment variable `CODESIGN_IDENTITY`. You can find the correct value by visiting `Keychain Access` and looking under your `login` profile for `Certificates`. The name would usually look like `Apple Development: user@example.com (WDYABC123)`

If you’re not familiar with the process, there’s a guide [here](https://ioscodesigning.com/generating-code-signing-files/#generate-a-code-signing-certificate-using-xcode)

In `bun`:

```bash
# If you omit --depth=1, `git submodule update` will take 17.5 minutes on 1gbps internet, mostly due to WebKit.
git submodule update --init --recursive --progress --depth=1
make vendor jsc identifier-cache dev
```

#### Verify it worked (macOS)

First ensure the node dependencies are installed

```bash
cd integration/snippets
npm i
```

Then

```bash
# if you’re not already in the bun root directory
cd ../../
make test-dev-all
```

#### Troubleshooting (macOS)

If you see an error when compiling `libarchive`, run this:

```bash
brew install pkg-config
```

If you see an error about missing files on `zig build obj`, make sure you built the headers

## vscode-zig

Note: this is automatically installed on the devcontainer

You will want to install the fork of `vscode-zig` so you get a `Run test` and a `Debug test` button.

To do that:

```bash
curl -L https://github.com/Jarred-Sumner/vscode-zig/releases/download/fork-v1/zig-0.2.5.vsix > vscode-zig.vsix
code --install-extension vscode-zig.vsix
```

<a target="_blank" href="https://github.com/jarred-sumner/vscode-zig"><img src="https://pbs.twimg.com/media/FBZsKHlUcAYDzm5?format=jpg&name=large"></a>
