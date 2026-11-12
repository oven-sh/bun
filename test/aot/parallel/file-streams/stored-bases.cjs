// File streams below the classes of node:stream, and below classes that a program stored there before the first one.
const stream = require("node:stream");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const which = process.argv[2] ?? "old";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-streams-"));
const file = path.join(dir, "a.txt");
fs.writeFileSync(file, "one\ntwo\nthree\n");
const born = { Readable: stream.Readable, Writable: stream.Writable };
const seen = [];
class Below extends stream.Readable {
  constructor(options) {
    super(options);
    seen.push("constructed");
  }
  extra() {
    return "extra of " + this.constructor.name;
  }
}
function Old(options) {
  seen.push("called");
  born.Readable.call(this, options);
}
Old.prototype = Object.create(born.Readable.prototype, { constructor: { value: Old }, old: { value: () => "old" } });
Object.setPrototypeOf(Old, born.Readable);
const attempts = [["as built", () => {}]];
const stored = { none: undefined, old: Old, number: 5, bare: { prototype: undefined }, plain: { prototype: { made: "up" } }, arrow: () => {} }[which];
if (which) stream.Readable = stored;
const lines = [];
const tell = (name, o) => lines.push([name, o instanceof born.Readable, o instanceof born.Writable, Object.getPrototypeOf(Object.getPrototypeOf(o)) === born.Readable.prototype, typeof o.old, o.made].join(" "));
(async () => {
  try {
    const r = fs.createReadStream(file, { highWaterMark: 5 });
    tell("reader", r);
    let text = "";
    for await (const chunk of r) text += chunk;
    lines.push(JSON.stringify(text), r.bytesRead, r.destroyed, Object.keys(r).sort().join());
  } catch (e) {
    lines.push(e.constructor.name + " " + e.message);
  }
  try {
    const w = fs.createWriteStream(path.join(dir, "b.txt"));
    tell("writer", w);
    await new Promise((done, fail) => {
      w.on("error", fail);
      w.write("x");
      w.end("y", done);
    });
    lines.push(w.bytesWritten, fs.readFileSync(path.join(dir, "b.txt"), "utf8"), Object.keys(w).sort().join());
  } catch (e) {
    lines.push(e.constructor.name + " " + e.message);
  }
  try {
    lines.push(Object.getPrototypeOf(fs.ReadStream)?.name, fs.ReadStream.name, fs.ReadStream.length, Object.getOwnPropertyNames(fs.ReadStream.prototype).sort().join(), Object.getPrototypeOf(fs.WriteStream) === born.Writable);
    class Mine extends fs.ReadStream {
      constructor(p) {
        super(p, { start: 2, end: 5 });
        this.mine = true;
      }
    }
    const m = new Mine(file);
    let part = "";
    m.on("data", c => (part += c));
    await new Promise(done => m.on("close", done));
    lines.push(part, m.mine, m.start, m.end, m.path === file);
    const called = fs.ReadStream(file, { encoding: "utf8" });
    lines.push(called.readableEncoding, called.constructor.name);
    await new Promise(done => called.on("close", done).resume());
  } catch (e) {
    lines.push(e.constructor.name + " " + e.message);
  }
  console.log(lines.join("\n"), seen.join());
  fs.rmSync(dir, { recursive: true });
})();
