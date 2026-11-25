// Object.create(null, descriptors) with one or two descriptors makes a small object. It then takes any number of further properties.
const seen = [];
const Key = Symbol("key");
function makeKeys() { return [Symbol("first"), Symbol("second")]; }
const [First, Second] = makeKeys();
const one = value => Object.create(null, { [Key]: { value } });
const oneNamed = value => Object.create(null, { name: { value, enumerable: true, writable: true, configurable: true } });
const two = value => Object.create(null, { [First]: { value }, [Second]: { value: [value], enumerable: true } });
const twoNamed = value => Object.create(null, { a: { value, enumerable: true }, b: { get() { return value + 1; }, enumerable: true } });
const three = value => Object.create(null, { a: { value, enumerable: true }, b: { value, enumerable: true }, c: { value, enumerable: true } });
const none = () => Object.create(null);
const empty = () => Object.create(null, {});
const withPrototype = value => Object.create({ inherited: "yes" }, { [Key]: { value } });
const makers = [one, oneNamed, two, twoNamed, three, none, empty, withPrototype];
const show = object => {
  const parts = [];
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    parts.push(String(key) + "=" + ("value" in descriptor ? JSON.stringify(descriptor.value) : "getter " + object[key]) + (descriptor.enumerable ? "e" : "") + (descriptor.writable ? "w" : "") + (descriptor.configurable ? "c" : ""));
  }
  return parts.join(",") + " | " + String(Object.getPrototypeOf(object) === null) + " " + Object.keys(object).join("");
};
for (let round = 0; round < 3; round++) {
  for (let index = 0; index < makers.length; index++) {
    for (let extra = 0; extra <= 9; extra++) {
      const object = makers[index](round + 1);
      for (let added = 0; added < extra; added++) object["p" + added] = added;
      seen.push(index + " " + extra + " " + show(object));
      if (extra > 2) { delete object.p1; object.again = true; object[extra] = "index"; seen.push(show(object)); }
      if (extra === 5) { Object.freeze(object); seen.push(String(Object.isFrozen(object)) + " " + show(object)); }
      if (extra === 6) { Object.setPrototypeOf(object, { late: 1 }); seen.push(String(object.late) + " " + show(object)); }
    }
  }
}
// Many live at once, across collections.
const kept = [];
for (let index = 0; index < 200000; index++) {
  const object = one(index);
  if ((index & 7) === 0) { object.a = index; object.b = index + 1; object.c = index + 2; }
  if ((index & 63) === 0) kept.push(object);
}
let sum = 0;
for (const object of kept) sum += object[Key] + object.a + object.b + object.c;
seen.push("sum " + sum);
// A tree of them, as a path tracker keeps.
const root = one(new Set());
function entitiesAt(path) {
  let current = root;
  for (const segment of path) current = current[segment] ||= one(new Set());
  return current[Key];
}
for (const path of [[], ["a"], ["a", "b"], ["a", "c"], ["d", "e", "f"], ["a", "b"], ["g"], ["h"], ["i"], ["j"], ["k"], ["l"]]) entitiesAt(path).add(path.join("."));
seen.push(Object.keys(root).join(), [...entitiesAt(["a", "b"])].join(), [...entitiesAt([])].join("-"), Object.keys(root.a).join());
console.log(seen.join("\n"));
