// An object whose prototype is an array inherits its length and its elements: they are data properties of the array, whoever the receiver is.
const list = [1, 2, 3];
const heir = Object.create(list);
console.log(heir.length, heir[1], Array.isArray(heir), heir.join("-"));
class Bag extends Array {}
const bagHeir = Object.create(new Bag(4));
console.log(bagHeir.length);
const text = Object.create(new String("abc"));
try { console.log(text.length); } catch (e) { console.log(e.name); }
function Old() {}
Old.prototype = [7, 8];
const old = new Old();
console.log(old.length, old[0], old instanceof Array);
old.push(9);
console.log(old.length, Old.prototype.length, Object.keys(old).join());
const empty = [];
console.log(Object.create(empty).length, { __proto__: [5] }.length, { __proto__: [5] }[0]);
const reparented = {};
Object.setPrototypeOf(reparented, [1, 2]);
console.log(reparented.length, reparented[0]);
function Mine() {}
Mine.prototype = Object.create(Array.prototype);
const mine = new Mine();
console.log(mine.length);
mine.push("a");
console.log(mine.length, mine[0], mine.join());
const overFunction = Object.create(function (a, b) {});
console.log(overFunction.length, overFunction.name);
const layered = Object.create([1, 2, 3]);
layered.length = 1;
console.log(layered.length, Object.getPrototypeOf(layered).length, Object.keys(layered).join());
