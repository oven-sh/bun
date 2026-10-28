// A function hands its argument to Object.create() and returns the result, and the caller does not use it. Then the argument gets a setter under an index.
// Prints what a store past the end of a typed array leaves in the object below it, before and after.
function storeBelowBytes() {
  const below = {};
  Object.setPrototypeOf(below, new Uint8Array(2));
  below[9] = 1;
  return JSON.stringify(Reflect.ownKeys(below)) + " " + below[9];
}

function heirOf(object) {
  return Object.create(object);
}

const parent = { name: "parent" };
heirOf(parent);
console.log(storeBelowBytes());
Object.defineProperty(parent, 3, { set(value) {} });
console.log(storeBelowBytes());
