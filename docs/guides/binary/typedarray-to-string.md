---
name: Convert a Uint8Array to a string
---

Bun implements the Web-standard [`TextDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder) class for converting from binary data types like `Uint8Array` and strings.

```ts
const arr = new Uint8Array([104, 101, 108, 108, 111]);
const decoder = new TextDecoder();
const str = decoder.decode(arr);
// => "hello"
```

---

See [Docs > API > Binary Data](https://bun.com/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
