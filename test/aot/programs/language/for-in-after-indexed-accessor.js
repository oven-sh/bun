// for-in reads its list of keys during and after the moment an indexed accessor on a prototype moves every array of the realm to array storage.
function keysOf(object) {
  const keys = [];
  for (const key in object) keys.push(key);
  return keys.join();
}
function defineIndexedAccessorOnPrototype() {
  const prototype = {};
  Object.create(prototype);
  Object.defineProperty(prototype, 0, { get() { return "inherited" }, enumerable: true, configurable: true });
}
const point = { x: 1, y: 2, z: 3 };
for (let i = 0; i < 2000; i++) keysOf(point);
console.log(keysOf(point), keysOf([4, 5]), keysOf("ab"), keysOf(Object.create(point)));

const seen = [];
for (const key in point) {
  seen.push(key);
  if (key === "x") defineIndexedAccessorOnPrototype();
}
console.log(seen.join());

for (let i = 0; i < 2000; i++) keysOf(point);
console.log(keysOf(point), keysOf([4, 5]), keysOf("ab"), keysOf(Object.create(point)), keysOf({}) === "");
