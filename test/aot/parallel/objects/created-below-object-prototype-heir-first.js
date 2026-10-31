// Two places of Object.create(): the second makes objects below what the first makes. The first place is handed Object.prototype. Then the second place is handed an object below the
// literal, which no call of the first place made. The object below Object.prototype has no getter of the literal, and the objects that the first place makes later below the literal have it.
const base = { get size() { return this.items; } };
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

const plain = mid(Object.prototype);
console.log("plain:", read(plain));
const heir = leaf(Object.setPrototypeOf({ items: 5 }, base));
console.log("heir: ", read(heir), "plain:", read(plain));
const below = mid(base);
const deep = leaf(mid(base));
console.log("below:", read(below), "deep:", read(deep), "plain:", read(plain));
const other = mid(Object.prototype);
console.log("other:", read(other), Object.getPrototypeOf(other) === Object.prototype, Object.getPrototypeOf(below) === base);
