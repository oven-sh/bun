---
name: Write a file incrementally
---

Bun provides an API for incrementally writing to a file. This is useful for writing large files, or for writing to a file over a long period of time.

Call `.writer()` on a `BunFile` to retrieve a `FileSink` instance. This instance can be used to efficiently buffer data and periodically "flush" it to disk. You can write & flush many times.

```ts
const file = Bun.file("/path/to/file.txt");
const writer = file.writer();

writer.write("lorem");
writer.write("ipsum");
writer.write("dolor");

writer.flush();

// continue writing & flushing
```

---

The `.write()` method can accept strings or binary data.

```ts
w.write("hello");
w.write(Buffer.from("there"));
w.write(new Uint8Array([0, 255, 128]));
writer.flush();
```

---

The `FileSink` will also auto-flush when its internal buffer is full. You can configure the buffer size with the `highWaterMark` option.

```ts
const file = Bun.file("/path/to/file.txt");
const writer = file.writer({ highWaterMark: 1024 * 1024 }); // 1MB
```

---

When you're done writing to the file, call `.end()` to auto-flush the buffer and close the file.

```ts
writer.end();
```

---

Full documentation: [FileSink](/docs/api/file-io#incremental-writing-with-filesink).
