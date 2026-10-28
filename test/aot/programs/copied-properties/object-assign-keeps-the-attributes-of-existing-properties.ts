// Object.defineProperty gives one own property of an object other attributes, then Object.assign stores into the object.
// The targets are literals typed by an interface, instances of a class and untyped literals; the property is a declared one, an undeclared one or a symbol.
// At the end the constructor of a class defines the property, so every instance is born with it.
// Every property's value and attributes, the order of the keys, for-in and JSON.stringify are printed after each call.
interface Shape {
  n?: number;
  s?: string;
  o?: { k: number };
}
class Point {
  n = 10;
  s = "point";
}
const mark = Symbol("mark");

function describe(value: object) {
  const parts: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    const own = Object.getOwnPropertyDescriptor(value, key)!;
    parts.push(
      `${String(key)}=${JSON.stringify(own.value)}:${own.writable ? "w" : "-"}${own.enumerable ? "e" : "-"}${own.configurable ? "c" : "-"}`,
    );
  }
  let listed = "";
  for (const name in value) listed += name + ",";
  return `${parts.join(" ")} | ${Object.keys(value)} | ${listed} | ${JSON.stringify(value)}`;
}

function written(form: number): Shape {
  switch (form) {
    case 0:
      return {};
    case 1:
      return { n: 1 };
    case 2:
      return { s: "s", n: 2 };
    default:
      return { o: { k: 3 }, s: "t", n: 3 };
  }
}

const targets: [string, () => object][] = [
  ["empty", () => written(0)],
  ["n", () => written(1)],
  ["s n", () => written(2)],
  ["o s n", () => written(3)],
  ["instance", () => new Point()],
  ["untyped", () => ({ s: "u", extra: 0, n: 4 })],
  ["below null", () => Object.setPrototypeOf(written(2), null)],
];
const sources: [string, () => object][] = [
  ["n", () => written(1)],
  ["s n", () => written(2)],
  ["o s n", () => written(3)],
  ["instance", () => new Point()],
  ["extra n", () => ({ extra: 9, n: 8 })],
  ["mark n extra", () => ({ [mark]: 7, n: 6, extra: 5 })],
  ["text for n", () => ({ n: "text" })],
];
const keys: PropertyKey[] = ["n", "s", "extra", mark];

for (const [targetName, makeTarget] of targets) {
  for (const key of keys) {
    for (let attributes = 0; attributes < 8; attributes++) {
      const descriptor = {
        value: -1,
        writable: (attributes & 4) === 0,
        enumerable: (attributes & 1) !== 0,
        configurable: (attributes & 2) !== 0,
      };
      for (const [sourceName, makeSource] of sources) {
        const target = makeTarget();
        Object.defineProperty(target, key, descriptor);
        let outcome = "stored";
        try {
          Object.assign(target, makeSource());
        } catch (error) {
          outcome = (error as Error).constructor.name;
        }
        console.log(`${targetName} . ${String(key)} ${attributes} . ${sourceName}: ${outcome}: ${describe(target)}`);
      }
    }
  }
}

for (const limit of [Object.preventExtensions, Object.seal, Object.freeze]) {
  for (const [targetName, makeTarget] of targets) {
    for (const [sourceName, makeSource] of sources) {
      const target = makeTarget();
      Object.defineProperty(target, "n", { value: -1, writable: true, enumerable: false, configurable: true });
      limit(target);
      let outcome = "stored";
      try {
        Object.assign(target, makeSource());
      } catch (error) {
        outcome = (error as Error).constructor.name;
      }
      console.log(`${limit.name} . ${targetName} . ${sourceName}: ${outcome}: ${describe(target)}`);
    }
  }
}

const several = written(3);
Object.defineProperty(several, "s", { enumerable: false });
Object.defineProperty(several, "n", { enumerable: false, configurable: false });
Object.assign(several, written(2), written(1), { extra: 1 });
console.log("several sources:", describe(several));

class Hidden {
  n = 1;
  declare secret: number;
  constructor() {
    Object.defineProperty(this, "secret", { value: 0, writable: true, enumerable: false, configurable: true });
  }
}
class Pinned {
  n = 1;
  declare pin: number;
  constructor() {
    Object.defineProperty(this, "pin", { value: 0, writable: true, enumerable: true, configurable: false });
  }
}
class Options {
  secret = 7;
  pin = 8;
  n = 3;
}
for (let turn = 0; turn < 3; turn++) {
  console.log("hidden . instance:", describe(Object.assign(new Hidden(), new Options())));
  console.log("hidden . literal:", describe(Object.assign(new Hidden(), { secret: 5, n: 2 })));
  console.log("hidden . hidden:", describe(Object.assign(new Hidden(), new Hidden())));
  console.log("pinned . instance:", describe(Object.assign(new Pinned(), new Options())));
  console.log("pinned . text:", describe(Object.assign(new Pinned(), { pin: "text" })));
  console.log("instance . hidden:", describe(Object.assign(new Options(), new Hidden())));
  console.log("spread:", describe({ ...new Hidden(), ...new Pinned() }));
}
