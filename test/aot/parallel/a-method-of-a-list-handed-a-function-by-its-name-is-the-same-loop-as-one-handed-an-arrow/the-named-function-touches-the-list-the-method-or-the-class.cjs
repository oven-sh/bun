// The function given by its name changes what the loop runs over: it pushes onto the list, cuts it short, deletes an element, lays a method of the same name on the list that the next call reads it off, hands back an heir of Array; the list is frozen, sealed, an heir with a species, a list with a getter under an index.
const said = [];
let list = [];
function grows(value, index) { if (index < 2) list.push(value + 10); return value * 2; }
function cuts(value, index) { if (index === 1) list.length = 3; return value > 0; }
function deletes(total, value, index) { if (index === 0) delete list[2]; return total + value; }
function twice(value) { return value * 2; }
function big(value) { return value > 2; }
function add(total, value) { return total + value; }
for (let turn = 0; turn < 3; turn++) {
  list = JSON.parse("[1,2,3,4,5]"); said.push(list.map(grows).join(), list.join());
  list = JSON.parse("[1,2,3,4,5]"); said.push(list.filter(cuts).join(), list.join());
  list = JSON.parse("[1,2,3,4,5]"); said.push(list.reduce(deletes, 0), list.join());
}
function own(rows) { const made = rows.map(twice); if (rows.length & 1) made.filter = function (f) { return ["own", f.name]; }; return made.filter(big).join(); }
said.push(own([1, 2, 3]), own([1, 2, 3, 4]), own([1, 2, 3]));
class Heir extends Array { static get [Symbol.species]() { return Array; } sum() { return this.reduce(add, 0); } }
class Kept extends Array { }
const heir = Heir.from([1, 2, 3]), kept = Kept.from([1, 2, 3]);
said.push(heir.map(twice).constructor.name, heir.sum(), kept.map(twice).constructor.name, kept.map(twice).filter(big).constructor.name, kept.filter(big).reduce(add, 0));
said.push(Object.freeze([1, 2, 3]).map(twice).filter(big).join(), Object.seal([3, 4]).filter(big).reduce(add, 0));
const gotten = [1, 2, 3]; Object.defineProperty(gotten, 1, { get() { said.push("got"); return 7; } }); said.push(gotten.map(twice).join(), gotten.filter(big).join(), gotten.reduce(add, 0));
said.push(Array.prototype.map.call({ length: 2, 0: 4, 1: 5 }, twice).join(), Array.prototype.filter.call("abc", big).length);
console.log(said.join(" | "));
