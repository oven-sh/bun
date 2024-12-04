---
name: Convert a Buffer to an ArrayBuffer
---

The Node.js [`Buffer`](https://nodejs.org/api/buffer.html) class provides a way to view and manipulate data in an underlying `ArrayBuffer`, which is available via the `buffer` property.

```ts
const nodeBuf = Buffer.alloc(64);
const arrBuf = nodeBuf.buffer;
```

---

See [Docs > API > Binary Data](https://bun.sh/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
