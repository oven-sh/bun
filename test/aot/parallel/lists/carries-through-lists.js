// Loops that add whole numbers to the elements of an array: its storage stays that of int32s where the elements do.
const show = v => (typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "string" ? JSON.stringify(v) : typeof v === "bigint" ? v + "n" : typeof v === "object" ? "object" : String(v));
const list = a => {
  let s = a.length + ":";
  for (let i = 0; i < Math.min(a.length, 10); i++) s += (i in a ? show(a[i]) : "_") + ",";
  return s;
};
const log = [];
var limit;
function setLimit(bits) {
  limit = 1 << bits;
}
function carry(x, j) {
  let k = 0;
  while (x[j] >= limit && k++ < 9) {
    x[j] -= limit;
    x[++j]++;
  }
  return j;
}
function lower(x, j) {
  let k = 0;
  while (x[j] >= limit && k++ < 9) x[j] -= limit;
  return k;
}
function raise(x, n) {
  for (let i = 0; i < n; i++) x[i] += 3;
  return n;
}
function sums(x, n) {
  let s = 0;
  for (let i = n - 1; i >= 0; --i) {
    x[i] = x[i] + limit;
    s = (s + x[i]) | 0;
  }
  return s;
}
function halves(x, n) {
  for (let i = 0; i < n; i++) {
    x[i] = x[i] + limit;
    x[i] += 0.5;
  }
  return x[0];
}
const make = {
  ints: () => [3, 1 << 28, 5, 268435456 * 2, 7, 900000000, 11, 13],
  big: () => [2147483647, -2147483648, 2147483600, 5, 2147483646, 1, 2, 3],
  doubles: () => [0.5, 268435456.5, 2.25, 536870912.75, 4, 5, 6, 7],
  mixed: () => [1, 2.5, 268435456, 4, 5e9, 6, 7, 8],
  holes: () => {
    const a = [1, 300000000, 3, 4, 5, 6, 7, 8];
    delete a[3];
    return a;
  },
  grown: () => {
    const a = new Array();
    for (let i = 7; i >= 0; --i) a[i] = i * 60000000;
    return a;
  },
  strings: () => [1, "300000000", 3, "x", 5, 6, 7, 8],
  frozen: () => Object.freeze([1, 300000000, 3, 4, 5, 6, 7, 8]),
  objects: () => [1, { valueOf: () => log.push("v") + 300000000 }, 3, 4, 5, 6, 7, 8],
  view: () => new Int32Array([1, 300000000, 3, 4, 5, 6, 7, 8]),
  plain: () => ({ 0: 1, 1: 300000000, 2: 3, 3: 4, length: 8 }),
  getter: () => {
    const a = [1, 300000000, 3, 4, 5, 6, 7, 8];
    let held = 400000000;
    Object.defineProperty(a, 2, { get: () => (log.push("get"), held), set: v => void (log.push("set"), (held = v)), configurable: true });
    return a;
  },
  nan: () => [NaN, 300000000, -0, 4, Infinity, 6, 7, 8],
};
for (const bits of [28, 2]) {
  setLimit(bits);
  for (const f of [carry, lower, raise, sums, halves]) {
    for (const kind of Object.keys(make)) {
      log.length = 0;
      const x = make[kind]();
      let r;
      try {
        for (let k = 1; k < 4; k++) r = f(x, k);
        r = f(x, 8);
      } catch (e) {
        r = e.name;
      }
      console.log(bits, f.name, kind, show(r), list(x), log.join());
    }
  }
}
