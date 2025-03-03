---
name: Delete files
---

To delete a file, use `Bun.file(path).delete()`.

```ts
// Delete a file
const file = Bun.file("path/to/file.txt");
await file.delete();

// Now the file doesn't exist
const exists = await file.exists();
// => false
```

---

See [Docs > API > FileSystem](https://bun.sh/docs/api/file-io) for more filesystem operations.
