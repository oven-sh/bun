---
name: Get the absolute path of the current file
---

Bun provides a handful of module-specific utilities on the [`import.meta`](/docs/api/import-meta) object. Use `import.meta.path` to retreive the absolute path of the current file.

```ts#/a/b/c.ts
import.meta.path; // => "/a/b/c.ts"
```

---

See [Docs > API > import.meta](/docs/api/import-meta) for complete documentation.
