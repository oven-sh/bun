---
name: Get the file name of the current file
---

Bun provides a handful of module-specific utilities on the [`import.meta`](https://bun.sh/docs/api/import-meta) object. Use `import.meta.file` to retrieve the name of the current file.

```ts#/a/b/c.ts
import.meta.file; // => "c.ts"
```

---

See [Docs > API > import.meta](https://bun.sh/docs/api/import-meta) for complete documentation.
