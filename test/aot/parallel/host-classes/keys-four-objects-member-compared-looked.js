// Compares one member of each of four built-in objects with undefined or null, picks by it, or looks for its name with `in`.
// Then it copies each object with a rest pattern and prints its own keys.
const answers = [String.raw === undefined, Reflect.set != null, Symbol.keyFor ? 1 : 2, "freeze" in Object];
console.log(answers.join());
for (const object of [String, Reflect, Symbol, Object]) {
  const { length, ...others } = object;
  console.log(length, Object.keys(others).length, Reflect.ownKeys(object).map(String).join());
}
