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

{% callout %}

**Note** — Currently, the `--compile` flag can only accept a single entrypoint at a time and does not support the following flags:

- `--outdir` — use `outfile` instead.
- `--external`
- `--splitting`
- `--public-path`

{% /callout %}

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
import db from './my.db' with {type: "sqlite"};

console.log(db.query("select * from users LIMIT 1").get());
```

That means if the executable is located at `/usr/bin/hello`, the user's terminal is located at `/home/me/Desktop`, it will look for `/home/me/Desktop/my.db`.

```
$ cd /home/me/Desktop
$ ./hello
```

## Embedding files

Standalone executables support embedding files.

To embed files into an executable with `bun build --compile`, import the file in your code

```js
// this becomes an internal file path
import icon from "./icon.png";

import { file } from "bun";

export default {
  fetch(req) {
    return new Response(file(icon));
  },
};
```

You may need to specify a `--loader` for it to be treated as a `"file"` loader (so you get back a file path).

Embedded files can be read using `Bun.file`'s functions or the Node.js `fs.readFile` function (in `"node:fs"`).

### Embedding SQLite databases

If your application wants to embed a SQLite database, set `type: "sqlite"` in the import attribute and the `embed` attribute to `"true"`.

```js
import myEmbeddedDb from "./my.db" with {type: "sqlite", embed: "true"};

console.log(myEmbeddedDb.query("select * from users LIMIT 1").get());
```

This database is read-write, but all changes are lost when the executable exits (since it's stored in memory).

### Embedding N-API Addons

As of Bun v1.0.23, you can embed `.node` files into executables.

```js
const addon = require("./addon.node");

console.log(addon.hello());
```

Unfortunately, if you're using `@mapbox/node-pre-gyp` or other similar tools, you'll need to make sure the `.node` file is directly required or it won't bundle correctly.

## Minification

To trim down the size of the executable a little, pass `--minify` to `bun build --compile`. This uses Bun's minifier to reduce the code size. Overall though, Bun's binary is still way too big and we need to make it smaller.
