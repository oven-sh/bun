Bun's bundler implements a `--compile` flag for generating a standalone binary from a TypeScript or JavaScript file.

{% codetabs %}

```bash
$ bun build ./cli.ts --compile --outfile mycli
```

```ts#cli.ts
console.log("Hello world!");
```

{% /codetabs %}

This bundles `cli.ts` into an executable that can be executed directly:

```
$ ./mycli
Hello world!
```

All imported files and packages are bundled into the executable, along with a copy of the Bun runtime. All built-in Bun and Node.js APIs are supported.

## Cross-compile to other platforms

The `--target` flag lets you compile your standalone executable for a different operating system, architecture, or version of Bun than the machine you're running `bun build` on.

To build for Linux x64 (most servers):

```sh
bun build --compile --target=bun-linux-x64 ./index.ts --outfile myapp

# To support CPUs from before 2013, use the baseline version (nehalem)
bun build --compile --target=bun-linux-x64-baseline ./index.ts --outfile myapp

# To explicitly only support CPUs from 2013 and later, use the modern version (haswell)
# modern is faster, but baseline is more compatible.
bun build --compile --target=bun-linux-x64-modern ./index.ts --outfile myapp
```

To build for Linux ARM64 (e.g. Graviton or Raspberry Pi):

```sh
# Note: the default architecture is x64 if no architecture is specified.
bun build --compile --target=bun-linux-arm64 ./index.ts --outfile myapp
```

To build for Windows x64:

```sh
bun build --compile --target=bun-windows-x64 ./path/to/my/app.ts --outfile myapp

# To support CPUs from before 2013, use the baseline version (nehalem)
bun build --compile --target=bun-windows-x64-baseline ./path/to/my/app.ts --outfile myapp

# To explicitly only support CPUs from 2013 and later, use the modern version (haswell)
bun build --compile --target=bun-windows-x64-modern ./path/to/my/app.ts --outfile myapp

# note: if no .exe extension is provided, Bun will automatically add it for Windows executables
```

To build for macOS arm64:

```sh
bun build --compile --target=bun-darwin-arm64 ./path/to/my/app.ts --outfile myapp
```

To build for macOS x64:

```sh
bun build --compile --target=bun-darwin-x64 ./path/to/my/app.ts --outfile myapp
```

#### Supported targets

The order of the `--target` flag does not matter, as long as they're delimited by a `-`.

| --target              | Operating System | Architecture | Modern | Baseline |
| --------------------- | ---------------- | ------------ | ------ | -------- |
| bun-linux-x64         | Linux            | x64          | ✅     | ✅       |
| bun-linux-arm64       | Linux            | arm64        | ✅     | N/A      |
| bun-windows-x64       | Windows          | x64          | ✅     | ✅       |
| ~~bun-windows-arm64~~ | Windows          | arm64        | ❌     | ❌       |
| bun-darwin-x64        | macOS            | x64          | ✅     | ✅       |
| bun-darwin-arm64      | macOS            | arm64        | ✅     | N/A      |

On x64 platforms, Bun uses SIMD optimizations which require a modern CPU supporting AVX2 instructions. The `-baseline` build of Bun is for older CPUs that don't support these optimizations. Normally, when you install Bun we automatically detect which version to use but this can be harder to do when cross-compiling since you might not know the target CPU. You usually don't need to worry about it on Darwin x64, but it is relevant for Windows x64 and Linux x64. If you or your users see `"Illegal instruction"` errors, you might need to use the baseline version.

## Deploying to production

Compiled executables reduce memory usage and improve Bun's start time.

Normally, Bun reads and transpiles JavaScript and TypeScript files on `import` and `require`. This is part of what makes so much of Bun "just work", but it's not free. It costs time and memory to read files from disk, resolve file paths, parse, transpile, and print source code.

With compiled executables, you can move that cost from runtime to build-time.

When deploying to production, we recommend the following:

```sh
bun build --compile --minify --sourcemap ./path/to/my/app.ts --outfile myapp
```

**What do these flags do?**

The `--minify` argument optimizes the size of the transpiled output code. If you have a large application, this can save megabytes of space. For smaller applications, it might still improve start time a little.

The `--sourcemap` argument embeds a sourcemap compressed with zstd, so that errors & stacktraces point to their original locations instead of the transpiled location. Bun will automatically decompress & resolve the sourcemap when an error occurs.

## SQLite

You can use `bun:sqlite` imports with `bun build --compile`.

By default, the database is resolved relative to the current working directory of the process.

```js
import db from "./my.db" with { type: "sqlite" };

console.log(db.query("select * from users LIMIT 1").get());
```

That means if the executable is located at `/usr/bin/hello`, the user's terminal is located at `/home/me/Desktop`, it will look for `/home/me/Desktop/my.db`.

```
$ cd /home/me/Desktop
$ ./hello
```

## Embed assets & files

Standalone executables support embedding files.

To embed files into an executable with `bun build --compile`, import the file in your code

```ts
// this becomes an internal file path
import icon from "./icon.png" with { type: "file" };
import { file } from "bun";

export default {
  fetch(req) {
    // Embedded files can be streamed from Response objects
    return new Response(file(icon));
  },
};
```

Embedded files can be read using `Bun.file`'s functions or the Node.js `fs.readFile` function (in `"node:fs"`).

For example, to read the contents of the embedded file:

```js
import icon from "./icon.png" with { type: "file" };
import { file } from "bun";

const bytes = await file(icon).arrayBuffer();
```

### Embed SQLite databases

If your application wants to embed a SQLite database, set `type: "sqlite"` in the import attribute and the `embed` attribute to `"true"`.

```js
import myEmbeddedDb from "./my.db" with { type: "sqlite", embed: "true" };

console.log(myEmbeddedDb.query("select * from users LIMIT 1").get());
```

This database is read-write, but all changes are lost when the executable exits (since it's stored in memory).

### Embed N-API Addons

As of Bun v1.0.23, you can embed `.node` files into executables.

```js
const addon = require("./addon.node");

console.log(addon.hello());
```

Unfortunately, if you're using `@mapbox/node-pre-gyp` or other similar tools, you'll need to make sure the `.node` file is directly required or it won't bundle correctly.

## Minification

To trim down the size of the executable a little, pass `--minify` to `bun build --compile`. This uses Bun's minifier to reduce the code size. Overall though, Bun's binary is still way too big and we need to make it smaller.

## Unsupported CLI arguments

Currently, the `--compile` flag can only accept a single entrypoint at a time and does not support the following flags:

- `--outdir` — use `outfile` instead.
- `--splitting`
- `--public-path`
- `--target=node` or `--target=browser`
- `--format` - always outputs a binary executable. Internally, it's almost esm.
- `--no-bundle` - we always bundle everything into the executable.
