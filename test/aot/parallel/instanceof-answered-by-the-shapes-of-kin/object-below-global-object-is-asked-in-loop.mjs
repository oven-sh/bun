class Other {}
function count(value) {
  let count = 0;
  for (let i = 0; i < 20; i++) count += value instanceof Other ? 1 : 2;
  return count;
}
console.log(count(new Other()), count(Object.create(globalThis)), count(globalThis));
Object.setPrototypeOf(Object.getPrototypeOf(globalThis) && globalThis, Other.prototype);
console.log(count(globalThis), count(Object.create(globalThis)), globalThis instanceof Other);
