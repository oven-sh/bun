// N GET requests in one write at limit L. The handler ends the response inside the 'stream' event.
// usage: <runtime> sync3.cjs [N=3] [L=1]
const http2 = require("node:http2");
const net = require("node:net");
const N = Number(process.argv[2] || 3), L = Number(process.argv[3] || 1);
const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
function frame(type, flags, id, payload = Buffer.alloc(0)) {
  const h = Buffer.alloc(9);
  h.writeUIntBE(payload.length, 0, 3); h[3] = type; h[4] = flags; h.writeUInt32BE(id, 5);
  return Buffer.concat([h, payload]);
}
const block = Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x01, 9]), Buffer.from("localhost")]);
const handlers = [];
const server = http2.createServer({ settings: { maxConcurrentStreams: L } });
server.on("session", s => s.on("error", () => {}));
server.on("stream", stream => { handlers.push(stream.id); stream.on("error", () => {}); stream.respond({ ":status": 200 }); stream.end("ok"); });
server.listen(0, "127.0.0.1", () => {
  const socket = net.connect(server.address().port, "127.0.0.1");
  const frames = []; let buf = Buffer.alloc(0);
  socket.on("data", d => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 9) {
      const len = buf.readUIntBE(0, 3);
      if (buf.length < 9 + len) break;
      frames.push({ type: buf[3], flags: buf[4], id: buf.readUInt32BE(5) & 0x7fffffff, payload: buf.subarray(9, 9 + len) });
      buf = buf.subarray(9 + len);
    }
    if (frames.some(f => f.type === 6 && (f.flags & 1))) {
      const rst = frames.filter(f => f.type === 3).map(f => [f.id, f.payload.readUInt32BE(0)]);
      const answered = frames.filter(f => f.type === 1).map(f => f.id);
      console.log(JSON.stringify({ runtime: typeof Bun !== "undefined" ? "bun " + Bun.revision.slice(0, 9) : "node " + process.version, N, L, handlers, answered, rst }));
      process.exit(0);
    }
  });
  socket.on("connect", () => {
    const bufs = [PREFACE, frame(4, 0, 0)];
    for (let i = 0; i < N; i++) bufs.push(frame(1, 0x5, 1 + 2 * i, block));
    bufs.push(frame(6, 0, 0, Buffer.alloc(8)));
    socket.write(Buffer.concat(bufs));
  });
});
