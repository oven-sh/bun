---
name: Read a file to a Uint8Array
---

The `Bun.file()` function accepts a path and returns a `BunFile` instance. The `BunFile` class extends `Blob` and allows you to lazily read the file in a variety of formats.

To read the file into a `Uint8Array` instance, retrieve the contents of the `BunFile` as an `ArrayBuffer` with `.arrayBuffer()`, then pass it into the `Uint8Array` constructor.

```ts
const path = "/path/to/package.json";
const file = Bun.file(path);

const arrBuffer = await file.arrayBuffer();
const byteArray = new Uint8Array(arrBuffer);

byteArray[0]; // first byteArray
byteArray.length; // length of byteArray
```

---

Refer to [API > Binary data > Typed arrays](/docs/api/binary-data#typedarray) for more information on working with `Uint8Array` and other binary data formats in Bun.
