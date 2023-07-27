---
name: Compress and decompress data with DEFLATE
---

Use `Bun.deflateSync()` to compress a `Uint8Array` with DEFLATE.

```ts
const data = Buffer.from("Hello, world!");
const compressed = Bun.deflateSync("Hello, world!");
// => Uint8Array

const decompressed = Bun.inflateSync(compressed);
// => Uint8Array
```

---

See [Docs > API > Utils](/docs/api/utils) for more useful utilities.
