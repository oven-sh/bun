// An object that Object.create() made below Object.prototype is given Object.prototype again, in each way a program has. It has no member of the literal that the place is handed later.
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

const bySetPrototypeOf = Object.setPrototypeOf(make(Object.prototype), Object.prototype);
const byReflect = make(Object.prototype);
console.log(Reflect.setPrototypeOf(byReflect, Object.prototype));
const byAssignment = make(Object.prototype);
byAssignment.__proto__ = Object.prototype;
const all = [bySetPrototypeOf, byReflect, byAssignment];
for (const made of all) console.log("before:", call(made), size(made));
const second = make(members);
for (const made of all) console.log("after: ", call(made), size(made), Object.getPrototypeOf(made) === Object.prototype);
console.log("second:", call(second), size(second));
// Moved below the literal, and back.
Object.setPrototypeOf(byReflect, members);
console.log("moved: ", call(byReflect), size(byReflect));
Object.setPrototypeOf(byReflect, Object.prototype);
console.log("back:  ", call(byReflect), size(byReflect));
