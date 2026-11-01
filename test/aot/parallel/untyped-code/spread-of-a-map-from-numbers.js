// An object used as a map from numbers keeps them as elements. A spread copies their storage at once and asks for no key.
// COUNT: counter:CopiesByOrdinaryLookups <= 60
function digest(object) {
  let sum = 0;
  let keys = 0;
  let last = "";
  for (const key of Reflect.ownKeys(object)) {
    keys++;
    last = String(key);
    const value = object[key];
    sum = (sum * 31 + (typeof value === "number" ? Math.round(value * 4) : String(value).length) + last.length) % 1000003;
  }
  return `${keys} ${last} ${sum}`;
}
function filled(count, first, step, value) {
  const made = {};
  for (let i = 0; i < count; i++) made[first + i * step] = value(i);
  return made;
}
const kinds = {
  integers: i => i,
  fractions: i => i + 0.25,
  texts: i => "t" + i,
  mixed: i => (i % 3 ? i : i % 2 ? "s" + i : i + 0.5),
};
for (const [kind, value] of Object.entries(kinds)) {
  for (const [first, step] of [[0, 1], [1, 1], [5, 3], [1000, 7], [100000, 7], [4294967000, 50]]) {
    let state = filled(40, first, step, value);
    const keys = Object.keys(state);
    for (let turn = 0; turn < 60; turn++) state = { ...state, [keys[(turn * 7) % keys.length]]: value(turn + 100) };
    console.log(kind, first, step, digest(state));
  }
}

// The copy and its source go their own ways.
for (const first of [0, 2000, 200000]) {
  const source = filled(30, first, 2, i => i);
  source.name = "source";
  const copy = { ...source };
  copy[first] = "changed";
  copy[first + 1] = "filled a hole";
  copy[first + 500] = "far";
  delete copy[first + 4];
  copy.name = "copy";
  copy.more = 1;
  source[first + 2] = "changed in the source";
  delete source[first + 6];
  source[first + 61] = "added to the source";
  console.log("source", first, digest(source), source[first], source[first + 1], source[first + 4], source[first + 500], source.name, source.more);
  console.log("copy", first, digest(copy), copy[first + 2], copy[first + 6], copy[first + 61], copy.name);
  console.log("again", first, digest({ ...copy }), digest({ ...source }), Object.keys({ ...copy }).slice(0, 3).join(), Object.keys({ ...copy }).slice(-3).join());
}

// Names among the numbers, and keys that only look like numbers.
const named = { z: 1, 3: "three", a: 2, 1: "one", "-1": "minus", "1.5": "half", "01": "padded", 4294967295: "past the last index", 4294967294: "the last index" };
console.log("named", JSON.stringify({ ...named }), digest({ ...{ ...named } }));
const many = filled(20, 0, 1, i => i);
for (let i = 0; i < 12; i++) many["n" + i] = i;
console.log("many names", digest({ ...many }), digest({ ...{ ...many }, 5: "over", n5: "over" }));

// What a copy of the storage would get wrong.
for (const first of [0, 5000]) {
  let asked = 0;
  const computed = filled(10, first, 1, i => i);
  Object.defineProperty(computed, first + 3, { get() { return ++asked; }, enumerable: true, configurable: true });
  const taken = { ...computed };
  console.log("getter", first, digest(taken), asked, Object.getOwnPropertyDescriptor(taken, first + 3).value);
  const hidden = filled(10, first, 1, i => i);
  Object.defineProperty(hidden, first + 3, { value: "hidden", enumerable: false, writable: true, configurable: true });
  console.log("hidden", first, digest({ ...hidden }), first + 3 in { ...hidden });
  const fixed = filled(10, first, 1, i => i);
  Object.defineProperty(fixed, first + 3, { value: "fixed", enumerable: true, writable: false, configurable: false });
  const loose = { ...fixed };
  loose[first + 3] = "written";
  console.log("read-only", first, loose[first + 3], delete loose[first + 3], digest(loose));
  const hiddenName = filled(10, first, 1, i => i);
  Object.defineProperty(hiddenName, "secret", { value: 1, enumerable: false });
  console.log("hidden name", first, digest({ ...hiddenName }), "secret" in { ...hiddenName });
  const frozen = { ...Object.freeze(filled(10, first, 1, i => i)) };
  frozen[first] = "thawed";
  frozen[first + 20] = "added";
  console.log("frozen", first, Object.isFrozen(frozen), digest(frozen));
  const sealed = { ...Object.seal(filled(10, first, 1, i => i)) };
  console.log("sealed", first, delete sealed[first], Object.isExtensible(sealed), digest(sealed));
  const bare = Object.assign(Object.create(null), filled(10, first, 1, i => i));
  console.log("bare", first, Object.getPrototypeOf({ ...bare }) === Object.prototype, digest({ ...bare }));
  const parent = filled(10, first, 1, i => i);
  const child = Object.create(parent);
  console.log("parent", first, child[first + 1], digest({ ...parent }), digest({ ...child }));
}
console.log("lists", JSON.stringify({ ...[1, , 3] }), JSON.stringify({ ...[1.5, "a"] }), JSON.stringify({ ..."ab" }), JSON.stringify({ ...new Uint8Array([7, 8]) }));
const { 1: one, ...others } = filled(6, 0, 1, i => i * 2);
console.log("rest", one, JSON.stringify(others));
console.log("assign", JSON.stringify(Object.assign({}, filled(4, 0, 2, i => i))), JSON.stringify(Object.assign({ 2: "under", 9: "kept" }, filled(4, 0, 2, i => i))));
