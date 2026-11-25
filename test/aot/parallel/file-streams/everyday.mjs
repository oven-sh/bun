// What programs do with file streams: options, events, errors, backpressure, pipes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-streams-"));
const at = name => path.join(dir, name);
fs.writeFileSync(at("a"), Array.from({ length: 300 }, (_, i) => "line " + i).join("\n"));
const lines = [];
for (let round = 0; round < 12; round++) {
  lines.length = 0;
  await pipeline(fs.createReadStream(at("a"), { highWaterMark: 100 + round }), new Transform({ transform(c, _, done) { done(null, c.toString().toUpperCase()); } }), fs.createWriteStream(at("b"), { highWaterMark: 64 }));
  lines.push(fs.readFileSync(at("b"), "utf8").length);
  const r = fs.createReadStream(at("a"), { start: 5, end: 20, encoding: "utf8" });
  const events = [];
  for (const name of ["open", "ready", "data", "end", "close", "error", "pause", "resume", "readable"]) if (name !== "readable") r.on(name, x => events.push(name + (typeof x === "string" ? ":" + x : "")));
  await new Promise(done => r.on("close", done));
  lines.push(events.join(), r.bytesRead, r.pending, r.readableEnded, r.closed, r.readableLength, r.autoClose);
  const missing = fs.createReadStream(at("none"));
  lines.push(await new Promise(done => missing.on("error", e => done(e.code + " " + e.syscall))));
  const w = fs.createWriteStream(at("c"), { flags: "w", mode: 0o644, encoding: "utf8" });
  let full = 0;
  for (let i = 0; i < 40; i++) if (!w.write("x".repeat(1000))) full++;
  await new Promise(done => w.end(done));
  lines.push(full, w.bytesWritten, w.writableFinished, w.path === at("c"), w.pending);
  const append = fs.createWriteStream(at("c"), { flags: "a" });
  append.end("tail");
  await new Promise(done => append.on("finish", done));
  lines.push(fs.statSync(at("c")).size);
  const handle = await fs.promises.open(at("a"));
  let n = 0;
  for await (const chunk of handle.createReadStream({ highWaterMark: 1000 })) n += chunk.length;
  lines.push(n);
  const fd = fs.openSync(at("a"), "r");
  const byNumber = fs.createReadStream(null, { fd, autoClose: false, end: 3 });
  lines.push((await byNumber.toArray()).join(), byNumber.fd === fd);
  fs.closeSync(fd);
  const own = fs.createReadStream("x", { fs: { open: (p, f, m, done) => done(null, 7), read: (d, b, o, l, p, done) => { const s = own.bytesRead ? "" : "own fs"; b.write(s, o); done(null, s.length, b); }, close: (d, done) => done(null) } });
  lines.push((await own.toArray()).join());
  const destroyed = fs.createReadStream(at("a"));
  destroyed.destroy(new Error("stop"));
  lines.push(await new Promise(done => destroyed.on("error", e => done(e.message))), destroyed.destroyed);
  for (const bad of [{ start: 3, end: 1 }, { start: "a" }, { fd: -1 }, { encoding: "none" }, 5]) {
    try {
      fs.createReadStream(at("a"), bad);
      lines.push("no error");
    } catch (e) {
      lines.push(e.code);
    }
  }
}
console.log(lines.join("\n"));
fs.rmSync(dir, { recursive: true });
