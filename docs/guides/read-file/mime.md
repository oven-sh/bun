---
name: Get the MIME type of a file
---

The `Bun.file()` function accepts a path and returns a `BunFile` instance. The `BunFile` class extends `Blob`, so use the `.type` property to read the MIME type.

```ts
const file = Bun.file("./package.json");
file.type; // application/json

const file = Bun.file("./index.html");
file.type; // text/html

const file = Bun.file("./image.png");
file.type; // image/png
```

---

Refer to [API > File I/O](https://bun.sh/docs/api/file-io) for more information on working with `BunFile`.
