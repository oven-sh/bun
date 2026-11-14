// The same loop over arrays of any storage, views, frozen arrays, accessors and methods that another object overrides.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
let log = "";
class V {
  constructor(d) {
    this.d = d;
  }
  add(p) {
    this.d[0] += p.d[0];
    this.d[1] += p.d[1];
    this.d[2] += p.d[2];
    return this;
  }
}
class Heir extends V {
  add(p) {
    log += "h";
    this.d[1] = p.d[0];
    return this;
  }
}
function run(list, w) {
  let s = 0;
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < list.length; i++) {
      list[i].d[0] = i * 0.5;
      list[i].d[2] = i;
      s = s * 0.5 + list[i].add(w).d[0];
    }
  }
  return s;
}
const odd = [
  () => [1, 2, 3],
  () => [0.5, 1.5, 2.5],
  () => [-0, 0, 0.5],
  () => [2147483647, 2147483647, 1],
  () => ["a", 2, 3],
  () => [1, "b", 3.5],
  () => [1, , 3],
  () => [1],
  () => [],
  () => [0.5, NaN, 2],
  () => new Float64Array([1, 2.5, 3]),
  () => Object.freeze([1, 2, 3]),
  () => Object.freeze([0.5, 2, 3]),
  () => ({ 0: 1, 1: 2, 2: 3 }),
  () => [null, undefined, 1],
  () => [1n, 2, 3],
  () => Object.setPrototypeOf([1, , 3], { __proto__: Array.prototype, get 1() { log += "g"; return 4; }, set 1(v) { log += "s"; } }),
  () => Object.defineProperty([1, 2, 3], 1, { get() { log += "G"; return 5; }, set(v) { log += "S" + show(v); } }),
];
const text = v => (v && v.d ? Array.from(v.d, show).join() : String(v));
for (const make of odd) {
  for (const makeOther of [() => [0.5, 1, 1.5], () => [1, 2, 3], make]) {
    const list = [];
    for (let k = 0; k < 8; k++) list.push(new V(k & 1 ? [k, k, k] : [k * 0.5, 1, 2]));
    list[5] = new V(make());
    list[6] = new Heir([0.5, 1, 2]);
    const w = new V(makeOther());
    log = "";
    let result;
    try {
      result = show(run(list, w));
    } catch (e) {
      result = e.constructor.name;
    }
    console.log(result, log, list.map(text).join(" "), text(w));
  }
}
