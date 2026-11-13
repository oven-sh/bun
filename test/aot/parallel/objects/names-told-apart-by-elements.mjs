// Reads under the elements of a list off objects of a few names: names that are there, that are not, names that are numbers, symbols and objects, lists and objects that change in between.
// STATISTIC: AccessesDispatchedByKeyString >= 1
const log = []; let effects = 0;
const one = v => typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : v === undefined ? "u" : typeof v === "function" ? "fn" : typeof v === "symbol" ? "sym" : JSON.stringify(v);
const o = { a: 1, b: 2, c: 3 }, names = ["a", "b", "c"];
function ofFile(n) { let sum = 0; for (let i = 0; i < n; i++) sum += o[names[i % 3]]; return sum; }
function ofParameters(p, list, n) { let sum = 0; for (let i = 0; i < n; i++) sum += p[list[i % list.length]]; return sum; }
function ofTexts(p, list, n) { let text = ""; for (let i = 0; i < n; i++) text += p[list[i % list.length]]; return text; }
function withStores(p, list, n) { let sum = 0; for (let i = 0; i < n; i++) { sum += p[list[i % list.length]]; if (i === 4) p.a = 10; if (i === 6) list[0] = "c"; } return sum; }
function withDeletes(p, list, n) { let sum = 0; for (let i = 0; i < n; i++) { sum += p[list[i % list.length]] ?? 100; if (i === 4) delete p.a; } return sum; }
const keys = [["a", "b", "c"], ["c", "c", "a"], ["a" + "", "b".slice(0), String.fromCharCode(99)], ["a", "z", "b"], ["a", 1, "b"], ["toString", "a", "b"], [Symbol.iterator, "a", "b"], [{ toString() { effects++; return "b"; } }, "a", "c"], ["a", , "c"], [undefined, "a", null], [["a"], "b", "c"], ["__proto__", "a", "b"], ["a\u0000", "b", "c"], ["abc".at(0), "xb"[1], `${"c"}`]];
const objects = [() => ({ a: 1, b: 2, c: 3 }), () => ({ c: 1, a: -0, b: 0.5 }), () => ({ a: 1, b: 2, c: 3, d: 4 }), () => ({ a: 1, b: 2 }), () => ({ get a() { effects += 10; return 5; }, b: 2, c: 3 }), () => Object.freeze({ a: 1, b: 2, c: 3 }), () => Object.assign(Object.create({ c: 9 }), { a: 1, b: 2 }), () => new Proxy({ a: 1, b: 2, c: 3 }, { get(t, k) { effects += 100; return t[k]; } }), () => { const p = { a: 1, b: 2, c: 3 }; delete p.b; return p; }, () => [1, 2, 3], () => JSON.parse('{"a":4,"b":5,"c":6}')];
const said = run => { effects = 0; try { return one(run()); } catch (e) { return "threw " + e?.constructor?.name; } };
for (const [k, list] of keys.entries()) for (const [j, make] of objects.entries()) for (const [name, run] of Object.entries({ ofParameters, ofTexts, withStores, withDeletes })) log.push([name, k, j, said(() => run(make(), list.slice(), 9)), effects].join(" "));
log.push(said(() => ofFile(9)), said(() => { o.b = 7; return ofFile(9); }), said(() => { names[1] = "q"; return ofFile(9); }), said(() => { names[1] = "b"; o.d = 1; return ofFile(9); }), said(() => { delete o.a; return ofFile(9); }), said(() => { Object.defineProperty(o, "c", { get() { effects++; return 50; } }); return ofFile(9); }), effects);
console.log(log.join("\n"));
