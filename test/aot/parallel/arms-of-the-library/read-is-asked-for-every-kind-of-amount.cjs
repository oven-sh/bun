// read(n) works out how much to hand over from n, from what is buffered and from the flags of the state.
// Every kind of n meets every kind of stream here, many times over, so that a compiled program has long learned its sites.
const { Readable } = require("node:stream");
const turns = Number(process.argv[2] ?? 40);
const amounts = [undefined, 0, -1, 1, 3, 4, 5, 100, NaN, "2", 2.5, null, Infinity];
const kinds = {
  "one chunk": () => fill(new Readable({ read() {} }), ["page"]),
  "three chunks": () => fill(new Readable({ read() {} }), ["pa", "ge", "s!"]),
  "nothing yet": () => fill(new Readable({ read() {} }), []),
  "one chunk, ended": () => fill(new Readable({ read() {} }), ["page", null]),
  "three chunks, ended": () => fill(new Readable({ read() {} }), ["pa", "ge", "s!", null]),
  "nothing, ended": () => fill(new Readable({ read() {} }), [null]),
  "three chunks as text": () => fill(new Readable({ read() {}, encoding: "utf8" }), ["pa", "ge", "s!"]),
  "three chunks as text, ended": () => fill(new Readable({ read() {}, encoding: "utf8" }), ["pa", "ge", "s!", null]),
  "three objects": () => fill(new Readable({ read() {}, objectMode: true }), [{ a: 1 }, { a: 2 }, { a: 3 }]),
  "three objects, ended": () => fill(new Readable({ read() {}, objectMode: true }), [{ a: 1 }, { a: 2 }, null]),
  "a low mark": () => fill(new Readable({ read() {}, highWaterMark: 1 }), ["pa", "ge"]),
  "a mark of nothing": () => fill(new Readable({ read() {}, highWaterMark: 0 }), ["pa", "ge"]),
  "read pushes at once": () => {
    let left = 3;
    return new Readable({ read() { this.push(left-- > 0 ? "xy" : null); } });
  },
  "an heir": () => fill(new (class extends Readable { _read() {} })(), ["pa", "ge", "s!"]),
};
function fill(stream, chunks) {
  for (const chunk of chunks) stream.push(chunk);
  return stream;
}
const shown = value => (value === null ? "null" : Buffer.isBuffer(value) ? "bytes " + value.toString() : JSON.stringify(value));
function look(make, amount) {
  const stream = make();
  stream.on("error", () => {});
  const said = [];
  for (let time = 0; time < 4; time++) {
    let got;
    try {
      got = shown(amount === undefined ? stream.read() : stream.read(amount));
    } catch (error) {
      got = error.code ?? error.name;
    }
    said.push(got + " (" + stream.readableLength + " left)");
  }
  return said.join(", ");
}
const lines = [];
for (let turn = 0; turn < turns; turn++) {
  const now = [];
  for (const [kind, make] of Object.entries(kinds)) for (const amount of amounts) now.push(kind + ", read(" + String(amount) + "): " + look(make, amount));
  if (turn === 0) lines.push(...now);
  else for (let at = 0; at < now.length; at++) if (now[at] !== lines[at]) lines.push("turn " + turn + " parts: " + now[at]);
}
console.log(lines.join("\n"));
