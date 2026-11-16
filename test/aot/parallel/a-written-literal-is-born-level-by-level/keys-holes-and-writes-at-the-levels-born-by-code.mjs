// Each level above a list of leaves is born by code. Here the levels born by code hold what the witness of the forms does not: holes, leaves of every kind beside a list, numeric, repeated and computed keys,
// a written prototype, empty lists and records, a frozen record, a Map made of pairs. Each maker is called, all it made is written into, and it is called again: the second answer is as the first was, and shares no cell with it.
const N = 5;
const makers = [
  function holesOutside() { return [[1, 2], , [3], , ]; },
  function leavesBeside() { return [[1], -0, 7n, undefined, null, NaN, `t`, -1, void 0, true, 1e21]; },
  function numbered() { return { b: [1], 2: [2], a: [3], 1: [4], "-1": [5], "01": [6] }; },
  function twice() { return { a: 1, b: [2], a: [3], b: 4 }; },
  function computed() { return { ["x" + 1]: [1], [2]: [2], ["__proto__"]: [3], [`k`]: [4] }; },
  function above() { return { __proto__: [1, 2], own: [3] }; },
  function short() { return { N, list: [N, N + 1] }; },
  function deep() { return { a: { b: { c: [1, { d: [2] }] } }, e: [[[]], [[3]]] }; },
  function empties() { return [[], {}, [[]], [{}], { a: [] }, [1]]; },
  function frozen() { return Object.freeze({ list: [1, 2], at: { x: [0] } }); },
  function pairs() { return [...new Map([["a", [1]], ["b", [2]]])]; },
];
const isObject = v => Object(v) === v, usual = p => p === Object.prototype || p === Array.prototype;
function show(v) {
  if (!isObject(v)) return typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : String(v);
  const mark = usual(Object.getPrototypeOf(v)) ? "" : "^" + show(Object.getPrototypeOf(v));
  if (Array.isArray(v)) { const parts = []; for (let i = 0; i < v.length; i++) parts.push(i in v ? show(v[i]) : "<hole>"); return "[" + parts.join() + "]" + mark; }
  return "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join() + "}" + mark;
}
function change(v) { if (!isObject(v) || usual(v)) return; for (const k of Object.keys(v)) change(v[k]); change(Object.getPrototypeOf(v)); if (Object.isFrozen(v)) return; if (Array.isArray(v)) { v[0] = "changed"; v.push("more"); } else v.added = "more"; }
function shared(a, b) { if (!isObject(a) || !isObject(b)) return 0; let n = a === b ? 1 : 0; for (const k of Object.keys(a)) n += shared(a[k], b[k]); return n; }
const said = [];
for (const make of makers) { const first = make(), before = show(first); change(first); const second = make(); said.push(make.name + "=" + show(second) + "/" + (show(second) === before) + "/" + shared(first, second)); }
let kept; for (let t = 0; t < 3; t++) { const made = { list: [1, 2], rows: [[3], , [4]] }; if (kept) said.push("turn=" + show(made) + "/" + shared(kept, made)); change(made); kept = made; }
console.log("SAID " + said.join(" | "));
