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

- HTTP Server
- [`Bun.serve`](https://bun.sh/docs/api/http#bun-serve)

---

- Shell
- [`$`](https://bun.sh/docs/runtime/shell)

---

- Bundler
- [`Bun.build`](https://bun.sh/docs/bundler)

---

- File I/O
- [`Bun.file`](https://bun.sh/docs/api/file-io#reading-files-bun-file), [`Bun.write`](https://bun.sh/docs/api/file-io#writing-files-bun-write), `Bun.stdin`, `Bun.stdout`, `Bun.stderr`

---

- Child Processes
- [`Bun.spawn`](https://bun.sh/docs/api/spawn#spawn-a-process-bun-spawn), [`Bun.spawnSync`](https://bun.sh/docs/api/spawn#blocking-api-bun-spawnsync)

---

- TCP Sockets
- [`Bun.listen`](https://bun.sh/docs/api/tcp#start-a-server-bun-listen), [`Bun.connect`](https://bun.sh/docs/api/tcp#start-a-server-bun-listen)

---

- UDP Sockets
- [`Bun.udpSocket`](https://bun.sh/docs/api/udp)

---

- WebSockets
- `new WebSocket()` (client), [`Bun.serve`](https://bun.sh/docs/api/websockets) (server)

---

- Transpiler
- [`Bun.Transpiler`](https://bun.sh/docs/api/transpiler)

---

- Routing
- [`Bun.FileSystemRouter`](https://bun.sh/docs/api/file-system-router)

---

- Streaming HTML
- [`HTMLRewriter`](https://bun.sh/docs/api/html-rewriter)

---

- Hashing
- [`Bun.password`](https://bun.sh/docs/api/hashing#bun-password), [`Bun.hash`](https://bun.sh/docs/api/hashing#bun-hash), [`Bun.CryptoHasher`](https://bun.sh/docs/api/hashing#bun-cryptohasher), `Bun.sha`

---

- SQLite
- [`bun:sqlite`](https://bun.sh/docs/api/sqlite)

---

- PostgreSQL Client
- [`Bun.SQL`](https://bun.sh/docs/api/sql), `Bun.sql`

---

- Redis (Valkey) Client
- [`Bun.RedisClient`](https://bun.sh/docs/api/redis), `Bun.redis`

---

- FFI (Foreign Function Interface)
- [`bun:ffi`](https://bun.sh/docs/api/ffi)

---

- DNS
- [`Bun.dns.lookup`](https://bun.sh/docs/api/dns), `Bun.dns.prefetch`, `Bun.dns.getCacheStats`

---

- Testing
- [`bun:test`](https://bun.sh/docs/cli/test)

---

- Workers
- [`new Worker()`](https://bun.sh/docs/api/workers)

---

- Module Loaders
- [`Bun.plugin`](https://bun.sh/docs/bundler/plugins)

---

- Glob
- [`Bun.Glob`](https://bun.sh/docs/api/glob)

---

- Cookies
- [`Bun.Cookie`](https://bun.sh/docs/api/cookie), [`Bun.CookieMap`](https://bun.sh/docs/api/cookie)

---

- Node-API
- [`Node-API`](https://bun.sh/docs/api/node-api)

---

- `import.meta`
- [`import.meta`](https://bun.sh/docs/api/import-meta)

---

- Utilities
- [`Bun.version`](https://bun.sh/docs/api/utils#bun-version), [`Bun.revision`](https://bun.sh/docs/api/utils#bun-revision), [`Bun.env`](https://bun.sh/docs/api/utils#bun-env), [`Bun.main`](https://bun.sh/docs/api/utils#bun-main)

---

- Sleep & Timing
- [`Bun.sleep()`](https://bun.sh/docs/api/utils#bun-sleep), [`Bun.sleepSync()`](https://bun.sh/docs/api/utils#bun-sleepsync), [`Bun.nanoseconds()`](https://bun.sh/docs/api/utils#bun-nanoseconds)

---

- Random & UUID
- [`Bun.randomUUIDv7()`](https://bun.sh/docs/api/utils#bun-randomuuidv7)

---

- System & Environment
- [`Bun.which()`](https://bun.sh/docs/api/utils#bun-which)

---

- Comparison & Inspection
- [`Bun.peek()`](https://bun.sh/docs/api/utils#bun-peek), [`Bun.deepEquals()`](https://bun.sh/docs/api/utils#bun-deepequals), `Bun.deepMatch`, [`Bun.inspect()`](https://bun.sh/docs/api/utils#bun-inspect)

---

- String & Text Processing
- [`Bun.escapeHTML()`](https://bun.sh/docs/api/utils#bun-escapehtml), [`Bun.stringWidth()`](https://bun.sh/docs/api/utils#bun-stringwidth), `Bun.indexOfLine`

---

- URL & Path Utilities
- [`Bun.fileURLToPath()`](https://bun.sh/docs/api/utils#bun-fileurltopath), [`Bun.pathToFileURL()`](https://bun.sh/docs/api/utils#bun-pathtofileurl)

---

- Compression
- [`Bun.gzipSync()`](https://bun.sh/docs/api/utils#bun-gzipsync), [`Bun.gunzipSync()`](https://bun.sh/docs/api/utils#bun-gunzipsync), [`Bun.deflateSync()`](https://bun.sh/docs/api/utils#bun-deflatesync), [`Bun.inflateSync()`](https://bun.sh/docs/api/utils#bun-inflatesync), `Bun.zstdCompressSync()`, `Bun.zstdDecompressSync()`, `Bun.zstdCompress()`, `Bun.zstdDecompress()`

---

- Stream Processing
- [`Bun.readableStreamTo*()`](https://bun.sh/docs/api/utils#bun-readablestreamto), `Bun.readableStreamToBytes()`, `Bun.readableStreamToBlob()`, `Bun.readableStreamToFormData()`, `Bun.readableStreamToJSON()`, `Bun.readableStreamToArray()`

---

- Memory & Buffer Management
- `Bun.ArrayBufferSink`, `Bun.allocUnsafe`, `Bun.concatArrayBuffers`

---

- Module Resolution
- [`Bun.resolveSync()`](https://bun.sh/docs/api/utils#bun-resolvesync)

---

- Parsing & Formatting
- [`Bun.semver`](https://bun.sh/docs/api/semver), `Bun.TOML.parse`, [`Bun.color`](https://bun.sh/docs/api/color)

---

- Low-level / Internals
- `Bun.mmap`, `Bun.gc`, `Bun.generateHeapSnapshot`, [`bun:jsc`](https://bun.sh/docs/api/bun-jsc)

---

{% /table %}
