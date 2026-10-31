// One place hands Object.create() Object.prototype first and an empty literal second. The program stores a method into the literal after the first object is made: the first object never has it.
const members = {};
function make(proto) {
  const made = Object.create(proto); // not a tail call
  made.items = 7;
  return made;
}
function call(made) { try { return made.later(); } catch (e) { return e.constructor.name; } }

const first = make(Object.prototype);
console.log("first: ", call(first));
members.later = function () { return "members.later " + this.items; };
console.log("first: ", call(first));
const second = make(members);
console.log("first: ", call(first));
console.log("second:", call(second));
