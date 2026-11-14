// A key that is put together reads properties that stores added behind the literal or the class.
const make = () => ({ con0_: null, read(name) { return this["con" + name + "_"]; } });
const a = make(), b = make();
a["conNaN_"] = [];
class Store { constructor() { this._firstList = null; } list(name) { return this[`_${name}List`]; } }
const store = new Store();
store._secondList = new Map([[1, 2]]);
store["_" + "third" + "List"] = new Set([3]);
Object.defineProperty(store, "_fourthList", { get() { return this._secondList.get(1); } });
for (const name of ["first", "0", "NaN", "second", "third", "fourth"]) {
  let line = name;
  for (const object of [a, b, a]) line += " " + (Array.isArray(object.read(name)) ? object.read(name).push(1) : object.read(name));
  const list = store.list(name);
  console.log(line, list instanceof Map ? list.get(1) : list instanceof Set ? list.size : list);
}
