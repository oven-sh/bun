---
name: Convert a DataView to a string
---

If a [`DataView`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView) contains ASCII-encoded text, you can convert it to a string using the [`TextDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder) class.

```ts
const dv: DataView = ...;
const decoder = new TextDecoder();
const str = decoder.decode(dv);
```

---

See [Docs > API > Binary Data](https://bun.sh/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
