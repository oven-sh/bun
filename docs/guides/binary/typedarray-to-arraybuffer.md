---
name: Convert a Uint8Array to an ArrayBuffer
---

A [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) is a _typed array_ class, meaning it is a mechanism for viewing data in an underlying `ArrayBuffer`. The underlying `ArrayBuffer` is accessible via the `buffer` property.

```ts
const arr = new Uint8Array(64);
arr.buffer; // => ArrayBuffer(64)
```

---

The `Uint8Array` may be a view over a _subset_ of the data in the underlying `ArrayBuffer`. In this case, the `buffer` property will return the entire buffer, and the `byteOffset` and `byteLength` properties will indicate the subset.

```ts
const arr = new Uint8Array(64, 16, 32);
arr.buffer; // => ArrayBuffer(64)
arr.byteOffset; // => 16
arr.byteLength; // => 32
```

---

See [Docs > API > Binary Data](/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
