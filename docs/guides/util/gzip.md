---
name: Compress and decompress data with gzip
---

Use `Bun.gzipSync()` to compress a `Uint8Array` with gzip.

```ts
const data = Buffer.from("Hello, world!");
const compressed = Bun.gzipSync(data);
// => Uint8Array

const decompressed = Bun.gunzipSync(compressed);
// => Uint8Array
```

---

See [Docs > API > Utils](/docs/api/utils) for more useful utilities.
