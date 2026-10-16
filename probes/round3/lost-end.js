// stdout is a file. write, Writable.prototype.write, write, end(cb), then a write after end().
const { Writable } = require("node:stream");
const out = process.stdout, ev = [];
const code = e => (e == null ? "" : ":" + e.code);
out.on("error", e => ev.push("error" + code(e)));
out.write("A", e => ev.push("w0" + code(e)));
Writable.prototype.write.call(out, "B", e => ev.push("p1" + code(e)));
out.write("C", e => ev.push("w2" + code(e)));
out.end(e => ev.push("end" + code(e)));
out.write("E", e => ev.push("w4" + code(e)));
setTimeout(() => process.stderr.write(JSON.stringify(ev) + "\n"), 200);
