// Object.fromEntries of a written list of pairs, Object.defineProperties of the descriptors of a literal, Array.from of a written length. Then copies Object and Array and lists their keys.
const made = Object.fromEntries([["a", 1]]);
const defined = Object.defineProperties({}, Object.getOwnPropertyDescriptors({ b: 2 }));
const list = Array.from({ length: 2 }, (_, index) => index);
console.log(made.a, defined.b, list.join());
for (const object of [Object, Array]) {
  const entries = Object.entries(object);
  console.log(entries.length, Reflect.ownKeys(object).map(String).join());
}
