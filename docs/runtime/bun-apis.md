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
- [`Bun.serve`](https://bun.com/docs/api/http#bun-serve)

---

- Shell
- [`$`](https://bun.com/docs/runtime/shell)

---

- Bundler
- [`Bun.build`](https://bun.com/docs/bundler)

---

- File I/O
- [`Bun.file`](https://bun.com/docs/api/file-io#reading-files-bun-file), [`Bun.write`](https://bun.com/docs/api/file-io#writing-files-bun-write), `Bun.stdin`, `Bun.stdout`, `Bun.stderr`

---

- Child Processes
- [`Bun.spawn`](https://bun.com/docs/api/spawn#spawn-a-process-bun-spawn), [`Bun.spawnSync`](https://bun.com/docs/api/spawn#blocking-api-bun-spawnsync)

---

- TCP Sockets
- [`Bun.listen`](https://bun.com/docs/api/tcp#start-a-server-bun-listen), [`Bun.connect`](https://bun.com/docs/api/tcp#start-a-server-bun-listen)

---

- UDP Sockets
- [`Bun.udpSocket`](https://bun.com/docs/api/udp)

---

- WebSockets
- `new WebSocket()` (client), [`Bun.serve`](https://bun.com/docs/api/websockets) (server)

---

- Transpiler
- [`Bun.Transpiler`](https://bun.com/docs/api/transpiler)

---

- Routing
- [`Bun.FileSystemRouter`](https://bun.com/docs/api/file-system-router)

---

- Streaming HTML
- [`HTMLRewriter`](https://bun.com/docs/api/html-rewriter)

---

- Hashing
- [`Bun.password`](https://bun.com/docs/api/hashing#bun-password), [`Bun.hash`](https://bun.com/docs/api/hashing#bun-hash), [`Bun.CryptoHasher`](https://bun.com/docs/api/hashing#bun-cryptohasher), `Bun.sha`

---

- SQLite
- [`bun:sqlite`](https://bun.com/docs/api/sqlite)

---

- PostgreSQL Client
- [`Bun.SQL`](https://bun.com/docs/api/sql), `Bun.sql`

---

- Redis (Valkey) Client
- [`Bun.RedisClient`](https://bun.com/docs/api/redis), `Bun.redis`

---

- FFI (Foreign Function Interface)
- [`bun:ffi`](https://bun.com/docs/api/ffi)

---

- DNS
- [`Bun.dns.lookup`](https://bun.com/docs/api/dns), `Bun.dns.prefetch`, `Bun.dns.getCacheStats`

---

- Testing
- [`bun:test`](https://bun.com/docs/cli/test)

---

- Workers
- [`new Worker()`](https://bun.com/docs/api/workers)

---

- Module Loaders
- [`Bun.plugin`](https://bun.com/docs/bundler/plugins)

---

- Glob
- [`Bun.Glob`](https://bun.com/docs/api/glob)

---

- Cookies
- [`Bun.Cookie`](https://bun.com/docs/api/cookie), [`Bun.CookieMap`](https://bun.com/docs/api/cookie)

---

- Node-API
- [`Node-API`](https://bun.com/docs/api/node-api)

---

- `import.meta`
- [`import.meta`](https://bun.com/docs/api/import-meta)

---

- Utilities
- [`Bun.version`](https://bun.com/docs/api/utils#bun-version), [`Bun.revision`](https://bun.com/docs/api/utils#bun-revision), [`Bun.env`](https://bun.com/docs/api/utils#bun-env), [`Bun.main`](https://bun.com/docs/api/utils#bun-main)

---

- Sleep & Timing
- [`Bun.sleep()`](https://bun.com/docs/api/utils#bun-sleep), [`Bun.sleepSync()`](https://bun.com/docs/api/utils#bun-sleepsync), [`Bun.nanoseconds()`](https://bun.com/docs/api/utils#bun-nanoseconds)

---

- Random & UUID
- [`Bun.randomUUIDv7()`](https://bun.com/docs/api/utils#bun-randomuuidv7)

---

- System & Environment
- [`Bun.which()`](https://bun.com/docs/api/utils#bun-which)

---

- Comparison & Inspection
- [`Bun.peek()`](https://bun.com/docs/api/utils#bun-peek), [`Bun.deepEquals()`](https://bun.com/docs/api/utils#bun-deepequals), `Bun.deepMatch`, [`Bun.inspect()`](https://bun.com/docs/api/utils#bun-inspect)

---

- String & Text Processing
- [`Bun.escapeHTML()`](https://bun.com/docs/api/utils#bun-escapehtml), [`Bun.stringWidth()`](https://bun.com/docs/api/utils#bun-stringwidth), `Bun.indexOfLine`

---

- URL & Path Utilities
- [`Bun.fileURLToPath()`](https://bun.com/docs/api/utils#bun-fileurltopath), [`Bun.pathToFileURL()`](https://bun.com/docs/api/utils#bun-pathtofileurl)

---

- Compression
- [`Bun.gzipSync()`](https://bun.com/docs/api/utils#bun-gzipsync), [`Bun.gunzipSync()`](https://bun.com/docs/api/utils#bun-gunzipsync), [`Bun.deflateSync()`](https://bun.com/docs/api/utils#bun-deflatesync), [`Bun.inflateSync()`](https://bun.com/docs/api/utils#bun-inflatesync), `Bun.zstdCompressSync()`, `Bun.zstdDecompressSync()`, `Bun.zstdCompress()`, `Bun.zstdDecompress()`

---

- Stream Processing
- [`Bun.readableStreamTo*()`](https://bun.com/docs/api/utils#bun-readablestreamto), `Bun.readableStreamToBytes()`, `Bun.readableStreamToBlob()`, `Bun.readableStreamToFormData()`, `Bun.readableStreamToJSON()`, `Bun.readableStreamToArray()`

---

- Memory & Buffer Management
- `Bun.ArrayBufferSink`, `Bun.allocUnsafe`, `Bun.concatArrayBuffers`

---

- Module Resolution
- [`Bun.resolveSync()`](https://bun.com/docs/api/utils#bun-resolvesync)

---

- Parsing & Formatting
- [`Bun.semver`](https://bun.com/docs/api/semver), `Bun.TOML.parse`, [`Bun.YAML.parse`](https://bun.com/docs/api/yaml), [`Bun.color`](https://bun.com/docs/api/color)

---

- Low-level / Internals
- `Bun.mmap`, `Bun.gc`, `Bun.generateHeapSnapshot`, [`bun:jsc`](https://bun.com/reference/bun/jsc)

---

{% /table %}
