// A walk up the prototypes of a built-in function, in a program that reads a map.
function chain(value) {
  let length = 0;
  for (let current = value; current !== null; current = Object.getPrototypeOf(current)) length++;
  return length;
}
const cache = new Map([["a", 1]]);
console.log(chain(parseInt), chain([]), chain(cache));
console.log(cache.get("a"), cache.has("b"));
