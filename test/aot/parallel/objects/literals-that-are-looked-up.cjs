// STATISTIC: LiteralsSharedByLookups >= 6
// A literal of constants that a function or a loop only looks a key up in is made once; one that anything else sees is made each time.
const out = [], keys = ["a", "b", 1, "2", "zz", "toString", "__proto__", "constructor", null, undefined, -1, Symbol("s"), { toString: () => "b" }];
const shown = v => typeof v === "function" ? `fn ${v.name}` : typeof v === "object" && v ? "{" + Object.keys(v) + "}" : Object.is(v, -0) ? "-0" : String(v);
function named(key) { const names = { a: 1, b: "bee", "2": -0 }; return names[key]; }
function numbered(key) { const names = { 1: "one", 2: "two", 30: "thirty" }; return names[key]; }
function either(key) { return { a: "x", 1: "y" }[key] || "none"; }
function known(key) { const all = { a: true, b: undefined, 1: null }; return key in all; }
class Lookup { at(key) { const table = { a: 0.5, b: 1e300, 1: 10n }; return table[key]; } }
function* each() { for (const key of keys) yield { a: "g", 2: "h" }[key]; }
function loop(turns) { let n = 0; for (let k = 0; k < turns; k++) { const t = { 0: 1, 1: 2, 2: 3 }; n += t[k % 4] ?? 100; } return n; }
function stored(key) { const t = { a: 1, b: 2 }; const before = t[key]; t[key] = 9; return before; }
function handed(key) { const t = { a: 1, b: 2 }; return [t[key], t]; }
function counted(key) { const t = { a: 1, b: 2, 1: 3 }; return t[key]++; }
function nested(key) { const t = { a: { v: 1 }, b: { v: 2 } }; const inner = t[key]; if (inner && typeof inner.v === "number") inner.v += 10; return inner && inner.v; }
function called(key) { const t = { a: 1, toString() { return "own"; } }; return typeof t[key] === "function" ? t[key]() : t[key]; }
function above(key) { const t = { __proto__: { up: 5 }, a: 1 }; return t[key]; }
const lookup = new Lookup();
for (let turn = 0; turn < 2; turn++) {
  for (const key of keys) out.push([named(key), numbered(key), either(key), known(key), lookup.at(key), stored(key), counted(key), nested(key), called(key), above(key)].map(shown).join(" "));
  out.push([...each()].map(shown).join(), loop(40), handed("a")[1] === handed("a")[1]);
}
handed("a")[1].a = 7;
out.push(handed("a")[0]);
let thrown = 0;
for (const key of [{ toString() { throw new RangeError("key"); } }, Object.create(null)]) { try { named(key); } catch { thrown++; } try { known(key); } catch { thrown++; } }
console.log(out.join("\n"), thrown);
