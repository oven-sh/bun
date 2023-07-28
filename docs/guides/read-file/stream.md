---
name: Read a file as a ReadableStream
---

The `Bun.file()` function accepts a path and returns a `BunFile` instance. The `BunFile` class extends `Blob` and allows you to lazily read the file in a variety of formats. Use `.stream()` to consume the file incrementally as a `ReadableStream`.

```ts
const path = "/path/to/package.json";
const file = Bun.file(path);

const stream = await file.stream();
```

---

The chunks of the stream can be consumed with `for await`.

```ts
for await (const chunk of stream.values()) {
  chunk; // => Uint8Array
}
```

---

Refer to the [Streams](/docs/api/streams) documentation for more information on working with streams in Bun.
