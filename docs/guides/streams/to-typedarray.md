---
name: Convert a ReadableStream to a Uint8Array
---

Bun provides a number of convenience functions for reading the contents of a [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) into different formats. This snippet reads the contents of a `ReadableStream` to an [`ArrayBuffer`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer), then creates a [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) that points to the buffer.

```ts
const stream = new ReadableStream();
const buf = await Bun.readableStreamToArrayBuffer(stream);
const uint8 = new Uint8Array(buf);
```

---

See [Docs > API > Utils](/docs/api/utils#bun-readablestreamto) for documentation on Bun's other `ReadableStream` conversion functions.
