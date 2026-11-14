// list.includes(x) and list.indexOf(x) in loops, of values and lists of which nothing is known: integers, fractions, -0, NaN, texts, symbols, big integers, holes, lists of every kind, short and long.
// STATISTIC: UnknownValuesSearchedByStub >= 4
function included(list, values) { let found = ""; for (let i = 0; i < values.length; i++) found += list.includes(values[i]) ? "1" : "0"; return found; }
function indexes(list, values) { const found = []; for (let i = 0; i < values.length; i++) found.push(list.indexOf(values[i])); return found.join(); }
function from(list, values, start) { const found = []; for (let i = 0; i < values.length; i++) found.push(list.indexOf(values[i], start) + ":" + list.includes(values[i], start)); return found.join(); }
function unique(values) { const out = []; for (let i = 0; i < values.length; i++) if (!out.includes(values[i])) out.push(values[i]); return out.length; }
function firsts(values) { const out = []; for (const value of values) if (out.indexOf(value) < 0) out.push(value); return out.length; }
function common(a, b) { let n = 0; for (const value of a) if (b.includes(value)) n++; return n; }
const symbol = Symbol("s"), object = { valueOf() { return 1; } };
const long = length => Array.from({ length }, (_, i) => i * 3);
const lists = [[], [1, 2, 3, 2147483647, -1], [0.5, 1, 2, -0, 3.25], [NaN, 1.5, Infinity], [0, -0, 5], [1, , 3, , 5], [0.5, , 1], ["a", 1, "b", 2.5, null, undefined], [symbol, object, 1n, 2n, "1", 1], long(8), long(40), long(400), long(400).map(x => x / 2), long(40).map(String), Object.freeze([1, 2, 3]), new Array(9), Object.assign([1, 2, 3], { 7: 1 }), new (class extends Array {})(1, 2, 3), new Int32Array([1, 2, 3]), new Float64Array([1, 0.5, NaN, -0]), "a1b2"];
const values = [1, 2, 3, 0, -0, 0.5, 1.5, NaN, -1, 2147483647, 2147483648, Infinity, "a", "1", "", null, undefined, true, symbol, object, {}, 1n, 2n, 3, 9, 117, 1197, 1200];
let digest = 0, cases = 0;
for (let turn = 0; turn < 3; turn++) {
  for (const list of lists) {
    for (const run of [() => included(list, values), () => indexes(list, values), () => from(list, values, 2), () => from(list, values, -3), () => from(list, values, 1e10), () => unique(Array.from(list)), () => firsts(Array.from(list)), () => common(values, Array.from(list)), () => common(Array.from(list), values)]) {
      let line;
      try { line = String(run()); } catch (error) { line = error.constructor.name; }
      cases++;
      for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
      if (cases % 23 === 7) console.log(line.slice(0, 160));
    }
  }
  if (turn === 1) lists.push([1, 2, 3].concat([7]), Array.from({ length: 5 }, (_, i) => i), JSON.parse("[1,2,1.5,\"x\",null]"));
}
console.log(cases, digest);
