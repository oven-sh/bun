---
name: Convert a ReadableStream to a Buffer
---

Bun provides a number of convenience functions for reading the contents of a [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) into different formats. This snippet reads the contents of a `ReadableStream` to an [`ArrayBuffer`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer), then creates a [`Buffer`](https://nodejs.org/api/buffer.html) that points to it.

```ts
const stream = new ReadableStream();
const arrBuf = await Bun.readableStreamToArrayBuffer(stream);
const nodeBuf = Buffer.from(arrBuf);
```

---

See [Docs > API > Utils](/docs/api/utils#bun-readablestreamto) for documentation on Bun's other `ReadableStream` conversion functions.
