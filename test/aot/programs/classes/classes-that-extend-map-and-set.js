// Classes of the program that extend Map, Set, WeakMap and WeakSet. The constructor of each calls `set` or `add` as it finds it on the new object, once for every entry it is given, and calls nothing when it is given none.
const say = (...values) => console.log(...values);

class Plain extends Map {}
const plain = new Plain();
say(plain.set(1, "one") === plain, plain.get(1).length, plain.size, plain instanceof Plain, plain instanceof Map, plain.constructor === Plain, Object.getPrototypeOf(plain) === Plain.prototype);
say(new Plain([[1, 2], [3, 4]]).size, [...new Plain([["k", { deep: true }]]).values()][0].deep, new Plain(null).size, new Plain(undefined).size);

class Counting extends Map {
  static made = 0;
  #stores = 0;
  label = "counting";
  constructor(entries, label) {
    super(entries);
    if (label) this.label = label;
    Counting.made++;
  }
  set(key, value) {
    // The field is not there yet while the constructor of Map runs.
    try { this.#stores++; } catch { Counting.early = (Counting.early ?? 0) + 1; }
    return super.set(key, typeof value === "function" ? value() : value);
  }
  get stores() { return this.#stores; }
  describe() { return `${this.label}: ${this.size} entries, ${this.#stores} stores`; }
}
const counting = new Counting([["a", () => "made by a call"], ["b", 2]], "given");
say(counting.describe(), Counting.early, counting.get("a").toUpperCase(), counting.get("b") + 1, Counting.made);
counting.set("c", () => [1, 2, 3]);
say(counting.describe(), counting.get("c").length, counting.stores, new Counting().describe(), Counting.early, Counting.made);
say(Map.prototype.set.call(counting, "d", 4) === counting, counting.stores, counting.size, Map.prototype.get.call(counting, "d"));

class Refusing extends Map { set() { throw new RangeError("no stores"); } }
try { new Refusing([[1, 2]]); } catch (error) { say(error instanceof RangeError, error.message); }
say(new Refusing().size, new Refusing([]).size);
class NoSetter extends Map {}
NoSetter.prototype.set = 5;
try { new NoSetter([[1, 2]]); } catch (error) { say(error instanceof TypeError); }
say(new NoSetter().size);

class Bag extends Set {
  added = [];
  add(value) { (this.added ?? (Bag.early ??= [])).push(value); return super.add(value); }
  static get [Symbol.species]() { return Set; }
}
const bag = new Bag(["x", "y", "x"]);
say(bag.size, Bag.early.join(), bag.added.length, bag.add("z").added.join(), bag.has("z"), [...bag].join(), bag instanceof Set);
say(bag.union(new Set(["w"])) instanceof Bag, bag.union(new Set(["w"])).size, new (class extends Set {})([1, 1, 2]).size);

const first = {}, second = {};
class Notes extends WeakMap { set(key, value) { Notes.calls = (Notes.calls ?? 0) + 1; return super.set(key, value); } }
const notes = new Notes([[first, "first"]]);
say(notes.get(first).length, notes.has(second), notes.set(second, () => "called").get(second)(), Notes.calls, notes instanceof WeakMap);
class Marks extends WeakSet { add(value) { Marks.calls = (Marks.calls ?? 0) + 1; return super.add(value); } }
say(new Marks([first, second]).has(second), Marks.calls, new Marks().has(first), new (class extends WeakSet {})().add(first).has(first));

// new.target decides what lies above the new object, and so which `set` the constructor finds.
const reflected = Reflect.construct(Map, [[["r", () => "through Counting"]]], Counting);
say(reflected instanceof Counting, reflected.get("r"), reflected.label, Counting.early);
say(Reflect.construct(Counting, [[["s", 1]]], Plain) instanceof Plain, Reflect.construct(Counting, [[["s", 1]]], Plain).label, Reflect.construct(Set, [[1]], Bag).added);
