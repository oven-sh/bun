// An object is handed to Object.create() and nobody uses the result. Then a proxy is put above the object.
// Prints what a store past the end of a typed array leaves in the object below it, before and after.
function storeBelowBytes() {
  const below = {};
  Object.setPrototypeOf(below, new Uint8Array(2));
  below[9] = 1;
  return JSON.stringify(Reflect.ownKeys(below)) + " " + below[9];
}

const parent = {};
Object.create(parent);
console.log(storeBelowBytes());
Object.setPrototypeOf(parent, new Proxy({}, {}));
console.log(storeBelowBytes());
