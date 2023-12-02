---
name: Write a string to a file
---

This code snippet writes a string to disk at a particular _absolute path_.

It uses the fast [`Bun.write()`](/docs/api/file-io#writing-files-bun-write) API to efficiently write data to disk. The first argument is a _destination_; the second is the _data_ to write.

```ts
const path = "/path/to/file.txt";
await Bun.write(path, "Lorem ipsum");
```

---

Any relative paths will be resolved relative to the project root (the nearest directory containing a `package.json` file).

```ts
const path = "./file.txt";
await Bun.write(path, "Lorem ipsum");
```

---

You can pass a `BunFile` as the destination. `Bun.write()` will write the data to its associated path.

```ts
const path = Bun.file("./file.txt");
await Bun.write(path, "Lorem ipsum");
```

---

`Bun.write()` returns the number of bytes written to disk.

```ts
const path = "./file.txt";
const bytes = await Bun.write(path, "Lorem ipsum");
// => 11
```

---

See [Docs > API > File I/O](/docs/api/file-io#writing-files-bun-write) for complete documentation of `Bun.write()`.
