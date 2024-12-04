Bun implements a set of native APIs on the `Bun` global object and through a number of built-in modules. These APIs are heavily optimized and represent the canonical "Bun-native" way to implement some common functionality.

Bun strives to implement standard Web APIs wherever possible. Bun introduces new APIs primarily for server-side tasks where no standard exists, such as file I/O and starting an HTTP server. In these cases, Bun's approach still builds atop standard APIs like `Blob`, `URL`, and `Request`.

```ts
Bun.serve({
  fetch(req: Request) {
    return new Response("Success!");
  },
});
```

Click the link in the right column to jump to the associated documentation.

{% table %}

- Topic
- APIs

---

- HTTP server
- [`Bun.serve`](https://bun.sh/docs/api/http#bun-serve)

---

- Bundler
- [`Bun.build`](https://bun.sh/docs/bundler)

---

- File I/O
- [`Bun.file`](https://bun.sh/docs/api/file-io#reading-files-bun-file)
  [`Bun.write`](https://bun.sh/docs/api/file-io#writing-files-bun-write)

---

- Child processes
- [`Bun.spawn`](https://bun.sh/docs/api/spawn#spawn-a-process-bun-spawn)
  [`Bun.spawnSync`](https://bun.sh/docs/api/spawn#blocking-api-bun-spawnsync)

---

- TCP
- [`Bun.listen`](https://bun.sh/docs/api/tcp#start-a-server-bun-listen)
  [`Bun.connect`](https://bun.sh/docs/api/tcp#start-a-server-bun-listen)

---

- Transpiler
- [`Bun.Transpiler`](https://bun.sh/docs/api/transpiler)

---

- Routing
- [`Bun.FileSystemRouter`](https://bun.sh/docs/api/file-system-router)

---

- Streaming HTML Transformations
- [`HTMLRewriter`](https://bun.sh/docs/api/html-rewriter)

---

- Hashing
- [`Bun.hash`](https://bun.sh/docs/api/hashing#bun-hash)
  [`Bun.CryptoHasher`](https://bun.sh/docs/api/hashing#bun-cryptohasher)

---

- import.meta
- [`import.meta`](https://bun.sh/docs/api/import-meta)

---

<!-- - [DNS](https://bun.sh/docs/api/dns)
- `Bun.dns`

--- -->

- SQLite
- [`bun:sqlite`](https://bun.sh/docs/api/sqlite)

---

- FFI
- [`bun:ffi`](https://bun.sh/docs/api/ffi)

---

- Testing
- [`bun:test`](https://bun.sh/docs/cli/test)

---

- Node-API
- [`Node-API`](https://bun.sh/docs/api/node-api)

---

- Glob
- [`Bun.Glob`](https://bun.sh/docs/api/glob)

---

- Utilities
- [`Bun.version`](https://bun.sh/docs/api/utils#bun-version)
  [`Bun.revision`](https://bun.sh/docs/api/utils#bun-revision)
  [`Bun.env`](https://bun.sh/docs/api/utils#bun-env)
  [`Bun.main`](https://bun.sh/docs/api/utils#bun-main)
  [`Bun.sleep()`](https://bun.sh/docs/api/utils#bun-sleep)
  [`Bun.sleepSync()`](https://bun.sh/docs/api/utils#bun-sleepsync)
  [`Bun.which()`](https://bun.sh/docs/api/utils#bun-which)
  [`Bun.peek()`](https://bun.sh/docs/api/utils#bun-peek)
  [`Bun.openInEditor()`](https://bun.sh/docs/api/utils#bun-openineditor)
  [`Bun.deepEquals()`](https://bun.sh/docs/api/utils#bun-deepequals)
  [`Bun.escapeHTML()`](https://bun.sh/docs/api/utils#bun-escapehtml)
  [`Bun.fileURLToPath()`](https://bun.sh/docs/api/utils#bun-fileurltopath)
  [`Bun.pathToFileURL()`](https://bun.sh/docs/api/utils#bun-pathtofileurl)
  [`Bun.gzipSync()`](https://bun.sh/docs/api/utils#bun-gzipsync)
  [`Bun.gunzipSync()`](https://bun.sh/docs/api/utils#bun-gunzipsync)
  [`Bun.deflateSync()`](https://bun.sh/docs/api/utils#bun-deflatesync)
  [`Bun.inflateSync()`](https://bun.sh/docs/api/utils#bun-inflatesync)
  [`Bun.inspect()`](https://bun.sh/docs/api/utils#bun-inspect)
  [`Bun.nanoseconds()`](https://bun.sh/docs/api/utils#bun-nanoseconds)
  [`Bun.readableStreamTo*()`](https://bun.sh/docs/api/utils#bun-readablestreamto)
  [`Bun.resolveSync()`](https://bun.sh/docs/api/utils#bun-resolvesync)

{% /table %}
