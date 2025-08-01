---
name: Convert a Blob to a ReadableStream
---

The [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) class provides a number of methods for consuming its contents in different formats, including `.stream()`. This returns `Promise<ReadableStream>`.

```ts
const blob = new Blob(["hello world"]);
const stream = await blob.stream();
```

---

See [Docs > API > Binary Data](https://bun.com/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
