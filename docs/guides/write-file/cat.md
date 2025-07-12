---
name: Write a file to stdout
---

Bun exposes `stdout` as a `BunFile` with the `Bun.stdout` property. This can be used as a destination for [`Bun.write()`](https://bun.com/docs/api/file-io#writing-files-bun-write).

This code writes a file to `stdout` similar to the `cat` command in Unix.

```ts#cat.ts
const path = "/path/to/file.txt";
const file = Bun.file(path);
await Bun.write(Bun.stdout, file);
```

---

See [Docs > API > File I/O](https://bun.com/docs/api/file-io#writing-files-bun-write) for complete documentation of `Bun.write()`.
