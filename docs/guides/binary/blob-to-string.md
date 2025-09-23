---
name: Convert a Blob to a string
---

The [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) class provides a number of methods for consuming its contents in different formats, including `.text()`.

```ts
const blob = new Blob(["hello world"]);
const str = await blob.text();
// => "hello world"
```

---

See [Docs > API > Binary Data](https://bun.com/docs/api/binary-data#conversion) for complete documentation on manipulating binary data with Bun.
