# Streams Rewrite — Acceptance Test Surface

Scope: what in `test/` must pass (or start passing) when Web Streams are rewritten in C++.
Generated 2026-07-01 from a read-only scan of this checkout.

---

## 1) Web Platform Tests (WPT)

**There is NO vendored WPT snapshot for Web Streams in this repo.** That is the single most
important gap in the acceptance surface: nothing in `test/` runs upstream
`streams/readable-streams`, `streams/writable-streams`, `streams/transform-streams`,
`streams/readable-byte-streams`, `streams/queuing-strategies`, or `streams/piping`.

What *does* exist, WPT-wise:

| Location | What it is | Streams coverage |
| --- | --- | --- |
| `test/js/third_party/wpt-h2/` | Vendored WPT **fetch** `.h2.any.js` files (byte-identical to upstream `web-platform-tests/wpt @ ebf8e306`), driven by `run.test.ts` + a local `testharness-shim.ts` and `server.ts`; results recorded in `RESULTS.md` | None (fetch/h2 only) — but this is the **existing in-repo pattern for vendoring WPT**: shim `testharness.js` primitives, ship the upstream `.any.js` verbatim, keep a `RESULTS.md`. |
| `test/bundler/css/wpt/` | WPT CSS parsing data for the bundler | None |
| `test/js/node/test/common/wpt/` (`worker.js` only) | Node's WPT helper stub, vendored with the node test suite | None — Node's actual `test/wpt/` runner + `test/fixtures/wpt/streams/` snapshot were **not** vendored |
| `test/napi/node-napi-tests/test/common/wpt.js` | Same, for the napi node-test vendor | None |
| `test/js/web/encoding/text-decoder-wpt.test.ts`, `test/js/web/urlpattern/urlpattern.test.ts`, `test/js/bun/crypto/wpt-webcrypto.generateKey.test.ts` | Hand-ported WPT data for encoding/urlpattern/webcrypto | None |

**Expectations / skip lists.** The repo-wide expectations file is `test/expectations.txt`
(WebKit TestExpectations format; 282 lines). Since there is no streams WPT, there is no
streams-WPT failure list to flip. The stream-adjacent entries that DO exist there are:

```
# Vendored node v26.3.0 stream tests blocked on missing native subsystems (see PR #31826)
test/js/node/test/parallel/test-stream-pipeline.js [ SKIP ] # block at L271 hangs: pipeline(rs, req) writes 11x'hello' raw after a never-ended GET's \r\n\r\n; node's llhttp rejects lowercase 'h' as a method char (HPE_INVALID_METHOD -> clientError -> 400+close -> req 'close' -> pipeline callback fires), but bun's uWS HttpParser buffers any incomplete run of valid tchars waiting for the request-line, so the connection stays open and the callback never fires. Pre-existing server-parser leniency; needs uWS HttpParser to reject non-uppercase method bytes like llhttp.
test/js/node/test/parallel/test-stream-wrap.js [ FAIL ] # needs internal/test/binding + js_stream (net.Socket({handle}) libuv compat layer)
test/js/node/test/parallel/test-stream-wrap-drain.js [ FAIL ] # needs internal/js_stream_socket (net.Socket({handle}) libuv compat layer)
test/js/node/test/parallel/test-stream-wrap-encoding.js [ FAIL ] # needs internal/js_stream_socket (net.Socket({handle}) libuv compat layer)
[ ASAN ] test/js/web/streams/streams-leak.test.ts [ LEAK ] # Absolute memory usage remains relatively constant when reading and writing to a pipe
[ ASAN ] test/js/web/fetch/fetch-leak.test.ts [ LEAK ]
[ ASAN ] test/js/bun/spawn/spawn.test.ts [ TIMEOUT ]
test/js/bun/spawn/spawn-maxbuf.test.ts [ FLAKY ]
```

None of those are WHATWG-Streams spec failures; they are node-compat / ASAN / harness entries.

