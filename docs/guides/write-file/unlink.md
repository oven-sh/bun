---
name: Delete a file
---

The `Bun.file()` function accepts a path and returns a `BunFile` instance. Use the `.delete()` method to delete the file.

```ts
const path = "/path/to/file.txt";
const file = Bun.file(path);

await file.delete();
```

---

See [Docs > API > File I/O](https://bun.com/docs/api/file-io#reading-files-bun-file) for complete documentation of `Bun.file()`.
