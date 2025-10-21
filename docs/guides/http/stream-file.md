---
name: Stream a file as an HTTP Response
---

This snippet reads a file from disk using [`Bun.file()`](https://bun.com/docs/api/file-io#reading-files-bun-file). This returns a `BunFile` instance, which can be passed directly into the `new Response` constructor.

```ts
const path = "/path/to/file.txt";
const file = Bun.file(path);
const resp = new Response(file);
```

---

The `Content-Type` is read from the file and automatically set on the `Response`.

```ts
new Response(Bun.file("./package.json")).headers.get("Content-Type");
// => application/json;charset=utf-8

new Response(Bun.file("./test.txt")).headers.get("Content-Type");
// => text/plain;charset=utf-8

new Response(Bun.file("./index.tsx")).headers.get("Content-Type");
// => text/javascript;charset=utf-8

new Response(Bun.file("./img.png")).headers.get("Content-Type");
// => image/png
```

---

Putting it all together with [`Bun.serve()`](https://bun.com/docs/api/http#bun-serve).

```ts
// static file server
Bun.serve({
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const file = Bun.file(path);
    return new Response(file);
  },
});
```

---

See [Docs > API > File I/O](https://bun.com/docs/api/file-io#writing-files-bun-write) for complete documentation of `Bun.write()`.
