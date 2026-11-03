// Objects that look like instances of a class below a built-in class and were made on other roads.
class Bag extends Map<string, number> {
  limit: number = 3;
  room(): number { return this.limit - this.size; }
  put(key: string, value: number): this { if (this.room() > 0) this.set(key, value); return this; }
}
class Wide extends Bag {
  extra: string = "wide";
  room(): number { return super.room() + 1; }
}
class Other extends Set<number> { limit: number = 9; room(): number { return -1; } }
function roomOf(bag: Bag): number { return bag.room(); }
function limitOf(bag: Bag): unknown { return bag.limit; }
function sizeOf(bag: Bag): number { return bag.size; }
function show(label: string, run: () => unknown) {
  try { console.log(label, String(run())); } catch (error) { console.log(label, "threw", (error as Error).constructor.name); }
}
const made: [string, () => any][] = [
  ["new", () => new Bag()],
  ["new below", () => new Wide()],
  ["construct Bag for Bag", () => Reflect.construct(Bag, [])],
  ["construct Map for Bag", () => Reflect.construct(Map, [], Bag)],
  ["construct Set for Bag", () => Reflect.construct(Set, [], Bag)],
  ["construct Array for Bag", () => Reflect.construct(Array, [], Bag)],
  ["construct Error for Bag", () => Reflect.construct(Error, ["x"], Bag)],
  ["construct Object for Bag", () => Reflect.construct(Object, [], Bag)],
  ["construct Bag for Wide", () => Reflect.construct(Bag, [], Wide)],
  ["construct Wide for Bag", () => Reflect.construct(Wide, [], Bag)],
  ["construct Bag for Other", () => Reflect.construct(Bag, [], Other)],
  ["construct Other for Bag", () => Reflect.construct(Other, [], Bag)],
  ["construct Bag for Map", () => Reflect.construct(Bag, [], Map)],
  ["construct Bag for a function", () => Reflect.construct(Bag, [], function F() {})],
  ["construct Bag for a bound class", () => Reflect.construct(Bag, [], Bag.bind(null))],
  ["construct Bag for a proxy", () => Reflect.construct(Bag, [], new Proxy(Bag, {}))],
  ["a Map with the prototype", () => Object.setPrototypeOf(new Map(), Bag.prototype)],
  ["an object with the prototype", () => Object.create(Bag.prototype)],
  ["a Set with the prototype", () => Object.setPrototypeOf(new Set(), Bag.prototype)],
];
for (let round = 0; round < 3; round++) {
  for (const [label, make] of made) {
    show(label + " room", () => roomOf(make()));
    show(label + " limit", () => limitOf(make()));
    show(label + " size", () => sizeOf(make()));
    show(label + " put", () => { const bag = make(); bag.put("a", 1).put("b", 2).put("c", 3).put("d", 4).put("e", 5); return [...bag.keys()].join(); });
    show(label + " is", () => { const bag = make(); return [bag instanceof Bag, bag instanceof Wide, bag instanceof Map, bag instanceof Set, Object.prototype.toString.call(bag)].join(); });
  }
}
