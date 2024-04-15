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
- [`Bun.serve`](/docs/api/http#bun-serve)

---

- Bundler
- [`Bun.build`](/docs/bundler)

---

- File I/O
- [`Bun.file`](/docs/api/file-io#reading-files-bun-file)
  [`Bun.write`](/docs/api/file-io#writing-files-bun-write)

---

- Child processes
- [`Bun.spawn`](/docs/api/spawn#spawn-a-process-bun-spawn)
  [`Bun.spawnSync`](/docs/api/spawn#blocking-api-bun-spawnsync)

---

- TCP
- [`Bun.listen`](/docs/api/tcp#start-a-server-bun-listen)
  [`Bun.connect`](/docs/api/tcp#start-a-server-bun-listen)

---

- Transpiler
- [`Bun.Transpiler`](/docs/api/transpiler)

---

- Routing
- [`Bun.FileSystemRouter`](/docs/api/file-system-router)

---

- Streaming HTML Transformations
- [`HTMLRewriter`](/docs/api/html-rewriter)

---

- Hashing
- [`Bun.hash`](/docs/api/hashing#bun-hash)
  [`Bun.CryptoHasher`](/docs/api/hashing#bun-cryptohasher)

---

- import.meta
- [`import.meta`](/docs/api/import-meta)

---

<!-- - [DNS](/docs/api/dns)
- `Bun.dns`

--- -->

- SQLite
- [`bun:sqlite`](/docs/api/sqlite)

---

- FFI
- [`bun:ffi`](/docs/api/ffi)

---

- Testing
- [`bun:test`](/docs/cli/test)

---

- Node-API
- [`Node-API`](/docs/api/node-api)

---

- Glob
- [`Bun.Glob`](/docs/api/glob)

---

- Utilities
- [`Bun.version`](/docs/api/utils#bun-version)
  [`Bun.revision`](/docs/api/utils#bun-revision)
  [`Bun.env`](/docs/api/utils#bun-env)
  [`Bun.main`](/docs/api/utils#bun-main)
  [`Bun.sleep()`](/docs/api/utils#bun-sleep)
  [`Bun.sleepSync()`](/docs/api/utils#bun-sleepsync)
  [`Bun.which()`](/docs/api/utils#bun-which)
  [`Bun.peek()`](/docs/api/utils#bun-peek)
  [`Bun.openInEditor()`](/docs/api/utils#bun-openineditor)
  [`Bun.deepEquals()`](/docs/api/utils#bun-deepequals)
  [`Bun.escapeHTML()`](/docs/api/utils#bun-escapehtml)
  [`Bun.fileURLToPath()`](/docs/api/utils#bun-fileurltopath)
  [`Bun.pathToFileURL()`](/docs/api/utils#bun-pathtofileurl)
  [`Bun.gzipSync()`](/docs/api/utils#bun-gzipsync)
  [`Bun.gunzipSync()`](/docs/api/utils#bun-gunzipsync)
  [`Bun.deflateSync()`](/docs/api/utils#bun-deflatesync)
  [`Bun.inflateSync()`](/docs/api/utils#bun-inflatesync)
  [`Bun.inspect()`](/docs/api/utils#bun-inspect)
  [`Bun.nanoseconds()`](/docs/api/utils#bun-nanoseconds)
  [`Bun.readableStreamTo*()`](/docs/api/utils#bun-readablestreamto)
  [`Bun.resolveSync()`](/docs/api/utils#bun-resolvesync)

{% /table %}
