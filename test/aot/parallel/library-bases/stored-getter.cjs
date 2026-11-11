// zlib streams and the streams of node:crypto and node:readline, whose classes extend a member of node:stream: below the library's classes, read through a getter.
const how = "getter";
const stream = require("node:stream");
const born = { Transform: stream.Transform, Duplex: stream.Duplex, Readable: stream.Readable, Writable: stream.Writable };
const seen = [];
class Below extends born.Transform { constructor(o) { super(o); seen.push("constructed"); } extra() { return "extra"; } }
function Old(o) { seen.push("called"); born.Transform.call(this, o); this.fromOld = 1; }
Old.prototype = Object.create(born.Transform.prototype, { constructor: { value: Old }, old: { value: () => "old" } });
Object.setPrototypeOf(Old, born.Transform);
if (how === "old") stream.Transform = Old;
if (how === "class") stream.Transform = Below;
if (how === "number") stream.Transform = 5;
if (how === "duplex") stream.Transform = born.Duplex;
if (how === "getter") Object.defineProperty(stream, "Transform", { get() { seen.push("get Transform"); return born.Transform; }, configurable: true });
const lines = [];
const show = v => (v instanceof Error ? v.name + " " + (v.code ?? "") + " " + v.message : Buffer.isBuffer(v) ? "buffer " + v.toString("latin1").slice(0, 40) : typeof v === "function" ? "fn" : typeof v === "object" ? "object" : String(v));
const tryTo = (name, f) => { try { lines.push(name + " " + show(f())); } catch (e) { lines.push(name + " THROWN " + show(e)); } };
let zlib;
tryTo("load", () => (zlib = require("node:zlib"), "loaded"));
const classes = ["Deflate", "Inflate", "Gzip", "Gunzip", "DeflateRaw", "InflateRaw", "Unzip", "BrotliCompress", "BrotliDecompress", "ZstdCompress", "ZstdDecompress"];
(async () => {
  if (zlib) {
    for (const name of classes) {
      const C = zlib[name];
      tryTo(name + " chain", () => { const r = []; for (let p = C.prototype; p; p = Object.getPrototypeOf(p)) r.push(p.constructor?.name + ":" + Object.getOwnPropertyNames(p).length); return r.join(">"); });
      tryTo(name + " new", () => { const z = new C(); return [z instanceof born.Transform, z instanceof born.Duplex, z instanceof born.Writable, z instanceof stream.Readable, Object.keys(z).join(), typeof z.old, z.fromOld, z._closed, z.bytesWritten, z.writableHighWaterMark, z.readableObjectMode].join(" "); });
      tryTo(name + " without new", () => Object.keys(C()).length);
      tryTo(name + " bad", () => new C({ chunkSize: 1 }));
      tryTo(name + " options", () => Object.keys(new C({ chunkSize: 100, highWaterMark: 7, objectMode: true, encoding: "utf8", flush: 2, info: true })).join());
      tryTo(name + " heir", () => { class Mine extends C { mine = 1; _transform(c, e, d) { this.mine++; super._transform(c, e, d); } } const m = new Mine(); m.on("data", () => {}); m.on("error", () => {}); m.end("x"); return m.mine + " " + (m instanceof C); });
      try { new C(); } catch (e) { lines.push(name + " constructs nothing: " + show(e)); continue; }
      await new Promise(done => { const z = new C(); const events = []; for (const e of ["data", "end", "finish", "close", "error", "prefinish"]) z.on(e, x => events.push(e + (x ? " " + show(x).length : ""))); z.on("close", () => { lines.push(name + " events " + events.join() + " " + z._handle + " " + z._closed + " " + z.destroyed); done(); }); z.write("hello "); z.end("world"); });
      tryTo(name + " close", () => { const z = new C(); z.close(() => lines.push(name + " closed")); return z._closed; });
      tryTo(name + " reset", () => { const z = new C(); z.reset(); return z.bytesRead; });
    }
    const pairs = [["gzipSync", "gunzipSync"], ["deflateSync", "inflateSync"], ["deflateRawSync", "inflateRawSync"], ["brotliCompressSync", "brotliDecompressSync"], ["zstdCompressSync", "zstdDecompressSync"], ["gzipSync", "unzipSync"]];
    for (const [a, b] of pairs) for (const size of [0, 1, 100, 70000]) tryTo(a + " " + size, () => { const x = Buffer.alloc(size, "ab"); const y = zlib[b](zlib[a](x)); return y.equals(x) + " " + zlib[a](x).length; });
    for (const [a] of pairs) tryTo(a + " of an object", () => zlib[a]({}));
    tryTo("gunzip of text", () => zlib.gunzipSync(Buffer.from("not zipped")));
    tryTo("truncated", () => zlib.gunzipSync(zlib.gzipSync("x".repeat(1000)).subarray(0, 20)));
    tryTo("too large", () => zlib.gunzipSync(zlib.gzipSync("x".repeat(1000)), { maxOutputLength: 10 }));
    for (const [a, b] of [["gzip", "gunzip"], ["deflate", "inflate"], ["brotliCompress", "brotliDecompress"], ["zstdCompress", "zstdDecompress"]]) await new Promise(done => { const stop = e => (lines.push(a + " THROWN " + show(e)), done()); try { zlib[a]("some text ".repeat(9), (e, x) => (e ? (lines.push(a + " " + show(e)), done()) : zlib[b](x, (e2, y) => (lines.push(a + " " + show(e2 ?? y)), done())))); } catch (e) { stop(e); } });
    if (how !== "number" && how !== "class" && how !== "duplex") await new Promise(done => { const z = zlib.createGzip({ level: 1 }); const parts = []; z.on("data", d => parts.push(d)); z.on("end", () => { lines.push("params " + zlib.gunzipSync(Buffer.concat(parts)).toString()); done(); }); z.on("error", e => { lines.push("params " + show(e)); done(); }); z.write("one ", () => z.params?.(9, 0, () => z.end("two"))); z.flush?.(() => lines.push("flushed")); });
    if (how !== "number" && how !== "class" && how !== "duplex") await new Promise(done => stream.pipeline(stream.Readable.from(["a", "b"]), zlib.createGzip(), zlib.createGunzip(), new born.Writable({ write(c, _, d) { lines.push("piped " + c); d(); } }), e => { lines.push("pipeline " + show(e ?? "done")); done(); }));
  }
  const crypto = require("node:crypto");
  tryTo("hash", () => { const h = crypto.createHash("md5"); return [h instanceof born.Transform, h instanceof born.Writable, Object.keys(h).join(), h.update("x").digest("hex")].join(" "); });
  await new Promise(done => { const h = crypto.createHash("sha1"); h.on("data", d => { lines.push("hashed " + d.toString("hex")); }); h.on("close", done); h.on("end", done); h.write("a"); h.end("b"); });
  tryTo("sign", () => { const s = crypto.createSign("sha256"); return [s instanceof born.Writable, Object.keys(s).join(), s.write("x"), s.writableLength].join(" "); });
  tryTo("cipher", () => { const c = crypto.createCipheriv("aes-128-cbc", Buffer.alloc(16), Buffer.alloc(16)); return [c instanceof born.Transform, Object.keys(c).join(), c.update("abc", "utf8", "hex") + c.final("hex")].join(" "); });
  const readline = require("node:readline");
  for await (const l of readline.createInterface({ input: stream.Readable.from(["a\nb", "c\n"]) })) lines.push("line " + l);
  lines.push(seen.join().slice(0, 300));
  console.log(lines.join("\n"));
  process.exit(0);
})();
