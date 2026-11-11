// Reads under keys that are put together: what has the beginning and the end of the key answers, wherever it lies.
const print = (...values) => console.log(values.map(value => typeof value === "function" ? "function " + value.name : Array.isArray(value) ? "[" + value.join() + "]" : String(value)).join(" "));
const names = ["first", "second", "", "none", "late", "fi" + "rst"];
class Item { constructor(n) { this.count = n; } }
class Store {
  constructor() { this._firstList = []; this._secondList = [new Item(7)]; this._List = "bare"; this._size = 0; }
  list(name) { return this[`_${name}List`]; }
  sum(name) { return this["_" + name + "List"]; }
  ending(name) { return this[name + "List"]; }
  beginning(name) { return this["_" + name]; }
  _methodList() { return 5; }
  get _getterList() { return this._size + 1; }
  static list(name) { return this[`_${name}List`]; }
  static _staticList = [3];
}
const store = new Store();
for (const name of names) print(name, store.list(name)?.length, store.sum(name)?.length, store.ending("_" + name)?.length, typeof store.beginning(name + "List"));
print(store.list("method"), store.list("getter"), Store.list("static"), Store.list("none"));
store._lateList = [1, 2];
store["_" + "later" + "List"] = [4];
print(store.list("late"), store.list("later"), store.list("latest"));
Object.defineProperty(store, "_definedList", { get() { return 11; }, configurable: true });
print(store.list("defined"));
delete store._secondList;
print(store.list("second"));
Store.prototype._addedList = "added";
print(store.list("added"), new Store().list("added"));
class Below extends Store { constructor() { super(); this._belowList = "below"; } _methodList() { return 6; } }
print(new Below().list("below"), new Below().list("first"), new Below().list("method")(), new Below().list("added"));
const bare = Object.create(null);
bare._firstList = 1;
const under = Object.create({ _aboveList: "above" });
const literal = { _firstList: 2, __proto__: { _aboveList: "linked" } };
for (const object of [bare, under, literal]) print(object[`_${names[0]}List`], object[`_${"above"}List`], object[`_${names[3]}List`]);
const read = (object, name) => object["to" + name + "ing"];
print(read({ a: 1 }, "Str"), read(store, "Str"), read({ toString: 1, toing: 2 }, ""), typeof read({}, "LocaleStr"));
const made = (object, name) => object["con" + name + "r"];
print(made(store, "structo") === Store, made({}, "structo") === Object, made({ conr: 4 }, ""));
const link = (object, name) => object["__" + name + "__"];
print(link(store, "proto") === Store.prototype, link({}, "proto") === Object.prototype, link({ ____: 1 }, ""), link(bare, "proto"));
const index = (object, first, second) => object["1" + first + second];
print(index(["a", "b", "c", ...Array(9).fill("d"), "e"], "", "2"), index({ 12: "twelve", 1: "one" }, "", "2"), index({ 12: "twelve", 1: "one" }, "", ""));
const digits = (object, n) => object["n" + n];
print(digits({ n0: "zero", n1: "one", "n-1": "minus", nNaN: "nan", nundefined: "u", "n1.5": "half" }, 0), digits({ n0: 0 }, -0), digits({ "n-1": 5 }, -1), digits({ nNaN: 6 }, NaN), digits({ nundefined: 8 }, undefined), digits({ "n1.5": 9 }, 1.5), digits({ "n4294967295": 10 }, 2 ** 32 - 1));
const wide = (object, half) => object["\uD83D" + half];
print(wide({ "\u{1F600}": "face" }, "\uDE00"), wide({ "\uD83Dx": "half" }, "x"));
const spaced = { toString() { return "first"; } };
print(store[`_${spaced}List`]?.length, store["_" + ["late"] + "List"]);
class List extends Array { at2(name) { return this["len" + name]; } }
print(List.of(1, 2).at2("gth"), new List(3).at2("gths"));
const frozen = Object.freeze({ _firstList: "frozen" });
print(frozen[`_${names[0]}List`], Object.assign({}, frozen)[`_${names[0]}List`]);
const proxy = new Proxy(store, { get(target, key) { return key === "_firstList" ? "trapped" : target[key]; } });
print(proxy[`_${names[0]}List`], proxy.list("first"), proxy.list("second"));
class Private { #_firstList = 1; _firstList = 2; read(name) { return this["_" + name + "List"] + this.#_firstList; } }
print(new Private().read("first"));
let fields = "";
for (const object of [{ kA: 1 }, { kA: 2, kB: 3 }, { kB: 4 }, { kC: [5] }]) for (const name of ["A", "B", "C"]) fields += object["k" + name] + ",";
print(fields);
function Old() { this._oldList = 1; }
Old.prototype._protoList = 2;
Old.prototype.read = function (name) { return this["_" + name + "List"]; };
print(new Old().read("old"), new Old().read("proto"), new Old().read("none"));
