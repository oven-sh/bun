---
name: Convert a Uint8Array to a Buffer
---

The [`Buffer`](https://nodejs.org/api/buffer.html) class extends [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) with a number of additional methods. Use `Buffer.from()` to create a `Buffer` instance from a `Uint8Array`.

```ts
const arr: Uint8Array = ...
const buf = Buffer.from(arr);
```

---

See [Docs > API > Binary Data](/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
