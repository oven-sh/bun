---
name: Convert a file URL to an absolute path
---

Use `Bun.fileURLToPath()` to convert a `file://` URL to an absolute path.

```ts
Bun.fileURLToPath("file:///path/to/file.txt");
// => "/path/to/file.txt"
```

---

See [Docs > API > Utils](https://bun.com/docs/api/utils) for more useful utilities.
