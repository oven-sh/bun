---
name: Check if the current file is the entrypoint
---

Bun provides a handful of module-specific utilities on the [`import.meta`](https://bun.com/docs/api/import-meta) object. Use `import.meta.main` to check if the current file is the entrypoint of the current process.

```ts#index.ts
if (import.meta.main) {
  // this file is directly executed with `bun run`
} else {
  // this file is being imported by another file
}
```

---

See [Docs > API > import.meta](https://bun.com/docs/api/import-meta) for complete documentation.
