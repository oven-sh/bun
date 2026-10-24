interface P {
  a: number;
  b?: string;
  c?: number;
}

class K {
  x = 1;
  y?: number;
  #z = 2;
  z(): number {
    return this.#z;
  }
}

class A {
  name: string;
  constructor(cb?: (o: A) => void) {
    if (cb) {
      (this as any).tag = 1;
      cb(this);
    }
    this.name = "x";
  }
}

function print(value: unknown): void {
  console.log(JSON.stringify(value));
}

function show(value: unknown): string {
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return String(value);
  return String(JSON.stringify(value));
}

function describe(o: object): string {
  const forIn: string[] = [];
  for (const key in o) forIn.push(key);
  return [
    "keys " + Object.keys(o).join(),
    "values " + Object.values(o).map(show).join(),
    "entries " + Object.entries(o).map(([key, value]) => key + "=" + show(value)).join(),
    "for-in " + forIn.join(),
    "json " + JSON.stringify(o),
    "own " + Reflect.ownKeys(o).map(String).join(),
    "spread " + Object.keys({ ...o }).join(),
  ].join(" | ");
}

function repeated(name: string, create: () => object): void {
  const first = describe(create());
  console.log(name + ": " + first);
  for (let i = 1; i < 2000; i++) {
    const current = describe(create());
    if (current !== first) {
      console.log(name + " differs at " + i + ": " + current);
      return;
    }
  }
}

function once(name: string, create: () => object): void {
  console.log(name + ": " + describe(create()));
  console.log(name + ", again: " + describe(create()));
}

function createP(): P {
  return { a: 1 };
}

function add(o: object, names: string[]): void {
  for (const name of names) (o as any)[name] = name.length;
}

repeated("fields of an interface", () => createP());
repeated("optional fields", () => {
  const o = createP();
  o.c = 3;
  o.b = "b";
  return o;
});
repeated("fields of a class", () => new K());
repeated("one added", () => {
  const o = createP();
  add(o, ["one"]);
  return o;
});
repeated("three added", () => {
  const o = createP();
  add(o, ["one", "three", "seven"]);
  return o;
});
repeated("one added before an optional field", () => {
  const o = createP();
  add(o, ["one"]);
  o.b = "b";
  return o;
});
repeated("three added before an optional field", () => {
  const o = createP();
  add(o, ["one", "three", "seven"]);
  o.c = 3;
  return o;
});
repeated("one added after an optional field", () => {
  const o = createP();
  o.b = "b";
  add(o, ["one"]);
  return o;
});
repeated("three added after an optional field", () => {
  const o = createP();
  o.c = 3;
  add(o, ["one", "three", "seven"]);
  return o;
});
repeated("added to a class", () => {
  const o = new K();
  add(o, ["one", "three"]);
  o.y = 2;
  return o;
});
repeated("frozen with added properties", () => {
  const o = createP();
  add(o, ["one", "three"]);
  return Object.freeze(o);
});
repeated("sealed with added properties", () => {
  const o = new K();
  add(o, ["one"]);
  return Object.seal(o);
});

const sameNames = ["left", "right"];
repeated("same added names, first object", () => {
  const o = createP();
  add(o, sameNames);
  return o;
});
repeated("same added names, second object", () => {
  const o = createP();
  add(o, sameNames);
  (o as any).left = "changed";
  return o;
});

for (let round = 0; round < 3; round++) {
  repeated("collections, round " + round, () => {
    const o = createP();
    add(o, ["one", "three"]);
    o.b = "b";
    return o;
  });
  (globalThis as any).Bun.gc(true);
}

const a = new A();
(a as any).tag = 1;
print(Object.keys({ ...a }));
new A(o => print(Object.keys({ ...o })));
new A(o => print(Object.entries(o).map(([key]) => key)));
new A(o => console.log(describe(o)));

once("an added accessor", () => {
  const o = createP();
  add(o, ["one"]);
  Object.defineProperty(o, "accessor", { get: () => 5, enumerable: true, configurable: true });
  return o;
});
once("a non-enumerable added property", () => {
  const o = createP();
  add(o, ["one"]);
  Object.defineProperty(o, "hidden", { value: 6, enumerable: false });
  add(o, ["two"]);
  return o;
});
const addedSymbol = Symbol("added");
once("an added symbol", () => {
  const o = createP();
  add(o, ["one"]);
  (o as any)[addedSymbol] = 7;
  return o;
});
once("an added index key", () => {
  const o = createP();
  add(o, ["one"]);
  (o as any)["0"] = 8;
  return o;
});

const manyNames: string[] = [];
for (let i = 0; i < 2000; i++) manyNames.push("name" + i);
function printDictionary(o: object): void {
  const keys = Object.keys(o);
  const values = Object.values(o);
  const forIn: string[] = [];
  for (const key in o) forIn.push(key);
  print([keys.length, keys[0], keys[1], keys[keys.length - 1], values.length, forIn.length, Reflect.ownKeys(o).length]);
  print([JSON.stringify(o).length, Object.keys({ ...o }).length, Object.entries(o)[1]]);
}
for (let round = 0; round < 2; round++) {
  const o = createP();
  add(o, manyNames);
  printDictionary(o);
}

once("an added name deleted again", () => {
  const o = createP();
  add(o, ["one", "two"]);
  delete (o as any).one;
  return o;
});
once("the only added name deleted again", () => {
  const o = createP();
  add(o, ["one"]);
  delete (o as any).one;
  o.b = "b";
  return o;
});
once("an optional field deleted", () => {
  const o = createP();
  o.b = "b";
  add(o, ["one"]);
  delete o.b;
  return o;
});
once("an optional field deleted and created again", () => {
  const o = createP();
  o.b = "b";
  o.c = 3;
  add(o, ["one"]);
  delete o.b;
  o.b = "again";
  return o;
});
once("toJSON as an added property", () => {
  const o = createP();
  add(o, ["one"]);
  (o as any).toJSON = () => ({ replaced: true });
  return o;
});
