// Bench inputs: many small entries, so the header phase dominates.
import fs from "node:fs";
import { gzipSync } from "node:zlib";
const octal = (n, w) => n.toString(8).padStart(w - 1, "0") + "\0";
function header(name, size, type) {
  const b = Buffer.alloc(512, 0);
  b.write(name, 0, 100);
  b.write(octal(0o644, 8), 100); b.write(octal(0, 8), 108); b.write(octal(0, 8), 116);
  b.write(octal(size, 12), 124); b.write(octal(1700000000, 12), 136);
  b.fill(" ", 148, 156); b.write(type, 156);
  b.write("ustar\0", 257, "latin1"); b.write("00", 263);
  let s = 0; for (let i = 0; i < 512; i++) s += b[i];
  b.write(octal(s, 8), 148);
  return b;
}
const pad = n => Buffer.alloc((512 - (n % 512)) % 512);
const record = (k, v) => { const body = ` ${k}=${v}\n`; let len = body.length + 1; while (String(len).length + body.length !== len) len++; return Buffer.from(`${len}${body}`); };
const body = i => Buffer.from(`module.exports = ${i};\n`.repeat(1 + (i % 7)));
fs.mkdirSync("/tmp/la-harness/bench", { recursive: true });
let parts = [];
for (let i = 0; i < 2000; i++) { const d = body(i); parts.push(header(`package/lib/f${i}.js`, d.length, "0"), d, pad(d.length)); }
parts.push(Buffer.alloc(1024));
fs.writeFileSync("/tmp/la-harness/bench/ustar2000.tgz", gzipSync(Buffer.concat(parts)));
parts = [];
for (let i = 0; i < 2000; i++) {
  const d = body(i);
  const p = record("path", "package/" + "deeply/nested/".repeat(9) + `file-number-${i}.js`);
  parts.push(header("PaxHeader", p.length, "x"), p, pad(p.length), header(`package/f${i}`, d.length, "0"), d, pad(d.length));
}
parts.push(Buffer.alloc(1024));
fs.writeFileSync("/tmp/la-harness/bench/pax2000.tgz", gzipSync(Buffer.concat(parts)));
console.log("ok");
