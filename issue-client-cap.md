### What happens

`http2.connect()` in Bun sends every request at once before it has the SETTINGS frame of the server. Node sends at most 100 and queues the others, because nghttp2 assumes a peer limit of 100 concurrent streams until the SETTINGS arrive (`peerMaxConcurrentStreams`).

So a Bun client that starts many requests on a new session gets RST_STREAM(REFUSED_STREAM) for every request over the limit of the server, where a node client does not exceed that limit for more than its first 100 requests.

### Repro

A raw TCP server reads the client preface, never sends SETTINGS, and counts the HEADERS frames. The client calls `client.request()` 150 times in one turn.

```js
const http2 = require("node:http2");
const net = require("node:net");
const server = net.createServer(socket => {
  let buf = Buffer.alloc(0), headers = 0, preface = false;
  socket.on("data", d => {
    buf = Buffer.concat([buf, d]);
    if (!preface) { if (buf.length < 24) return; buf = buf.subarray(24); preface = true; }
    while (buf.length >= 9) {
      const len = buf.readUIntBE(0, 3);
      if (buf.length < 9 + len) break;
      if (buf[3] === 1) headers++;
      buf = buf.subarray(9 + len);
    }
  });
  setTimeout(() => { console.log({ headersSentBeforeSettings: headers }); process.exit(0); }, 1500);
});
server.listen(0, "127.0.0.1", () => {
  const client = http2.connect("http://127.0.0.1:" + server.address().port);
  client.on("error", () => {});
  for (let i = 0; i < 150; i++) { const r = client.request({ ":path": "/" }); r.on("error", () => {}); r.end(); }
});
```

| | HEADERS frames sent before SETTINGS |
|---|---|
| node v26.3.0 | 100 |
| Bun 1.4.3 | 150 |

### Where

`ClientHttp2Session.request()` in `src/js/node/http2.ts` reads `this.#remoteSettings?.maxConcurrentStreams`, which is undefined until the SETTINGS of the server arrive. The queue for pending requests exists. The option `peerMaxConcurrentStreams` is not read.

Found while working on #44337 (the server side of the same limit). With that PR a Bun server keeps the session for up to 1001 refused streams, as node does. A Bun client that starts more than that on a new session still loses the session.
