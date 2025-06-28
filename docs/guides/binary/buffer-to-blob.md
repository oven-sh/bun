---
name: Convert a Buffer to a blob
---

A [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) can be constructed from an array of "chunks", where each chunk is a string, binary data structure (including `Buffer`), or another `Blob`.

```ts
const buf = Buffer.from("hello");
const blob = new Blob([buf]);
```

---

See [Docs > API > Binary Data](https://bun.sh/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
