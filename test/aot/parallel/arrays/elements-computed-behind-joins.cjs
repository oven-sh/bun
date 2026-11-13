// STATISTIC: LargeLoopsOfElementsVersioned >= 3
// The loop of an image resizer: elements of two unknown holders behind choices, sums into a view under a counter that the loop steps itself, a place that a division finds.
"use strict";
const boxes = new Map();
function Sizer(length, make) { this.length = Math.abs(Math.floor(length) || 0) * 4; this.sums = make(this.length); this.seen = new Float64Array(length); }
Sizer.prototype.add = function (pixels, hasAlpha, weight, start) {
  const sums = this.sums, seen = this.seen;
  let place = 0, caret = start, r = 0, g = 0, b = 0, a = 0;
  for (place = 0; place < this.length;) {
    r = pixels[caret++];
    g = pixels[caret++];
    b = pixels[caret++];
    a = hasAlpha ? pixels[caret++] : 255;
    sums[place++] += (a ? r : 0) * weight;
    sums[place++] += (a ? g : 0) * weight;
    sums[place++] += (a ? b : 0) * weight;
    if (hasAlpha) {
      sums[place++] += a * weight;
      seen[place / 4 - 1] += a ? weight : 0;
    }
  }
  return caret;
};
const makers = { floats: n => new Float32Array(n), doubles: n => new Float64Array(n), bytes: n => new Uint8Array(n), array: n => new Array(n).fill(0), short: n => new Float32Array(n - 3), holes: n => [0, , 1.5], object: n => ({ length: n, 0: 1, 1: "x" }), frozen: n => Object.freeze(new Array(n).fill(2)) };
const sources = {
  buffer: Buffer.from(Array.from({ length: 96 }, (_, k) => (k * 37) & 255)), floats: Float32Array.from({ length: 96 }, (_, k) => k % 4 === 3 ? k & 4 : k * .75), doubles: Float64Array.from({ length: 96 }, (_, k) => k / 3),
  array: Array.from({ length: 96 }, (_, k) => k), mixed: Array.from({ length: 96 }, (_, k) => k === 40 ? "7" : k === 41 ? null : k === 42 ? undefined : k / 2), holes: (() => { const t = Array.from({ length: 96 }, (_, k) => k); delete t[9]; return t; })(),
  object: { 0: 1, 1: 2, 2: 3, 3: 4, 4: { valueOf() { calls++; return 5; } } }, string: "0123456789".repeat(10), negative: Int8Array.from({ length: 96 }, (_, k) => k - 48), short: new Uint16Array(10).fill(9),
  proxy: new Proxy([1, 2, 3, 4, 5, 6, 7, 8], { get(t, k) { calls++; return Reflect.get(t, k); } }),
};
let calls = 0;
const show = list => Array.from({ length: Math.min(list.length, 12) }, (_, k) => Object.is(list[k], -0) ? "-0" : String(list[k])).join();
for (const [maker, make] of Object.entries(makers)) {
  for (const [source, pixels] of Object.entries(sources)) {
    for (const hasAlpha of [true, false]) {
      boxes.set("s", new Sizer(maker === "array" ? 12 : 6, make)); boxes.set("p", pixels);
      const sizer = boxes.get("s"); let end;
      try { end = sizer.add(boxes.get("p"), hasAlpha, 1.25, 0); end += sizer.add(boxes.get("p"), hasAlpha, hasAlpha ? -.5 : 2, 3); }
      catch (error) { end = error.constructor.name; }
      console.log(maker, source, hasAlpha, end, calls, show(sizer.sums), show(sizer.seen));
    }
  }
}
// One array is read and summed into.
const same = new Sizer(6, makers.doubles); console.log(same.add(same.sums.fill(3), true, 2, 1), show(same.sums), show(same.seen));
const aliased = new Sizer(6, makers.floats); const bytes = new Uint8Array(aliased.sums.buffer); bytes.fill(63); console.log(aliased.add(bytes, true, .5, 0), show(aliased.sums));
