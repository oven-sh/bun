---
name: Write a Blob to a file
---

This code snippet writes a `Blob` to disk at a particular path.

It uses the fast [`Bun.write()`](/docs/api/file-io#writing-files-bun-write) API to efficiently write data to disk. The first argument is a _destination_, like an absolute path or `BunFile` instance. The second argument is the _data_ to write.

```ts
const path = "/path/to/file.txt";
await Bun.write(path, "Lorem ipsum");
```

---

The `BunFile` class extends `Blob`, so you can pass a `BunFile` directly into `Bun.write()` as well.

```ts
const path = "./out.txt";
const data = Bun.file("./in.txt");

// write the contents of ./in.txt to ./out.txt
await Bun.write(path, data);
```

---

See [Docs > API > File I/O](/docs/api/file-io#writing-files-bun-write) for complete documentation of `Bun.write()`.
