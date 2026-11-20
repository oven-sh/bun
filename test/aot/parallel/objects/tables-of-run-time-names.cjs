// COUNTER: ExtraPropertyDictionaries >= 40
// A class instance as a table under names that the program never spells: its names, what lies above, deletes, order and copies.
const out = [];
const show = (v) => typeof v === "function" ? "fn" : typeof v === "object" && v ? JSON.stringify(v) : String(v);
const tell = (f) => { try { out.push(show(f())); } catch (e) { out.push(e.constructor.name); } };
const spell = (i) => "k" + (i * 7919 % 1009).toString(36) + "q";
class Drawer { constructor() { this.hasOwnProperty = undefined; this.lid = undefined; this.toString = undefined; } get shared() { return "above"; } }
class Cabinet {
  constructor() { this.drawer = new Drawer(); this.things = 0; }
  put(name, thing) { const free = this.drawer[name] === undefined || this.drawer[name] === null; if (free) { this.things += 1; this.drawer[name] = thing; } return free; }
  find(name) { const thing = this.drawer[name]; return thing === undefined || thing === null ? null : thing; }
  labels() { const said = []; for (const label in this.drawer) { const thing = this.drawer[label]; if (thing !== undefined && thing !== null) said.push(label); } return said; }
}
// many tables with other names, and with the same ones
const tables = [];
for (let t = 0; t < 60; t++) { const table = new Cabinet(); for (let i = 0; i < t % 13; i++) table.put(spell(t % 3 ? t * 40 + i : i), t * 100 + i); tables.push(table); }
tell(() => tables.map((t) => t.things).join(""));
tell(() => { let sum = 0, none = 0; for (let r = 0; r < 5; r++) for (let t = 0; t < 60; t++) for (let i = 0; i < 14; i++) { const v = tables[t].find(spell(t % 3 ? t * 40 + i : i)); if (v === null) none++; else sum += v; } return [sum, none]; });
tell(() => tables.slice(8, 20).map((t) => t.labels().join()).join(";"));
tell(() => tables.slice(0, 30).map((t, i) => [t.put(spell(i), "again"), t.put(spell(5000 + i), "more"), t.things].join()).join(";"));
// large tables
const large = new Cabinet();
for (let i = 0; i < 900; i++) large.put("n" + i + spell(i), i);
tell(() => { let s = 0; for (let i = 0; i < 950; i++) { const v = large.find("n" + i + spell(i)); s += v === null ? 1000000 : v; } return [s, large.things, large.labels().length, large.labels()[899]]; });
// names above and beside the fields
const t = new Cabinet();
tell(() => [t.find("shared"), t.find("constructor") === Drawer, t.find("toString"), t.find("valueOf") === Object.prototype.valueOf, t.find(spell(1))]);
tell(() => [t.put("toString", 1), t.put("shared", 2), t.find("toString"), t.find("shared"), Object.keys(t.drawer).join()]);
tell(() => { Drawer.prototype[spell(3)] = "from above"; return [t.find(spell(3)), t.put(spell(3), 1), tables[4].find(spell(3))]; });
tell(() => { delete Drawer.prototype[spell(3)]; return [t.find(spell(3)), t.put(spell(3), "own"), t.find(spell(3))]; });
// deletes, again and again
tell(() => { const d = new Cabinet(), s = []; for (let i = 0; i < 12; i++) { d.put(spell(i), i); if (i % 3 === 2) { s.push(delete d.drawer[spell(i - 1)]); } s.push(d.find(spell(i - 1))); } return s.concat(d.labels()).join(); });
// frozen, sealed, not extensible
tell(() => { "x"; const f = new Cabinet(); f.put(spell(1), 1); Object.freeze(f.drawer); try { f.drawer[spell(2)] = 2; } catch (e) { return e.constructor.name; } return [f.find(spell(1)), f.find(spell(2)), Object.isFrozen(f.drawer)]; });
tell(() => { const f = new Cabinet(); Object.preventExtensions(f.drawer); try { f.drawer[spell(2)] = 2; } catch (e) { return e.constructor.name; } return [f.find(spell(2)), f.labels()]; });
// setters and getters above, defined later
tell(() => { const seen = []; Object.defineProperty(Drawer.prototype, spell(77), { set(v) { seen.push(v); }, get() { return "got" + seen.length; }, configurable: true }); const s = new Cabinet(); s.drawer[spell(77)] = 4; return [s.find(spell(77)), seen, Object.keys(s.drawer).length]; });
tell(() => { Object.defineProperty(Drawer.prototype, spell(78), { value: 1, writable: false, configurable: true }); const s = new Cabinet(); try { s.drawer[spell(78)] = 4; } catch (e) { return e.constructor.name; } return [s.find(spell(78)), s.labels().length]; });
// symbols, indices, __proto__
tell(() => { const s = new Cabinet(), y = Symbol("y"); s.drawer[y] = 1; s.drawer[String(3)] = "three"; s.drawer[spell(9)] = 9; s.drawer["-1"] = "minus"; return [s.drawer[y], s.find("3"), s.find(spell(9)), s.find("-1"), s.labels().join()]; });
tell(() => { const s = new Cabinet(); const p = "__pro" + "to__"; s.drawer[p] = { inherited: 5 }; return [s.find("inherited"), Object.getPrototypeOf(s.drawer) === Drawer.prototype]; });
// the prototype is replaced, the table copied, spread, iterated, written as JSON
tell(() => { const s = new Cabinet(); s.put(spell(1), 1); s.put(spell(2), 2); Object.setPrototypeOf(s.drawer, { [spell(5)]: "five" }); return [s.find(spell(5)), s.find(spell(1)), s.find("shared")]; });
tell(() => { const s = new Cabinet(); for (let i = 0; i < 6; i++) s.put(spell(i), i); const c = { ...s.drawer }, a = Object.assign(new Drawer(), s.drawer); return [JSON.stringify(c), JSON.stringify(a), JSON.stringify(s.drawer), Object.entries(s.drawer).length]; });
// substrings of one text as names
tell(() => { const text = "alpha beta gamma delta epsilon alpha gamma zeta"; const w = new Cabinet(), s = []; let start = 0; for (let i = 0; i <= text.length; i++) if (i === text.length || text[i] === " ") { const word = text.slice(start, i); s.push(w.find(word)); w.drawer[word] = (w.find(word) || 0) + 1; start = i + 1; } return s.concat(w.labels().map((k) => k + w.find(k))).join(); });
// as a prototype of others
tell(() => { const s = new Cabinet(); for (let i = 0; i < 5; i++) s.put(spell(i), i); const child = Object.create(s.drawer); const before = child[spell(6)]; s.put(spell(6), "late"); return [before, child[spell(6)], child[spell(2)], spell(2) in child, Object.keys(child).length]; });
console.log(out.join("\n"));
