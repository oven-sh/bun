// A helper copies an object: it makes the copy below the prototype of the source. The first source is a plain object, the second lies below a literal with a getter and a method.
// The first copy has neither member, before the second copy is made and after it.
const members = {
  get size() { return this.items; },
  m() { return "members.m"; },
};
function copy(source) {
  const made = Object.create(Object.getPrototypeOf(source)); // not a tail call
  for (const key of Object.keys(source)) made[key] = source[key];
  return made;
}
function size(made) { return made.size; }
function call(made) { try { return made.m(); } catch (e) { return e.constructor.name; } }

const first = copy({ items: 7 });
console.log("first: ", size(first), call(first));
const second = copy({ __proto__: members, items: 7 });
console.log("first: ", size(first), call(first));
console.log("second:", size(second), call(second));
console.log(Object.getPrototypeOf(first) === Object.prototype, Object.getPrototypeOf(second) === members);
