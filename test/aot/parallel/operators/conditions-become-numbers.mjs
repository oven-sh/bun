// `condition ? 1 : 0` and `condition ? 0 : 1` in sums, differences and bits, of conditions of every kind.
const o = { a: 1, flag: true, maybe: undefined };
const seen = new Set([1, 2, "a"]);
let calls = 0;
const f = x => { calls++; return x > 1; };
const lists = { ints: [0, 1, 2, 3, 4, 5], doubles: [1.5, NaN, -0, 3, Infinity, 2], mixed: [1, "2", null, undefined, true, {}], strings: ["a", "b", "", "ab", "a", "c"] };
const show = v => Object.is(v, -0) ? "-0" : String(v);
function c0(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += x > 2 ? 1 : 0;
    m -= x > 2 ? 0 : 1;
    bits = (bits << 1) | (x > 2 ? 1 : 0);
    t += x > 2 ? 1 : 0;
    u *= (x > 2 ? 1 : 0) + 1;
    inverse = 1 / (x > 2 ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c1(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += x === y ? 1 : 0;
    m -= x === y ? 0 : 1;
    bits = (bits << 1) | (x === y ? 1 : 0);
    t += x === y ? 1 : 0;
    u *= (x === y ? 1 : 0) + 1;
    inverse = 1 / (x === y ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c2(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += x !== 3 ? 1 : 0;
    m -= x !== 3 ? 0 : 1;
    bits = (bits << 1) | (x !== 3 ? 1 : 0);
    t += x !== 3 ? 1 : 0;
    u *= (x !== 3 ? 1 : 0) + 1;
    inverse = 1 / (x !== 3 ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c3(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += !x ? 1 : 0;
    m -= !x ? 0 : 1;
    bits = (bits << 1) | (!x ? 1 : 0);
    t += !x ? 1 : 0;
    u *= (!x ? 1 : 0) + 1;
    inverse = 1 / (!x ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c4(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += x ? 1 : 0;
    m -= x ? 0 : 1;
    bits = (bits << 1) | (x ? 1 : 0);
    t += x ? 1 : 0;
    u *= (x ? 1 : 0) + 1;
    inverse = 1 / (x ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c5(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += "a" in o ? 1 : 0;
    m -= "a" in o ? 0 : 1;
    bits = (bits << 1) | ("a" in o ? 1 : 0);
    t += "a" in o ? 1 : 0;
    u *= ("a" in o ? 1 : 0) + 1;
    inverse = 1 / ("a" in o ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c6(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += x in o ? 1 : 0;
    m -= x in o ? 0 : 1;
    bits = (bits << 1) | (x in o ? 1 : 0);
    t += x in o ? 1 : 0;
    u *= (x in o ? 1 : 0) + 1;
    inverse = 1 / (x in o ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c7(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += o.hasOwnProperty(s) ? 1 : 0;
    m -= o.hasOwnProperty(s) ? 0 : 1;
    bits = (bits << 1) | (o.hasOwnProperty(s) ? 1 : 0);
    t += o.hasOwnProperty(s) ? 1 : 0;
    u *= (o.hasOwnProperty(s) ? 1 : 0) + 1;
    inverse = 1 / (o.hasOwnProperty(s) ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c8(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += s === "b" ? 1 : 0;
    m -= s === "b" ? 0 : 1;
    bits = (bits << 1) | (s === "b" ? 1 : 0);
    t += s === "b" ? 1 : 0;
    u *= (s === "b" ? 1 : 0) + 1;
    inverse = 1 / (s === "b" ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c9(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += typeof x === "number" ? 1 : 0;
    m -= typeof x === "number" ? 0 : 1;
    bits = (bits << 1) | (typeof x === "number" ? 1 : 0);
    t += typeof x === "number" ? 1 : 0;
    u *= (typeof x === "number" ? 1 : 0) + 1;
    inverse = 1 / (typeof x === "number" ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c10(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += x && y ? 1 : 0;
    m -= x && y ? 0 : 1;
    bits = (bits << 1) | (x && y ? 1 : 0);
    t += x && y ? 1 : 0;
    u *= (x && y ? 1 : 0) + 1;
    inverse = 1 / (x && y ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c11(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += x || y ? 1 : 0;
    m -= x || y ? 0 : 1;
    bits = (bits << 1) | (x || y ? 1 : 0);
    t += x || y ? 1 : 0;
    u *= (x || y ? 1 : 0) + 1;
    inverse = 1 / (x || y ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c12(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += x ?? y ? 1 : 0;
    m -= x ?? y ? 0 : 1;
    bits = (bits << 1) | (x ?? y ? 1 : 0);
    t += x ?? y ? 1 : 0;
    u *= (x ?? y ? 1 : 0) + 1;
    inverse = 1 / (x ?? y ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c13(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += Array.isArray(y) ? 1 : 0;
    m -= Array.isArray(y) ? 0 : 1;
    bits = (bits << 1) | (Array.isArray(y) ? 1 : 0);
    t += Array.isArray(y) ? 1 : 0;
    u *= (Array.isArray(y) ? 1 : 0) + 1;
    inverse = 1 / (Array.isArray(y) ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c14(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += o.flag ? 1 : 0;
    m -= o.flag ? 0 : 1;
    bits = (bits << 1) | (o.flag ? 1 : 0);
    t += o.flag ? 1 : 0;
    u *= (o.flag ? 1 : 0) + 1;
    inverse = 1 / (o.flag ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c15(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += o.maybe ? 1 : 0;
    m -= o.maybe ? 0 : 1;
    bits = (bits << 1) | (o.maybe ? 1 : 0);
    t += o.maybe ? 1 : 0;
    u *= (o.maybe ? 1 : 0) + 1;
    inverse = 1 / (o.maybe ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c16(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += x == y ? 1 : 0;
    m -= x == y ? 0 : 1;
    bits = (bits << 1) | (x == y ? 1 : 0);
    t += x == y ? 1 : 0;
    u *= (x == y ? 1 : 0) + 1;
    inverse = 1 / (x == y ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c17(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += seen.has(x) ? 1 : 0;
    m -= seen.has(x) ? 0 : 1;
    bits = (bits << 1) | (seen.has(x) ? 1 : 0);
    t += seen.has(x) ? 1 : 0;
    u *= (seen.has(x) ? 1 : 0) + 1;
    inverse = 1 / (seen.has(x) ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c18(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += x instanceof Object ? 1 : 0;
    m -= x instanceof Object ? 0 : 1;
    bits = (bits << 1) | (x instanceof Object ? 1 : 0);
    t += x instanceof Object ? 1 : 0;
    u *= (x instanceof Object ? 1 : 0) + 1;
    inverse = 1 / (x instanceof Object ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c19(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += x % 2 === 0 ? 1 : 0;
    m -= x % 2 === 0 ? 0 : 1;
    bits = (bits << 1) | (x % 2 === 0 ? 1 : 0);
    t += x % 2 === 0 ? 1 : 0;
    u *= (x % 2 === 0 ? 1 : 0) + 1;
    inverse = 1 / (x % 2 === 0 ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c20(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += f(x) ? 1 : 0;
    m -= f(x) ? 0 : 1;
    bits = (bits << 1) | (f(x) ? 1 : 0);
    t += f(x) ? 1 : 0;
    u *= (f(x) ? 1 : 0) + 1;
    inverse = 1 / (f(x) ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
function c21(xs, ys, start) {
  let n = start, m = 0, bits = 1, t = "", u = 0.5, inverse = 0;
  for (let k = 0; k < 12; k++) {
    const x = xs[k % 6], y = ys[(k + 1) % 6], s = "abc"[k % 3];
    n += x > 1 && y < 4 ? 1 : 0;
    m -= x > 1 && y < 4 ? 0 : 1;
    bits = (bits << 1) | (x > 1 && y < 4 ? 1 : 0);
    t += x > 1 && y < 4 ? 1 : 0;
    u *= (x > 1 && y < 4 ? 1 : 0) + 1;
    inverse = 1 / (x > 1 && y < 4 ? 1 : 0);
  }
  return [n, m, bits, t, u, inverse].map(show).join();
}
for (const run of [c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15, c16, c17, c18, c19, c20, c21]) for (const [one, xs] of Object.entries(lists)) for (const [other, ys] of Object.entries(lists)) {
  let said; try { said = [0, 2147483640, 0.25, "s"].map(start => run(xs, ys, start)).join(" "); } catch (error) { said = error.name; }
  console.log(run.name, one, other, said);
}
console.log(calls);
