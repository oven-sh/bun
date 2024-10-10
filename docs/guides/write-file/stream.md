---
name: Write a ReadableStream to a file
---

To write a `ReadableStream` to disk, first create a `Response` instance from the stream. This `Response` can then be written to disk using [`Bun.write()`](https://bun.sh/docs/api/file-io#writing-files-bun-write).

```ts
const stream: ReadableStream = ...;
const path = "./file.txt";
const response = new Response(stream);

await Bun.write(path, response);
```

---

See [Docs > API > File I/O](https://bun.sh/docs/api/file-io#writing-files-bun-write) for complete documentation of `Bun.write()`.
