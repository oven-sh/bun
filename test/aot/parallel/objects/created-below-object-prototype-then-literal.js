// One place hands Object.create() Object.prototype first and a literal with a method and a getter second. The first object has neither member, before the second call and after it.
const members = {
  m() { return "members.m"; },
  get size() { return this.items; },
};
function make(proto) {
  const made = Object.create(proto); // not a tail call
  made.items = 7;
  return made;
}
function call(made) { try { return made.m(); } catch (e) { return e.constructor.name; } }
function size(made) { return made.size; }

const first = make(Object.prototype);
console.log(Object.getPrototypeOf(first) === Object.prototype);
console.log("first: ", call(first), size(first));
const second = make(members);
console.log("first: ", call(first), size(first));
console.log("second:", call(second), size(second));
