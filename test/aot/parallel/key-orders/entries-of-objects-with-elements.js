// Object.entries() and Object.values() of objects that hold elements beside their fields.
const lines = [];
function value(v) { return typeof v === "function" ? "F" : typeof v === "symbol" ? "S" : v; }
function show(o) {
  for (const list of [() => Object.entries(o).map(e => e[0] + "=" + String(value(e[1]))), () => Object.values(o).map(v => String(value(v))), () => Object.keys(o), () => { const all = []; for (const [k, v] of Object.entries(o)) all.push(k, String(value(v))); return all; }, () => [...new Map(Object.entries(o)).keys()], () => [JSON.stringify(Object.fromEntries(Object.entries(o)), (k, v) => value(v))]]) {
    let said;
    try { said = list().join(); } catch (e) { said = e.constructor.name; }
    lines.push(said);
  }
}
let calls = 0;
const makers = [
  i => ({ a: i, 3: 1, b: 2, 1: 5 }),
  i => ({ "-1": 1, "+1": 2, 100: i, 1234: 2, "1st": 3, a: 4 }),
  i => { const o = { a: 1, b: 2 }; for (let k = 9; k >= 0; k -= 2) o[k] = k * i; return o; },
  i => { const o = { a: 1, 4294967294: 1, 4294967295: 2, 5000000000: 3, "01": 4 }; o[7] = i; return o; },
  i => { const o = { a: 1, 2: 2, b: 3 }; Object.defineProperty(o, 1, { get() { calls++; return i; }, enumerable: true, configurable: true }); return o; },
  i => { const o = { a: 1, 2: 2, b: 3 }; Object.defineProperty(o, 1, { value: i, enumerable: false, configurable: true }); Object.defineProperty(o, "a", { enumerable: false }); return o; },
  i => { const o = { a: 1, 2: 2, get b() { calls++; return 3; } }; o[0] = i; return o; },
  i => Object.freeze({ a: 1, 2: 2, b: i }),
  i => { const o = { a: 1, 2: 2, b: i, 5: 1.5, 6: "x" }; delete o[2]; delete o.a; o[8] = {}; return o; },
  i => { const o = { a: 1, 2: 2 }; o["x" + (i & 1)] = 1; o.b = 2; return o; },
  i => { const o = { a: 1, 2: 2, [Symbol.iterator]: 3 }; o[Symbol.for("s")] = i; return o; },
  i => Object.assign(Object.create({ 1: 1, p: 2 }), { 5: i, q: 1 }),
  i => { class C { constructor() { this[2] = i; this.a = 1; this[0] = 2; } m() { } } return new C; },
  i => { const o = { a: () => i, 0: () => 1, b() { return 2; } }; return o; },
  i => { const o = { 0: 0.5, 1: 1, 2: undefined, 3: null, a: undefined, b: null }; o[1] = i / 2; return o; },
  i => { const o = { a: 1 }; o[100000 + i] = 1; o[3] = 2; o[200000] = 3; o.b = 4; return o; },
];
for (let i = 0; i < 6; i++) for (const make of makers) { const o = make(i); show(o); try { o.late = 1; o[4] = 2; } catch { } show(o); }
let digest = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(lines.length, digest, calls);
console.log(lines.join("\n"));
