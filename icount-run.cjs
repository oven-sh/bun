// usage: node run.cjs <bun-profile binary> <server|client> <symbol> [K=6] [limit]
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");
const http2 = require("node:http2");
const net = require("node:net");
const [BIN, MODE, SYMBOL] = process.argv.slice(2);
const K = Number(process.argv[5] || 6);
const LIMIT = process.argv[6];
const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
function frame(type, flags, id, payload = Buffer.alloc(0)) {
  const h = Buffer.alloc(9);
  h.writeUIntBE(payload.length, 0, 3); h[3] = type; h[4] = flags; h.writeUInt32BE(id, 5);
  return Buffer.concat([h, payload]);
}
const block = Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x01, 9]), Buffer.from("localhost")]);
function lookup(bin, symbol) {
  const out = execFileSync("nm", ["-S", "-C", "--defined-only", bin], { maxBuffer: 1 << 30 }).toString();
  for (const line of out.split("\n")) {
    const m = /^([0-9a-f]+) ([0-9a-f]+) [tTwW] (.*)$/.exec(line);
    if (m && m[3] === symbol) return { addr: m[1], size: parseInt(m[2], 16) };
  }
  throw new Error("symbol not found: " + symbol);
}
(async () => {
  const { addr, size } = lookup(BIN, SYMBOL);
  const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", ICOUNT_ADDR: addr, ICOUNT_SIZE: String(size), ICOUNT_NAME: SYMBOL.replace(/bun_runtime::api::(h2_frame_parser_body|h2::connection)::/g, "") };
  const gdbArgs = ["-batch", "--readnever", "-x", path.join(__dirname, "count.py"), "--args", BIN];
  const counts = [];
  let onLine = null;
  const start = args => {
    const child = spawn("gdb", [...gdbArgs, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    child.stdout.on("data", d => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.startsWith("ICOUNT")) counts.push(line);
        else if (line.startsWith("{") && onLine) onLine(JSON.parse(line));
      }
    });
    child.stderr.on("data", () => {});
    return new Promise(r => child.on("exit", r));
  };
  if (MODE === "server") {
    const portP = new Promise(r => (onLine = r));
    const exited = start([path.join(__dirname, "server-one.cjs"), ...(LIMIT ? [LIMIT] : [])]);
    const { port } = await portP;
    const socket = net.connect(port, "127.0.0.1");
    const frames = [];
    let buf = Buffer.alloc(0), waiter = null;
    socket.on("data", d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        if (buf.length < 9 + len) break;
        frames.push({ type: buf[3], flags: buf[4], id: buf.readUInt32BE(5) & 0x7fffffff });
        buf = buf.subarray(9 + len);
      }
      if (waiter && frames.some(waiter.pred)) { const w = waiter; waiter = null; w.resolve(); }
    });
    const waitFor = pred => (frames.some(pred) ? Promise.resolve() : new Promise(resolve => (waiter = { pred, resolve })));
    await new Promise(r => socket.on("connect", r));
    socket.write(Buffer.concat([PREFACE, frame(4, 0, 0)]));
    await waitFor(f => f.type === 4 && (f.flags & 1) === 0);
    socket.write(frame(4, 1, 0));
    for (let i = 0; i < K; i++) {
      const id = 1 + 2 * i;
      socket.write(frame(1, 0x5, id, block));
      await waitFor(f => f.id === id && (f.type === 0 || f.type === 1) && (f.flags & 1) !== 0);
      await new Promise(r => setTimeout(r, 300));
    }
    socket.destroy();
    await exited;
  } else {
    const server = http2.createServer();
    server.on("stream", s => { s.respond({ ":status": 200 }); s.end("ok"); });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    await start([path.join(__dirname, "client-seq.cjs"), String(server.address().port), String(K)]);
    server.close();
  }
  console.log(counts.join("\n"));
  process.exit(0);
})();
