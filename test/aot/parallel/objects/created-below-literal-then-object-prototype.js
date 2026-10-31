// One place hands Object.create() a literal with a method and a getter first and Object.prototype second. The second object has neither member, and the first keeps both.
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

const first = make(members);
console.log("first: ", call(first), size(first));
const second = make(Object.prototype);
console.log(Object.getPrototypeOf(second) === Object.prototype);
console.log("first: ", call(first), size(first));
console.log("second:", call(second), size(second));
