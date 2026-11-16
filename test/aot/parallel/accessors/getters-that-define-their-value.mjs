// A getter of a literal that defines itself as a value at the first read, under each set of attributes, and what is done to such a property then.
const tell = (o) => Reflect.ownKeys(o).map((k) => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + String(d.value) : "<" + !!d.get + "|" + !!d.set + ">") + (d.enumerable ? "" : "h") + (d.configurable ? "" : "f") + (d.writable === false ? "r" : ""); }).join(" ");
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
let made = 0;
const makers = [
  (n) => ({ get table() { made++; const value = n * 2; Object.defineProperty(this, "table", { value, enumerable: true }); return value; } }),
  (n) => ({ get table() { made++; const value = [n]; Object.defineProperty(this, "table", { value }); return value; } }),
  (n) => ({ get table() { made++; Object.defineProperty(this, "table", { value: n, writable: true }); return n; } }),
  (n) => ({ get table() { made++; Object.defineProperty(this, "table", { value: n, writable: true, enumerable: true, configurable: true }); return n; } }),
  (n) => ({ get table() { made++; Object.defineProperty(this, "table", { value: n, configurable: false, enumerable: false }); return n; } }),
  (n) => ({ before: n, get table() { made++; Object.defineProperty(this, "table", { value: "t" + n, enumerable: n % 2 === 0 }); return n; }, set table(v) { made += v; }, after: n }),
  (n) => { const o = { get table() { made++; Object.defineProperty(o, "table", { value: n }); return n; } }; return o; },
  (n) => ({ get table() { made++; delete this.table; return this.table = n; } }),
  (n) => ({ get table() { made++; return n; } }),
];
const uses = [
  (o) => [o.table, o.table, o.table].join(),
  (o) => { let t = 0; for (let i = 0; i < 4; i++) t += +o.table; return t; },
  (o) => { const first = o.table; return first + " " + attempt(() => { o.table = 5; return "stored"; }) + o.table; },
  (o) => { attempt(() => { o.table = 5; }); return o.table; },
  (o) => o.table + " " + attempt(() => delete o.table) + " " + o.table,
  (o) => attempt(() => delete o.table) + " " + o.table,
  (o) => o.table + " " + attempt(() => Object.defineProperty(o, "table", { get() { return "anew"; } }) && o.table),
  (o) => attempt(() => Object.defineProperty(o, "table", { value: 9, writable: true }) && o.table),
  (o) => tell({ ...o }) + " " + tell(o),
  (o) => { o.table; return tell({ ...o }) + Object.keys(o).join() + JSON.stringify(o) + Object.values(o).join(); },
  (o) => { Object.freeze(o); return attempt(() => o.table) + " " + made; },
  (o) => { const keys = []; for (const k in o) keys.push(k + o[k]); return keys.join(); },
];
for (let round = 0; round < 3; round++)
  for (let m = 0; m < makers.length; m++)
    for (let u = 0; u < uses.length; u++) { const o = makers[m](m + u + round); console.log(m, u, attempt(() => uses[u](o)), tell(o), made); }
function lazy(size) {
  let count = 0;
  const object = { get table() { count++; const value = Array.from({ length: size }, (_, i) => i * size); Object.defineProperty(this, "table", { value, enumerable: true }); return value; } };
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += object.table.length + object.table.reduce((a, b) => a + b, 0);
  return sum + " made " + count;
}
let text = ""; for (let i = 0; i < 300; i++) text = lazy(i % 7); console.log(text);
