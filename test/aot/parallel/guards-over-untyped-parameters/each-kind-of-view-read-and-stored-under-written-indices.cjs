"use strict";
function ends(a) { return [a[0], a[1], a[2], a[3], a[4], a[-1], a[1.5]]; }
function fill(out, x, y) { out[0] = x; out[1] = y; out[2] = x + y; out[3] = x * y; out[4] = 7; out[-1] = 9; return out; }
const table = { ends, fill }, names = JSON.parse('["ends", "fill"]');
const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, Array];
const values = [[1, 2], [-3, 300], [1.5, 2.25], [70000, -70000], [4294967295, 2], [NaN, 1], [-0, 0], [1e20, -1e20]];
for (const Kind of kinds) {
  for (const [x, y] of values) {
    const filled = table[names[1]](new Kind(4), x, y);
    console.log(Kind.name, x, y, table[names[0]](filled).map(v => (Object.is(v, -0) ? "-0" : String(v))).join(" "), filled.length);
  }
}
console.log(table[names[0]](Buffer.from([250, 251, 252, 253])).join(" "), table[names[0]]("text").join(" "), table[names[0]]({ 0: "a", 4: "e", "-1": "m", 1.5: "h" }).join(" "));
