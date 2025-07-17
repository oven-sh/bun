---
name: Convert an ArrayBuffer to a string
---

Bun implements the Web-standard [`TextDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder) class for converting between binary data types and strings.

```ts
const buf = new ArrayBuffer(64);
const decoder = new TextDecoder();
const str = decoder.decode(buf);
```

---

See [Docs > API > Binary Data](https://bun.com/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