**Closest thing to a WPT-for-streams today** is the vendored Node v26 test suite's
WHATWG-webstream tests (Node ports many WPT cases into these by hand). All run through the
node-test harness and are NOT in the skip list, i.e. they currently pass and must keep passing:

- `test/js/node/test/parallel/test-whatwg-readablestream.mjs`
- `test/js/node/test/parallel/test-whatwg-readablebytestream.js`
- `test/js/node/test/parallel/test-whatwg-readablebytestreambyob.js`
- `test/js/node/test/parallel/test-whatwg-writablestream-close.js`
- `test/js/node/test/parallel/test-whatwg-webstreams-compression.js`
- `test/js/node/test/parallel/test-global-webstreams.js`
- `test/js/node/test/parallel/test-webstream-string-tag.js`
- `test/js/node/test/parallel/test-webstreams-adapters-writable-buffer-sources.js`
- `test/js/node/test/parallel/test-webstreams-compression-bad-chunks.js`
- `test/js/node/test/parallel/test-webstreams-compression-buffer-source.js`
- `test/js/node/test/parallel/test-webstreams-duplex-fromweb-writev-unhandled-rejection.js`

(plus ~231 `test-stream-*` node tests exercising `node:stream` interop, incl. `Readable.toWeb/fromWeb`).

