---
name: Check if a file exists
---

The `Bun.file()` function accepts a path and returns a `BunFile` instance. Use the `.exists()` method to check if a file exists at the given path.

```ts
const path = "/path/to/package.json";
const file = Bun.file(path);

file.exists(); // boolean;
```

---

Refer to [API > File I/O](/docs/api/file-io) for more information on working with `BunFile`.
