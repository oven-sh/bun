// The callee keeps its rest list: each call has a list of its own, a list in every respect.
const kept = [];
class Keeper { count = 0; keep(a, b, ...rest) { this.count++; kept.push(rest); return rest.length; } }
function wrap(keeper) { return function (...values) { return keeper.keep(1, 2, ...values); }; }
const table = { handsOn: wrap(new Keeper()) };
globalThis.table = table;
(0, eval)("1");
let total = 0;
for (let i = 0; i < 300; i++) total += table.handsOn(i, "x") + table.handsOn();
kept[0].push("more");
console.log(total, kept.length, kept[0].join(), kept[2].join(), kept[1].length, kept[0] !== kept[2], Array.isArray(kept[4]), Object.getPrototypeOf(kept[4]) === Array.prototype, Object.keys(kept[598]).join());
