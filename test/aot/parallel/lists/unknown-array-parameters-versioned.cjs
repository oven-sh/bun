// STATISTIC: BodiesVersionedByArrayKind >= 2
// Nothing is known of the arrays that arrive: the body has a version for arrays and one for each kind of typed array that the file names.
"use strict";
const out = [];
const bag = {};
function hide(name, value) {
  bag[name + String(out.length)] = value;
  return Object.values(bag).pop();
}
function multiply(out, a, b) {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
  const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
  out[0] = a0 * b0 + a2 * b1;
  out[1] = a1 * b0 + a3 * b1;
  out[2] = a0 * b2 + a2 * b3;
  out[3] = a1 * b2 + a3 * b3;
  return out;
}
function blend(target, source, t) {
  target[0] = target[0] + (source[0] - target[0]) * t;
  target[1] = target[1] + (source[1] - target[1]) * t;
  target[2] = target[2] + (source[2] - target[2]) * t;
}
function run(make, other) {
  const a = hide("a", make()), b = hide("b", other()), c = hide("c", make());
  for (let i = 0; i < 5; i++) {
    multiply(c, a, b);
    multiply(a, b, c);
    blend(b, c, 0.25);
  }
  return [a, b, c].map(x => x.constructor.name + " " + Array.from({ length: Math.min(x.length, 6) }, (_, i) => (Object.is(x[i], -0) ? "-0" : String(x[i]))).join()).join("; ");
}
class Vector extends Array {}
const makers = [
  () => [1, 2, 3, 4],
  () => [0.5, 1.5, -0, 2.5],
  () => new Float32Array([1, 2, 3, 4]),
  () => new Float64Array([0.1, 0.2, 0.3, 0.4]),
  () => [1, , 3, 4],
  () => [1, "2", null, undefined],
  () => new Float32Array(3),
  () => new Float32Array(new ArrayBuffer(16, { maxByteLength: 32 })),
  () => Vector.from([4, 3, 2, 1]),
  () => [1, 2],
  () => ({ length: 4, 0: 1, 1: 2, 2: 3, 3: 4 }),
  () => new Proxy([1, 2, 3, 4], {}),
  () => Object.freeze([1, 2, 3, 4]),
  () => new BigInt64Array(4),
  () => [{ valueOf: () => 3 }, 1, 2, 3],
];
for (const make of makers) {
  for (const other of makers) {
    try {
      out.push(run(make, other));
    } catch (e) {
      out.push(e.constructor.name);
    }
  }
}
for (const line of out) console.log(line);
