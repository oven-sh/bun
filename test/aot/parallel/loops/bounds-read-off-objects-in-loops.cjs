// for (let k = 0; k < o.n; k++): the bound that the loop reads off an object is rounded to an int32 before the tested version.
// STATISTIC: IntegerBoundGuardsHoisted >= 4
const log = [];
class List extends Array {
  constructor(n, data) {
    super(1);
    this.n = n;
    this.data = data;
  }
  sum() {
    let s = 0;
    for (let k = 0; k < this.n; k++) s += this.data[k] * 2;
    return s;
  }
  scaled() {
    for (let k = 0; k <= this.n; k++) this.data[k] = this.data[k] * 0.5;
    return this.sum();
  }
  backward() {
    let s = 0;
    for (let k = 3; k > this.n; k--) s += this.data[k] / 2;
    return s;
  }
  toward() {
    let s = 0;
    for (let k = 3; this.n <= k; k--) s = s * 2 + this.data[k] * 1;
    return s;
  }
}
class Plain {
  constructor(n, data) {
    this.n = n;
    this.data = data;
  }
  sum() {
    let s = 0, turns = 0;
    for (let k = 0; k < this.n; k++) {
      if (++turns > 9) break;
      s += this.data[k] * 2;
    }
    return s;
  }
  scaled() {
    for (let k = 0; k <= this.n && k < 9; k++) this.data[k] *= 0.5;
    return this.data.length;
  }
  backward() {
    let s = 0, turns = 0;
    for (let k = 3; k >= this.n; k--) {
      if (++turns > 9) return -s;
      s += this.data[k] / 2;
      if (k === 1) this.n = s;
    }
    return s;
  }
  toward() {
    let s = 0;
    for (let k = 0; this.n > k; k++) {
      if (k === 2) this.n = log;
      s += this.data[k] * 3;
    }
    return s;
  }
}
globalThis["list" + process.pid] = [List, Plain];
const text = (v) => (Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : String(v));
const bounds = [3, 3.5, 2.25 + 0.75, -1, -0, 0, NaN, undefined, null, "3", "x", true, 2n, 2 ** 31, 2 ** 31 - 1, 2 ** 31 + 0.5, -(2 ** 31), 2 ** 53, 2 ** 53 + 2, 1e300, Infinity, -Infinity, 1e-320, [2], { valueOf() { log.push("read"); return 2; } }, Symbol("s")];
const lists = [() => [1.5, 2.5, 3.5, 4.5], () => [1, 2, 3, 4], () => [1.5, , 3.5], () => ["a", 1, 2.5, -0], () => new Float64Array([1, 2, 3]), () => Object.freeze([1.5, 2, 3])];
for (const C of [List, Plain]) {
  for (const n of bounds) {
    // The list's loops have no other end.
    if (C === List && !(Number(typeof n === "symbol" || typeof n === "bigint" ? 0 : n) < 100)) continue;
    const results = [];
    for (const data of lists) {
      for (const name of ["sum", "scaled", "backward", "toward"]) {
        if (C === List && name !== "sum" && name !== "scaled" && !(Number(typeof n === "symbol" || typeof n === "bigint" ? 0 : n) > -100)) continue;
        const o = new C(n, data());
        try {
          results.push(text(o[name]()));
        } catch (error) {
          results.push(error.constructor.name);
        }
        results.push(Array.from(o.data, text).slice(0, 5).join());
      }
    }
    console.log(C.name, text(n), results.join(" | "), log.length);
    log.length = 0;
  }
}
