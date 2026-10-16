const util = require("node:util");
const raw = { customInspect: false };
const mode = process.argv[2];
let n = 0;
if (mode === "nonurl" || mode === "hooks") {
  const opts = mode === "hooks" ? undefined : raw;
  for (let i = 0; i < 100; i++) { const v = new (class Point {})(); v.x = i; util.inspect(v, opts); n++; }
  for (let i = 0; i < 11; i++) { const v = Object.create(null); v.x = i; util.inspect(v, opts); n++; }
} else if (mode === "control") {
  for (let i = 0; i < 10000; i++) { util.inspect({ x: i, y: [i] }, raw); n++; }
  for (let i = 0; i < 1000; i++) { util.inspect([i, "a"], raw); n++; }
} else if (mode === "urls") {
  for (let i = 0; i < 1000; i++) { util.inspect(new URL("http://example.com/" + i), raw); n++; }
} else if (mode === "assert") {
  const assert = require("node:assert");
  for (let i = 0; i < 100; i++) { try { assert.deepStrictEqual({ a: i }, { a: -1 }); } catch {} n++; }
}
console.log(mode, n);
