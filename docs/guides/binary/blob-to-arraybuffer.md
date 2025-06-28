---
name: Convert a Blob to an ArrayBuffer
---

The [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) class provides a number of methods for consuming its contents in different formats, including `.arrayBuffer()`.

```ts
const blob = new Blob(["hello world"]);
const buf = await blob.arrayBuffer();
```

---

See [Docs > API > Binary Data](https://bun.sh/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
