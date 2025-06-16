---
name: Encode and decode base64 strings
---

Bun implements the `Buffer` API from Node which can be used for encoding and decoding strings

### Encoding and decoding with `Buffer`

```ts
const data = "hello world";
const encoded = Buffer.from(data, "utf-8").toString("base64"); // => "aGVsbG8gd29ybGQ="
const decoded = Buffer.from(encoded, "base64").toString("utf-8"); // => "hello world"
```

---

See [Docs > Binary Data](https://bun.sh/docs/api/binary-data#buffer) for a complete breakdown of the Buffer API.
