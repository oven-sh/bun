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
- `--publicPath`

{% /callout %}

# Embedding files

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
