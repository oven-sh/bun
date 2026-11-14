// Closures of one factory that loops call: each has code of its own, and nothing that the program sees changes.
const list = JSON.parse("[48, 1, 97, 0.5, 70, -3, 57, 122]");
let made = 0;
const compose = (f, g) => x => f(g(x));
const not = f => x => !f(x);
function range(low, high) { made++; return function (c) { return c >= low && c <= high; }; }
const typeIs = name => v => typeof v === name;
const by = key => (a, b) => a[key] - b[key];
function partial(f, a) { return function (b) { return f.call(this, a, b); }; }
function counter(step) { let n = 0; const next = () => (n += step); return next; }
const clamp = (low, high = low * 2) => v => v < low ? low : v > high ? high : v;
function memo(f) { const seen = new Map(); return function (n) { if (!seen.has(n)) seen.set(n, f(n)); return seen.get(n); }; }
const ops = { inc: partial((a, b) => a + b, 1), dec: partial((a, b) => b - a, 1) };
const h = compose(x => x + 1, x => x * 2), k = compose(compose(x => x - 1, x => x ^ 3), Math.abs);
const isDigit = range(48, 57), isLower = range(97, 122), isOther = not(isDigit);
const isNumber = typeIs("number"), isString = typeIs("string");
const byX = by("x"), byName = by("name");
const ones = counter(1), threes = counter(3), low = clamp(1), byte = clamp(0, 255);
let square = memo(n => n * n), cube = memo(n => n * n * n);
function turns(count) {
  let sum = 0, kinds = "";
  for (let i = 0; i < count; i++) {
    const x = list[i % list.length];
    sum += h(x) + k(x) + low(x) + byte(x) + ones() + threes() + ops.inc(x) * ops.dec(x) + square(x) + cube(i % 3);
    kinds += isDigit(x) ? "d" : isLower(x) ? "l" : isOther(x) ? "o" : "?";
    if (isNumber(x) === isString(x)) kinds += "!";
  }
  return sum + " " + kinds;
}
console.log(turns(11), made);
console.log([{ x: 2, name: 3 }, { x: 1, name: 9 }, { x: 5, name: 1 }].sort(byX).map(it => it.x + byName(it, { name: 1 })).join());
for (const odd of ["5", null, undefined, 2n, {}, [7], NaN, -0]) {
  try { console.log(h(odd), isDigit(odd), low(odd), isString(odd)); } catch (error) { console.log(error.name); }
}
console.log(h.name, h.length, isDigit.name, isDigit.length, String(h) === String(k), String(isDigit) === String(isLower), String(h).length > 8, ones.name, h === k);
square = cube;
console.log(turns(3), compose(h, k)(4), not(isLower)(100), range(1, 2)(2), made);
try { for (let i = 0; i < 3; i++) compose(x => { throw new RangeError("inside " + x); }, h)(i); } catch (error) { console.log(error.message, error.stack.includes("closures-of-copied-factories")); }
