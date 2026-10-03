### What happens

`stream.respond(headers, options)` on a `node:http2` server fails in Bun for priority options that node accepts, and the client gets no frame at all: no response and no RST_STREAM.

### Repro

```js
const http2 = require("node:http2");
const server = http2.createServer();
server.on("stream", stream => {
  stream.on("error", e => console.log("server stream error:", e.code, e.message));
  stream.respond({ ":status": 200 }, { weight: 0 });
  stream.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  const client = http2.connect("http://127.0.0.1:" + server.address().port);
  const r = client.request({ ":path": "/" });
  r.on("response", h => console.log("status", h[":status"]));
  r.on("close", () => process.exit(0));
  r.resume();
  r.end();
  setTimeout(() => { console.log("no answer in 3 s"); process.exit(1); }, 3000);
});
```

| options | node v26.3.0 | Bun 1.4.3 |
|---|---|---|
| `{ weight: 0 }` | status 200 | server stream error `ERR_HTTP2_STREAM_ERROR` (NGHTTP2_INTERNAL_ERROR), client gets no answer |
| `{ parent: -1 }` | status 200 | the same |
| `1` (not an object) | `respond()` throws `ERR_INVALID_ARG_TYPE` | no throw, server stream error, client gets no answer |

Node ignores the priority options (they are deprecated). For the third row node throws before it sends a frame.

Found while working on #44337. Its tests use these calls as a way to make `respond()` fail in Bun, and they are skipped on node.
