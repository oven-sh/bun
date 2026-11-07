// Objects of classes and of record types that get properties their types do not declare: everything the language lets a program do to such a property.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
const show = (label: string, value: unknown) => console.log(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
const attempt = (label: string, action: () => unknown) => {
  try {
    show(label, action());
  } catch (error) {
    console.log(label + ": throws " + (error as Error).constructor.name);
  }
};

class TwoBoxed {
  first: unknown = 1;
  second: unknown = "two";
  describe(): string {
    return "TwoBoxed";
  }
}
class BoxedAndLink {
  value: unknown = 1;
  next: BoxedAndLink | null = null;
  describe(): string {
    return "BoxedAndLink";
  }
}
class ThreeLinks {
  a: ThreeLinks | null = null;
  b: ThreeLinks | null = null;
  c: ThreeLinks | null = null;
  describe(): string {
    return "ThreeLinks";
  }
}
class FourLinks {
  a: FourLinks | null = null;
  b: FourLinks | null = null;
  c: FourLinks | null = null;
  d: FourLinks | null = null;
  describe(): string {
    return "FourLinks";
  }
}
class Flags {
  on = true;
  off = false;
  count = 3;
  describe(): string {
    return "Flags";
  }
}
class Heir extends BoxedAndLink {
  more: unknown = "more";
  describe(): string {
    return "Heir of " + super.describe();
  }
}
class WithOptional {
  always = 1;
  sometimes?: string;
  describe(): string {
    return "WithOptional";
  }
}
interface Point {
  x: number;
  y: number;
}
interface Named {
  name: string;
  tag?: string;
}

const makers: [string, () => any][] = [
  ["TwoBoxed", () => new TwoBoxed()],
  ["BoxedAndLink", () => new BoxedAndLink()],
  ["ThreeLinks", () => new ThreeLinks()],
  ["FourLinks", () => new FourLinks()],
  ["Flags", () => new Flags()],
  ["Heir", () => new Heir()],
  ["WithOptional", () => new WithOptional()],
  ["Point", (): Point => ({ x: 1, y: 2 })],
  ["Named", (): Named => ({ name: "n" })],
];

const symbol = Symbol("mark");

for (const [label, make] of makers) {
  console.log("== " + label);
  const object = make();
  show("keys at birth", Object.keys(object));
  show("missing", String(object.params));
  object.params = { id: 7 };
  object.query = "q";
  object.route = 3.5;
  show("read", [object.params.id, object.query, object.route]);
  show("keys", Object.keys(object));
  show("json", JSON.stringify(object));
  show("spread", { ...object });
  show("assign", Object.assign({ before: 0 }, object));
  show("entries", Object.entries(object));
  const inLoop: string[] = [];
  for (const key in object) inLoop.push(key);
  show("for in", inLoop);
  show("in", ["params" in object, "nothing" in object, "toString" in object]);
  show("hasOwn", [Object.hasOwn(object, "query"), Object.hasOwn(object, "nothing"), object.hasOwnProperty("route")]);
  show("descriptor", Object.getOwnPropertyDescriptor(object, "query"));
  if (typeof object.describe === "function") show("method", object.describe());

  object.query = "r";
  object.route += 1;
  show("stored again", [object.query, object.route]);

  show("delete", [delete object.query, delete object.nothing]);
  show("keys after delete", Object.keys(object));
  show("read after delete", String(object.query));
  object.query = "back";
  show("keys after it is back", Object.keys(object));

  object[symbol] = "by symbol";
  object[2] = "two";
  object[0] = "zero";
  show("own keys", Reflect.ownKeys(object).map(String));
  show("by symbol and index", [object[symbol], object[0], object[2], String(object[1])]);
  show("delete index", [delete object[0], Object.keys(object)]);

  let calls = 0;
  Object.defineProperty(object, "computed", {
    get() {
      calls++;
      return this.route * 2;
    },
    set(value) {
      this.route = value;
    },
    enumerable: true,
    configurable: true,
  });
  show("getter", [object.computed, object.computed, calls]);
  object.computed = 10;
  show("setter", [object.route, object.computed]);
  Object.defineProperty(object, "hidden", { value: "h", enumerable: false, writable: true, configurable: true });
  Object.defineProperty(object, "fixed", { value: "f", enumerable: true, writable: false, configurable: false });
  show("keys with hidden", Object.keys(object));
  show("names with hidden", Object.getOwnPropertyNames(object));
  attempt("store to read-only", () => {
    "use strict";
    object.fixed = "g";
    return object.fixed;
  });
  attempt("delete what cannot be deleted", () => {
    "use strict";
    return delete object.fixed;
  });
  attempt("redefine what cannot be", () => Object.defineProperty(object, "fixed", { value: "other" }));
  show("descriptors", Object.keys(Object.getOwnPropertyDescriptors(object)));
  Object.defineProperty(object, "computed", { value: "now a value", writable: true, enumerable: true, configurable: true });
  show("accessor made a value", object.computed);

  const heir = Object.create(object);
  show("inherited", [heir.params.id, heir.hidden, Object.keys(heir)]);
  heir.params = "own";
  show("shadowed", [heir.params, object.params.id]);

  if (typeof shell.structuredClone === "function") {
    const plainCopy = make();
    plainCopy.extra = [1, 2];
    show("structuredClone", shell.structuredClone(plainCopy));
  }
}

console.log("== all of them deleted, then added again");
for (const [label, make] of makers) {
  const object = make();
  const before = Object.keys(object);
  object.one = 1;
  object.two = 2;
  delete object.one;
  delete object.two;
  const between = Object.keys(object);
  object.three = 3;
  show(label, [before.length === between.length, Object.keys(object).slice(before.length), String(object.one), object.three]);
}

console.log("== an optional field that is created after a property beyond the layout");
{
  const object: any = new WithOptional();
  object.early = 1;
  object.sometimes = "now";
  object.late = 2;
  show("keys", Object.keys(object));
  delete object.sometimes;
  show("keys", Object.keys(object));
  object.sometimes = "again";
  show("keys", Object.keys(object));
  const named: any = { name: "n" } as Named;
  named.early = 1;
  named.tag = "t";
  named.late = 2;
  show("keys", Object.keys(named));
  show("json", named);
}

console.log("== integrity levels");
function frozen(): unknown[] {
  const results: unknown[] = [];
  const point: Point = { x: 1, y: 2 };
  (point as any).z = 3;
  Object.freeze(point);
  results.push(Object.isFrozen(point), Object.isSealed(point), Object.isExtensible(point));
  try {
    (point as any).z = 4;
    results.push("stored");
  } catch (error) {
    results.push((error as Error).constructor.name);
  }
  try {
    (point as any).w = 4;
    results.push("added");
  } catch (error) {
    results.push((error as Error).constructor.name);
  }
  try {
    results.push(delete (point as any).z);
  } catch (error) {
    results.push((error as Error).constructor.name);
  }
  results.push((point as any).z, Object.keys(point));
  return results;
}
function sealed(): unknown[] {
  const results: unknown[] = [];
  const point: Point = { x: 1, y: 2 };
  (point as any).z = 3;
  Object.seal(point);
  results.push(Object.isFrozen(point), Object.isSealed(point), Object.isExtensible(point));
  (point as any).z = 4;
  try {
    (point as any).w = 4;
    results.push("added");
  } catch (error) {
    results.push((error as Error).constructor.name);
  }
  try {
    results.push(delete (point as any).z);
  } catch (error) {
    results.push((error as Error).constructor.name);
  }
  results.push((point as any).z, Object.keys(point));
  return results;
}
function notExtensible(): unknown[] {
  const results: unknown[] = [];
  const point: Point = { x: 1, y: 2 };
  (point as any).z = 3;
  Object.preventExtensions(point);
  results.push(Object.isFrozen(point), Object.isSealed(point), Object.isExtensible(point));
  (point as any).z = 4;
  try {
    (point as any).w = 4;
    results.push("added");
  } catch (error) {
    results.push((error as Error).constructor.name);
  }
  results.push(delete (point as any).z, String((point as any).z), Object.keys(point));
  return results;
}
show("frozen", frozen());
show("sealed", sealed());
show("not extensible", notExtensible());

console.log("== many");
for (const [label, make] of makers) {
  const object = make();
  const fields = Object.keys(object).length;
  for (let i = 0; i < 200; i++) object["p" + i] = i;
  let sum = 0;
  for (let i = 0; i < 200; i++) sum += object["p" + i];
  for (let i = 0; i < 200; i += 2) delete object["p" + i];
  let left = 0;
  for (const key of Object.keys(object).slice(fields)) left += object[key];
  show(label, [sum, left, Object.keys(object).length - fields, Object.keys(object)[fields], Object.keys(object).at(-1)]);
}

console.log("== what they refer to survives collections, and nothing else does");
{
  const registry = typeof shell.FinalizationRegistry === "function";
  for (const [label, make] of makers) {
    const kept: any[] = [];
    let expected = 0;
    for (let round = 0; round < 40; round++) {
      for (let i = 0; i < 500; i++) {
        const object = make();
        object.payload = { number: i, text: "t" + i };
        object.self = object;
        object.list = [i, i + 1];
        if (i % 50 === 0) {
          kept.push(object);
          expected += i + i + 1 + i;
        }
      }
      collect(round % 8 === 7);
    }
    collect(true);
    let sum = 0;
    for (const object of kept) sum += object.payload.number + object.list[1] + object.self.list[0] + (object.payload.text === "t" + object.payload.number ? 0 : 1000000);
    show(label, [kept.length, sum === expected, registry]);
  }
}

console.log("== an old object gets a young property");
{
  const old: any[] = makers.map(([, make]) => make());
  collect(true);
  collect(true);
  for (const object of old) object.young = { value: "first" };
  collect(false);
  for (const object of old) object.younger = { value: object.young.value + " second" };
  collect(false);
  for (const object of old) object.young = { value: "third" };
  collect(false);
  collect(true);
  show("values", old.map(object => object.young.value + " | " + object.younger.value));
}

console.log("== one site, objects with and without, in every order");
{
  const read = (object: any) => object.params;
  const store = (object: any, value: unknown) => {
    object.params = value;
  };
  const call = (object: any) => (typeof object.describe === "function" ? object.describe() : "none");
  const seen: string[] = [];
  for (let round = 0; round < 50; round++) {
    for (const [, make] of makers) {
      const object = make();
      const before = String(read(object));
      if (round % 3) store(object, round);
      if (round % 5 === 0) object.other = 1;
      if (round % 7 === 0) store(object, "again");
      seen.push(before + String(read(object)) + call(object).length);
    }
  }
  show("digest", [seen.length, seen.slice(0, 12).join(","), seen.slice(-12).join(",")]);
}