**Recommendation for the rewrite** (out of scope of this scan, but the answer to "how would
we run streams WPT"): copy the `test/js/third_party/wpt-h2/` shape — vendor upstream
`streams/**/*.any.js` + `streams/resources/*.js` verbatim, reuse/extend its
`testharness-shim.ts`, and record pass/fail in a `RESULTS.md` sidecar.

---

## 2) Direct stream tests

Discovery: `rg -l 'ReadableStream|WritableStream|TransformStream|getReader|pipeTo|pipeThrough|ByteLengthQueuingStrategy|CountQueuingStrategy|BYOB|type: ?"direct"|ArrayBufferSink|FileSink|readableStreamTo' test/ -g '*.test.*'`
→ **142 test files**. Test counts are `rg -c '^\s*(test|it|test.each|it.each|describe)\('` (approximate; includes `describe`).

### Tier A — spec / core streams (`test/js/web/streams/`)

| File | ~n | Note |
| --- | --- | --- |
| test/js/web/streams/streams.test.js | 71 | THE core suite: spec behavior + Bun `type:"direct"` sources + native lazy streams + sinks. Primary acceptance file. |
| test/js/web/streams/compression.test.ts | 16 | CompressionStream/DecompressionStream (TransformStream-backed) |
| test/js/web/streams/native-source-onclose-leak.test.ts | 4 | native lazy source lifecycle / leak |
| test/js/web/streams/pipeTo-signal-leak.test.ts | 3 | pipeTo + AbortSignal leak |
| test/js/web/streams/readable-stream-blob-consumed.test.ts | 1 | Blob.stream() consumed state |
| test/js/web/streams/streams-leak.test.ts | 1 | RSS-bounded pipe read/write leak |
| test/js/web/streams/transform-stream-leak.test.ts | 3 | TransformStream leak |
| test/js/web/encoding/text-decoder-stream.test.ts | 18 | TextDecoderStream (TransformStream) |
| test/js/web/encoding/text-encoder-stream.test.ts | 1 | TextEncoderStream |
| test/js/web/encoding/encode-bad-chunks.test.ts | 2 | WPT-derived encode chunk errors through streams |
| test/js/bun/stream/direct-readable-stream.test.tsx | 19 | Bun direct (`type:"direct"`) ReadableStream semantics |
| test/js/bun/util/readablestreamtoarraybuffer.test.ts | 1 | `Bun.readableStreamTo*` converters |
| test/js/bun/spawn/readablestream-helpers.test.ts | 13 | `Bun.readableStreamTo*` helpers over spawn output |
| test/js/bun/util/arraybuffersink.test.ts | 2 | ArrayBufferSink |
| test/js/bun/util/filesink.test.ts | 11 | FileSink (Bun.file().writer()) |

### Tier B — fetch / Request / Response bodies (`test/js/web/fetch/`)

| File | ~n | Note |
| --- | --- | --- |
| test/js/web/fetch/fetch.test.ts | 129 | fetch incl. streaming request/response bodies |
| test/js/web/fetch/body.test.ts | 49 | Body mixin: consume as stream/text/json/etc. |
| test/js/web/fetch/body-clone.test.ts | 46 | Response/Request.clone() → teed streams |
| test/js/web/fetch/fetch.stream.test.ts | 21 | streaming fetch response bodies |
| test/js/web/fetch/body-stream.test.ts | 9 | request body as ReadableStream |
| test/js/web/fetch/body-stream-excess.test.ts | 2 | body stream over-read |
| test/js/web/fetch/blob.test.ts | 26 | Blob.stream() |
| test/js/web/fetch/blob-write.test.ts | 10 | Bun.write with blob/stream sources |
| test/js/web/fetch/response.test.ts | 19 | Response(stream) construction |
| test/js/web/fetch/client-fetch.test.ts | 32 | fetch client, streamed bodies |
| test/js/web/fetch/fetch-gzip.test.ts | 11 | decompression through response body stream |
| test/js/web/fetch/fetch-compress.test.ts | 3 | compression + fetch body |
| test/js/web/fetch/fetch-backpressure.test.ts | 7 | body-stream backpressure |
| test/js/web/fetch/stream-fast-path.test.ts | 4 | native fast-path for body streams |
| test/js/web/fetch/fetch-abort-stream-body.test.ts | 1 | abort mid-stream |
| test/js/web/fetch/fetch-stream-cancel-leak.test.ts | 2 | cancel leak |
| test/js/web/fetch/server-response-stream-leak.test.ts | 2 | server-side response stream leak |
| test/js/web/fetch/fetch-leak.test.ts | 14 | body/stream RSS leak |
| test/js/web/fetch/fetch-http2-leak.test.ts | 7 | h2 body leak |
| test/js/web/fetch/fetch-response-finalizer-sweep.test.ts | 1 | GC of streamed responses |
| test/js/web/fetch/wasm-streaming.test.ts | 22 | WebAssembly.instantiateStreaming over Response streams |
| test/js/web/fetch/utf8-bom.test.ts | 27 | BOM handling on streamed body decode |
| test/js/web/fetch/fetch-syscall-fault.test.ts | 12 | fault injection into streamed I/O |
| test/js/web/fetch/fetch-http2-client.test.ts / fetch-http3-client.test.ts / fetch-http3-adversarial.test.ts | 60/50/10 | h2/h3 client — response body streams |
| test/js/web/fetch/fetch-args.test.ts / fetch-keepalive.test.ts / fetch-cyclic-reference.test.ts / request-cyclic-reference.test.ts / response-cyclic-reference.test.ts / fetch.upgrade.test.ts / fetch-tcp-keepalive.test.ts / fetch-proxy-connect-tunnel-split-envelope.test.ts / exiting.test.ts | 15/5/3/2/2/2/0/1/0 | body/stream references, mostly incidental |
| test/js/web/request/request.test.ts | 4 | Request body streams |
| test/js/web/html/FormData.test.ts | 51 | multipart bodies via streams |
| test/js/deno/fetch/blob.test.ts / body.test.ts | 9/5 | Deno-ported blob/body stream tests |

### Tier C — Bun.serve / HTTP server (`test/js/bun/http/`)

| File | ~n | Note |
| --- | --- | --- |
| test/js/bun/http/serve.test.ts | 87 | Bun.serve incl. ReadableStream response bodies, req.body streams |
| test/js/bun/http/bun-server.test.ts | 43 | server streaming behaviors |
| test/js/bun/http/serve-direct-readable-stream.test.ts | 8 | `type:"direct"` stream as HTTP response |
| test/js/bun/http/serve-stream-body-error.test.ts | 0 (fixture-driven) | erroring stream body |
| test/js/bun/http/serve-async-stream-client-abort.test.ts | 2 | client abort of a streaming response |
| test/js/bun/http/serve-pending-promise-abort-leak.test.ts | 6 | abort/leak |
| test/js/bun/http/serve-reused-response.test.ts | 6 | reusing a Response (stream lock semantics) |
| test/js/bun/http/serve-syscall-fault.test.ts | 5 | fault injection |
| test/js/bun/http/fetch-file-upload.test.ts | 5 | streamed uploads |
| test/js/bun/http/serve-http3.test.ts | 49 | h3 server streaming |
| test/js/bun/http/proxy-stress-lifecycle.test.ts / proxy-stress-matrix.test.ts | 9/9 | proxied streamed bodies under stress |
| test/js/bun/http/bun-serve-html-manifest.test.ts / serve-protocols.test.ts / serve-epoll-add-fail.test.ts | 5/1/0 | incidental |

### Tier D — spawn stdio ↔ streams (`test/js/bun/spawn/`)

| File | ~n | Note |
| --- | --- | --- |
| test/js/bun/spawn/spawn.test.ts | 56 | stdout/stderr as ReadableStream, stdin sinks |
| test/js/bun/spawn/spawn-stdin-readable-stream.test.ts | 24 | ReadableStream as stdin |
| test/js/bun/spawn/spawn-stdin-readable-stream-edge-cases.test.ts | 13 | edge cases |
| test/js/bun/spawn/spawn-stdin-readable-stream-integration.test.ts | 6 | integration |
| test/js/bun/spawn/spawn-stdin-readable-stream-sync.test.ts | 2 | spawnSync + stream stdin |
| test/js/bun/spawn/spawn-streaming-stdin.test.ts / spawn-streaming-stdout.test.ts | 1/1 | streaming stdio |
| test/js/bun/spawn/spawn-maxbuf.test.ts | 12 | buffered vs streamed output limits |
| test/js/bun/spawn/spawn-stdout-filereader-gc-uaf.test.ts / spawn-pipe-stale-fd-unregister.test.ts / spawn-stdin-pipe-fd-leak.test.ts / spawn-socketpair-shutdown.test.ts | 0/0/0/2 | native FileReader/pipe lifecycle regressions |
| test/js/bun/terminal/terminal-spawn.test.ts | 13 | PTY streams |

### Tier E — node interop

| File | ~n | Note |
| --- | --- | --- |
| test/js/node/stream/node-stream.test.js | 69 | node:stream incl. Readable/Writable/Duplex `.toWeb()/.fromWeb()` |
| test/js/node/stream/node-stream-uint8array.test.ts | — | node stream chunk types |
| test/js/node/http/node-http.test.ts | 144 | node:http request/response bodies (IncomingMessage/OutgoingMessage over internals shared with web streams) |
| test/js/node/http/node-http-backpressure.test.ts / -max / -nested-cork / -syscall-fault / node-fetch.test.js | 4/1/10/4/5 | backpressure & interop |
| test/js/node/http2/node-http2.test.js | 68 | h2 streams |
| test/js/node/fs/fs.test.ts | 301 | incl. `fs.createReadStream` ↔ web-stream bridges, `Bun.file().stream()` adjacency |
| test/js/node/async_hooks/AsyncLocalStorage.test.ts | 28 | ALS context across stream callbacks |
| test/js/node/test/parallel/test-whatwg-*/test-webstream* (11 files, §1) | — | vendored Node v26 WHATWG stream tests |
| test/js/node/test/parallel/test-stream-* (~231 files) | — | vendored node:stream suite (interop blast radius) |
| test/js/node/net/node-net-allowHalfOpen.test.js, readline/*, process/stdin/*, tls/renegotiation.test.ts | small | stdio/socket stream edges |

### Tier F — other consumers

| File | ~n | Note |
| --- | --- | --- |
| test/js/bun/s3/s3.test.ts | 106 | S3 upload/download streams |
| test/js/bun/s3/s3-stream-cancel-leak.test.ts | 1 | S3 stream cancel |
| test/js/bun/shell/bunshell.test.ts | 104 | `Bun.$` pipes ↔ streams/blobs |
| test/js/workerd/html-rewriter.test.js | 59 | HTMLRewriter transforms Response body streams |
| test/js/valkey/valkey.test.ts | 450 | incidental (subscriber streams) |
| test/js/sql/local-sql.test.ts | 4 | incidental |
| test/js/third_party/grpc-js/*.test.ts (4) | 44+ | h2 stream consumers |
| test/js/third_party/hono/hello-world-fixture.test.ts, prompts/prompts.test.ts | 1/1 | frameworks over Response streams / stdin |
| test/js/bun/util/inspect.test.js | 45 | `Bun.inspect` of stream objects |
| test/js/bun/util/fuzzy-wuzzy.test.ts | 8 | fuzz incl. stream classes |
| test/js/bun/util/BunObject.test.ts, bun-file*.test.ts | — | `Bun.file().stream()` surface |
| test/cli/hot/hot.test.ts, test/cli/inspect/inspect.test.ts, test/cli/test/test-changed.test.ts, test/cli/create/create-jsx.test.ts, test/cli/install/bun-install-tarball-integrity.test.ts, test/cli/run/no-orphans.test.ts | 11/10/19/5/11/0 | CLI paths that stream child stdio / tarballs |
| test/bundler/bundler_compile.test.ts, bundler_cjs2esm.test.ts, bundler_npm.test.ts | 7/1/1 | bundled code referencing streams |
| test/integration/bun-types/bun-types.test.ts | 9 | `.d.ts` surface for streams types |
| test/js/bun/fetch/node-use-system-ca.test.ts, test/js/bun/http/readable-stream-throws.fixture.js, test/js/bun/resolve/bun-main-entry-point.test.ts | small | incidental |
| Regressions: test/regression/issue/{02499/02499,07001,09555,10004,18413*,19661,20875,21654/21654,23183,26142,26377,27099,27272,29225,29787,ctrl-c}.test.ts | 1–12 each | issue-pinned stream bugs (18413* = 4 files on Compression/Decompression truncation & deflate semantics; 07001/09555/10004 = stream body/tee; 27099/29787 = stream lifecycle) |

Total files touching a streams API by that grep: **142**.

---

## 3) Indirect blast radius — top ~25 files most likely to break

Ordered by exposure. All paths absolute under the repo root.

1. `test/js/web/fetch/body.test.ts` — every Body-mixin consumer routes through ReadableStream internals.
2. `test/js/web/fetch/body-clone.test.ts` — `clone()` = `tee()`; the hardest spec surface.
3. `test/js/web/fetch/fetch.test.ts` — response bodies are lazily-created native ReadableStreams.
4. `test/js/web/fetch/fetch.stream.test.ts` — explicit streaming fetch bodies, chunked + gzip.
5. `test/js/bun/http/serve.test.ts` — `Bun.serve` with ReadableStream response bodies + `req.body`.
6. `test/js/bun/http/bun-server.test.ts` — server streaming, sendfile/stream interplay.
7. `test/js/bun/http/serve-direct-readable-stream.test.ts` — Bun `type:"direct"` sink into uWS.
8. `test/js/bun/stream/direct-readable-stream.test.tsx` — direct-stream controller semantics.
9. `test/js/bun/spawn/spawn.test.ts` — `stdout`/`stderr` are native lazy ReadableStreams; `stdin` FileSink.
10. `test/js/bun/spawn/spawn-stdin-readable-stream.test.ts` (+ its 3 siblings) — ReadableStream→stdin pump.
11. `test/js/bun/spawn/readablestream-helpers.test.ts` — `Bun.readableStreamTo*` over process pipes.
12. `test/js/node/stream/node-stream.test.js` — `Readable.toWeb/fromWeb`, `Duplex.toWeb`, adapter layer.
13. `test/js/node/http/node-http.test.ts` — node:http bodies share the underlying byte-stream plumbing.
14. `test/js/node/fs/fs.test.ts` — `createReadStream`, `Bun.file().stream()` bridges.
15. `test/js/web/fetch/blob.test.ts` — `Blob.stream()` (native byte source) + `readable-stream-blob-consumed`.
16. `test/js/web/streams/compression.test.ts` + `test/regression/issue/18413*.test.ts` — Compression/DecompressionStream are TransformStreams.
17. `test/js/web/encoding/text-decoder-stream.test.ts` — TextDecoderStream is a TransformStream.
18. `test/js/bun/s3/s3.test.ts` — multipart upload from ReadableStream, download to stream.
19. `test/js/bun/shell/bunshell.test.ts` — shell pipes are stream/blob bridges.
20. `test/js/workerd/html-rewriter.test.js` — `HTMLRewriter.transform(Response)` rewrites the body stream.
21. `test/js/web/fetch/wasm-streaming.test.ts` — `instantiateStreaming(Response)` consumes the body stream natively.
22. `test/js/bun/util/filesink.test.ts` + `arraybuffersink.test.ts` — the Sink side of the direct-stream API.
23. `test/js/web/fetch/fetch-leak.test.ts` + `test/js/web/streams/*-leak.test.ts` — GC/refcount regressions; a C++ rewrite changes every lifetime.
24. `test/js/node/test/parallel/test-whatwg-readablestream.mjs` (+ the 10 sibling `test-whatwg-*`/`test-webstream*` files) — vendored Node WHATWG-stream conformance.
25. `test/js/web/fetch/fetch-http2-client.test.ts` / `fetch-http3-client.test.ts` — alternate transports feeding the same body-stream sink; and `test/js/bun/http/proxy-stress-*.test.ts` for lifecycle under load.

Also worth a smoke after any controller/queue change: `test/js/bun/util/inspect.test.js`
(console.log of stream objects) and `test/integration/bun-types/bun-types.test.ts` (typings).

---

## 4) How to run one file

Per `CLAUDE.md`: build + run with the debug binary (never `bun test` directly):

```sh
bun bd test test/js/web/streams/streams.test.js
# fuzzy match also works:
bun bd test streams/streams.test.js
# with a name filter:
bun bd test test/js/web/streams/streams.test.js -t "pipeTo"
```

Sanity that a new test is real: it should FAIL with `USE_SYSTEM_BUN=1 bun test <file>` and pass with `bun bd test <file>`.

---

## 5) Smoke set (~12 files, most-fundamental → most-integrated)

1. `test/js/web/streams/streams.test.js` — core Readable/Writable/Transform + direct + native sources.
2. `test/js/bun/stream/direct-readable-stream.test.tsx` — Bun direct-stream controller.
3. `test/js/bun/spawn/readablestream-helpers.test.ts` — `Bun.readableStreamTo*` converters.
4. `test/js/web/streams/compression.test.ts` — TransformStream via Compression/DecompressionStream.
5. `test/js/web/encoding/text-decoder-stream.test.ts` — TransformStream via TextDecoderStream.
6. `test/js/node/test/parallel/test-whatwg-readablestream.mjs` — Node's WHATWG conformance (tee, BYOB adjacency).
7. `test/js/web/fetch/body.test.ts` — Body mixin over streams.
8. `test/js/web/fetch/body-clone.test.ts` — clone/tee semantics.
9. `test/js/web/fetch/fetch.stream.test.ts` — real network → native byte source.
10. `test/js/bun/http/serve.test.ts` — stream as HTTP response + `req.body` (server sink).
11. `test/js/bun/spawn/spawn-stdin-readable-stream.test.ts` — stream → process stdin pump.
12. `test/js/node/stream/node-stream.test.js` — node:stream ↔ web-stream adapters.

Bonus leak gate (run after the 12 are green): `test/js/web/streams/streams-leak.test.ts`,
`test/js/web/streams/native-source-onclose-leak.test.ts`, `test/js/web/fetch/fetch-leak.test.ts`.
