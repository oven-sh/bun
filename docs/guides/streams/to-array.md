---
name: Convert a ReadableStream to an array of chunks
---

Bun provides a number of convenience functions for reading the contents of a [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) into different formats. The `Bun.readableStreamToArray` function reads the contents of a `ReadableStream` to an array of chunks.

```ts
const stream = new ReadableStream();
const str = await Bun.readableStreamToArray(stream);
```

---

See [Docs > API > Utils](https://bun.com/docs/api/utils#bun-readablestreamto) for documentation on Bun's other `ReadableStream` conversion functions.
