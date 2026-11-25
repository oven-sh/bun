// Lists of primitives are joined with their holes, fractions and other numbers; an object, a symbol or a BigInt asks the host function.
let calls = 0;
const object = { toString() { calls++; return "object"; } };
const lists = [
  [1, , 3], [, , 0.5], [0.5, , 2.5], [1, undefined, null], [NaN, -0, Infinity, 1e21, 1e-7], [true, "", "text", 2147483648], [, "only"], new Array(3),
  [0.5, 1.5], [1, object, , 2], [1n, , 2], [[1, , 2], [, 3]], ["é", , "中"], (list => { list[4] = 2.5; return list; })([1]), (list => { list.length = 3; return list; })([7]),
];
for (let turn = 0; turn < 2; turn++) {
  for (const list of lists) {
    for (const separator of [undefined, "", "-", ", ", 0, null]) console.log(list.join(separator));
    console.log(String(list), `${list}`.length, list + "", calls);
  }
}
try { console.log([1, Symbol("s"), , 2].join()); } catch (error) { console.log(error.constructor.name); }
const cyclic = [1, , 2]; cyclic.push(cyclic); console.log(cyclic.join("/"));
class Heir extends Array {} console.log(Heir.from([1, undefined, 2.5]).join("|"));
console.log(Object.freeze([1, , 2.5]).join("+"), Array.prototype.join.call({ length: 3, 0: 1, 2: 0.5 }, "*"));
