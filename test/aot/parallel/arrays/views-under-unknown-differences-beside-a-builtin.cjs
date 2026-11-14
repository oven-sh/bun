// STATISTIC: UnknownDifferencesOfIndexes >= 1
// A turn that calls a built-in which calls nobody back runs no other code: the holder of pixels[x - width] is still told apart as a view.
"use strict";
const filters = {
  up(pixels, start, width) { let sum = 0, text = ""; const end = start + width; for (let x = start; x < end; x++) { const up = start > 0 ? pixels[x - width] : 0; text = String.fromCharCode(65 + x % 26); sum += Math.abs(pixels[x] - up); } return sum + text; },
};
const values = Array.from({ length: 24 }, (_, k) => (k * 37 + 11) & 255);
let calls = 0;
const holders = {
  buffer: () => Buffer.from(values), bytes: () => Uint8Array.from(values), floats: () => Float32Array.from(values, v => v / 3), shorts: () => Int16Array.from(values, v => v * 200 - 9000),
  array: () => values.slice(), fractions: () => values.map(v => v / 8), holes: () => { const list = values.slice(); delete list[4]; return list; }, mixed: () => values.map((v, k) => k === 3 ? "5" : k === 6 ? null : k === 9 ? { valueOf() { calls++; return 2; } } : v), text: () => "0123456789abcdefghijklmn", object: () => ({ length: 5, 0: 1, 2: "3", "-1": 4 }),
  getter: () => Object.defineProperty(values.slice(0, 8), 3, { get() { calls++; return 7; } }), nothing: () => null,
};
const starts = [[0, 6], [6, 6], [4, 4], [1, 5], ["2", 3], [.5, 4], [-2, 5], [NaN, 4], [3, { valueOf() { calls++; return 2; } }], [2n, 1]];
for (const [name, make] of Object.entries(holders)) {
  let line = "";
  for (const [, run] of Object.entries(filters)) {
    for (const [start, width] of starts) {
      let result;
      try { result = run(make(), start, width); } catch (error) { result = error.constructor.name; }
      line += result + "|";
    }
  }
  console.log(name, calls, line);
}
