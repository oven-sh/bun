// join() and toString() of arrays without elements, and of their neighbors: holes, one element, heirs, separators of each kind, cycles.
const line = (...all) => console.log(all.map(v => (typeof v === "string" ? JSON.stringify(v) : String(v))).join(" "));
const attempt = f => { try { return f(); } catch (e) { return e.constructor.name; } };
let asked = 0;
const separators = [undefined, ", ", "", "ab", null, 5, { toString() { asked++; return "-"; } }, ["x", "y"], "中"];
const emptied = [1, 2]; emptied.length = 0;
const popped = ["a"]; popped.pop();
const shifted = [1.5]; shifted.shift();
const lists = { none: [], constructed: new Array(), emptied, popped, shifted, filtered: [1, 2].filter(() => false), mapped: [].map(v => v), sliced: ["a"].slice(1), frozen: Object.freeze([]), hole: [,], holes: [, ,], one: [""], oneHole: new Array(1), undefinedOne: [undefined], heir: new (class List extends Array {})(), nested: [[], [[]]], extra: Object.assign([], { extra: 1 }), sparse: Object.assign([], { length: 0 }), nullProto: Object.setPrototypeOf([], null), storage: (a => (a[70000] = 1, a.length = 0, a))([]) };
for (const name of Object.keys(lists)) for (const separator of separators) line(name, attempt(() => Array.prototype.join.call(lists[name], separator)), attempt(() => lists[name].join(separator)), attempt(() => lists[name].join()), attempt(() => "" + lists[name]), asked);
line(attempt(() => [].join(Symbol.iterator)), attempt(() => [1].join(Symbol.iterator)));
const cycle = []; cycle.push(cycle, [], cycle);
line(cycle.join(), [cycle, []].join("|"), String([[], cycle]));
const none = [];
let joined = 0;
for (let i = 0; i < 300; i++) {
  const list = [];
  if (i % 50 === 49) list.push("x" + i);
  joined += list.join(", ").length + none.map(v => "`" + v + "`").join(", ").length + (list + "").length;
}
line(joined);
class Own extends Array { join(separator) { return "own" + super.join(separator); } }
line(new Own().join("-"), String(new Own()), `${new Own()}`);
line(Array.prototype.join.call({ length: 0 }, "x"), Array.prototype.join.call({ length: 2 }, "x"), Array.prototype.join.call("", "x"), attempt(() => Array.prototype.join.call(null)));
