---
name: Convert a Uint8Array to a Blob
---

A [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) can be constructed from an array of "chunks", where each chunk is a string, binary data structure (including `Uint8Array`), or another `Blob`.

```ts
const arr = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
const blob = new Blob([arr]);
console.log(await blob.text());
// => "hello"
```

---

See [Docs > API > Binary Data](/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
