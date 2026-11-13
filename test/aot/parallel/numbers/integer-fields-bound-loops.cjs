// A field that the program uses as an index bounds loops and moves keys. What it holds later: a fraction, a number beyond int32, -0, NaN, a string, nothing, an object that counts its conversions.
let conversions = 0;
function Big(array, t) {
  this.array = array;
  this.t = t;
}
Big.prototype.last = function () {
  return this.array[this.t - 1] & 255;
};
function step(value) {
  return value + 1;
}
function sumBelow(x) {
  var s = 0;
  for (var i = 0; i < x.t - 1; ++i) s = (s * 31 + x.array[i]) | 0;
  return [s, i].join();
}
function moveBy(x, r) {
  for (var i = 0; i < x.t; ++i) {
    r.array[i + x.t] = step(x.array[i]);
    r.t = i + x.t;
  }
  return r.t;
}
function pairs(x, r) {
  for (var i = 0; i < x.t - 1; ++i) {
    r.array[2 * i] = step(x.array[i]);
    r.array[2 * i + 1] = x.t - i - 1;
  }
  return i;
}
function countDown(x) {
  var seen = [];
  for (var i = x.t - 1; i >= 0; --i) seen.push(x.array[i]);
  return seen.join();
}
function grows(x) {
  var n = 0;
  for (var i = 0; i < x.t; ++i) {
    if (x.array[i] === 5) x.t = x.t + 0.5;
    if (x.array[i] === 7) x.t += 2;
    if (++n > 40) break;
  }
  return [n, i, x.t].join();
}
function equals(x, y) {
  var n = 0;
  for (var i = 0; i < 12; i++) if (i === x.t || y.t <= i || i + x.t > y.t) n += i;
  return n;
}
const digits = () => [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8];
const show = v => (Array.isArray(v) ? "[" + Array.from({ length: v.length }, (_, k) => (k in v ? show(v[k]) : "hole")).join() + "]" + Object.keys(v).slice(v.length).join() : Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : String(v));
const attempt = run => {
  try {
    return show(run());
  } catch (e) {
    return e.constructor.name;
  }
};
for (let round = 0; round < 60; round++) {
  const x = new Big(digits(), 4 + (round % 8)), r = new Big([], 0);
  x.last();
  sumBelow(x);
  moveBy(x, r);
  pairs(x, r);
  countDown(x);
  grows(new Big(digits(), 12));
  equals(x, r);
}
const counts = [0, 1, 5, 12, 13, -1, 4.5, 5.000000001, -0, NaN, "6", "x", true, null, undefined, { valueOf() { conversions++; return 5; } }, [4], 6n, Symbol("t")];
for (const t of counts) {
  const name = typeof t === "object" && t ? "object" : show(t);
  const r = new Big([], 0), q = new Big([], 0);
  console.log(name, attempt(() => sumBelow(new Big(digits(), t))), attempt(() => moveBy(new Big(digits(), t), r)), show(r.array), attempt(() => pairs(new Big(digits(), t), q)), show(q.array), attempt(() => countDown(new Big(digits(), t))), attempt(() => equals(new Big([], t), new Big([], 7))), attempt(() => equals(new Big([], 3), new Big([], t))));
}
console.log(attempt(() => grows(new Big([1, 7, 2, 5, 7, 1], 6))), attempt(() => grows(new Big([5, 5, 5, 5], 2))));
const far = new Big(digits(), 2147483647);
console.log(attempt(() => equals(far, new Big([], 2147483648))), attempt(() => equals(new Big([], 4294967295), far)), attempt(() => equals(new Big([], -2147483648), new Big([], -2147483649))));
console.log(conversions);
