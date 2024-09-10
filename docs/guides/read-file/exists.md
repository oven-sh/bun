---
name: Check if a file exists
---

The `Bun.file()` function accepts a path and returns a `BunFile` instance. Use the `.exists()` method to check if a file exists at the given path.

```ts
const path = "/path/to/package.json";
const file = Bun.file(path);

await file.exists(); // boolean;
```

---

Refer to [API > File I/O](https://bun.sh/docs/api/file-io) for more information on working with `BunFile`.
