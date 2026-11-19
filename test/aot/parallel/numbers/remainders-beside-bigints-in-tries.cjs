// Remainders of numbers, BigInts and both in one function, in classes whose methods a loop calls inside of try: no build stops, every answer is as plain.
const shown = [];
const show = (...values) => shown.push(values.map((value) => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value))).join(" "));
let v0 = 1, v1 = 7;
class C0 { f(x, y, z) { z = ((y | 0.5) + z); if (x > 1.5) z++; if (y <= z) y++; let v4 = ((z + 100) + (z % y)); return v4; } }
class C1 { f(x, y, z) { let r = x % y; if (r < 0) r = r + y; return (z * 2) + r; } }
class C2 { f(x, y, z) { const q = x / y, r = x % y; return q * y + r === x ? z % 3 : (z % y) - r; } }
class C3 { f(x, y, z) { v0 = (y + 100); return (y + (1 % v1)); } }
class C4 { f(x, y, z) { let v4 = (1 * (y + 3)); v4 = v4 < y ? (z / x) : (v4 | (v4 + x)); y = v4; return (y * z); } }
class C5 { f(x, y, z) { let s = x; for (let i = 0; i < 3; i++) { s = s % y; if (typeof s === "number") s = s - 0.5; else s = s + z; } return s; } }
class C6 { f(x, y, z) { let t = x * y; try { t = t % z; if (t >= 0n) return t; return z + t; } catch (e) { return -(t % 4); } } }
class C7 { f(x, y, z) { let a = x % 5n; let b = a * a; if (y > 2) b = b - 1n; return (b % 7n) + z; } }
const objects = [new C0(), new C1(), new C2(), new C3(), new C4(), new C5(), new C6(), new C7()];
const values = [Infinity, "a", 1, 100, 0.5, -3, -0, 9007199254740991, 5n, -3n, 2, 2n ** 80n, -(2n ** 70n), 0, 0n, NaN, -2147483648];
function run() {
  let s, t = 0;
  for (let i = 0; i < 240; i++) {
    for (let k = 0; k < objects.length; k++) {
      try {
        s = objects[k].f(values[(i * 1 + k) % values.length], values[(i * 2 + 3) % values.length], values[(i * 3 + 1) % values.length]);
        show(k, typeof s, s);
        t = t + (typeof s === "number" && s === s ? s % 1000 : 1);
      } catch (e) { show(k, e.name); }
    }
  }
  show(t);
}
run();
function first(i) {
  let s, t = 0;
  for (; i < 48; i++) {
    try { s = objects[0].f(values[(i * 1 + 1) % values.length], values[(i * 2 + 0) % values.length], values[(i * 3 + 1) % values.length]); } catch (e) { }
    try { s = objects[3].f(values[(i * 1 + 1) % values.length], values[(i * 2 + 0) % values.length], values[(i * 3 + 1) % values.length]); t = t + (typeof s === "number" ? s : 1); } catch (e) { }
    try { s = objects[4].f(values[(i * 1 + 1) % values.length], values[(i * 2 + 0) % values.length], values[(i * 3 + 1) % values.length]); t = t + (typeof s === "number" ? s : 1); } catch (e) { }
  }
  show(t);
}
first(0);
console.log(shown.join("\n"));
