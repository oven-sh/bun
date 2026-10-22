// Well-known symbols as the constant key of in, delete, reads, stores, accessors and literals that spread afterwards, in code that runs once and in loops. A property named like the description of a symbol is another property.
type Bag = Record<PropertyKey, unknown>;

class Tagged {
  [Symbol.toStringTag] = "Tagged";
  size = 1;
}

class Ranged {
  limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  *[Symbol.iterator](): Generator<number> {
    for (let i = 0; i < this.limit; i++) yield i;
  }
  get [Symbol.toStringTag](): string {
    return "Ranged" + this.limit;
  }
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "number";
  }
}

const trapped: string[] = [];
const proxy = new Proxy({}, {
  has(target: object, key: PropertyKey): boolean {
    trapped.push("has " + String(key));
    return key === Symbol.iterator;
  },
  deleteProperty(target: object, key: PropertyKey): boolean {
    trapped.push("delete " + String(key));
    return true;
  },
});

const subjects: [string, object][] = [
  ["array", []],
  ["map", new Map()],
  ["date", new Date(0)],
  ["plain", {}],
  ["no prototype", Object.create(null)],
  ["text names", { iterator: 1, toStringTag: 2, "Symbol.iterator": 3, "Symbol(Symbol.iterator)": 4 }],
  ["field", new Tagged()],
  ["methods", new Ranged(2)],
  ["class", Ranged],
  ["function", function () {}],
  ["proxy", proxy],
];

const show = (bag: object): string => Reflect.ownKeys(bag).map(key => String(key) + "=" + String((bag as Bag)[key])).join(" ");

function attempt(run: () => string): string {
  try {
    return run();
  } catch (error) {
    return (error as Error).name;
  }
}

function membership(value: object): string {
  return [Symbol.iterator in value, Symbol.asyncIterator in value, Symbol.toStringTag in value, Symbol.hasInstance in value, Symbol.toPrimitive in value].map(Number).join("");
}

function fieldMembership(value: Tagged): string {
  return [Symbol.toStringTag in value, Symbol.iterator in value, "toStringTag" in value, "size" in value].map(Number).join("");
}

console.log("once", Symbol.iterator in subjects[0][1], Symbol.toStringTag in subjects[6][1], Symbol.iterator in subjects[5][1], Symbol.hasInstance in Ranged);
for (const [name, value] of subjects) console.log(name, membership(value));
console.log(trapped.join(", "));
console.log("field", fieldMembership(new Tagged()));

function countInLoop(values: object[], rounds: number): number {
  let count = 0;
  for (let i = 0; i < rounds; i++) {
    const value = values[i % values.length];
    if (Symbol.iterator in value) count += 1;
    if (Symbol.toStringTag in value) count += 100;
    if (Symbol.iterator in value) count += 10000;
  }
  return count;
}
const withoutProxy = subjects.filter(([name]) => name !== "proxy").map(([, value]) => value);
console.log("in a loop", countInLoop(withoutProxy, 20000), countInLoop([new Tagged()], 3), countInLoop([{ iterator: 1 }], 3));

function literalThenSpread(rest: object): Bag {
  return { [Symbol.iterator]: "first", [Symbol.toStringTag]: "tag", plain: 1, ...rest };
}
for (let i = 0; i < 3; i++) {
  console.log("spread", show(literalThenSpread({})), "|", show(literalThenSpread({ [Symbol.iterator]: "second", other: i })), "|", show(literalThenSpread(new Tagged())), "|", show(literalThenSpread([i])));
}

function remove(bag: Bag): string {
  const before = Symbol.toStringTag in bag;
  const removed = delete bag[Symbol.toStringTag];
  return [before, removed, Symbol.toStringTag in bag, "toStringTag" in bag, show(bag)].join(" ");
}
for (let i = 0; i < 3; i++) {
  console.log("delete", remove({ [Symbol.toStringTag]: "x", toStringTag: "text" }), "|", remove({ toStringTag: i }), "|", remove(new Tagged() as unknown as Bag), "|", attempt(() => remove(Object.freeze({ [Symbol.toStringTag]: "frozen" }) as Bag)));
}
trapped.length = 0;
console.log("delete", remove(proxy as Bag), trapped.join(", "));

function withAccessors(start: number) {
  let current = start;
  return {
    get [Symbol.toStringTag](): string {
      return "tag" + current;
    },
    set [Symbol.toStringTag](value: string) {
      current = value.length;
    },
    get [Symbol.toPrimitive]() {
      return () => current;
    },
    plain: start,
  };
}
for (let i = 0; i < 3; i++) {
  const object = withAccessors(i);
  const first = Object.prototype.toString.call(object) + " " + Number(object) + " " + `${object}`;
  object[Symbol.toStringTag] = "four";
  const descriptor = Object.getOwnPropertyDescriptor(object, Symbol.toStringTag)!;
  console.log("accessors", first, Object.prototype.toString.call(object), Number(object), typeof descriptor.get, typeof descriptor.set, descriptor.enumerable, descriptor.configurable, Reflect.ownKeys(object).map(String).join());
}

function readThenStore(bag: Bag, value: unknown): string {
  const before = bag[Symbol.unscopables];
  bag[Symbol.unscopables] = value;
  return String(before) + ">" + String(bag[Symbol.unscopables]) + " " + String(bag["unscopables"]);
}
for (let i = 0; i < 3; i++) {
  const bag: Bag = { unscopables: "text" };
  console.log("stores", readThenStore(bag, i), readThenStore(bag, "again"), show(bag));
  try {
    console.log("an array", readThenStore([] as unknown as Bag, i));
  } catch (error) {
    console.log("an array", (error as Error).name);
  }
}

Bun.gc(true);
console.log("after a collection", subjects.map(([, value]) => membership(value)).join(" "), show(literalThenSpread({ last: true })), countInLoop(withoutProxy, 1000));
