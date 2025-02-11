---
name: Convert a Blob to a DataView
---

The [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) class provides a number of methods for consuming its contents in different formats. This snippets reads the contents to an `ArrayBuffer`, then creates a `DataView` from the buffer.

```ts
const blob = new Blob(["hello world"]);
const arr = new DataView(await blob.arrayBuffer());
```

---

See [Docs > API > Binary Data](https://bun.sh/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
