// Pairs are constructed first and extended later by code that does not know them. Each has a Structure of its own then.
// The names are stored by key alone, so none of them becomes a field of Pair.
function Pair(car, cdr) { this.car = car; this.cdr = cdr; }
Pair.prototype.sum = function () { return this.car + 1; };
Pair.prototype.inherited = "above";
const any = JSON.parse("[]"), wide = JSON.parse('[1, null, "t", 2.5, [3]]'), tag = Symbol("tag");
const make = [k => new Pair(wide[k % 5], wide[3]), k => new Pair(wide[(k + 1) % 5], wide[k % 3]), k => [new Pair(wide[(k + 2) % 5], wide[1])][0]];
globalThis.extend = (o, k, v) => { o[k] = v; return o; };
globalThis.extend(JSON.parse("{}"), "q", 1);
for (let i = 0; i < 9; i++) any.push(make[i % 3](i));
for (let i = 0; i < 9; i++) { globalThis.extend(any[i], "later", i); globalThis.extend(any[i], "further", "f" + i); if (i & 1) globalThis.extend(any[i], tag, i); if (i % 3 === 0) globalThis.extend(any[i], 5, "five"); }
globalThis.visits = {
  read: o => o.later + ":" + o.further,
  key: (o, i) => o[["later", "further", "car", "sum", "missing"][i % 5]] === undefined ? "none" : typeof o[["later", "further", "car", "sum", "missing"][i % 5]],
  has: o => ["later", "missing", "inherited", "car", tag, 5].map(k => (k in o) + "" + Object.hasOwn(o, k)).join(),
  store: (o, i) => { globalThis.extend(o, "later", i); globalThis.extend(o, "further", o.further + "!"); return o.later + o.further; },
  symbol: o => o[tag] === undefined ? "none" : globalThis.extend(o, tag, o[tag] + 1)[tag],
  inherited: o => o.inherited + o.sum(),
  removed: (o, i) => { delete o.later; const gone = o.later === undefined && !("later" in o); globalThis.extend(o, "later", -i); return gone + "" + o.later; },
  shadowed: (o, i) => { globalThis.extend(o, "inherited", "own" + i); const own = o.inherited; delete o.inherited; return own + o.inherited; },
  accessor: (o, i) => { Object.defineProperty(o, "got", { get() { return this === o ? i : "other"; }, configurable: true }); return o.got; },
  readonly: (o, i) => { Object.defineProperty(o, "fixed", { value: i, writable: false, configurable: true }); globalThis.extend(o, "fixed", -1); return o.fixed; },
  many: (o, i) => { for (let j = 0; j < 80; j++) globalThis.extend(o, "k" + j, j + i); let s = 0; for (let j = 0; j < 80; j++) s += o["k" + j]; return s + "," + o.k1 + "," + o.k2 + "," + o.later; },
  keys: o => Object.keys(o).filter(k => !k.startsWith("k")).join() + Reflect.ownKeys(o).length,
  heir: o => { const h = Object.create(o); const s = h.later; globalThis.extend(h, "later", "own"); return s + h.later + o.later; },
  frozen: o => { Object.freeze(o); globalThis.extend(o, "later", "thawed"); return o.later; },
};
for (const name of Object.keys(globalThis.visits)) {
  const visit = globalThis.visits[name], out = [];
  for (let round = 0; round < 40; round++) for (let i = 0; i < any.length; i++) { const answer = visit(any[i], i + round); if (round === 0 || round === 39) out.push(answer); }
  console.log(name, out.join(" "));
}
Bun.gc(true);
console.log(any.map(o => o.later + "" + o.further + o.car).join(" "));
