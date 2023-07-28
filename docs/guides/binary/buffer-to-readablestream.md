---
name: Convert a Buffer to a ReadableStream
---

The naive approach to creating a [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) from a [`Buffer`](https://nodejs.org/api/buffer.html) is to use the `ReadableStream` constructor and enqueue the entire array as a single chunk. For a large buffer, this may be undesirable as this approach does not "streaming" the data in smaller chunks.

```ts
const buf = Buffer.from("hello world");
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(buf);
    controller.close();
  },
});
```

---

To stream the data in smaller chunks, first create a `Blob` instance from the `Buffer`. Then use the [`Blob.stream()`](https://developer.mozilla.org/en-US/docs/Web/API/Blob/stream) method to create a `ReadableStream` that streams the data in chunks of a specified size.

```ts
const buf = Buffer.from("hello world");
const blob = new Blob([buf]);
const stream = blob.stream();
```

---

The chunk size can be set by passing a number to the `.stream()` method.

```ts
const buf = Buffer.from("hello world");
const blob = new Blob([buf]);

// set chunk size of 1024 bytes
const stream = blob.stream(1024);
```

---

See [Docs > API > Binary Data](/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
