---
name: Read a file to an ArrayBuffer
---

The `Bun.file()` function accepts a path and returns a `BunFile` instance. The `BunFile` class extends `Blob` and allows you to lazily read the file in a variety of formats. Use `.arrayBuffer()` to read the file as an `ArrayBuffer`.

```ts
const path = "/path/to/package.json";
const file = Bun.file(path);

const buffer = await file.arrayBuffer();
```

---

The binary content in the `ArrayBuffer` can then be read as a typed array, such as `Int8Array`. For `Uint8Array`, use [`.bytes()`](./uint8array).

```ts
const buffer = await file.arrayBuffer();
const bytes = new Int8Array(buffer);

bytes[0];
bytes.length;
```

---

Refer to the [Typed arrays](/docs/api/binary-data#typedarray) docs for more information on working with typed arrays in Bun.
