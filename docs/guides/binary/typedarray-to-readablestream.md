---
name: Convert a Uint8Array to a ReadableStream
---

The naive approach to creating a [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) from a [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) is to use the [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) constructor and enqueue the entire array as a single chunk. For larger chunks, this may be undesirable as it isn't actually "streaming" the data.

```ts
const arr = new Uint8Array(64);
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(arr);
    controller.close();
  },
});
```

---

To stream the data in smaller chunks, first create a `Blob` instance from the `Uint8Array`. Then use the [`Blob.stream()`](https://developer.mozilla.org/en-US/docs/Web/API/Blob/stream) method to create a `ReadableStream` that streams the data in chunks of a specified size.

```ts
const arr = new Uint8Array(64);
const blob = new Blob([arr]);
const stream = blob.stream();
```

---

The chunk size can be set by passing a number to the `.stream()` method.

```ts
const arr = new Uint8Array(64);
const blob = new Blob([arr]);

// set chunk size of 1024 bytes
const stream = blob.stream(1024);
```

---

See [Docs > API > Binary Data](/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
