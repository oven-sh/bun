// Rests of objects with getters that nobody knows, with several sets of names left out of one object, and lists of literals in sight whose getters change what comes behind them.
const tell = (o) => Reflect.ownKeys(o).map((k) => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + "=" + String(d.value) + (d.enumerable ? "" : "h"); }).join(" ");
const attempt = (f) => { try { return f(); } catch (e) { return e.message; } };
let reads = 0, log = [];
const api = {};
Object.defineProperty(api, "add", { enumerable: true, get: () => { log.push("add"); return ++reads; } });
for (const name of ["half", "twice", "hidden"]) Object.defineProperty(api, name, { enumerable: name !== "hidden", get() { log.push(name); return name + reads; } });
const bag = [api, { get a() { return ++reads; }, b: 2, get c() { return this.b; } }, { get a() { delete this.c; return 1; }, b: 2, c: 3 }, { get a() { this.z = 1; return 1; }, b: 2 }, { get a() { Object.defineProperty(this, "c", { enumerable: false }); return 1; }, b: 2, c: 3 }, { a: 1, get b() { if (reads % 3) throw new Error("b"); return 2; }, c: 4 }];
function rests(o) {
  const out = [];
  out.push(attempt(() => { const { add, ...rest } = o; return tell(rest); }));
  out.push(attempt(() => { const { a, ...rest } = o; return tell(rest); }));
  out.push(attempt(() => { const { a, b, c, ...rest } = o; return tell(rest); }));
  out.push(attempt(() => { const { c, add: sum, ...rest } = o; return tell(rest) + typeof sum; }));
  out.push(attempt(() => { const { ...rest } = o; rest.more = 1; return tell(rest); }));
  return out.join(" | ");
}
for (let turn = 0; turn < 30; turn++) { const o = bag[turn % bag.length]; log = []; console.log(turn, rests(o), log.join(), reads); }
function inSight(n) {
  const o = { get a() { delete o.b; return n; }, b: 1, get c() { return o.a; } };
  const p = { x: n, get y() { p.x = 9; return p.x; }, get z() { return this.x; } };
  return [attempt(() => Object.values(o).join()), Object.keys(o).join(), attempt(() => Object.entries(p).join(";")), Object.values(p).length, Object.keys(p)[1]].join(" ");
}
for (let n = 0; n < 6; n++) console.log(inSight(n));
let t = 0; for (let n = 0; n < 400; n++) { const q = { n, get m() { return this.n * 2; } }; for (const [k, v] of Object.entries(q)) t += v; for (const v of Object.values(q)) t += v; } console.log(t);
