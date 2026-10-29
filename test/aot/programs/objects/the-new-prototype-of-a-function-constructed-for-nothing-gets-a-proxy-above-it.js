// A function gets another object as its prototype property and is constructed, and nobody uses the instance. Then a proxy is put above that object.
// Prints what a store past the end of a typed array leaves in the object below it, before and after.
function storeBelowBytes() {
  const below = {};
  Object.setPrototypeOf(below, new Uint8Array(2));
  below[9] = 1;
  return JSON.stringify(Reflect.ownKeys(below)) + " " + below[9];
}

function Made() {}
const parent = {};
Made.prototype = parent;
new Made();
console.log(storeBelowBytes());
Object.setPrototypeOf(parent, new Proxy({}, {}));
console.log(storeBelowBytes());
