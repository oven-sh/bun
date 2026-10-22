// A spread copy of a literal that nothing else changes accepts every change JavaScript allows, in cold code and in a hot loop, and the source stays as it was.
const defaults = { a: 1, b: 2 };
const mutations = {
  add(copy) { copy.c = 3 },
  remove(copy) { delete copy.a },
  redefine(copy) { Object.defineProperty(copy, "a", { get() { return 10 }, enumerable: true, configurable: true }) },
  hide(copy) { Object.defineProperty(copy, "b", { value: 20, enumerable: false }) },
  freeze(copy) { Object.freeze(copy) },
  seal(copy) { Object.seal(copy) },
  storeOtherType(copy) { copy.a = "text" },
  storeIndex(copy) { copy[0] = "element" },
  storeSymbol(copy) { copy[Symbol.iterator] = null },
  changePrototype(copy) { Object.setPrototypeOf(copy, { inherited: true }) },
  becomePrototype(copy) { Object.create(copy).own = 1 },
};
function describe(object) {
  return [JSON.stringify(object), Reflect.ownKeys(object).map(String).join(), Object.isFrozen(object), Object.isSealed(object), object.inherited].join(" ");
}
function copyAndMutate(mutate) {
  const copy = { ...defaults };
  mutate(copy);
  return copy;
}
function copyWithStoreAndMutate(mutate) {
  const copy = { ...defaults, b: 5 };
  mutate(copy);
  return copy;
}
for (const name in mutations) {
  const mutate = mutations[name];
  console.log(name, describe(copyAndMutate(mutate)), "|", describe(copyWithStoreAndMutate(mutate)));
  let last;
  for (let i = 0; i < 2000; i++) last = [copyAndMutate(mutate), copyWithStoreAndMutate(mutate)];
  console.log(name, describe(last[0]), "|", describe(last[1]));
}
console.log(defaults.a, defaults.b);
