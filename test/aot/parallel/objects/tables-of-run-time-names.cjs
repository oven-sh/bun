// COUNTER: ExtraPropertyDictionaries >= 40
// A class instance as a table under names that the program never spells: its names, what lies above, deletes, order and copies.
const out = [];
const show = (v) => typeof v === "function" ? "fn" : typeof v === "object" && v ? JSON.stringify(v) : String(v);
const tell = (f) => { try { out.push(show(f())); } catch (e) { out.push(e.constructor.name); } };
const spell = (i) => "k" + (i * 7919 % 1009).toString(36) + "q";
class Intrinsics { constructor() { this.prototype = undefined; this.toString = undefined; this.hasOwnProperty = undefined; } get shared() { return "above"; } }
class Table {
  constructor() { this.count = 0; this.table = new Intrinsics(); }
  add(key, value) { if (this.table[key] != undefined) return false; this.table[key] = value; this.count++; return true; }
  lookup(key) { const found = this.table[key]; return found != undefined ? found : null; }
  keys() { const names = []; for (const k in this.table) if (this.table[k] != undefined) names.push(k); return names; }
}
// many tables with other names, and with the same ones
const tables = [];
for (let t = 0; t < 60; t++) { const table = new Table(); for (let i = 0; i < t % 13; i++) table.add(spell(t % 3 ? t * 40 + i : i), t * 100 + i); tables.push(table); }
tell(() => tables.map((t) => t.count).join(""));
tell(() => { let sum = 0, none = 0; for (let r = 0; r < 5; r++) for (let t = 0; t < 60; t++) for (let i = 0; i < 14; i++) { const v = tables[t].lookup(spell(t % 3 ? t * 40 + i : i)); if (v === null) none++; else sum += v; } return [sum, none]; });
tell(() => tables.slice(8, 20).map((t) => t.keys().join()).join(";"));
tell(() => tables.slice(0, 30).map((t, i) => [t.add(spell(i), "again"), t.add(spell(5000 + i), "more"), t.count].join()).join(";"));
// large tables
const large = new Table();
for (let i = 0; i < 900; i++) large.add("n" + i + spell(i), i);
tell(() => { let s = 0; for (let i = 0; i < 950; i++) { const v = large.lookup("n" + i + spell(i)); s += v === null ? 1000000 : v; } return [s, large.count, large.keys().length, large.keys()[899]]; });
// names above and beside the fields
const t = new Table();
tell(() => [t.lookup("shared"), t.lookup("constructor") === Intrinsics, t.lookup("toString"), t.lookup("valueOf") === Object.prototype.valueOf, t.lookup(spell(1))]);
tell(() => [t.add("toString", 1), t.add("shared", 2), t.lookup("toString"), t.lookup("shared"), Object.keys(t.table).join()]);
tell(() => { Intrinsics.prototype[spell(3)] = "from above"; return [t.lookup(spell(3)), t.add(spell(3), 1), tables[4].lookup(spell(3))]; });
tell(() => { delete Intrinsics.prototype[spell(3)]; return [t.lookup(spell(3)), t.add(spell(3), "own"), t.lookup(spell(3))]; });
// deletes, again and again
tell(() => { const d = new Table(), s = []; for (let i = 0; i < 12; i++) { d.add(spell(i), i); if (i % 3 === 2) { s.push(delete d.table[spell(i - 1)]); } s.push(d.lookup(spell(i - 1))); } return s.concat(d.keys()).join(); });
// frozen, sealed, not extensible
tell(() => { "x"; const f = new Table(); f.add(spell(1), 1); Object.freeze(f.table); try { f.table[spell(2)] = 2; } catch (e) { return e.constructor.name; } return [f.lookup(spell(1)), f.lookup(spell(2)), Object.isFrozen(f.table)]; });
tell(() => { const f = new Table(); Object.preventExtensions(f.table); try { f.table[spell(2)] = 2; } catch (e) { return e.constructor.name; } return [f.lookup(spell(2)), f.keys()]; });
// setters and getters above, defined later
tell(() => { const seen = []; Object.defineProperty(Intrinsics.prototype, spell(77), { set(v) { seen.push(v); }, get() { return "got" + seen.length; }, configurable: true }); const s = new Table(); s.table[spell(77)] = 4; return [s.lookup(spell(77)), seen, Object.keys(s.table).length]; });
tell(() => { Object.defineProperty(Intrinsics.prototype, spell(78), { value: 1, writable: false, configurable: true }); const s = new Table(); try { s.table[spell(78)] = 4; } catch (e) { return e.constructor.name; } return [s.lookup(spell(78)), s.keys().length]; });
// symbols, indices, __proto__
tell(() => { const s = new Table(), y = Symbol("y"); s.table[y] = 1; s.table[String(3)] = "three"; s.table[spell(9)] = 9; s.table["-1"] = "minus"; return [s.table[y], s.lookup("3"), s.lookup(spell(9)), s.lookup("-1"), s.keys().join()]; });
tell(() => { const s = new Table(); const p = "__pro" + "to__"; s.table[p] = { inherited: 5 }; return [s.lookup("inherited"), Object.getPrototypeOf(s.table) === Intrinsics.prototype]; });
// the prototype is replaced, the table copied, spread, iterated, written as JSON
tell(() => { const s = new Table(); s.add(spell(1), 1); s.add(spell(2), 2); Object.setPrototypeOf(s.table, { [spell(5)]: "five" }); return [s.lookup(spell(5)), s.lookup(spell(1)), s.lookup("shared")]; });
tell(() => { const s = new Table(); for (let i = 0; i < 6; i++) s.add(spell(i), i); const c = { ...s.table }, a = Object.assign(new Intrinsics(), s.table); return [JSON.stringify(c), JSON.stringify(a), JSON.stringify(s.table), Object.entries(s.table).length]; });
// substrings of one text as names
tell(() => { const text = "alpha beta gamma delta epsilon alpha gamma zeta"; const w = new Table(), s = []; let start = 0; for (let i = 0; i <= text.length; i++) if (i === text.length || text[i] === " ") { const word = text.slice(start, i); s.push(w.lookup(word)); w.table[word] = (w.lookup(word) || 0) + 1; start = i + 1; } return s.concat(w.keys().map((k) => k + w.lookup(k))).join(); });
// as a prototype of others
tell(() => { const s = new Table(); for (let i = 0; i < 5; i++) s.add(spell(i), i); const child = Object.create(s.table); const before = child[spell(6)]; s.add(spell(6), "late"); return [before, child[spell(6)], child[spell(2)], spell(2) in child, Object.keys(child).length]; });
console.log(out.join("\n"));
