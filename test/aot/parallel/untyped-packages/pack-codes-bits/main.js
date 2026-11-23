// An untyped package and a program of it (bits): text packed by prefix codes, by dictionaries and by runs; all three unpacked again
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const b = new lib.Bits(); let seed = 9; const put = []; for (let i = 0; i < 90; i++) { seed = seed * 16807 % 2147483647; const w = 1 + seed % 17, v = seed & (1 << w) - 1; b.put(v, w); put.push([v, w]); } say(b.n, b.bytes.length, b.bytes.slice(0, 10).join()); let bad = 0; for (const [v, w] of put) if (b.get(w) !== v) bad++; say(bad, b.at, b.at === b.n); for (let i = 0; i < 12; i++) { const c = new lib.Bits(); for (let k = 0; k <= i; k++) c.put(k * 0x5555 ^ i, k + 1); say(i, c.n, c.bytes.map(x => x.toString(16)).join(' '), c.get(i + 1), c.get(3), new lib.Bits(c.bytes).get(8)); }
