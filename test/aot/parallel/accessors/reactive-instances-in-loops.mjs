// A loop over the own names of the instances of a class defines accessors over its values: loops look them up before they begin.
// STATISTIC: SettersExpectedInLoops >= 1
// STATISTIC: GettersExpectedInLoops >= 2
const turns = Number("40");
function reactive(target) { for (const key of Object.keys(target)) { let value = target[key]; Object.defineProperty(target, key, { enumerable: true, configurable: true, get() { return value; }, set(x) { if (x !== value) value = x; } }); } return target; }
class Store { constructor(first) { this.first = first; this.second = 2; reactive(this); } }
const store = new Store(1);
let m = 0; for (let k = 0; k < turns; k++) { store.first = k & 3; m += store.first + store.second; }
console.log(m, JSON.stringify(store));
const other = new Store("text"); function both(one, turns) { let s = ""; for (let k = 0; k < turns; k++) { one.second = k; s += one.first + one.second; } return s; }
console.log(both(store, 5), both(other, 5));
const define = new Function("target", "name", "descriptor", "Object.defineProperty(target, name, descriptor)");
define(store, "second", { value: 5, writable: false, configurable: true }); try { console.log(both(store, 3)); } catch (e) { console.log(e.constructor.name); }
delete other.first; console.log(both(other, 2));
