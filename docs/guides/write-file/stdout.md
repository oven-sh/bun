---
name: Write to stdout
---

The `console.log` function writes to `stdout`. It will automatically append a line break at the end of the printed data.

```ts
console.log("Lorem ipsum");
```

---

For more advanced use cases, Bun exposes `stdout` as a `BunFile` via the `Bun.stdout` property. This can be used as a destination for [`Bun.write()`](https://bun.sh/docs/api/file-io#writing-files-bun-write).

```ts
await Bun.write(Bun.stdout, "Lorem ipsum");
```

---

See [Docs > API > File I/O](https://bun.sh/docs/api/file-io#writing-files-bun-write) for complete documentation of `Bun.write()`.
