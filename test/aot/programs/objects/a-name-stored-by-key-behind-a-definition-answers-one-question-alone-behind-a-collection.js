// Objects are filled by key, one of the names an object already has is defined anew with other attributes, and one more name is stored by key behind that.
// Behind a collection each object is asked one question about that last name, and nothing else looks at its names.
const descriptors = [
  () => ({
    get() {
      return 5;
    },
    set(value) {},
    enumerable: true,
    configurable: true,
  }),
  () => ({
    get() {
      return 5;
    },
    enumerable: false,
    configurable: true,
  }),
  () => ({ value: 5, writable: true, enumerable: false, configurable: true }),
  () => ({ value: 5, writable: false, enumerable: true, configurable: true }),
  () => ({ value: 5, writable: true, enumerable: true, configurable: false }),
];

function fill(object, prefix, count) {
  for (let i = 0; i < count; i++) object[prefix + i] = i;
}
function readByKey(object, key) {
  return object[key] === 7;
}
function isIn(object, key) {
  return key in object;
}
function isOwn(object, key) {
  return Object.hasOwn(object, key);
}
function isOwnByMethod(object, key) {
  return object.hasOwnProperty(key);
}
function isOwnByCall(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}
function isInByReflect(object, key) {
  return Reflect.has(object, key);
}

for (const question of [readByKey, isIn, isOwn, isOwnByMethod, isOwnByCall, isInByReflect]) {
  const names = [];
  for (const name of ["north", "east", "south", "west", "up", "down"]) names.push(name + "_" + question.name);
  const known = {};
  for (const name of names) known[name] = 1;
  let missing = 0;
  let asked = 0;
  for (let round = 0; round < 30; round++) {
    for (const count of [0, 1, 3, 8, 70]) {
      const object = {};
      fill(object, question.name, count);
      const changed = names[(round + 1) % names.length];
      object[changed] = 1;
      Object.defineProperty(object, changed, descriptors[round % descriptors.length]());
      object[names[round % names.length]] = 7;
      Bun.gc(round % 4 !== 3);
      asked++;
      if (!question(object, names[round % names.length])) missing++;
    }
  }
  console.log(question.name, "asked", asked, "missing", missing);
}
