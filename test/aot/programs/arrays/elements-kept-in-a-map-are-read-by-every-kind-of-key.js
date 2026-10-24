// An array keeps its elements in a map once they are far apart, have attributes of their own, or the array is frozen and has a name
// of its own (the strings of a tagged template). A read by key finds what any other read finds: values, getters, holes, what lies
// above the array, and names that only look like indexes.
function tag(strings, ...values) { let text = ""; for (let k = 0; k < strings.length; k++) text += strings[k] + "|" + strings.raw[k] + "|" + (k < values.length ? values[k] : ""); return text; }
function read(object, key) { return object[key]; }
function makers() {
  const farApart = [1, 2, 3]; farApart[100000] = "far"; farApart[4294967294] = "last";
  const withGetter = [1, 2, 3]; let calls = 0; Object.defineProperty(withGetter, 1, { get() { return "got" + ++calls; }, configurable: true });
  const readOnly = [1, 2, 3]; Object.defineProperty(readOnly, 0, { value: "fixed", writable: false });
  const hidden = [1, 2, 3]; Object.defineProperty(hidden, 2, { value: "hidden", enumerable: false });
  const frozenWithName = [1, "two", { three: 3 }, , undefined]; frozenWithName.name = "n"; Object.freeze(frozenWithName);
  const frozen = Object.freeze(["a", "b"]);
  const sealedWithName = [1.5, 2.5]; sealedWithName.name = "n"; Object.seal(sealedWithName);
  const holes = [1, , 3]; holes.name = 1; Object.freeze(holes);
  const below = Object.freeze(Object.assign(Object.setPrototypeOf([1, , 3], { 1: "above", 7: "above too", "-2": "minus two" }), { name: 1 }));
  const object = { 0: "zero", 5: "five" }; Object.defineProperty(object, 3, { value: "three", writable: false }); Object.freeze(object);
  const setterOnly = [1]; Object.defineProperty(setterOnly, 0, { set(v) {} });
  const deleted = [1, 2, 3]; Object.defineProperty(deleted, 1, { value: 2, configurable: true, writable: false }); delete deleted[1];
  const args = (function () { Object.defineProperty(arguments, 0, { value: "arg", writable: false }); return Object.freeze(arguments); })(1, 2);
  class Heir extends Array {} const heir = Heir.from([1, 2, 3]); heir.name = 1; Object.freeze(heir);
  return { farApart, withGetter, readOnly, hidden, frozenWithName, frozen, sealedWithName, holes, below, object, setterOnly, deleted, args, heir };
}
const keys = [0, 1, 2, 3, 4, 5, 7, 100000, 4294967294, 4294967295, -1, -2, -4294967294, 1.5, "0", "1", "01", "-2", "name", "length", NaN];
for (let turn = 0; turn < 40; turn++) {
  const made = makers();
  for (const name in made) {
    let line = name + ":";
    for (const key of keys) { const value = read(made[name], key); line += " " + (typeof value === "object" && value ? JSON.stringify(value) : String(value)); }
    if (turn === 0 || turn === 39) console.log(line);
  }
  const text = tag`a${turn}b\n${2}c` + tag`${1}` + tag`only`;
  if (turn === 0 || turn === 39) console.log(JSON.stringify(text));
}
function same(strings) { return strings; }
function site() { return same`x${0}y`; }
console.log(site() === site(), Object.isFrozen(site()), Object.isFrozen(site().raw), Object.getOwnPropertyNames(site()).join(), JSON.stringify(Object.getOwnPropertyDescriptor(site(), 0)));
try { "use strict"; site()[0] = 1; } catch (error) { console.log(error.constructor.name); }
console.log(site()[0], site().length);
