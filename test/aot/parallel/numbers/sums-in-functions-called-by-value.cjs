// Functions in arrays, in fields of records and on prototypes of many classes: loops call what they find there. A guard asks their parameters for numbers where their sums lean on it. Other values run the slow version.
const show = v => console.log(typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : typeof v === "string" ? JSON.stringify(v) : String(v));
const odd = { valueOf() { show("valueOf"); return 4; } };
const values = [1, 2.5, -0, 3, NaN, 2147483647, 0.5, -7, 9007199254740992, Infinity];
const others = ["a", undefined, null, 5n, true, odd, [3], Symbol.iterator, ""];

const table = [
  function (x) { x = x > 10 ? 0.5 : x + 1; x = x > 11 ? 0.5 : x + 1; x = x > 12 ? 0.25 : x + x; return x > 13 ? x - 1 : x + 2; },
  function (x) { let y = x + x; let z = y + x; return z > y ? z + y : y + 1; },
  function (x, y) { let s = x + y; for (let k = 0; k < 4; k++) s = s + (x < y ? x : y); return s + x; },
  function (x) { let t = x + 1; t = t + t; t = t < 5 ? t + x : t + 0.5; return t; },
  function (x, y, z) { const a = x + y, b = a + z; return a > b ? a + b : b + a; },
  function (x) { return x; },
];
const records = [
  { f(x) { x = x > 3 ? x + 0.5 : x + 1; x = x + x; return x > 100 ? 1 : x + 2; } },
  { f(x) { let a = x + 1, b = a + x; return b > a ? b + 1 : a + b; } },
  { f(x) { return x + x + x + 1 > 2 ? x + 0.5 : x + x; } },
];
function A() {} A.prototype.g = function (x) { let a = x + 1; a = a > 2 ? a + x : a + 0.5; return a + a; };
function B() {} B.prototype.g = function (x) { let a = x + x; a = a + 3; return a > 7 ? a + x : 1; };
function C() {} C.prototype.g = function (x) { return x + 1 + x + 2 > 5 ? x + 0.25 : x + 4; };
function D() {} D.prototype.g = function (x) { let a = x + 2; return a + a + a; };
function E() {} E.prototype.g = function (x) { let a = x + 0.5; return a > x ? a + x : x + x; };
class F { g(x) { let a = x + 1; return a + a > 4 ? a + x : a; } }
const objects = [new A(), new B(), new C(), new D(), new E(), new F()];

function attempt(call) {
  try {
    show(call());
  } catch (e) {
    show(e.constructor.name);
  }
}
function run(pool) {
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i], b = pool[(i * 3 + 1) % pool.length], c = values[i % values.length];
    for (let j = 0; j < table.length; j++) attempt(() => table[j](a, b, c));
    for (let j = 0; j < records.length; j++) attempt(() => records[j].f(a));
    for (let j = 0; j < objects.length; j++) attempt(() => objects[j].g(a));
  }
}
function feed(start, n) {
  let x = start, y = start, z = start;
  for (let i = 0; i < n; i++) {
    x = table[i % table.length](x, y, z);
    y = records[i % records.length].f(y);
    z = objects[i % objects.length].g(z);
    if (x > 1e6) x = 1;
    if (y > 1e6) y = 0.5;
    if (z > 1e6) z = -1;
  }
  return [x, y, z].map(String).join();
}
show(feed(1, 50));
show(feed(0.5, 50));
show(feed(-3, 7));
run(values);
run(others);
show(feed(2, 20));
run([1, "b", 2, 6n, 0.5]);
