// Objects are filled by key. One of the names an object already has is defined anew with other attributes, more names are stored by key behind that,
// a collection runs, and then the object is asked for everything it was given.
const later = ["north", "east", "south", "west", "up", "down"];
const sizes = [0, 1, 2, 3, 5, 6, 7, 10, 30, 63, 64, 65, 70, 130, 300, 600];
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

function fill(object, count) {
  for (let i = 0; i < count; i++) object["member" + i] = i;
}

function check(object, count, changed, added, isListed) {
  let wrong = 0;
  for (let i = 0; i < count; i++) if (object["member" + i] !== i) wrong++;
  if (object[changed] !== 5) wrong++;
  for (let i = 0; i < added.length; i++) {
    if (object[added[i]] !== 100 + i) wrong++;
    if (!Object.hasOwn(object, added[i])) wrong++;
    if (!(added[i] in object)) wrong++;
  }
  const names = Object.getOwnPropertyNames(object);
  if (names.length !== count + 1 + added.length) wrong++;
  if (names[count] !== changed) wrong++;
  for (let i = 0; i < added.length; i++) if (names[count + 1 + i] !== added[i]) wrong++;
  if (Object.keys(object).length !== names.length - (isListed ? 0 : 1)) wrong++;
  return wrong;
}

let wrong = 0;
let objects = 0;
for (let round = 0; round < 6; round++) {
  for (const count of sizes) {
    for (let kind = 0; kind < descriptors.length; kind++) {
      const object = {};
      fill(object, count);
      const changed = later[(round + kind) % later.length];
      object[changed] = 1;
      const descriptor = descriptors[kind]();
      Object.defineProperty(object, changed, descriptor);
      const added = [];
      for (let i = 1; i <= 1 + ((round + kind) % 4); i++) {
        const name = later[(round + kind + i) % later.length];
        object[name] = 100 + added.length;
        added.push(name);
      }
      if ((round + kind) % 3 === 0) Bun.gc(false);
      else if (count % 5 !== 1) Bun.gc(true);
      wrong += check(object, count, changed, added, descriptor.enumerable);

      const last = added.pop();
      if (!delete object[last] || last in object) wrong++;
      object["behind" + round] = 100 + added.length;
      added.push("behind" + round);
      if (kind === 2) Bun.gc(true);
      wrong += check(object, count, changed, added, descriptor.enumerable);
      objects++;
    }
  }
}
console.log("objects", objects, "wrong", wrong);
