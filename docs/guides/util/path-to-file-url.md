---
name: Convert an absolute path to a file URL
---

Use `Bun.pathToFileURL()` to convert an absolute path to a `file://` URL.

```ts
Bun.pathToFileURL("/path/to/file.txt");
// => "file:///path/to/file.txt"
```

---

See [Docs > API > Utils](https://bun.sh/docs/api/utils) for more useful utilities.
