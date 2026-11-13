// The same stores into arrays of int32s, with holes, frozen, views, and arrays that change their storage in the loop.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
class Vector {
  constructor(d) {
    this.d = d;
  }
  add(other) {
    this.d[0] += other.d[0];
    this.d[1] += other.d[1] * 0.5;
    return this;
  }
}
function run(v, w, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    v.d[0] = i;
    v.d[2] = 0;
    s = s * 0.5 + v.add(w).d[0];
    if (i === 5) v.d[1] = "x";
    if (i === 6) v.d[1] = -0;
    if (i === 7) w.d = [1, , 3];
    if (i === 8) v.d.length = 1;
  }
  return s;
}
const arrays = [() => [0.5, 1.5, 2.5], () => [1, 2, 3], () => [1, , 3], () => [], () => ["a", 1, 2], () => Object.freeze([0.5, 1, 2]), () => new Float64Array([0.5, 1, 2]), () => new Uint8Array(3), () => Object.defineProperty([1, 2, 3], 0, { set(x) { this[1] = x; }, get: () => 4 })];
for (const a of arrays) {
  for (const b of arrays) {
    for (const n of [4, 12]) {
      const v = new Vector(a()), w = new Vector(b());
      try {
        console.log(show(run(v, w, n)), Array.from(v.d, show).join(), Array.from(w.d, show).join());
      } catch (error) {
        console.log(error.constructor.name, Array.from(v.d, show).join());
      }
    }
  }
}
