---
name: Convert a ReadableStream to an ArrayBuffer
---

Bun provides a number of convenience functions for reading the contents of a [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) into different formats.

```ts
const stream = new ReadableStream();
const buf = await Bun.readableStreamToArrayBuffer(stream);
```

---

See [Docs > API > Utils](https://bun.sh/docs/api/utils#bun-readablestreamto) for documentation on Bun's other `ReadableStream` conversion functions.
