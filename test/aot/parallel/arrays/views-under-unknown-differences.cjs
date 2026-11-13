// STATISTIC: UnknownDifferencesOfIndexes >= 1
// The filters of a PNG writer: each is called out of a table with a holder, a start and a width that nothing is known of.
"use strict";
const filters = {
  up(pixels, start, width) { let sum = 0; const end = start + width; for (let x = start; x < end; x++) { const up = start > 0 ? pixels[x - width] : 0; sum += Math.abs(pixels[x] - up); } return sum; },
  left(pixels, start, width, step) { let sum = 0; for (let x = 0; x < width; x++) { const left = x >= step ? pixels[start + x - step] : 0; sum += Math.abs(pixels[start + x] - left); } return sum; },
  copy(pixels, start, width, step, raw) { for (let x = 0; x < width; x++) raw[step + x] = pixels[start + x]; return raw; },
  store(pixels, start, width, step, raw) { for (let x = 0; x < width; x++) raw[step + x] = pixels[start + x] - (x >= step ? pixels[start + x - step] : 0); return raw; },
};
const values = Array.from({ length: 24 }, (_, k) => (k * 37 + 11) & 255);
let calls = 0;
const holders = {
  buffer: () => Buffer.from(values), bytes: () => Uint8Array.from(values), floats: () => Float32Array.from(values, v => v / 3), doubles: () => Float64Array.from(values, v => v % 7 ? v / 4 : NaN), shorts: () => Int16Array.from(values, v => v * 200 - 9000), clamped: () => Uint8ClampedArray.from(values),
  array: () => values.slice(), fractions: () => values.map(v => v / 8), holes: () => { const list = values.slice(); delete list[4]; return list; }, mixed: () => values.map((v, k) => k === 3 ? "5" : k === 6 ? null : k === 9 ? { valueOf() { calls++; return 2; } } : v), frozen: () => Object.freeze(values.slice()), text: () => "0123456789abcdefghijklmn", object: () => ({ length: 5, 0: 1, 2: "3", "-1": 4 }),
  detached: () => { const view = Uint8Array.from(values); structuredClone(view.buffer, { transfer: [view.buffer] }); return view; }, resizable: () => { const buffer = new ArrayBuffer(24, { maxByteLength: 48 }); const view = new Uint8Array(buffer); view.set(values); buffer.resize(9); return view; }, setter: () => Object.defineProperty(values.slice(0, 8), 3, { get() { calls++; return 7; }, set() { calls += 10; } }), nothing: () => null,
};
const show = value => value === null || typeof value !== "object" ? Object.is(value, -0) ? "-0" : String(value) : Array.from({ length: Math.min(value.length, 12) }, (_, k) => k in value ? String(value[k]) : ".").join();
const starts = [[0, 6, 3], [6, 6, 2], [4, 4, 0], [1, 5, "2"], ["2", 3, 1], [.5, 4, 1], [-2, 5, 1], [2, 2 ** 31, 1], [NaN, 4, 2], [3, { valueOf() { calls++; return 4; } }, 2]];
for (const [name, make] of Object.entries(holders)) {
  let line = "";
  for (const [filter, run] of Object.entries(filters)) {
    for (const [start, width, step] of starts) {
      if (width === 2 ** 31 && name !== "nothing") continue;
      const pixels = make(), raw = filter === "copy" && start === 6 ? pixels : filter === "store" && start === 4 ? make() : Buffer.alloc(12);
      let result;
      try { result = run(pixels, start, width, step, raw); } catch (error) { result = error.constructor.name; }
      line += show(result) + "/" + show(raw) + "|";
    }
  }
  console.log(name, calls, line);
}
const shared = Buffer.from(values); console.log(show(filters.copy(shared, 0, 12, 1, shared)), show(filters.copy(new Uint8Array(shared.buffer, shared.byteOffset, 12), 0, 8, 3, shared)));
