// An accessor under an index key in a class body does not change how other objects store elements.
// The engine stores past the end of a typed array on the prototype chain until an object that is already a prototype gets such an accessor.
function storePastTheEnd(label) {
  const object = { a: 1, __proto__: new Float32Array(4) };
  object[10] = 7;
  console.log(label, Object.keys(object).join(), object[10]);
}
const key = 44;
const seen = [];
class Setter { set 42(value) { seen.push("set " + value); } }
class Getter { get 43() { return "got"; } }
class Computed { set [key](value) { seen.push("computed " + value); } }
class Derived extends Setter { set 45(value) { seen.push("derived " + value); } }
function make(tag) { return class { set 46(value) { seen.push(tag + " " + value); } }; }
storePastTheEnd("defined");

const derived = new Derived();
derived[41] = 0; derived[42] = 1; derived[45] = 2;
const computed = new Computed();
computed[44] = 3;
for (const tag of ["first", "second"]) {
  const made = new (make(tag))();
  made[45] = 4; made[46] = 5;
  console.log(Object.keys(made).join());
}
console.log(seen.join(), Object.keys(derived).join(), Object.keys(computed).join(), new Getter()[43]);
storePastTheEnd("constructed");

class List extends Array { set 3(value) { seen.push("list " + value); } }
const list = new List();
list.push(1, 2, 3);
list[3] = 4; list[4] = 5;
console.log(seen.at(-1), list.length, Object.keys(list).join());
storePastTheEnd("below Array");

Object.defineProperty(Setter.prototype, 47, { set(value) {}, configurable: true });
storePastTheEnd("added to a prototype");
