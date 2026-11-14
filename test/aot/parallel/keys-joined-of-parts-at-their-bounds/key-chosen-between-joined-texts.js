const order = [];
const part = text => ({ toString() { order.push(text); return text; } });
function keyOf(term) {
  return term.size ? term.name + "/" + term.size : term.name + "/none";
}
function longKeyOf(term) {
  return term.size > 1 ? "" + term.size : term.size ? term.name : term.name + term.name;
}
function either(term) {
  const key = term.name && term.name + ":" + term.size;
  return key || "(" + term.size + ")";
}
const table = { "a/2": 1, "b/none": 2, 12: 3, aa: 4, a: 5, "toString": 6, "x:0": 7, "(3)": 8, "[object Object]/1": 9, "undefined/none": 10, "NaN/7": 11 };
const read = (key, term) => { try { return table[key(term)]; } catch (error) { return error.constructor.name; } };
const terms = [
  { name: "a", size: 2 }, { name: "b", size: 0 }, { name: "a", size: 12 }, { name: "a", size: 0 }, { name: "a", size: 1 }, { name: "toString", size: 1 }, { name: "x", size: 0 }, { name: "", size: 3 },
  { name: part("a"), size: part("2") }, { name: {}, size: 1 }, { name: undefined, size: 0 }, { name: NaN, size: 7 }, { name: Symbol("s"), size: 1 }, { name: "b", size: 0n }, { name: "ā", size: 5 }, { name: "a".repeat(80), size: 5 },
  { name: Object.create(null), size: 1 }, { name: "cut/a".slice(4), size: 2 }, { name: "to" + "String".slice(0), size: 1 },
];
for (let turn = 0; turn < 4; turn++) console.log([keyOf, longKeyOf, either].map(key => terms.map(term => String(read(key, term)).slice(0, 12)).join()).join(" | "));
console.log(order.join(""));

const counts = {};
for (let turn = 0; turn < 200; turn++) for (const word of "one two one three/4 two one".split(" ")) {
  const key = turn & 1 ? word + "/" + (turn & 3) : word;
  counts[key] = (counts[key] || 0) + 1;
}
console.log(Object.entries(counts).sort().join(" "));
const kept = [..."alpha beta gamma alpha".matchAll(/\w+/g)].map(match => match[0]);
let found = 0;
const places = { "alpha/1": 1, "beta/1": 2, "gamma/1": 4 };
for (let turn = 0; turn < 50; turn++) for (const word of kept) found += places[word + "/" + 1] + (places[word + "/" + 2] ?? 8);
console.log(found);
