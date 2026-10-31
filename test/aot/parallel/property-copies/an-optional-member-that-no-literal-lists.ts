interface Never {
  a?: number;
  b?: number;
}
const plain: Never[] = [{ b: 1 }, { b: 2 }];
const add = (o: Never) => (o.a ?? 100) + (o.b ?? 200);
console.log("nothing lands there", plain[0].a, add(plain[0]), "a" in plain[0], Object.keys(plain[1]).join());

interface Inherited {
  c?: number;
  d?: number;
}
const inherits: Inherited = Object.create({ c: 5 });
inherits.d = 1;
console.log("behind it on a prototype", inherits.c, (inherits.c ?? 7) + 1);
const literalProto: Inherited = { __proto__: { c: 6 }, d: 2 } as Inherited;
console.log("the prototype of a literal", literalProto.c);
const moved: Inherited = { d: 3 };
Object.setPrototypeOf(moved, { c: 8 });
console.log("a prototype set later", moved.c);

class Holder {
  e?: number;
  f?: number;
  constructor(f: number) {
    this.f = f;
  }
}
(Holder.prototype as Holder).e = 9;
console.log("on the prototype of a class", new Holder(1).e, Object.keys(new Holder(1)).join());

interface ByKey {
  g?: number;
  h?: number;
}
const byKey: ByKey = { h: 1 };
(byKey as Record<string, number>)[["g"].join("")] = 11;
console.log("under a key the run makes", byKey.g);
const defined: ByKey = { h: 1 };
Object.defineProperty(defined, "g", { value: 12, enumerable: true });
console.log("defined", defined.g);
const reflected: ByKey = { h: 1 };
Reflect.set(reflected, "g", 13);
console.log("through Reflect", reflected.g);
const assignedLater: ByKey = { h: 1 };
Object.assign(assignedLater, JSON.parse('{"g":14}'));
console.log("copied from what a text says", assignedLater.g);

interface Parsed {
  i?: number;
  j?: number;
}
const parsed = JSON.parse('{"i":15}') as Parsed;
console.log("parsed", parsed.i, parsed.j);
const parsedByType: Parsed = JSON.parse('{"i":16}');
console.log("parsed by its type", parsedByType.i, parsedByType.j, (parsedByType.i ?? 1) + 1);

interface Cloned {
  k?: number;
  l?: number;
}
const original = JSON.parse('{"k":17}') as Cloned;
const cloned: Cloned = structuredClone(original);
const spreadOfIt: Cloned = { l: 1, ...original };
console.log("cloned and spread", cloned.k, spreadOfIt.k);

interface Getter {
  m?: number;
  n?: number;
}
const withGetter: Getter = {
  get m() {
    return 18;
  },
};
console.log("a getter", withGetter.m);

interface Deleted {
  o?: number;
  p?: number;
}
const gone: Deleted = { p: 1 };
delete gone.o;
console.log("deleted", gone.o, "o" in gone);
export {};
