const util = require("node:util"), fs = require("node:fs"), net = require("node:net"), http = require("node:http"), os = require("node:os"), path = require("node:path");
const { Readable, Writable, Duplex, PassThrough } = require("node:stream");
const out = [];
const say = (...a) => out.push(a.map(x => (typeof x === "string" ? x : util.inspect(x, { depth: 1, breakLength: Infinity }))).join(" "));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "byname-"));
(async () => {
  const e = util._errnoException(-2, "open", "orig"); say("errno", e.name, e.message, e.code, e.errno, e.syscall);
  say("keys", Object.keys(util).join());
  say("descriptor", Object.getOwnPropertyDescriptor(util, "format").get !== undefined, Object.getOwnPropertyDescriptor(util, "inspect").set !== undefined);
  say("format", util.format("%s:%d:%j", "a", 1.5, { b: 1 }), util.formatWithOptions({ colors: true }, "%o", 1), util.stripVTControlCharacters("\x1b[1mx\x1b[0m"));
  say("buffer", util.inspect(Buffer.alloc(60, 1)).length); require("buffer").INSPECT_MAX_BYTES = 4; say("buffer4", util.inspect(Buffer.alloc(60, 1))); require("buffer").INSPECT_MAX_BYTES = 50;
  say("style", JSON.stringify(util.styleText("red", "x", { validateStream: false })), JSON.stringify(util.styleText(["bold", "blue"], "y", { stream: new PassThrough() })));
  try { util.styleText("red", "x", { stream: {} }); } catch (err) { say("style error", err.code); }
  try { util.styleText("nope", "x"); } catch (err) { say("style error", err.code); }
  const kept = util.format; util.format = () => "mine"; say("set", util.format("a"), Object.getOwnPropertyDescriptor(util, "format").writable, Object.keys(util).indexOf("format")); util.format = kept;
  const keptInspect = util.inspect; const derived = Object.create(util); derived.inspect = 5; const seen = [Object.hasOwn(derived, "inspect"), typeof util.inspect]; util.inspect = keptInspect; say("derived", seen);
  fs.writeFileSync(path.join(dir, "a.txt"), "a"); fs.mkdirSync(path.join(dir, "d")); fs.writeFileSync(path.join(dir, "d", "b.txt"), "b");
  say("globSync", fs.globSync("**/*.txt", { cwd: dir }).sort());
  say("glob", await new Promise(r => fs.glob("**/*.txt", { cwd: dir }, (err, m) => r(err ?? m.sort()))));
  say("glob promises", (await Array.fromAsync(fs.promises.glob("**/*", { cwd: dir, withFileTypes: true }))).map(d => d.name + d.isDirectory()).sort());
  const fh = await fs.promises.open(path.join(dir, "a.txt"), "r+"); say("fh", typeof fh.pull, typeof fh.writer, typeof fh.pullSync);
  if (typeof fh.pullSync === "function") { try { const chunks = []; for (const c of fh.pullSync()) chunks.push(Buffer.concat([].concat(c)).toString()); say("pullSync", chunks); } catch (err) { say("pullSync error", err.code ?? err.name); } }
  try { await fh.close(); say("closed"); } catch (err) { say("close error", err.code); }
  const server = http.createServer((req, res) => res.end("ok:" + req.url)); await new Promise(r => server.listen(0, "127.0.0.1", r)); const port = server.address().port;
  const agent = new http.Agent(); const sock = agent.createConnection({ port, host: "127.0.0.1" }); await new Promise(r => sock.once("connect", r)); say("agent socket", sock.constructor.name, sock.remotePort === port); sock.destroy();
  say("get", await new Promise(r => http.get({ port, host: "localhost", path: "/x", agent }, res => { let b = ""; res.on("data", c => (b += c)).on("end", () => r(b)); }).on("error", err => r(err.code))));
  const s2 = net.connect({ host: "localhost", port }); say("lookup", await new Promise(r => s2.once("lookup", (err, addr, family, host) => r([err, typeof addr, typeof family, host])))); s2.destroy();
  const refused = await new Promise(r => net.connect({ host: "127.0.0.1", port: 1 }).on("error", r)); say("refused", refused.name, refused.message, refused.code, refused.syscall, refused.address, refused.port);
  agent.destroy(); server.close();
  say("fromWeb", await Array.fromAsync(Readable.fromWeb(new ReadableStream({ start(c) { c.enqueue("q"); c.close(); } }))), Readable.toWeb(Readable.from(["z"])).constructor.name);
  const got = []; const w = Writable.fromWeb(new WritableStream({ write(c) { got.push(String(c)); } })); w.end("k"); await new Promise(r => w.on("finish", r)); say("writable", got, Writable.toWeb(new PassThrough()).constructor.name);
  const pair = Duplex.toWeb(new PassThrough()); say("duplex", Object.keys(pair).sort(), Duplex.fromWeb({ readable: new ReadableStream(), writable: new WritableStream() }).constructor.name);
  const dgram = require("node:dgram"); const u = dgram.createSocket("udp4"); await new Promise(r => u.bind(0, "localhost", r)); const u2 = dgram.createSocket("udp4");
  say("dgram", await new Promise(r => { u.on("message", m => r(String(m))); u2.send("hi", u.address().port, "localhost"); })); u.close(); u2.close();
  const snap = require("node:v8").writeHeapSnapshot(path.join(dir, "h.heapsnapshot")); say("snapshot", path.basename(snap), fs.statSync(snap).size > 1000);
  const h2 = require("node:http2"); const hs = h2.createServer(); hs.on("stream", st => { say("h2 inspect", util.inspect(st).slice(0, 24)); st.respond({ ":status": 200 }); st.end("h"); }); await new Promise(r => hs.listen(0, r));
  const c = h2.connect("http://localhost:" + hs.address().port); const rq = c.request({ ":path": "/" }); say("h2", util.inspect(rq).slice(0, 24), await new Promise(r => { let b = ""; rq.on("data", d => (b += d)).on("end", () => r(b)); })); c.close(); hs.close();
  const dl = util.debuglog("byname"); dl("seen %d", 1); say("debuglog enabled", dl.enabled);
  fs.rmSync(dir, { recursive: true }); console.log(out.join("\n"));
})().catch(err => { console.log(out.join("\n")); console.log("FAILED", err); });
