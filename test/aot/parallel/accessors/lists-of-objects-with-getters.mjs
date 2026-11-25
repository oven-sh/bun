// Object.values, entries, keys and spreads of objects that nobody knows and that have getters, hidden names and values that are not writable.
const bag = new Map(); let log = [], reads = 0;
const through = (o) => { bag.set(bag.size % 3, o); return bag.get((bag.size - 1) % 3) === o ? o : bag.get([...bag.keys()].find((k) => bag.get(k) === o)); };
const tell = (o) => Reflect.ownKeys(o).map((k) => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + String(d.value) : "<" + !!d.get + "|" + !!d.set + ">") + (d.enumerable ? "" : "h"); }).join(" ");
const attempt = (f) => { try { return f(); } catch (e) { return e.message; } };
const sym = Symbol("s");
const makers = [
  (n) => ({ a: n, get b() { log.push("b"); return this.a + ++reads; }, c: 3 }),
  (n) => ({ get a() { return n; }, get b() { return reads; }, get c() { return ++reads; } }),
  (n) => ({ get a() { delete this.c; return n; }, b: 1, c: 2 }),
  (n) => ({ get a() { Object.defineProperty(this, "c", { enumerable: false }); return n; }, b: 1, c: 2 }),
  (n) => ({ get a() { this.z = n; return 1; }, b: 2 }),
  (n) => ({ x: 1, get a() { if (n % 4 === 3) throw new Error("a" + n); return n; }, get b() { log.push("b"); return 2; } }),
  (n) => { const o = { plain: n }; Object.defineProperty(o, "hidden", { value: n + 1, writable: true }); Object.defineProperty(o, "fixed", { value: n + 2, enumerable: true }); Object.defineProperty(o, "double", { get() { return this.plain * 2; }, enumerable: true, configurable: true }); return o; },
  (n) => { const o = { plain: n }; Object.defineProperty(o, "none", { get() { log.push("none"); return 1; } }); return o; },
  (n) => ({ get [sym]() { log.push("sym"); return n; }, get a() { return 1; } }),
  (n) => ({ get 5() { log.push("5"); return n; }, get a() { return 1; }, 2: 3 }),
  (n) => Object.freeze({ get a() { return n; }, b: 2 }),
  (n) => { const o = { get a() { return n; } }; for (const name of ["q", "r"]) Object.defineProperty(o, name, { enumerable: true, get: () => name + n }); return o; },
  (n) => ({ set a(v) { }, b: n }),
];
for (let turn = 0; turn < 260; turn++) {
  const make = makers[turn % makers.length], n = turn % 7; log = [];
  const line = [
    attempt(() => Object.values(through(make(n))).join()), attempt(() => Object.entries(through(make(n))).join(";")), Object.keys(through(make(n))).join(), Object.getOwnPropertyNames(through(make(n))).join(), Reflect.ownKeys(through(make(n))).length,
    attempt(() => tell({ ...through(make(n)) })), attempt(() => tell({ a: 0, ...through(make(n)), z: 1 })), attempt(() => { const { a, ...rest } = through(make(n)); return String(a) + tell(rest); }), attempt(() => JSON.stringify(through(make(n)))),
    attempt(() => { let t = ""; for (const [k, v] of Object.entries(through(make(n)))) t += k + v; return t; }), attempt(() => { const o = through(make(n)); const keys = []; for (const k in o) keys.push(k); return keys.join(); }),
  ];
  if (turn < 39 || turn % 11 === 0) console.log(turn, line.join(" | "), log.join(), reads);
}
