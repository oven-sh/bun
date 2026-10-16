// node m3.cjs <shape> <warm> <n>: util.inspect of one value shape between the two markers.
const fs = require("node:fs");
const util = require("node:util");
const assert = require("node:assert");
const fd = fs.openSync(__filename, "r");
const buf = Buffer.alloc(1);
const mark = pos => fs.readSync(fd, buf, 0, 1, pos);
const raw = { customInspect: false };
class Point { constructor() { this.x = 1; this.y = 2; } }
const make = {
  plain: () => ({ x: 1, y: 2 }),
  classInstance: () => new Point(),
  nullProto: () => Object.assign(Object.create(null), { x: 1, y: 2 }),
  url: () => new URL("http://example.com/a?k=v"),
};
const [shape, warmArg, nArg, mode = "raw"] = process.argv.slice(2);
const warm = +warmArg, n = +nArg;
let run;
if (shape === "assertFail") {
  run = () => { try { assert.strictEqual(1, 2); } catch {} };
} else if (shape === "assertFailObject") {
  const a = { a: 1 }, b = { a: 2 };
  run = () => { try { assert.deepStrictEqual(a, b); } catch {} };
} else if (shape === "assertPass") {
  const a = { a: 1 }, b = { a: 1 };
  run = () => { assert.deepStrictEqual(a, b); };
} else if (shape === "mixed") {
  // 24 classes, 8 of them six levels deep, and 8 dictionary-mode objects, inspected in turn.
  const values = [];
  for (let i = 0; i < 24; i++) {
    let C = class {};
    if (i % 3 === 0) for (let d = 0; d < 5; d++) C = class extends C {};
    const v = new C(); v.x = i; values.push(v);
  }
  for (let i = 0; i < 8; i++) {
    const o = {}; for (let k = 0; k < 40; k++) o["k" + k] = k; for (let k = 0; k < 38; k++) delete o["k" + k];
    values.push(o);
  }
  let i = 0;
  run = () => { util.inspect(values[i++ % values.length], raw); };
} else {
  const value = make[shape]();
  run = mode === "default" ? () => { util.inspect(value); } : () => { util.inspect(value, raw); };
}
for (let i = 0; i < warm; i++) run();
mark(1); mark(2);
mark(987654321);
for (let i = 0; i < n; i++) run();
mark(987654322);
