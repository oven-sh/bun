"use strict";
// File streams: their classes, what a program has stored on node:stream before the first one, their members and their events.
const mode = process.argv[2] ?? "as it is";
const stream = require("node:stream");
const say = (...parts) => console.log("#", ...parts);
const { Readable, Writable } = stream;
if (mode === "replaced") {
  stream.Readable = class Other extends Readable { constructor(options) { super(options); this.other = "read"; } extra() { return "extra"; } };
  stream.Writable = class Other extends Writable { constructor(options) { super(options); this.other = "write"; } };
}
if (mode === "function") { stream.Readable = function Plain(options) { Readable.call(this, options); this.plain = true; }; Object.setPrototypeOf(stream.Readable.prototype, Readable.prototype); }
if (mode === "prototype") { Readable.prototype.added = "added"; Writable.prototype.added = "added"; Object.defineProperty(stream.Duplex.prototype, "more", { get: () => "more" }); }
if (mode === "base") { class Base { base() { return "base"; } } try { Object.setPrototypeOf(Writable.prototype, Base.prototype); } catch (error) { say(error.message); } Object.setPrototypeOf(Writable.prototype, stream.Stream.prototype); }
const fs = require("node:fs"), tty = require("node:tty"), path = require("node:path"), os = require("node:os");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "files-")); const file = path.join(dir, "file.txt"); fs.writeFileSync(file, "one\ntwo\nthree\n");
const chain = object => { const names = []; for (let it = object; it && names.length < 9; it = Object.getPrototypeOf(it)) names.push(typeof it === "function" ? "f " + it.name : Object.hasOwn(it, "constructor") ? it.constructor.name : "-"); return names.join(" < "); };
for (const Class of [fs.ReadStream, fs.WriteStream, tty.ReadStream, tty.WriteStream]) say(Class.name, Class.length, chain(Class), "|", chain(Class.prototype), "|", Reflect.ownKeys(Class.prototype).map(String).join(), "|", Reflect.ownKeys(Class).map(String).join());
const show = it => Object.keys(it).map(key => key + ":" + (key === "fd" ? typeof it.fd : typeof it[key] === "object" && it[key] ? it[key].constructor?.name ?? "bare" : typeof it[key] === "string" && it[key].startsWith(dir) ? "path" : String(it[key]).split("\n")[0].slice(0, 30))).join();
function record(it, events, out) { for (const name of events) it.on(name, value => out.push(name + (value instanceof Error ? " " + value.code : Buffer.isBuffer(value) ? " " + value.length : value === undefined || name === "open" ? "" : " " + typeof value))); }
const ended = it => new Promise(resolve => it.on("close", () => setImmediate(resolve)));
const turn = () => new Promise(resolve => setImmediate(resolve));
async function settle(it, name, closes) {
  await new Promise(resolve => { for (const event of [name, "error", "close"]) it.on(event, resolve); });
  while (closes && !it.closed) await turn();
  for (let i = 0; i < 3; i++) await turn();
}
(async () => {
  for (const options of [undefined, "utf8", { start: 2, end: 6 }, { highWaterMark: 3 }, { autoClose: false }, { emitClose: false }, { encoding: "hex", highWaterMark: 5 }, { flags: "r+" }, { fd: fs.openSync(file, "r") }, { objectMode: true }]) {
    const out = []; let it; try { it = fs.createReadStream(file, options); } catch (error) { say(error.code); continue; }
    const before = show(it); record(it, ["open", "ready", "data", "end", "close", "error"], out);
    await settle(it, "end", options?.autoClose !== false);
    say("read", typeof options === "object" ? JSON.stringify({ ...options, fd: options.fd && 1 }) : options, out.join(), it.bytesRead, it.pending, it.destroyed, it.other, it.plain, it.added, it.extra?.(), it instanceof Readable, it instanceof stream.Readable, it instanceof fs.ReadStream); say(before); say(show(it));
    if (!it.destroyed) it.destroy();
  }
  for (const options of [undefined, "latin1", { flags: "a" }, { start: 3, flags: "r+" }, { highWaterMark: 2 }, { autoClose: false }, { emitClose: false }, { fd: fs.openSync(path.join(dir, "by-fd"), "w") }, { flush: true }, { fs: { open: fs.open, write: fs.write, close: fs.close } }]) {
    const target = path.join(dir, "out-" + (typeof options === "object" ? Object.keys(options).join("-") : options)); if (options?.start) fs.writeFileSync(target, "0123456789");
    const out = []; let it; try { it = fs.createWriteStream(target, options); } catch (error) { say(error.code, error.message); continue; }
    const before = show(it); record(it, ["open", "ready", "drain", "finish", "close", "error", "pipe"], out); out.push(it.write("héllo"), it.write(Buffer.from(" bytes")));
    it.end("!", () => out.push("ended")); await settle(it, "finish", options?.autoClose !== false);
    say("write", typeof options === "object" ? Object.keys(options).join() : options, out.join(), it.bytesWritten, it.pending, it.destroyed, it.other, it.added, it instanceof Writable, it instanceof stream.Writable, it instanceof fs.WriteStream); say(before); say(show(it)); if (fs.existsSync(target)) say(JSON.stringify(fs.readFileSync(target, "latin1")));
  }
  const missing = fs.createReadStream(path.join(dir, "missing")); const out = []; record(missing, ["open", "data", "end", "error", "close"], out); await ended(missing); say("missing", out.join(), missing.errored?.code);
  const copy = fs.createReadStream(file).pipe(fs.createWriteStream(path.join(dir, "copy"))); await ended(copy); say(fs.readFileSync(path.join(dir, "copy"), "utf8").length, copy.bytesWritten);
  class Own extends fs.WriteStream { constructor(...args) { super(...args); this.own = 1; } _write(chunk, encoding, done) { this.own += chunk.length; super._write(chunk, encoding, done); } }
  const own = new Own(path.join(dir, "own")); own.end("four"); await ended(own); say(own.own, show(own), chain(own));
  say(fs.WriteStream(path.join(dir, "called")) instanceof fs.WriteStream, fs.ReadStream(file) instanceof fs.ReadStream);
  process.exit(0);
})();
