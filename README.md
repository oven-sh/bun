# Bun: a fast bundler & transpiler for developing web software

Bun is a new:

- JavaScript/TypeScript/JSX transpiler
- JavaScript & CSS bundler
- Development server with 60fps Hot Module Reloading (& WIP support for React Fast Refresh)
- JavaScript Runtime Environment (powered by JavaScriptCore, what WebKit/Safari uses)

All in one easy-to-use tool.

## Install:

```
# Global install is recommended so bun appears in your $PATH
npm install -g bun-cli
```

# Getting started

## Using Bun with Next.js

In your project folder root (where `package.json` is):

```bash
npm install bun-framework-next path buffer
bun bun --use next
open http://localhost:3000; bun dev --origin "http://localhost:3000"
```

Here are some features of Next.js that **aren't supported** yet:

- `getStaticPaths`. These functions will not be called.
- locales, zones, `assetPrefix` (workaround: change `--origin \"http://localhsot:3000/assetPrefixInhere\"`)
- `next/image` - `<Image />` component

Currently, any time you import new dependencies from `node_modules`, you will need to re-run `bun bun --use next`. This will eventually be automatic.

## Using Bun without a framework or with Create React App

In your project folder root (where `package.json` is):

```bash
bun bun ./entry-point-1.js ./entry-point-2.jsx
bun dev ./entry-point-1.js ./entry-point-2.jsx --origin https://localhost:3000
```

By default, `bun dev` will look for any HTML files in the `public` directory and serve that. For browsers navigating to the page, the `.html` file extension is optional in the URL, and `index.html` will automatically rewrite for the directory.

Here are examples of routing from `public/` and how they're matched:
| File Path | Dev Server URL |
| --------- | ------------- |
| public/dir/index.html | /dir |
| public/index.html | / |
| public/hi.html | /hi |
| public/file.html | /file |
| public/font/Inter.woff2 | /font/Inter.woff2 |

For **Create React App** users, note that Bun does not transpile HTML yet, so `%PUBLIC_URL%` will need to be replaced with '/'`.

From there, Bun relies on the filesystem for mapping dev server paths to source files. All URL paths are relative to the project root (where `package.json` is).

Here are examples of routing source code file paths:

| File Path                 | Dev Server URL             |
| ------------------------- | -------------------------- |
| src/components/Button.tsx | /src/components/Button.tsx |
| src/index.tsx             | /src/index.tsx             |
| pages/index.js            | /pages/index.js            |

## Using Bun without `bun dev`

`bun dev` is the recommended way to use Bun. Today, Bun is primarily intended to speed up your frontend development iteration cycle. `bun` does not implement a JavaScript minifier yet, and does not implement all the optimizations other tools do for shrinking bundle size. That means you probably should look to other tools for bundling in production. To make this split smoother, Bun strives for ecosystem compatibility (e.g. by integrating with Next.js)

```
bun bun ./entry-point-1.js ./entry-point-2.jsx
bun build ./entry-point-1.js ./entry-point-2.jsx --origin https://localhost:3000 --outdir=./out
```

You can also pass Bun a folder, and it will assume all JavaScript-like files are entry-points. This lets you use Bun's native filesystem router without a framework.

For a `routes` directory with these files:

- `routes/index.js`
- `routes/hello/bar.js`
- `routes/hello/baz.jsx`
- `routes/wut/wat.jsx`

This would be the corresponding command:

```bash
bun bun ./routes
bun build ./routes --outdir=./out
```

# The Bun Bundling Format

`bun bun` generates a `node_modules.bun` and (optionally) a `node_modules.server.bun`. This is a new binary file format that makes it very efficient to serialize/deserialize `node_modules`. With a 2.4 GHz 8-Core Intel Core i9, metadata for

Unlike many other bundlers, `Bun` only bundles `node_modules`. This is great for development, where most people add/update packages much less frequently than app code (which is also great for caching in browsers). To make that distinction clear, the filename defaults to `node_modules.bun`. We recommend storing `node_modules.bun` in your git repository. Since it's a binary file, it shouldn't clutter your git history and it will make your entire frontend development team move faster if they don't have to re-bundle dependencies.

# Things that don't work yet

| Feature                                                                                                                | In                    |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------- |
| [Private Class Fields](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_class_fields) | JavaScript Transpiler |
| [Import Assertions](https://github.com/tc39/proposal-import-assertions)                                                | JavaScript Transpiler |
| [`extends` in `tsconfig.json`](https://www.typescriptlang.org/tsconfig#extends)                                        | TypeScript Transpiler |
| Un-quoted `.env` string values                                                                                         | .env loader           |
| Sharing `.bun` files (must not write absolute paths)                                                                   | JavaScript Bundler    |

# Building from source

Estimated: 30-60 minutes :(

Compile Zig:

```bash
git clone https://github.com/jarred-sumner/zig
cd zig
git checkout jarred/zig-sloppy-with-small-structs
cmake . -DCMAKE_PREFIX_PATH=$(brew --prefix llvm) -DZIG_STATIC_LLVM=ON -DCMAKE_BUILD_TYPE=Release && make -j 16
```

Note that `brew install zig` won't work. Bun uses a build of Zig with a couple patches.

You'll want to make sure `zig` is in `$PATH`. The `zig` binary wil be in the same folder as the newly-cloned `zig` repo. If you use fish, you can run `fish_add_path (pwd)`.

In `bun`:

```bash
git submodule update --init --recursive --progress --depth=1
make vendor
zig build headers
zig build -Drelease-fast
```

# Credits

- While written in Zig instead of Go, Bun's JS transpiler & CSS lexer source code is based off of @evanw's esbuild project. @evanw did a fantastic job with esbuild.

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
