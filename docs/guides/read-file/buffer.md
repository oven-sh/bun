---
name: Read a file to a Buffer
---

The `Bun.file()` function accepts a path and returns a `BunFile` instance. The `BunFile` class extends `Blob` and allows you to lazily read the file in a variety of formats.

To read the file into a `Buffer` instance, first use `.arrayBuffer()` to consume the file as an `ArrayBuffer`, then use `Buffer.from()` to create a `Buffer` from the `ArrayBuffer`.

```ts
const path = "/path/to/package.json";
const file = Bun.file(path);

const arrbuf = await file.arrayBuffer();
const buffer = Buffer.from(arrbuf);
```

---

Refer to [Binary data > Buffer](https://bun.sh/docs/api/binary-data#buffer) for more information on working with `Buffer` and other binary data formats in Bun.
