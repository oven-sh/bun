// Reflect and computed access with objects, numbers and symbols as keys
const key = { toString: () => "name" };
function read(value) {
  const target = { name: value, 1: value + 1, get twice() { return this.name * 2; } };
  const receiver = { name: value + 10 };
  Reflect.set(target, key, Reflect.get(target, key) + 1);
  return [target[key], Reflect.has(target, key), Reflect.get(target, 1), Reflect.get(target, "twice", receiver), Reflect.set(target, "twice", 1), Reflect.ownKeys(target).join("+"), Reflect.deleteProperty(target, key), key in target].join();
}
console.log(read(1));
console.log(read(50));
console.log(read(-1));
