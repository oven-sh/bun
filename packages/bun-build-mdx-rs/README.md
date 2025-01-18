# bun-build-mdx-rs

This is a proof of concept for using a third-party native addon in `Bun.build()`.

This uses `mdxjs-rs` to convert MDX to JSX.

TODO: **This needs to be built & published to npm.**

## Building locally:

```sh
cargo build --release
```

```js
import { build } from "bun";
import mdx from "./index.js";

// TODO: This needs to be prebuilt for the current platform
// Probably use a napi-rs template for this
import addon from "./target/release/libmdx_bun.dylib" with { type: "file" };

const results = await build({
  entrypoints: ["./hello.jsx"],
  plugins: [mdx({ addon })],
  minify: true,
  outdir: "./dist",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

console.log(results);
```
