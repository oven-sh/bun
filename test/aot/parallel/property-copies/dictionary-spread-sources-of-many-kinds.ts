// `{ ...source, [key]: value }` where the type of the source is a dictionary and the object is something else: the copy is an ordinary object with the own enumerable
// properties of the source, in their order.
type Numbers = Record<string, number>;
const log: string[] = [];
function extended(source: Numbers, key: string, value: number): Numbers {
  return { ...source, [key]: value };
}
function describe(object: Numbers): string {
  const names = Reflect.ownKeys(object).map(name => {
    const descriptor = Object.getOwnPropertyDescriptor(object, name)!;
    const flags =
      (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
    return String(name) + "=" + String(descriptor.value) + flags;
  });
  return names.join(",") + " proto:" + (Object.getPrototypeOf(object) === Object.prototype);
}
class Point {
  x = 1;
  y = 2;
  get sum() {
    return this.x + this.y;
  }
}
const withGetter = {
  a: 1,
  get b() {
    log.push("get b");
    return 2;
  },
  c: 3,
};
const hidden: Numbers = { a: 1 };
Object.defineProperty(hidden, "secret", { value: 2, enumerable: false });
Object.defineProperty(hidden, "fixed", { value: 3, enumerable: true, writable: false, configurable: false });
const withoutPrototype: Numbers = Object.create(null);
withoutPrototype.a = 1;
const below: Numbers = Object.create({ inherited: 1 });
below.own = 2;
const withIndexes: Numbers = { b: 1, 2: 2, a: 3, 1: 4 };
const withSymbol: Numbers = { a: 1, [Symbol.for("s")]: 2 } as Numbers;
const deleted: Numbers = { a: 1, b: 2, c: 3 };
delete deleted.b;
const many: Numbers = {};
for (let i = 0; i < 70; i++) many["n" + i] = i;
const ownProto: Numbers = JSON.parse('{"__proto__": 1, "a": 2}');
const proxied = new Proxy<Numbers>(
  { a: 1, b: 2 },
  {
    ownKeys(target) {
      log.push("ownKeys");
      return Reflect.ownKeys(target).reverse();
    },
  },
);
const sources: Numbers[] = [
  {},
  { a: 1 },
  { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 },
  new Point() as unknown as Numbers,
  withGetter,
  hidden,
  Object.freeze({ a: 1, b: 2 }) as Numbers,
  Object.seal({ a: 1 }) as Numbers,
  withoutPrototype,
  below,
  withIndexes,
  withSymbol,
  deleted,
  many,
  ownProto,
  proxied,
  [5, 6] as unknown as Numbers,
  "hi" as unknown as Numbers,
  7 as unknown as Numbers,
  null as unknown as Numbers,
  undefined as unknown as Numbers,
  (() => 1) as unknown as Numbers,
];
let last = "";
for (let round = 0; round < 300; round++) {
  last = "";
  log.length = 0;
  for (const source of sources) {
    const copy = extended(source, round % 2 ? "a" : "z", round);
    copy.later = 1;
    last += describe(copy).slice(0, 200) + "\n";
  }
}
console.log(last + log.join(","));
console.log(describe(deleted), describe(hidden), Object.isFrozen(extended(Object.freeze({ a: 1 }) as Numbers, "b", 2)));
