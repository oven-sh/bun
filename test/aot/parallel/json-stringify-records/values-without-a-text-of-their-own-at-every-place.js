const word = process.argv[2] ?? "word";
const values = {
  nan: () => NaN, infinity: () => Infinity, minusZero: () => -0, undefined: () => undefined, null: () => null,
  function: () => () => word, symbol: () => Symbol.iterator, text: () => word, empty: () => "", list: () => [], object: () => ({}),
  big: () => 2 ** 53, boxed: () => new Number(NaN), date: () => new Date(NaN),
};
const show = run => { try { return String(run()); } catch (error) { return error.constructor.name; } };
function atTheRoot(v) { return JSON.stringify(v); }
function asAnElement(v) { return JSON.stringify([v]); }
function amongElements(v) { return JSON.stringify([1, v, "x"]); }
function amongNumbers(v) { return JSON.stringify([1.5, v, 2.5]); }
function asAField(v) { return JSON.stringify({ v }); }
function amongFields(v) { return JSON.stringify({ a: 1, v, z: "z" }); }
function asTheLastField(v) { return JSON.stringify({ a: 1, v }); }
function nested(v) { return JSON.stringify({ a: [{ v }, [v]], b: { c: [v, v] } }); }
function behindAHole(v) { return JSON.stringify([, v]); }
function beforeAHole(v) { const list = [v, 1, 2]; delete list[1]; return JSON.stringify(list); }
function fromToJSON(v) { return JSON.stringify({ toJSON() { return v; } }); }
function fromToJSONInAList(v) { return JSON.stringify([{ toJSON() { return v; } }]); }
function fromToJSONInAField(v) { return JSON.stringify({ a: 1, m: { toJSON() { return v; } }, z: 2 }); }
function fromToJSONOfAList(v) { const list = [1.5, 2.5]; list.toJSON = () => v; return JSON.stringify(list); }
function fromToJSONOfAListInAField(v) { const list = [1.5, 2.5]; list.toJSON = () => v; return JSON.stringify({ a: 1, list }); }
function fromAGetter(v) { return JSON.stringify({ a: 1, get v() { return v; } }); }
const places = [atTheRoot, asAnElement, amongElements, amongNumbers, asAField, amongFields, asTheLastField, nested, behindAHole, beforeAHole, fromToJSON, fromToJSONInAList, fromToJSONInAField, fromToJSONOfAList, fromToJSONOfAListInAField, fromAGetter];
for (const place of places) {
  for (const name in values) console.log(place.name, name, show(() => place(values[name]())));
}
function nanAtTheRoot() { return JSON.stringify(NaN) + JSON.stringify([NaN]) + JSON.stringify({ n: NaN }) + JSON.stringify([[NaN], { n: [NaN] }]); }
function nothingAtTheRoot() { return String(JSON.stringify(undefined)) + String(JSON.stringify(() => 1)) + String(JSON.stringify(Symbol.iterator)) + JSON.stringify(null); }
function holes() { return JSON.stringify([, ]) + JSON.stringify([1, , 3]) + JSON.stringify([1.5, , 3.5]) + JSON.stringify(["a", , "c"]) + JSON.stringify(new Array(2)) + JSON.stringify({ list: [, 1.5] }); }
console.log(nanAtTheRoot(), nothingAtTheRoot(), holes());
