// Two places of Object.create(): the second makes objects below what the first makes. The first object of the first place is below Object.prototype, and the second place is handed that
// object. Neither it nor the object below it has a member of the literal, until the program moves it below the literal, and again once it is moved back.
const base = { get size() { return this.items; }, name() { return "base"; } };
function mid(below) {
  const made = Object.create(below); // not a tail call
  made.items = 7;
  return made;
}
function leaf(below) {
  const made = Object.create(below); // not a tail call
  made.extra = 1;
  return made;
}
function read(made) { return made.size; }
function call(made) { try { return made.name(); } catch (e) { return e.constructor.name; } }

const parent = mid(Object.prototype);
const heir = leaf(parent);
console.log("heir:", read(heir), call(heir), heir.items);
const below = mid(base);
const deep = leaf(below);
console.log("below:", read(below), call(below), "deep:", read(deep), call(deep), "heir:", read(heir), call(heir));
Object.setPrototypeOf(parent, base);
console.log("moved:", read(heir), call(heir), read(parent), call(parent));
Object.setPrototypeOf(parent, Object.prototype);
console.log("back:", read(heir), call(heir), read(parent), call(parent));
