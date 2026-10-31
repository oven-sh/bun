// The place hands Object.create() its parameter, which is Object.prototype where the caller names none. The first call names none, the second names a literal with a method and a getter.
const members = {
  m() { return "members.m"; },
  get size() { return this.items; },
};
function make(proto = Object.prototype) {
  const made = Object.create(proto); // not a tail call
  made.items = 7;
  return made;
}
function call(made) { try { return made.m(); } catch (e) { return e.constructor.name; } }
function size(made) { return made.size; }

const first = make();
console.log("first: ", call(first), size(first));
const second = make(members);
console.log("first: ", call(first), size(first));
console.log("second:", call(second), size(second));
const third = make();
console.log("third: ", call(third), size(third));
