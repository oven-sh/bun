// Records whose names module code puts together out of a constant and the names of another record, read under those names in every way.
const out = [];
const show = (v) => typeof v === "function" ? "fn" : typeof v === "object" && v ? JSON.stringify(v) : String(v);
const tell = (f) => { try { out.push(show(f())); } catch (e) { out.push(e.constructor.name); } };
class Kind { constructor(label, conf = {}) { this.label = label; this.loop = !!conf.loop; this.update = null; } add(v) { return this.label.length + v; } }
class Word extends Kind { constructor(label, conf) { super(label, conf); this.word = label; } }
const types = { num: new Kind("num"), name: new Kind("name"), _early: new Kind("early") };
const keywords = { break: new Word("break"), for: new Word("for", { loop: true }), early: new Word("late early"), get: new Word("get"), "a b": new Word("a b"), 0: new Word("zero"), _proto__: new Word("proto") };
Object.keys(keywords).forEach((name) => { types["_" + name] = keywords[name]; });
const tables = {}; for (const k of Object.keys(keywords)) tables[`is${k}Of`] = k.length;
const numbers = { one: 1, two: 2 }; for (const [k, v] of Object.entries(numbers)) numbers[k + "Twice"] = v * 2;
const bare = Object.create(null); for (const k in keywords) bare["x" + k] = keywords[k].label;
const only = {}; for (const k in numbers) if (k !== "two") only["n_" + k] = k;
function scan(t, i) { if (t === types._break) return 1; if (t === types._for) return 2; if (t === types._early) return 3; if (t === types._get || t === types._set) return 4; return t === types.num ? 5 : t && t.add ? t.add(i) : 6; }
function run(m) { const all = [types._break, types._for, types._early, types._get, types.num, types._none, types["_a b"], types._0, types["__proto__"], keywords.for]; let s = 0; for (let i = 0; i < m; i++) for (let j = 0; j < all.length; j++) s = (s * 31 + scan(all[j], i & 3) + (tables.isforOf | 0) + (numbers.oneTwice || 0) + (bare.xbreak ? 1 : 0) + (only.n_one === "one" ? 2 : 0) + (only.n_two === undefined ? 3 : 0)) | 0; return s; }
tell(() => run(1)); tell(() => run(50));
for (const r of [types, tables, numbers, bare, only]) { tell(() => Object.keys(r).join()); tell(() => r); }
tell(() => "_for" in types); tell(() => Object.hasOwn(types, "_none")); tell(() => Object.getOwnPropertyDescriptor(types, "_get"));
tell(() => { const { _break, _get: g, _none = 7, ...rest } = types; return [_break.label, g.label, _none, Object.keys(rest).length]; });
types._break.update = function () { return this.label; }; tell(() => types._break.update());
delete types._early; tell(() => run(3)); types._early = keywords.early; tell(() => run(3)); tell(() => Object.keys(types).join());
keywords.set = new Word("set"); types["_" + "set"] = keywords.set; tell(() => run(3)); tell(() => types._set.label);
Object.defineProperty(types, "_for", { get() { return types.num; }, configurable: true }); tell(() => run(3));
Object.defineProperty(types, "_for", { value: 5, writable: false }); tell(() => run(3)); try { types._for = 1; out.push("silent"); } catch (e) { out.push(e.constructor.name); }
Object.setPrototypeOf(types, { _none: keywords.break }); tell(() => run(3)); tell(() => types._none.label);
Object.freeze(types); types._get = null; delete types._get; tell(() => types._get.label); tell(() => run(20));
const copy = { ...types }; tell(() => [copy._get.label, copy._break === types._break, Object.keys(copy).length]);
for (const line of out) console.log(line);
