---
name: Convert a Uint8Array to a DataView
---

A [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) is a _typed array_ class, meaning it is a mechanism for viewing data in an underlying `ArrayBuffer`. The following snippet creates a [`DataView`] instance over the same range of data as the `Uint8Array`.

```ts
const arr: Uint8Array = ...
const dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
```

---

See [Docs > API > Binary Data](/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
