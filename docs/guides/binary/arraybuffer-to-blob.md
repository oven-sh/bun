---
name: Convert an ArrayBuffer to a Blob
---

A [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) can be constructed from an array of "chunks", where each chunk is a string, binary data structure, or another `Blob`.

```ts
const buf = new ArrayBuffer(64);
const blob = new Blob([buf]);
```

---

By default the `type` of the resulting `Blob` will be unset. This can be set manually.

```ts
const buf = new ArrayBuffer(64);
const blob = new Blob([buf], { type: "application/octet-stream" });
blob.type; // => "application/octet-stream"
```

---

See [Docs > API > Binary Data](/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
