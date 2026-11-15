// STATISTIC: OrdinaryObjectElementsReadDirectly >= 1
// The same loop is handed an ordinary object, then views of every kind, both kinds of arguments objects, texts, String objects, lists of every storage, a function and primitives.
const said = [];
function sum(like) { let s = 0; for (let j = 0; j < like.length; j++) s += like[j]; return s; }
function fresh() { return JSON.parse('{"length":4,"0":3,"1":5,"2":7,"3":9}'); }
function strict() { "use strict"; return arguments; } function sloppy(a, b) { a = 30; return arguments; }
class Heir extends Array {} class View extends Uint8Array {}
const sparse = []; sparse[3] = 9; sparse[100000] = 1; sparse.length = 4;
for (let round = 0; round < 3; round++) for (const holder of [fresh(), new Uint8Array([3, 5, 7, 9]), new Float64Array([0.5, 1.5]), new Int16Array([-3, 5]), new BigInt64Array(0), Buffer.from([1, 2, 3]), new View([4, 4]), strict(3, 5, 7), sloppy(3, 5), "357", new String("35"), [3, 5, 7, 9], [0.5, 1.5], [3, "5", 7], [3, , 7], sparse, Heir.from([1, 2]), function (a, b) {}, 5, true, Symbol.iterator, fresh()]) said.push(String(sum(holder)));
for (const nothing of [null, undefined]) { try { sum(nothing); } catch (error) { said.push(error.name); } }
console.log(said.join(" "));
