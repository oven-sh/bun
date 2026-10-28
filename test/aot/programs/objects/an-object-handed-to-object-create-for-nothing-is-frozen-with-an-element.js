// An object that holds an element is handed to Object.create() in a loop and nobody uses the results. Then the object is frozen.
// Prints what a store past the end of a typed array leaves in the object below it, before and after.
function storeBelowBytes() {
  const below = {};
  Object.setPrototypeOf(below, new Uint8Array(2));
  below[9] = 1;
  return JSON.stringify(Reflect.ownKeys(below)) + " " + below[9];
}

const parent = { 0: "first" };
for (let i = 0; i < 3; i++) Object.create(parent);
console.log(storeBelowBytes());
Object.freeze(parent);
console.log(storeBelowBytes());
