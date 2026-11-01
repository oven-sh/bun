// Every case goes through shared deleting functions many times, so that what is remembered about one receiver meets all the others.
type Table = Record<string | symbol, any>;

const lines: string[] = [];
function show(label: string, value: unknown) {
  lines.push(label + ": " + String(value));
}

function describe(table: unknown): string {
  if ((typeof table !== "object" && typeof table !== "function") || table === null) return String(table);
  if (table instanceof Error) return "[" + Object.keys(table).join(" ") + "]";
  const parts: string[] = [];
  for (const key of Reflect.ownKeys(table)) {
    const d = Object.getOwnPropertyDescriptor(table, key)!;
    parts.push(
      String(key) +
        "=" +
        ("value" in d ? String(d.value) : "accessor") +
        (d.writable ? "w" : "-") +
        (d.enumerable ? "e" : "-") +
        (d.configurable ? "c" : "-"),
    );
  }
  return "[" + parts.join(" ") + "]";
}

function say(error: unknown): string {
  return (error as Error).constructor.name + ": " + (error as Error).message.replace(/ \(evaluating .*\)$/, "");
}

function deleteByKey(table: any, key: any): string {
  "use strict";
  try {
    return String(delete table[key]);
  } catch (error) {
    return say(error);
  }
}
const { deleteByKeySloppy, deleteASloppy, isSloppy } = require("./sloppy-deletions.cjs") as {
  deleteByKeySloppy(table: any, key: any): string;
  deleteASloppy(table: any): string;
  isSloppy: string;
};
show("the other file is", isSloppy);
function deleteA(table: any): string {
  try {
    return String(delete table.a);
  } catch (error) {
    return say(error);
  }
}
function deleteB(table: any): string {
  try {
    return String(delete table.b);
  } catch (error) {
    return say(error);
  }
}

const rounds = 120;
function repeat(label: string, make: () => any, act: (table: any, round: number) => string) {
  let first = "";
  let differs = 0;
  for (let round = 0; round < rounds; round++) {
    const table = make();
    const result = act(table, round) + " " + describe(table);
    if (!round) first = result;
    else if (result !== first) differs++;
  }
  show(label, first + (differs ? " BUT " + differs + " ROUNDS DIFFER" : ""));
}

class Point {
  x = 1;
  y = 2;
}
class Sparse {
  a?: number;
  b?: number;
  constructor(a?: number, b?: number) {
    if (a !== undefined) this.a = a;
    if (b !== undefined) this.b = b;
  }
}

const addedByKey = [process.argv.length > 99 ? "other" : "b"];
const makers: [string, () => Table][] = [
  ["record", () => ({ a: 1, b: 2, c: 3 })],
  [
    "empty then filled",
    () => {
      const t: Table = {};
      t.a = 1;
      t.b = 2;
      t.c = 3;
      return t;
    },
  ],
  ["without prototype", () => ({ __proto__: null, a: 1, b: 2, c: 3 }) as Table],
  [
    "Object.create(null)",
    () => {
      const t: Table = Object.create(null);
      t.a = 1;
      t.b = 2;
      t.c = 3;
      return t;
    },
  ],
  [
    "instance with extras",
    () => {
      const t: Table = new Point();
      t.a = 1;
      t.b = 2;
      t.c = 3;
      return t;
    },
  ],
  [
    "instance with optional fields",
    () => {
      const t: Table = new Sparse(1, 2);
      t.c = 3;
      return t;
    },
  ],
  [
    "many names",
    () => {
      const t: Table = {};
      for (let i = 0; i < 12; i++) t["n" + i] = i;
      t.a = 1;
      t.b = 2;
      t.c = 3;
      return t;
    },
  ],
  [
    "function",
    () => {
      const t: Table = function () {};
      t.a = 1;
      t.b = 2;
      t.c = 3;
      return t;
    },
  ],
  [
    "array",
    () => {
      const t: Table = [7, 8];
      t.a = 1;
      t.b = 2;
      t.c = 3;
      return t;
    },
  ],
  [
    "a name added by key between two others",
    () => {
      const t = { __proto__: null, a: 1 } as Table;
      t[addedByKey[0]] = 2;
      t.c = 3;
      return t;
    },
  ],
  [
    "an instance with a name added by key between two others",
    () => {
      const t: Table = new Point();
      t.a = 1;
      t[addedByKey[0]] = 2;
      t.c = 3;
      return t;
    },
  ],
  [
    "ninety names",
    () => {
      const t: Table = {};
      for (let i = 0; i < 90; i++) t["n" + i] = i;
      delete t.n7;
      t.a = 1;
      t.b = 2;
      t.c = 3;
      return t;
    },
  ],
];

for (const [name, make] of makers) {
  repeat(name + ", first by id", make, t => deleteA(t));
  repeat(name + ", middle by id", make, t => deleteB(t));
  repeat(name + ", last by key", make, t => deleteByKey(t, "c"));
  repeat(name + ", sloppy by key", make, t => deleteByKeySloppy(t, "b"));
  repeat(name + ", absent by key", make, t => deleteByKey(t, "zz"));
  repeat(name + ", twice", make, t => deleteA(t) + deleteA(t));
  repeat(name + ", all", make, t => deleteA(t) + deleteB(t) + deleteByKey(t, "c"));
  repeat(name + ", deleted and added again", make, t => {
    const r = deleteA(t);
    t.a = 9;
    return r;
  });
  repeat(name + ", deleted and added in another order", make, t => {
    const r = deleteA(t) + deleteB(t);
    t.b = 8;
    t.a = 9;
    return r;
  });
  repeat(
    name + ", read after",
    make,
    t => deleteB(t) + " " + t.a + " " + t.b + " " + t.c + " " + ("b" in t) + " " + Object.hasOwn(t, "b"),
  );
  repeat(name + ", keys after", make, t => deleteB(t) + " " + Object.keys(t).join() + " " + JSON.stringify(t));
  repeat(
    name + ", frozen",
    () => Object.freeze(make()),
    t => deleteA(t) + " " + deleteByKeySloppy(t, "a") + " " + deleteASloppy(t) + " " + deleteByKey(t, "zz"),
  );
  repeat(
    name + ", sealed",
    () => Object.seal(make()),
    t => deleteB(t) + " " + deleteByKeySloppy(t, "b"),
  );
  repeat(
    name + ", not extensible",
    () => Object.preventExtensions(make()),
    t => deleteB(t) + " " + deleteByKey(t, "c"),
  );
  repeat(
    name + ", not configurable",
    () => Object.defineProperty(make(), "a", { value: 5, configurable: false }),
    t => deleteA(t) + " " + deleteByKeySloppy(t, "a") + " " + deleteASloppy(t) + " " + deleteB(t),
  );
  repeat(
    name + ", getter",
    () =>
      Object.defineProperty(make(), "a", {
        get() {
          return 5;
        },
        configurable: true,
      }),
    t => deleteA(t) + " " + t.a,
  );
  repeat(
    name + ", setter",
    () => Object.defineProperty(make(), "b", { set(_v) {}, configurable: true, enumerable: true }),
    t => deleteB(t) + " " + t.b,
  );
  repeat(
    name + ", not enumerable",
    () => Object.defineProperty(make(), "b", { value: 5, configurable: true, enumerable: false }),
    t => deleteB(t),
  );
  repeat(
    name + ", an index",
    () => {
      const t = make();
      t[1] = 5;
      return t;
    },
    t => deleteByKey(t, 1) + " " + deleteByKey(t, 9) + " " + deleteByKeySloppy(t, 1),
  );
  repeat(
    name + ", an index of a frozen one",
    () => {
      const t = make();
      t[1] = 5;
      return Object.freeze(t);
    },
    t => deleteByKey(t, 1) + " " + deleteByKeySloppy(t, 1) + " " + deleteByKey(t, 9),
  );
  repeat(
    name + ", symbol",
    () => {
      const t = make();
      t[Symbol.iterator] = 4;
      return t;
    },
    t => deleteByKey(t, Symbol.iterator),
  );
  repeat(
    name + ", alternating",
    make,
    (t, round) =>
      (round & 1 ? deleteA(t) : deleteB(t)).length +
      " " +
      (round & 1 ? "" : (delete t.a, (t.b = 2), "")) +
      (round & 1 ? (delete t.b, (t.b = 2), "") : ""),
  );
  repeat(name + ", during for-in", make, t => {
    let seen = "";
    for (const key in t) {
      seen += key;
      if (key === "a") deleteB(t);
    }
    return seen;
  });
  repeat(
    name + ", key made at run time",
    make,
    (t, round) => deleteByKey(t, ["a", "b"][round & 1].concat("")).length + "",
  );
  repeat(name + ", as a prototype", make, t => {
    const child = Object.create(t);
    const before = child.b;
    const r = deleteB(t);
    return before + " " + r + " " + child.b + " " + ("b" in child);
  });
  repeat(name + ", inherited stays", make, t => {
    const child = Object.create(t);
    return deleteB(child) + " " + child.b;
  });
  repeat(name + ", shadow goes", make, t => {
    const child = Object.create(t);
    child.b = 7;
    return child.b + " " + deleteB(child) + " " + child.b;
  });
}

// A prototype that many reads have gone through.
{
  const proto: Table = { a: 1, b: 2 };
  const grandchild = Object.create(Object.create(proto));
  let sum = 0;
  for (let i = 0; i < 200; i++) sum += grandchild.b;
  show("read through chain", sum);
  show("delete on prototype", deleteB(proto));
  let undefinedReads = 0;
  for (let i = 0; i < 200; i++) if (grandchild.b === undefined) undefinedReads++;
  show("reads after", undefinedReads);
  proto.b = 5;
  show("read after adding again", grandchild.b);
}
{
  class Base {
    m() {
      return 1;
    }
  }
  class Derived extends Base {}
  const d = new Derived();
  let sum = 0;
  for (let i = 0; i < 100; i++) sum += d.m();
  show("method calls", sum);
  show("delete method", deleteByKey(Base.prototype, "m"));
  show("method after", typeof (d as any).m);
}

// Fields of compiled layouts.
repeat(
  "field of a class",
  () => new Point(),
  t => deleteByKey(t, "x") + " " + t.x + " " + Object.keys(t).join(),
);
repeat(
  "field then field again",
  () => new Point(),
  t => {
    const r = deleteByKey(t, "x");
    t.x = 5;
    return r + " " + Object.keys(t).join();
  },
);
repeat(
  "extra in front of a late field",
  () => {
    const t: any = new Sparse(1);
    t.extra = 1;
    t.b = 2;
    t.more = 3;
    return t;
  },
  t => deleteByKey(t, "extra") + " " + Object.keys(t).join(),
);
repeat(
  "extra behind a late field",
  () => {
    const t: any = new Sparse(1);
    t.extra = 1;
    t.b = 2;
    t.more = 3;
    return t;
  },
  t => deleteByKey(t, "more") + " " + Object.keys(t).join(),
);
repeat(
  "extras, then the late field",
  () => {
    const t: any = new Sparse(1);
    t.extra = 1;
    t.more = 3;
    return t;
  },
  t => {
    const r = deleteByKey(t, "extra");
    t.b = 2;
    t.extra = 4;
    return r + " " + Object.keys(t).join();
  },
);
repeat(
  "both orders of one layout",
  () => new Sparse(1),
  (t, round) => {
    if (round & 1) {
      t.extra = 1;
      t.b = 2;
    } else {
      t.b = 2;
      t.extra = 1;
    }
    const keys = Object.keys(t).join();
    return (deleteByKey(t, "extra") + " " + Object.keys(t).join() + " " + keys).length + "";
  },
);

class Mixed {
  n = 1.5;
  i = 7;
  s = "text";
  o: object | undefined = { inner: 1 };
  b = true;
  u: undefined | number = undefined;
  f = () => 3;
}
class Child extends Mixed {
  extra = [1];
}
for (const name of ["n", "i", "s", "o", "b", "u", "f"]) {
  repeat(
    "field " + name,
    () => new Mixed(),
    t => deleteByKey(t, name) + " " + String(t[name]) + " " + (name in t) + " " + Object.keys(t).join(),
  );
  repeat(
    "field " + name + " twice",
    () => new Mixed(),
    t => deleteByKey(t, name) + deleteByKey(t, name) + " " + Object.keys(t).join(),
  );
  repeat(
    "field " + name + " and back",
    () => new Mixed(),
    t => {
      const r = deleteByKey(t, name);
      t[name] = 5;
      return r + " " + t[name] + " " + Object.keys(t).join();
    },
  );
  repeat(
    "field " + name + " of a subclass",
    () => new Child(),
    t => deleteByKey(t, name) + " " + Object.keys(t).join() + " " + JSON.stringify(t),
  );
  repeat(
    "field " + name + " of a frozen one",
    () => Object.freeze(new Mixed()),
    t => deleteByKey(t, name) + " " + deleteByKeySloppy(t, name) + " " + Object.keys(t).join(),
  );
  repeat(
    "field " + name + " of a sealed one",
    () => Object.seal(new Mixed()),
    t => deleteByKey(t, name) + " " + Object.keys(t).join(),
  );
  repeat(
    "field " + name + " made a getter",
    () =>
      Object.defineProperty(new Mixed(), name, {
        get() {
          return 9;
        },
        configurable: true,
        enumerable: true,
      }),
    t => t[name] + " " + deleteByKey(t, name) + " " + String(t[name]) + " " + Object.keys(t).join(),
  );
  repeat(
    "field " + name + " made fixed",
    () => Object.defineProperty(new Mixed(), name, { configurable: false }),
    t => deleteByKey(t, name) + " " + deleteByKeySloppy(t, name) + " " + Object.keys(t).join(),
  );
  repeat(
    "field " + name + " with extras",
    () => {
      const t: any = new Mixed();
      t.z = 1;
      return t;
    },
    t => deleteByKey(t, name) + " " + Object.keys(t).join() + " " + deleteByKey(t, "z") + " " + Object.keys(t).join(),
  );
  repeat(
    "field " + name + " behind another",
    () => new Mixed(),
    t => deleteByKey(t, "s") + deleteByKey(t, name) + " " + Object.keys(t).join(),
  );
  repeat(
    "field " + name + " of a prototype",
    () => new Mixed(),
    t => {
      const child = Object.create(t);
      const before = String(child[name]);
      return before + " " + deleteByKey(t, name) + " " + String(child[name]);
    },
  );
}
repeat(
  "every field, forwards",
  () => new Mixed(),
  t => {
    let r = "";
    for (const name of Object.keys(t)) r += deleteByKey(t, name)[0];
    return r + Object.keys(t).length;
  },
);
repeat(
  "every field, backwards, and back",
  () => new Mixed(),
  t => {
    const names = Object.keys(t).reverse();
    for (const name of names) deleteByKey(t, name);
    for (const name of names) t[name] = 1;
    return Object.keys(t).join();
  },
);
repeat(
  "fields in turn",
  () => new Mixed(),
  (t, round) => {
    const name = ["n", "s", "o"][round % 3];
    deleteByKey(t, name);
    t[name] = 0;
    return String(Object.keys(t).length);
  },
);
{
  const instances: any[] = [];
  for (let i = 0; i < 2000; i++) instances.push(new Mixed());
  Bun.gc(true);
  let ok = 0;
  for (const t of instances)
    if (deleteByKey(t, "o") === "true" && t.o === undefined && !("o" in t) && t.s === "text") ok++;
  Bun.gc(true);
  for (const t of instances) if (Object.keys(t).join() === "n,i,s,b,u,f") ok++;
  show("fields of old instances", ok);
}

// Fields whose slots hold numbers and truth values as they are. One more property keeps each object in the heap.
class Whole {
  x = 1;
  y = 2;
}
class Fraction {
  x = 1.5;
  y = 2;
}
class Truth {
  x = true;
  y = 2;
}
class Large {
  x = 2 ** 40;
  y = 2;
}
class Text {
  x = "a";
  y = 2;
}
const spare = ["end"];
{
  const outcomes: string[] = [];
  const look = (t: Table) => String(t.x) + " " + ("x" in t) + " " + Object.keys(t).join() + " " + JSON.stringify(t);
  let whole = 0,
    fraction = 0,
    truth = 0,
    large = 0,
    text = 0;
  for (let i = 0; i < 60; i++) {
    const t = new Whole() as unknown as Table;
    t[spare[0]] = i;
    if (delete t.x && look(t) === 'undefined false y,end {"y":2,"end":' + i + "}") whole++;
    t.x = 7;
    if (i === 59) outcomes.push(look(t));
  }
  for (let i = 0; i < 60; i++) {
    const t = new Fraction() as unknown as Table;
    t[spare[0]] = i;
    if (delete t.x && look(t) === 'undefined false y,end {"y":2,"end":' + i + "}") fraction++;
    t.x = "other";
    if (i === 59) outcomes.push(look(t));
  }
  for (let i = 0; i < 60; i++) {
    const t = new Truth() as unknown as Table;
    t[spare[0]] = i;
    if (delete t.x && look(t) === 'undefined false y,end {"y":2,"end":' + i + "}") truth++;
    t.x = false;
    if (i === 59) outcomes.push(look(t));
  }
  for (let i = 0; i < 60; i++) {
    const t = new Large() as unknown as Table;
    t[spare[0]] = i;
    if (delete t.x && look(t) === 'undefined false y,end {"y":2,"end":' + i + "}") large++;
    t.x = 2 ** 41;
    if (i === 59) outcomes.push(look(t));
  }
  for (let i = 0; i < 60; i++) {
    const t = new Text() as unknown as Table;
    t[spare[0]] = i;
    if (delete t.x && look(t) === 'undefined false y,end {"y":2,"end":' + i + "}") text++;
    t.x = "b";
    if (i === 59) outcomes.push(look(t));
  }
  show("fields that hold raw values", [whole, fraction, truth, large, text].join() + " " + outcomes.join(" | "));
}

// Exotic receivers.
repeat(
  "proxy",
  () =>
    new Proxy({ a: 1 } as Table, {
      deleteProperty(target, key) {
        return key === "a" ? false : delete target[key as string];
      },
    }),
  t => deleteA(t) + " " + deleteByKeySloppy(t, "a") + " " + deleteB(t),
);
repeat(
  "proxy without trap",
  () => new Proxy({ a: 1, b: 2 } as Table, {}),
  t => deleteA(t) + " " + deleteB(t),
);
repeat(
  "array index",
  () => [1, 2, 3],
  t => deleteByKey(t, 1) + " " + deleteByKey(t, "0") + " " + t.length + " " + (1 in t),
);
repeat(
  "array length",
  () => [1, 2, 3],
  t => deleteByKey(t, "length") + " " + deleteByKeySloppy(t, "length"),
);
repeat(
  "string object",
  () => new String("ab"),
  t => deleteByKey(t, "0") + " " + deleteByKeySloppy(t, "length") + " " + deleteByKey(t, "5"),
);
repeat(
  "typed array",
  () => new Uint8Array(2),
  t => deleteByKey(t, "0") + " " + deleteByKeySloppy(t, 0) + " " + deleteByKey(t, 9) + " " + deleteByKey(t, "a"),
);
repeat(
  "function name and length",
  () => function named(_a: number) {},
  t =>
    deleteByKey(t, "name") +
    " " +
    deleteByKey(t, "length") +
    " " +
    deleteByKey(t, "prototype") +
    " " +
    t.name +
    " " +
    t.length,
);
repeat(
  "arrow function",
  () => () => 1,
  t => deleteByKey(t, "name") + " " + deleteByKey(t, "prototype") + " [" + t.name + "]",
);
repeat(
  "class constructor",
  () =>
    class K {
      static s = 1;
    },
  t => deleteByKey(t, "s") + " " + deleteByKey(t, "prototype") + " " + deleteByKey(t, "name"),
);
repeat(
  "arguments",
  () =>
    (function (..._r: number[]) {
      return arguments;
    })(1, 2),
  t => deleteByKey(t, "0") + " " + deleteByKey(t, "length") + " " + deleteByKey(t, "callee"),
);
repeat(
  "error",
  () => new Error("m"),
  t => deleteByKey(t, "message") + " " + deleteByKey(t, "stack") + " " + t.message + " " + typeof t.stack,
);
repeat(
  "regexp",
  () => /a/g,
  t => deleteByKey(t, "lastIndex") + " " + deleteByKeySloppy(t, "lastIndex") + " " + deleteByKey(t, "source"),
);
repeat(
  "map",
  () => {
    const m: any = new Map();
    m.a = 1;
    return m;
  },
  t => deleteA(t) + " " + deleteA(t),
);
repeat(
  "date",
  () => {
    const m: any = new Date(0);
    m.b = 1;
    return m;
  },
  t => deleteB(t),
);
repeat(
  "promise",
  () => {
    const m: any = Promise.resolve();
    m.b = 1;
    return m;
  },
  t => deleteB(t),
);
repeat(
  "number",
  () => 5,
  t => deleteA(t) + " " + deleteByKey(t, "toFixed"),
);
repeat(
  "string",
  () => "ab",
  t => deleteByKey(t, "length") + " " + deleteByKeySloppy(t, "0") + " " + deleteByKey(t, "zz"),
);
repeat(
  "boolean and symbol",
  () => true,
  t => deleteA(t) + " " + deleteA(Symbol.iterator),
);
show("undefined", deleteA(undefined));
show("null by key", deleteByKey(null, "a"));
show("null sloppy", deleteByKeySloppy(null, "a"));
show(
  "key that throws",
  deleteByKey(
    {},
    {
      toString() {
        throw new RangeError("no");
      },
    },
  ),
);
show(
  "null and a key that throws",
  deleteByKey(null, {
    toString() {
      throw new RangeError("no");
    },
  }),
);
show("Math.PI", deleteByKey(Math, "PI") + " " + deleteByKeySloppy(Math, "PI"));
show("globalThis.undefined", deleteByKey(globalThis, "undefined") + " " + deleteByKeySloppy(globalThis, "NaN"));
(globalThis as any).madeHere = 1;
show("globalThis property", deleteByKey(globalThis, "madeHere") + " " + typeof (globalThis as any).madeHere);
show(
  "module namespace",
  (() => {
    try {
      return String(Reflect.deleteProperty(Math, "abs2"));
    } catch (e) {
      return "threw";
    }
  })(),
);

// Dictionaries.
{
  const big: Table = {};
  for (let i = 0; i < 300; i++) big["k" + i] = i;
  let deleted = 0;
  for (let i = 0; i < 300; i += 2) if (deleteByKey(big, "k" + i) === "true") deleted++;
  show("dictionary", deleted + " " + Object.keys(big).length + " " + Object.keys(big).slice(0, 4).join());
  big.k0 = "again";
  show("dictionary, added again", Object.keys(big).slice(-2).join());
}
{
  const churn: Table = { keep: 1 };
  let ok = 0;
  for (let i = 0; i < 400; i++) {
    churn.a = i;
    churn.b = i;
    if (deleteA(churn) === "true" && churn.a === undefined && churn.b === i && deleteB(churn) === "true") ok++;
  }
  show("one object, added and deleted for ever", ok + " " + describe(churn));
}
{
  const churn: any = new Point();
  let ok = 0;
  for (let i = 0; i < 400; i++) {
    churn.a = i;
    churn.b = i;
    if (deleteA(churn) === "true" && churn.a === undefined && churn.b === i && deleteB(churn) === "true") ok++;
  }
  show("one instance, added and deleted for ever", ok + " " + describe(churn));
}

// Old objects, and collections in between.
{
  const old: Table[] = [];
  for (let i = 0; i < 2000; i++) old.push({ a: i, b: i, c: { i } });
  Bun.gc(true);
  let ok = 0;
  for (const t of old) if (deleteB(t) === "true" && t.b === undefined && t.c.i === t.a) ok++;
  Bun.gc(true);
  for (const t of old) if (deleteA(t) === "true" && t.c.i >= 0 && Object.keys(t).join() === "c") ok++;
  show("old objects", ok);
  const instances: any[] = [];
  for (let i = 0; i < 2000; i++) {
    const p: any = new Point();
    p.a = { i };
    p.b = { i };
    instances.push(p);
  }
  Bun.gc(true);
  ok = 0;
  for (const t of instances) if (deleteA(t) === "true" && t.a === undefined && t.b.i >= 0) ok++;
  Bun.gc(true);
  for (const t of instances) if (Object.keys(t).join() === "x,y,b" && t.b.i >= 0) ok++;
  show("old instances", ok);
}
{
  let ok = 0;
  for (let i = 0; i < 200000; i++) {
    const t: Table = { __proto__: null, finish: i };
    t.end = { i };
    t.close = { i };
    if (deleteByKey(t, "end") === "true" && t.end === undefined && t.close.i === i && t.finish === i) ok++;
  }
  show("young tables under allocation", ok);
}

// Reflect and what is seen from outside.
repeat(
  "Reflect.deleteProperty",
  () => ({ a: 1, b: 2 }),
  t => String(Reflect.deleteProperty(t, "a")) + deleteA(t),
);
repeat(
  "spread after",
  () => ({ a: 1, b: 2, c: 3 }),
  t =>
    deleteB(t) +
    " " +
    JSON.stringify({ ...t }) +
    " " +
    JSON.stringify(Object.assign({}, t)) +
    " " +
    JSON.stringify(Object.entries(t)),
);
repeat(
  "instance spread after",
  () => {
    const t: any = new Point();
    t.a = 1;
    t.b = 2;
    return t;
  },
  t =>
    deleteA(t) +
    " " +
    JSON.stringify({ ...t }) +
    " " +
    JSON.stringify(Object.entries(t)) +
    " " +
    JSON.stringify(structuredClone(t)),
);

console.log(lines.join("\n"));
/* Output:
the other file is: sloppy
record, first by id: true [b=2wec c=3wec]
record, middle by id: true [a=1wec c=3wec]
record, last by key: true [a=1wec b=2wec]
record, sloppy by key: true [a=1wec c=3wec]
record, absent by key: true [a=1wec b=2wec c=3wec]
record, twice: truetrue [b=2wec c=3wec]
record, all: truetruetrue []
record, deleted and added again: true [b=2wec c=3wec a=9wec]
record, deleted and added in another order: truetrue [c=3wec b=8wec a=9wec]
record, read after: true 1 undefined 3 false false [a=1wec c=3wec]
record, keys after: true a,c {"a":1,"c":3} [a=1wec c=3wec]
record, frozen: false false false true [a=1-e- b=2-e- c=3-e-]
record, sealed: false false [a=1we- b=2we- c=3we-]
record, not extensible: true true [a=1wec]
record, not configurable: false false false true [a=5we- c=3wec]
record, getter: true undefined [b=2wec c=3wec]
record, setter: true undefined [a=1wec c=3wec]
record, not enumerable: true [a=1wec c=3wec]
record, an index: true true true [a=1wec b=2wec c=3wec]
record, an index of a frozen one: TypeError: Unable to delete property. false true [1=5-e- a=1-e- b=2-e- c=3-e-]
record, symbol: true [a=1wec b=2wec c=3wec]
record, alternating: 4  [c=3wec b=2wec]
record, during for-in: ac [a=1wec c=3wec]
record, key made at run time: 4 [b=2wec c=3wec] BUT 60 ROUNDS DIFFER
record, as a prototype: 2 true undefined false [a=1wec c=3wec]
record, inherited stays: true 2 [a=1wec b=2wec c=3wec]
record, shadow goes: 7 true 2 [a=1wec b=2wec c=3wec]
empty then filled, first by id: true [b=2wec c=3wec]
empty then filled, middle by id: true [a=1wec c=3wec]
empty then filled, last by key: true [a=1wec b=2wec]
empty then filled, sloppy by key: true [a=1wec c=3wec]
empty then filled, absent by key: true [a=1wec b=2wec c=3wec]
empty then filled, twice: truetrue [b=2wec c=3wec]
empty then filled, all: truetruetrue []
empty then filled, deleted and added again: true [b=2wec c=3wec a=9wec]
empty then filled, deleted and added in another order: truetrue [c=3wec b=8wec a=9wec]
empty then filled, read after: true 1 undefined 3 false false [a=1wec c=3wec]
empty then filled, keys after: true a,c {"a":1,"c":3} [a=1wec c=3wec]
empty then filled, frozen: false false false true [a=1-e- b=2-e- c=3-e-]
empty then filled, sealed: false false [a=1we- b=2we- c=3we-]
empty then filled, not extensible: true true [a=1wec]
empty then filled, not configurable: false false false true [a=5we- c=3wec]
empty then filled, getter: true undefined [b=2wec c=3wec]
empty then filled, setter: true undefined [a=1wec c=3wec]
empty then filled, not enumerable: true [a=1wec c=3wec]
empty then filled, an index: true true true [a=1wec b=2wec c=3wec]
empty then filled, an index of a frozen one: TypeError: Unable to delete property. false true [1=5-e- a=1-e- b=2-e- c=3-e-]
empty then filled, symbol: true [a=1wec b=2wec c=3wec]
empty then filled, alternating: 4  [c=3wec b=2wec]
empty then filled, during for-in: ac [a=1wec c=3wec]
empty then filled, key made at run time: 4 [b=2wec c=3wec] BUT 60 ROUNDS DIFFER
empty then filled, as a prototype: 2 true undefined false [a=1wec c=3wec]
empty then filled, inherited stays: true 2 [a=1wec b=2wec c=3wec]
empty then filled, shadow goes: 7 true 2 [a=1wec b=2wec c=3wec]
without prototype, first by id: true [b=2wec c=3wec]
without prototype, middle by id: true [a=1wec c=3wec]
without prototype, last by key: true [a=1wec b=2wec]
without prototype, sloppy by key: true [a=1wec c=3wec]
without prototype, absent by key: true [a=1wec b=2wec c=3wec]
without prototype, twice: truetrue [b=2wec c=3wec]
without prototype, all: truetruetrue []
without prototype, deleted and added again: true [b=2wec c=3wec a=9wec]
without prototype, deleted and added in another order: truetrue [c=3wec b=8wec a=9wec]
without prototype, read after: true 1 undefined 3 false false [a=1wec c=3wec]
without prototype, keys after: true a,c {"a":1,"c":3} [a=1wec c=3wec]
without prototype, frozen: false false false true [a=1-e- b=2-e- c=3-e-]
without prototype, sealed: false false [a=1we- b=2we- c=3we-]
without prototype, not extensible: true true [a=1wec]
without prototype, not configurable: false false false true [a=5we- c=3wec]
without prototype, getter: true undefined [b=2wec c=3wec]
without prototype, setter: true undefined [a=1wec c=3wec]
without prototype, not enumerable: true [a=1wec c=3wec]
without prototype, an index: true true true [a=1wec b=2wec c=3wec]
without prototype, an index of a frozen one: TypeError: Unable to delete property. false true [1=5-e- a=1-e- b=2-e- c=3-e-]
without prototype, symbol: true [a=1wec b=2wec c=3wec]
without prototype, alternating: 4  [c=3wec b=2wec]
without prototype, during for-in: ac [a=1wec c=3wec]
without prototype, key made at run time: 4 [b=2wec c=3wec] BUT 60 ROUNDS DIFFER
without prototype, as a prototype: 2 true undefined false [a=1wec c=3wec]
without prototype, inherited stays: true 2 [a=1wec b=2wec c=3wec]
without prototype, shadow goes: 7 true 2 [a=1wec b=2wec c=3wec]
Object.create(null), first by id: true [b=2wec c=3wec]
Object.create(null), middle by id: true [a=1wec c=3wec]
Object.create(null), last by key: true [a=1wec b=2wec]
Object.create(null), sloppy by key: true [a=1wec c=3wec]
Object.create(null), absent by key: true [a=1wec b=2wec c=3wec]
Object.create(null), twice: truetrue [b=2wec c=3wec]
Object.create(null), all: truetruetrue []
Object.create(null), deleted and added again: true [b=2wec c=3wec a=9wec]
Object.create(null), deleted and added in another order: truetrue [c=3wec b=8wec a=9wec]
Object.create(null), read after: true 1 undefined 3 false false [a=1wec c=3wec]
Object.create(null), keys after: true a,c {"a":1,"c":3} [a=1wec c=3wec]
Object.create(null), frozen: false false false true [a=1-e- b=2-e- c=3-e-]
Object.create(null), sealed: false false [a=1we- b=2we- c=3we-]
Object.create(null), not extensible: true true [a=1wec]
Object.create(null), not configurable: false false false true [a=5we- c=3wec]
Object.create(null), getter: true undefined [b=2wec c=3wec]
Object.create(null), setter: true undefined [a=1wec c=3wec]
Object.create(null), not enumerable: true [a=1wec c=3wec]
Object.create(null), an index: true true true [a=1wec b=2wec c=3wec]
Object.create(null), an index of a frozen one: TypeError: Unable to delete property. false true [1=5-e- a=1-e- b=2-e- c=3-e-]
Object.create(null), symbol: true [a=1wec b=2wec c=3wec]
Object.create(null), alternating: 4  [c=3wec b=2wec]
Object.create(null), during for-in: ac [a=1wec c=3wec]
Object.create(null), key made at run time: 4 [b=2wec c=3wec] BUT 60 ROUNDS DIFFER
Object.create(null), as a prototype: 2 true undefined false [a=1wec c=3wec]
Object.create(null), inherited stays: true 2 [a=1wec b=2wec c=3wec]
Object.create(null), shadow goes: 7 true 2 [a=1wec b=2wec c=3wec]
instance with extras, first by id: true [x=1wec y=2wec b=2wec c=3wec]
instance with extras, middle by id: true [x=1wec y=2wec a=1wec c=3wec]
instance with extras, last by key: true [x=1wec y=2wec a=1wec b=2wec]
instance with extras, sloppy by key: true [x=1wec y=2wec a=1wec c=3wec]
instance with extras, absent by key: true [x=1wec y=2wec a=1wec b=2wec c=3wec]
instance with extras, twice: truetrue [x=1wec y=2wec b=2wec c=3wec]
instance with extras, all: truetruetrue [x=1wec y=2wec]
instance with extras, deleted and added again: true [x=1wec y=2wec b=2wec c=3wec a=9wec]
instance with extras, deleted and added in another order: truetrue [x=1wec y=2wec c=3wec b=8wec a=9wec]
instance with extras, read after: true 1 undefined 3 false false [x=1wec y=2wec a=1wec c=3wec]
instance with extras, keys after: true x,y,a,c {"x":1,"y":2,"a":1,"c":3} [x=1wec y=2wec a=1wec c=3wec]
instance with extras, frozen: false false false true [x=1-e- y=2-e- a=1-e- b=2-e- c=3-e-]
instance with extras, sealed: false false [x=1we- y=2we- a=1we- b=2we- c=3we-]
instance with extras, not extensible: true true [x=1wec y=2wec a=1wec]
instance with extras, not configurable: false false false true [x=1wec y=2wec a=5we- c=3wec]
instance with extras, getter: true undefined [x=1wec y=2wec b=2wec c=3wec]
instance with extras, setter: true undefined [x=1wec y=2wec a=1wec c=3wec]
instance with extras, not enumerable: true [x=1wec y=2wec a=1wec c=3wec]
instance with extras, an index: true true true [x=1wec y=2wec a=1wec b=2wec c=3wec]
instance with extras, an index of a frozen one: TypeError: Unable to delete property. false true [1=5-e- x=1-e- y=2-e- a=1-e- b=2-e- c=3-e-]
instance with extras, symbol: true [x=1wec y=2wec a=1wec b=2wec c=3wec]
instance with extras, alternating: 4  [x=1wec y=2wec c=3wec b=2wec]
instance with extras, during for-in: xyac [x=1wec y=2wec a=1wec c=3wec]
instance with extras, key made at run time: 4 [x=1wec y=2wec b=2wec c=3wec] BUT 60 ROUNDS DIFFER
instance with extras, as a prototype: 2 true undefined false [x=1wec y=2wec a=1wec c=3wec]
instance with extras, inherited stays: true 2 [x=1wec y=2wec a=1wec b=2wec c=3wec]
instance with extras, shadow goes: 7 true 2 [x=1wec y=2wec a=1wec b=2wec c=3wec]
instance with optional fields, first by id: true [b=2wec c=3wec]
instance with optional fields, middle by id: true [a=1wec c=3wec]
instance with optional fields, last by key: true [a=1wec b=2wec]
instance with optional fields, sloppy by key: true [a=1wec c=3wec]
instance with optional fields, absent by key: true [a=1wec b=2wec c=3wec]
instance with optional fields, twice: truetrue [b=2wec c=3wec]
instance with optional fields, all: truetruetrue []
instance with optional fields, deleted and added again: true [b=2wec c=3wec a=9wec]
instance with optional fields, deleted and added in another order: truetrue [c=3wec b=8wec a=9wec]
instance with optional fields, read after: true 1 undefined 3 false false [a=1wec c=3wec]
instance with optional fields, keys after: true a,c {"a":1,"c":3} [a=1wec c=3wec]
instance with optional fields, frozen: false false false true [a=1-e- b=2-e- c=3-e-]
instance with optional fields, sealed: false false [a=1we- b=2we- c=3we-]
instance with optional fields, not extensible: true true [a=1wec]
instance with optional fields, not configurable: false false false true [a=5we- c=3wec]
instance with optional fields, getter: true undefined [b=2wec c=3wec]
instance with optional fields, setter: true undefined [a=1wec c=3wec]
instance with optional fields, not enumerable: true [a=1wec c=3wec]
instance with optional fields, an index: true true true [a=1wec b=2wec c=3wec]
instance with optional fields, an index of a frozen one: TypeError: Unable to delete property. false true [1=5-e- a=1-e- b=2-e- c=3-e-]
instance with optional fields, symbol: true [a=1wec b=2wec c=3wec]
instance with optional fields, alternating: 4  [c=3wec b=2wec]
instance with optional fields, during for-in: ac [a=1wec c=3wec]
instance with optional fields, key made at run time: 4 [b=2wec c=3wec] BUT 60 ROUNDS DIFFER
instance with optional fields, as a prototype: 2 true undefined false [a=1wec c=3wec]
instance with optional fields, inherited stays: true 2 [a=1wec b=2wec c=3wec]
instance with optional fields, shadow goes: 7 true 2 [a=1wec b=2wec c=3wec]
many names, first by id: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec b=2wec c=3wec]
many names, middle by id: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec c=3wec]
many names, last by key: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec b=2wec]
many names, sloppy by key: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec c=3wec]
many names, absent by key: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec b=2wec c=3wec]
many names, twice: truetrue [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec b=2wec c=3wec]
many names, all: truetruetrue [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec]
many names, deleted and added again: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec b=2wec c=3wec a=9wec]
many names, deleted and added in another order: truetrue [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec c=3wec b=8wec a=9wec]
many names, read after: true 1 undefined 3 false false [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec c=3wec]
many names, keys after: true n0,n1,n2,n3,n4,n5,n6,n7,n8,n9,n10,n11,a,c {"n0":0,"n1":1,"n2":2,"n3":3,"n4":4,"n5":5,"n6":6,"n7":7,"n8":8,"n9":9,"n10":10,"n11":11,"a":1,"c":3} [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec c=3wec]
many names, frozen: false false false true [n0=0-e- n1=1-e- n2=2-e- n3=3-e- n4=4-e- n5=5-e- n6=6-e- n7=7-e- n8=8-e- n9=9-e- n10=10-e- n11=11-e- a=1-e- b=2-e- c=3-e-]
many names, sealed: false false [n0=0we- n1=1we- n2=2we- n3=3we- n4=4we- n5=5we- n6=6we- n7=7we- n8=8we- n9=9we- n10=10we- n11=11we- a=1we- b=2we- c=3we-]
many names, not extensible: true true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec]
many names, not configurable: false false false true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=5we- c=3wec]
many names, getter: true undefined [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec b=2wec c=3wec]
many names, setter: true undefined [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec c=3wec]
many names, not enumerable: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec c=3wec]
many names, an index: true true true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec b=2wec c=3wec]
many names, an index of a frozen one: TypeError: Unable to delete property. false true [1=5-e- n0=0-e- n1=1-e- n2=2-e- n3=3-e- n4=4-e- n5=5-e- n6=6-e- n7=7-e- n8=8-e- n9=9-e- n10=10-e- n11=11-e- a=1-e- b=2-e- c=3-e-]
many names, symbol: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec b=2wec c=3wec]
many names, alternating: 4  [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec c=3wec b=2wec]
many names, during for-in: n0n1n2n3n4n5n6n7n8n9n10n11ac [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec c=3wec]
many names, key made at run time: 4 [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec b=2wec c=3wec] BUT 60 ROUNDS DIFFER
many names, as a prototype: 2 true undefined false [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec c=3wec]
many names, inherited stays: true 2 [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec b=2wec c=3wec]
many names, shadow goes: 7 true 2 [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n7=7wec n8=8wec n9=9wec n10=10wec n11=11wec a=1wec b=2wec c=3wec]
function, first by id: true [length=0--c name=t--c prototype=[object Object]w-- b=2wec c=3wec]
function, middle by id: true [length=0--c name=t--c prototype=[object Object]w-- a=1wec c=3wec]
function, last by key: true [length=0--c name=t--c prototype=[object Object]w-- a=1wec b=2wec]
function, sloppy by key: true [length=0--c name=t--c prototype=[object Object]w-- a=1wec c=3wec]
function, absent by key: true [length=0--c name=t--c prototype=[object Object]w-- a=1wec b=2wec c=3wec]
function, twice: truetrue [length=0--c name=t--c prototype=[object Object]w-- b=2wec c=3wec]
function, all: truetruetrue [length=0--c name=t--c prototype=[object Object]w--]
function, deleted and added again: true [length=0--c name=t--c prototype=[object Object]w-- b=2wec c=3wec a=9wec]
function, deleted and added in another order: truetrue [length=0--c name=t--c prototype=[object Object]w-- c=3wec b=8wec a=9wec]
function, read after: true 1 undefined 3 false false [length=0--c name=t--c prototype=[object Object]w-- a=1wec c=3wec]
function, keys after: true a,c undefined [length=0--c name=t--c prototype=[object Object]w-- a=1wec c=3wec]
function, frozen: false false false true [length=0--- name=t--- prototype=[object Object]--- a=1-e- b=2-e- c=3-e-]
function, sealed: false false [length=0--- name=t--- prototype=[object Object]w-- a=1we- b=2we- c=3we-]
function, not extensible: true true [length=0--c name=t--c prototype=[object Object]w-- a=1wec]
function, not configurable: false false false true [length=0--c name=t--c prototype=[object Object]w-- a=5we- c=3wec]
function, getter: true undefined [length=0--c name=t--c prototype=[object Object]w-- b=2wec c=3wec]
function, setter: true undefined [length=0--c name=t--c prototype=[object Object]w-- a=1wec c=3wec]
function, not enumerable: true [length=0--c name=t--c prototype=[object Object]w-- a=1wec c=3wec]
function, an index: true true true [length=0--c name=t--c prototype=[object Object]w-- a=1wec b=2wec c=3wec]
function, an index of a frozen one: TypeError: Unable to delete property. false true [1=5-e- length=0--- name=t--- prototype=[object Object]--- a=1-e- b=2-e- c=3-e-]
function, symbol: true [length=0--c name=t--c prototype=[object Object]w-- a=1wec b=2wec c=3wec]
function, alternating: 4  [length=0--c name=t--c prototype=[object Object]w-- c=3wec b=2wec]
function, during for-in: ac [length=0--c name=t--c prototype=[object Object]w-- a=1wec c=3wec]
function, key made at run time: 4 [length=0--c name=t--c prototype=[object Object]w-- b=2wec c=3wec] BUT 60 ROUNDS DIFFER
function, as a prototype: 2 true undefined false [length=0--c name=t--c prototype=[object Object]w-- a=1wec c=3wec]
function, inherited stays: true 2 [length=0--c name=t--c prototype=[object Object]w-- a=1wec b=2wec c=3wec]
function, shadow goes: 7 true 2 [length=0--c name=t--c prototype=[object Object]w-- a=1wec b=2wec c=3wec]
array, first by id: true [0=7wec 1=8wec length=2w-- b=2wec c=3wec]
array, middle by id: true [0=7wec 1=8wec length=2w-- a=1wec c=3wec]
array, last by key: true [0=7wec 1=8wec length=2w-- a=1wec b=2wec]
array, sloppy by key: true [0=7wec 1=8wec length=2w-- a=1wec c=3wec]
array, absent by key: true [0=7wec 1=8wec length=2w-- a=1wec b=2wec c=3wec]
array, twice: truetrue [0=7wec 1=8wec length=2w-- b=2wec c=3wec]
array, all: truetruetrue [0=7wec 1=8wec length=2w--]
array, deleted and added again: true [0=7wec 1=8wec length=2w-- b=2wec c=3wec a=9wec]
array, deleted and added in another order: truetrue [0=7wec 1=8wec length=2w-- c=3wec b=8wec a=9wec]
array, read after: true 1 undefined 3 false false [0=7wec 1=8wec length=2w-- a=1wec c=3wec]
array, keys after: true 0,1,a,c [7,8] [0=7wec 1=8wec length=2w-- a=1wec c=3wec]
array, frozen: false false false true [0=7-e- 1=8-e- length=2--- a=1-e- b=2-e- c=3-e-]
array, sealed: false false [0=7we- 1=8we- length=2w-- a=1we- b=2we- c=3we-]
array, not extensible: true true [0=7wec 1=8wec length=2w-- a=1wec]
array, not configurable: false false false true [0=7wec 1=8wec length=2w-- a=5we- c=3wec]
array, getter: true undefined [0=7wec 1=8wec length=2w-- b=2wec c=3wec]
array, setter: true undefined [0=7wec 1=8wec length=2w-- a=1wec c=3wec]
array, not enumerable: true [0=7wec 1=8wec length=2w-- a=1wec c=3wec]
array, an index: true true true [0=7wec length=2w-- a=1wec b=2wec c=3wec]
array, an index of a frozen one: TypeError: Unable to delete property. false true [0=7-e- 1=5-e- length=2--- a=1-e- b=2-e- c=3-e-]
array, symbol: true [0=7wec 1=8wec length=2w-- a=1wec b=2wec c=3wec]
array, alternating: 4  [0=7wec 1=8wec length=2w-- c=3wec b=2wec]
array, during for-in: 01ac [0=7wec 1=8wec length=2w-- a=1wec c=3wec]
array, key made at run time: 4 [0=7wec 1=8wec length=2w-- b=2wec c=3wec] BUT 60 ROUNDS DIFFER
array, as a prototype: 2 true undefined false [0=7wec 1=8wec length=2w-- a=1wec c=3wec]
array, inherited stays: true 2 [0=7wec 1=8wec length=2w-- a=1wec b=2wec c=3wec]
array, shadow goes: 7 true 2 [0=7wec 1=8wec length=2w-- a=1wec b=2wec c=3wec]
a name added by key between two others, first by id: true [b=2wec c=3wec]
a name added by key between two others, middle by id: true [a=1wec c=3wec]
a name added by key between two others, last by key: true [a=1wec b=2wec]
a name added by key between two others, sloppy by key: true [a=1wec c=3wec]
a name added by key between two others, absent by key: true [a=1wec b=2wec c=3wec]
a name added by key between two others, twice: truetrue [b=2wec c=3wec]
a name added by key between two others, all: truetruetrue []
a name added by key between two others, deleted and added again: true [b=2wec c=3wec a=9wec]
a name added by key between two others, deleted and added in another order: truetrue [c=3wec b=8wec a=9wec]
a name added by key between two others, read after: true 1 undefined 3 false false [a=1wec c=3wec]
a name added by key between two others, keys after: true a,c {"a":1,"c":3} [a=1wec c=3wec]
a name added by key between two others, frozen: false false false true [a=1-e- b=2-e- c=3-e-]
a name added by key between two others, sealed: false false [a=1we- b=2we- c=3we-]
a name added by key between two others, not extensible: true true [a=1wec]
a name added by key between two others, not configurable: false false false true [a=5we- c=3wec]
a name added by key between two others, getter: true undefined [b=2wec c=3wec]
a name added by key between two others, setter: true undefined [a=1wec c=3wec]
a name added by key between two others, not enumerable: true [a=1wec c=3wec]
a name added by key between two others, an index: true true true [a=1wec b=2wec c=3wec]
a name added by key between two others, an index of a frozen one: TypeError: Unable to delete property. false true [1=5-e- a=1-e- b=2-e- c=3-e-]
a name added by key between two others, symbol: true [a=1wec b=2wec c=3wec]
a name added by key between two others, alternating: 4  [c=3wec b=2wec]
a name added by key between two others, during for-in: ac [a=1wec c=3wec]
a name added by key between two others, key made at run time: 4 [b=2wec c=3wec] BUT 60 ROUNDS DIFFER
a name added by key between two others, as a prototype: 2 true undefined false [a=1wec c=3wec]
a name added by key between two others, inherited stays: true 2 [a=1wec b=2wec c=3wec]
a name added by key between two others, shadow goes: 7 true 2 [a=1wec b=2wec c=3wec]
an instance with a name added by key between two others, first by id: true [x=1wec y=2wec b=2wec c=3wec]
an instance with a name added by key between two others, middle by id: true [x=1wec y=2wec a=1wec c=3wec]
an instance with a name added by key between two others, last by key: true [x=1wec y=2wec a=1wec b=2wec]
an instance with a name added by key between two others, sloppy by key: true [x=1wec y=2wec a=1wec c=3wec]
an instance with a name added by key between two others, absent by key: true [x=1wec y=2wec a=1wec b=2wec c=3wec]
an instance with a name added by key between two others, twice: truetrue [x=1wec y=2wec b=2wec c=3wec]
an instance with a name added by key between two others, all: truetruetrue [x=1wec y=2wec]
an instance with a name added by key between two others, deleted and added again: true [x=1wec y=2wec b=2wec c=3wec a=9wec]
an instance with a name added by key between two others, deleted and added in another order: truetrue [x=1wec y=2wec c=3wec b=8wec a=9wec]
an instance with a name added by key between two others, read after: true 1 undefined 3 false false [x=1wec y=2wec a=1wec c=3wec]
an instance with a name added by key between two others, keys after: true x,y,a,c {"x":1,"y":2,"a":1,"c":3} [x=1wec y=2wec a=1wec c=3wec]
an instance with a name added by key between two others, frozen: false false false true [x=1-e- y=2-e- a=1-e- b=2-e- c=3-e-]
an instance with a name added by key between two others, sealed: false false [x=1we- y=2we- a=1we- b=2we- c=3we-]
an instance with a name added by key between two others, not extensible: true true [x=1wec y=2wec a=1wec]
an instance with a name added by key between two others, not configurable: false false false true [x=1wec y=2wec a=5we- c=3wec]
an instance with a name added by key between two others, getter: true undefined [x=1wec y=2wec b=2wec c=3wec]
an instance with a name added by key between two others, setter: true undefined [x=1wec y=2wec a=1wec c=3wec]
an instance with a name added by key between two others, not enumerable: true [x=1wec y=2wec a=1wec c=3wec]
an instance with a name added by key between two others, an index: true true true [x=1wec y=2wec a=1wec b=2wec c=3wec]
an instance with a name added by key between two others, an index of a frozen one: TypeError: Unable to delete property. false true [1=5-e- x=1-e- y=2-e- a=1-e- b=2-e- c=3-e-]
an instance with a name added by key between two others, symbol: true [x=1wec y=2wec a=1wec b=2wec c=3wec]
an instance with a name added by key between two others, alternating: 4  [x=1wec y=2wec c=3wec b=2wec]
an instance with a name added by key between two others, during for-in: xyac [x=1wec y=2wec a=1wec c=3wec]
an instance with a name added by key between two others, key made at run time: 4 [x=1wec y=2wec b=2wec c=3wec] BUT 60 ROUNDS DIFFER
an instance with a name added by key between two others, as a prototype: 2 true undefined false [x=1wec y=2wec a=1wec c=3wec]
an instance with a name added by key between two others, inherited stays: true 2 [x=1wec y=2wec a=1wec b=2wec c=3wec]
an instance with a name added by key between two others, shadow goes: 7 true 2 [x=1wec y=2wec a=1wec b=2wec c=3wec]
ninety names, first by id: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec b=2wec c=3wec]
ninety names, middle by id: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec c=3wec]
ninety names, last by key: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec b=2wec]
ninety names, sloppy by key: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec c=3wec]
ninety names, absent by key: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec b=2wec c=3wec]
ninety names, twice: truetrue [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec b=2wec c=3wec]
ninety names, all: truetruetrue [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec]
ninety names, deleted and added again: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec b=2wec c=3wec a=9wec]
ninety names, deleted and added in another order: truetrue [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec c=3wec b=8wec a=9wec]
ninety names, read after: true 1 undefined 3 false false [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec c=3wec]
ninety names, keys after: true n0,n1,n2,n3,n4,n5,n6,n8,n9,n10,n11,n12,n13,n14,n15,n16,n17,n18,n19,n20,n21,n22,n23,n24,n25,n26,n27,n28,n29,n30,n31,n32,n33,n34,n35,n36,n37,n38,n39,n40,n41,n42,n43,n44,n45,n46,n47,n48,n49,n50,n51,n52,n53,n54,n55,n56,n57,n58,n59,n60,n61,n62,n63,n64,n65,n66,n67,n68,n69,n70,n71,n72,n73,n74,n75,n76,n77,n78,n79,n80,n81,n82,n83,n84,n85,n86,n87,n88,n89,a,c {"n0":0,"n1":1,"n2":2,"n3":3,"n4":4,"n5":5,"n6":6,"n8":8,"n9":9,"n10":10,"n11":11,"n12":12,"n13":13,"n14":14,"n15":15,"n16":16,"n17":17,"n18":18,"n19":19,"n20":20,"n21":21,"n22":22,"n23":23,"n24":24,"n25":25,"n26":26,"n27":27,"n28":28,"n29":29,"n30":30,"n31":31,"n32":32,"n33":33,"n34":34,"n35":35,"n36":36,"n37":37,"n38":38,"n39":39,"n40":40,"n41":41,"n42":42,"n43":43,"n44":44,"n45":45,"n46":46,"n47":47,"n48":48,"n49":49,"n50":50,"n51":51,"n52":52,"n53":53,"n54":54,"n55":55,"n56":56,"n57":57,"n58":58,"n59":59,"n60":60,"n61":61,"n62":62,"n63":63,"n64":64,"n65":65,"n66":66,"n67":67,"n68":68,"n69":69,"n70":70,"n71":71,"n72":72,"n73":73,"n74":74,"n75":75,"n76":76,"n77":77,"n78":78,"n79":79,"n80":80,"n81":81,"n82":82,"n83":83,"n84":84,"n85":85,"n86":86,"n87":87,"n88":88,"n89":89,"a":1,"c":3} [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec c=3wec]
ninety names, frozen: false false false true [n0=0-e- n1=1-e- n2=2-e- n3=3-e- n4=4-e- n5=5-e- n6=6-e- n8=8-e- n9=9-e- n10=10-e- n11=11-e- n12=12-e- n13=13-e- n14=14-e- n15=15-e- n16=16-e- n17=17-e- n18=18-e- n19=19-e- n20=20-e- n21=21-e- n22=22-e- n23=23-e- n24=24-e- n25=25-e- n26=26-e- n27=27-e- n28=28-e- n29=29-e- n30=30-e- n31=31-e- n32=32-e- n33=33-e- n34=34-e- n35=35-e- n36=36-e- n37=37-e- n38=38-e- n39=39-e- n40=40-e- n41=41-e- n42=42-e- n43=43-e- n44=44-e- n45=45-e- n46=46-e- n47=47-e- n48=48-e- n49=49-e- n50=50-e- n51=51-e- n52=52-e- n53=53-e- n54=54-e- n55=55-e- n56=56-e- n57=57-e- n58=58-e- n59=59-e- n60=60-e- n61=61-e- n62=62-e- n63=63-e- n64=64-e- n65=65-e- n66=66-e- n67=67-e- n68=68-e- n69=69-e- n70=70-e- n71=71-e- n72=72-e- n73=73-e- n74=74-e- n75=75-e- n76=76-e- n77=77-e- n78=78-e- n79=79-e- n80=80-e- n81=81-e- n82=82-e- n83=83-e- n84=84-e- n85=85-e- n86=86-e- n87=87-e- n88=88-e- n89=89-e- a=1-e- b=2-e- c=3-e-]
ninety names, sealed: false false [n0=0we- n1=1we- n2=2we- n3=3we- n4=4we- n5=5we- n6=6we- n8=8we- n9=9we- n10=10we- n11=11we- n12=12we- n13=13we- n14=14we- n15=15we- n16=16we- n17=17we- n18=18we- n19=19we- n20=20we- n21=21we- n22=22we- n23=23we- n24=24we- n25=25we- n26=26we- n27=27we- n28=28we- n29=29we- n30=30we- n31=31we- n32=32we- n33=33we- n34=34we- n35=35we- n36=36we- n37=37we- n38=38we- n39=39we- n40=40we- n41=41we- n42=42we- n43=43we- n44=44we- n45=45we- n46=46we- n47=47we- n48=48we- n49=49we- n50=50we- n51=51we- n52=52we- n53=53we- n54=54we- n55=55we- n56=56we- n57=57we- n58=58we- n59=59we- n60=60we- n61=61we- n62=62we- n63=63we- n64=64we- n65=65we- n66=66we- n67=67we- n68=68we- n69=69we- n70=70we- n71=71we- n72=72we- n73=73we- n74=74we- n75=75we- n76=76we- n77=77we- n78=78we- n79=79we- n80=80we- n81=81we- n82=82we- n83=83we- n84=84we- n85=85we- n86=86we- n87=87we- n88=88we- n89=89we- a=1we- b=2we- c=3we-]
ninety names, not extensible: true true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec]
ninety names, not configurable: false false false true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=5we- c=3wec]
ninety names, getter: true undefined [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec b=2wec c=3wec]
ninety names, setter: true undefined [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec c=3wec]
ninety names, not enumerable: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec c=3wec]
ninety names, an index: true true true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec b=2wec c=3wec]
ninety names, an index of a frozen one: TypeError: Unable to delete property. false true [1=5-e- n0=0-e- n1=1-e- n2=2-e- n3=3-e- n4=4-e- n5=5-e- n6=6-e- n8=8-e- n9=9-e- n10=10-e- n11=11-e- n12=12-e- n13=13-e- n14=14-e- n15=15-e- n16=16-e- n17=17-e- n18=18-e- n19=19-e- n20=20-e- n21=21-e- n22=22-e- n23=23-e- n24=24-e- n25=25-e- n26=26-e- n27=27-e- n28=28-e- n29=29-e- n30=30-e- n31=31-e- n32=32-e- n33=33-e- n34=34-e- n35=35-e- n36=36-e- n37=37-e- n38=38-e- n39=39-e- n40=40-e- n41=41-e- n42=42-e- n43=43-e- n44=44-e- n45=45-e- n46=46-e- n47=47-e- n48=48-e- n49=49-e- n50=50-e- n51=51-e- n52=52-e- n53=53-e- n54=54-e- n55=55-e- n56=56-e- n57=57-e- n58=58-e- n59=59-e- n60=60-e- n61=61-e- n62=62-e- n63=63-e- n64=64-e- n65=65-e- n66=66-e- n67=67-e- n68=68-e- n69=69-e- n70=70-e- n71=71-e- n72=72-e- n73=73-e- n74=74-e- n75=75-e- n76=76-e- n77=77-e- n78=78-e- n79=79-e- n80=80-e- n81=81-e- n82=82-e- n83=83-e- n84=84-e- n85=85-e- n86=86-e- n87=87-e- n88=88-e- n89=89-e- a=1-e- b=2-e- c=3-e-]
ninety names, symbol: true [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec b=2wec c=3wec]
ninety names, alternating: 4  [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec c=3wec b=2wec]
ninety names, during for-in: n0n1n2n3n4n5n6n8n9n10n11n12n13n14n15n16n17n18n19n20n21n22n23n24n25n26n27n28n29n30n31n32n33n34n35n36n37n38n39n40n41n42n43n44n45n46n47n48n49n50n51n52n53n54n55n56n57n58n59n60n61n62n63n64n65n66n67n68n69n70n71n72n73n74n75n76n77n78n79n80n81n82n83n84n85n86n87n88n89ac [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec c=3wec]
ninety names, key made at run time: 4 [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec b=2wec c=3wec] BUT 60 ROUNDS DIFFER
ninety names, as a prototype: 2 true undefined false [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec c=3wec]
ninety names, inherited stays: true 2 [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec b=2wec c=3wec]
ninety names, shadow goes: 7 true 2 [n0=0wec n1=1wec n2=2wec n3=3wec n4=4wec n5=5wec n6=6wec n8=8wec n9=9wec n10=10wec n11=11wec n12=12wec n13=13wec n14=14wec n15=15wec n16=16wec n17=17wec n18=18wec n19=19wec n20=20wec n21=21wec n22=22wec n23=23wec n24=24wec n25=25wec n26=26wec n27=27wec n28=28wec n29=29wec n30=30wec n31=31wec n32=32wec n33=33wec n34=34wec n35=35wec n36=36wec n37=37wec n38=38wec n39=39wec n40=40wec n41=41wec n42=42wec n43=43wec n44=44wec n45=45wec n46=46wec n47=47wec n48=48wec n49=49wec n50=50wec n51=51wec n52=52wec n53=53wec n54=54wec n55=55wec n56=56wec n57=57wec n58=58wec n59=59wec n60=60wec n61=61wec n62=62wec n63=63wec n64=64wec n65=65wec n66=66wec n67=67wec n68=68wec n69=69wec n70=70wec n71=71wec n72=72wec n73=73wec n74=74wec n75=75wec n76=76wec n77=77wec n78=78wec n79=79wec n80=80wec n81=81wec n82=82wec n83=83wec n84=84wec n85=85wec n86=86wec n87=87wec n88=88wec n89=89wec a=1wec b=2wec c=3wec]
read through chain: 400
delete on prototype: true
reads after: 200
read after adding again: 5
method calls: 100
delete method: true
method after: undefined
field of a class: true undefined y [y=2wec]
field then field again: true y,x [y=2wec x=5wec]
extra in front of a late field: true a,b,more [a=1wec b=2wec more=3wec]
extra behind a late field: true a,b,extra [a=1wec b=2wec extra=1wec]
extras, then the late field: true a,b,more,extra [a=1wec b=2wec more=3wec extra=4wec]
both orders of one layout: 18 [a=1wec b=2wec]
field n: true undefined false i,s,o,b,u,f [i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field n twice: truetrue i,s,o,b,u,f [i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field n and back: true 5 i,s,o,b,u,f,n [i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec n=5wec]
field n of a subclass: true i,s,o,b,u,f,extra {"i":7,"s":"text","o":{"inner":1},"b":true,"extra":[1]} [i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec extra=1wec]
field n of a frozen one: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5-e- i=7-e- s=text-e- o=[object Object]-e- b=true-e- u=undefined-e- f=() => 3-e-]
field n of a sealed one: TypeError: Unable to delete property. n,i,s,o,b,u,f [n=1.5we- i=7we- s=textwe- o=[object Object]we- b=truewe- u=undefinedwe- f=() => 3we-]
field n made a getter: 9 true undefined i,s,o,b,u,f [i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field n made fixed: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5we- i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field n with extras: true i,s,o,b,u,f,z true i,s,o,b,u,f [i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field n behind another: truetrue i,o,b,u,f [i=7wec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field n of a prototype: 1.5 true undefined [i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field i: true undefined false n,s,o,b,u,f [n=1.5wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field i twice: truetrue n,s,o,b,u,f [n=1.5wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field i and back: true 5 n,s,o,b,u,f,i [n=1.5wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec i=5wec]
field i of a subclass: true n,s,o,b,u,f,extra {"n":1.5,"s":"text","o":{"inner":1},"b":true,"extra":[1]} [n=1.5wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec extra=1wec]
field i of a frozen one: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5-e- i=7-e- s=text-e- o=[object Object]-e- b=true-e- u=undefined-e- f=() => 3-e-]
field i of a sealed one: TypeError: Unable to delete property. n,i,s,o,b,u,f [n=1.5we- i=7we- s=textwe- o=[object Object]we- b=truewe- u=undefinedwe- f=() => 3we-]
field i made a getter: 9 true undefined n,s,o,b,u,f [n=1.5wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field i made fixed: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5wec i=7we- s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field i with extras: true n,s,o,b,u,f,z true n,s,o,b,u,f [n=1.5wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field i behind another: truetrue n,o,b,u,f [n=1.5wec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field i of a prototype: 7 true undefined [n=1.5wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field s: true undefined false n,i,o,b,u,f [n=1.5wec i=7wec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field s twice: truetrue n,i,o,b,u,f [n=1.5wec i=7wec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field s and back: true 5 n,i,o,b,u,f,s [n=1.5wec i=7wec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec s=5wec]
field s of a subclass: true n,i,o,b,u,f,extra {"n":1.5,"i":7,"o":{"inner":1},"b":true,"extra":[1]} [n=1.5wec i=7wec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec extra=1wec]
field s of a frozen one: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5-e- i=7-e- s=text-e- o=[object Object]-e- b=true-e- u=undefined-e- f=() => 3-e-]
field s of a sealed one: TypeError: Unable to delete property. n,i,s,o,b,u,f [n=1.5we- i=7we- s=textwe- o=[object Object]we- b=truewe- u=undefinedwe- f=() => 3we-]
field s made a getter: 9 true undefined n,i,o,b,u,f [n=1.5wec i=7wec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field s made fixed: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5wec i=7wec s=textwe- o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field s with extras: true n,i,o,b,u,f,z true n,i,o,b,u,f [n=1.5wec i=7wec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field s behind another: truetrue n,i,o,b,u,f [n=1.5wec i=7wec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field s of a prototype: text true undefined [n=1.5wec i=7wec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec]
field o: true undefined false n,i,s,b,u,f [n=1.5wec i=7wec s=textwec b=truewec u=undefinedwec f=() => 3wec]
field o twice: truetrue n,i,s,b,u,f [n=1.5wec i=7wec s=textwec b=truewec u=undefinedwec f=() => 3wec]
field o and back: true 5 n,i,s,b,u,f,o [n=1.5wec i=7wec s=textwec b=truewec u=undefinedwec f=() => 3wec o=5wec]
field o of a subclass: true n,i,s,b,u,f,extra {"n":1.5,"i":7,"s":"text","b":true,"extra":[1]} [n=1.5wec i=7wec s=textwec b=truewec u=undefinedwec f=() => 3wec extra=1wec]
field o of a frozen one: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5-e- i=7-e- s=text-e- o=[object Object]-e- b=true-e- u=undefined-e- f=() => 3-e-]
field o of a sealed one: TypeError: Unable to delete property. n,i,s,o,b,u,f [n=1.5we- i=7we- s=textwe- o=[object Object]we- b=truewe- u=undefinedwe- f=() => 3we-]
field o made a getter: 9 true undefined n,i,s,b,u,f [n=1.5wec i=7wec s=textwec b=truewec u=undefinedwec f=() => 3wec]
field o made fixed: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5wec i=7wec s=textwec o=[object Object]we- b=truewec u=undefinedwec f=() => 3wec]
field o with extras: true n,i,s,b,u,f,z true n,i,s,b,u,f [n=1.5wec i=7wec s=textwec b=truewec u=undefinedwec f=() => 3wec]
field o behind another: truetrue n,i,b,u,f [n=1.5wec i=7wec b=truewec u=undefinedwec f=() => 3wec]
field o of a prototype: [object Object] true undefined [n=1.5wec i=7wec s=textwec b=truewec u=undefinedwec f=() => 3wec]
field b: true undefined false n,i,s,o,u,f [n=1.5wec i=7wec s=textwec o=[object Object]wec u=undefinedwec f=() => 3wec]
field b twice: truetrue n,i,s,o,u,f [n=1.5wec i=7wec s=textwec o=[object Object]wec u=undefinedwec f=() => 3wec]
field b and back: true 5 n,i,s,o,u,f,b [n=1.5wec i=7wec s=textwec o=[object Object]wec u=undefinedwec f=() => 3wec b=5wec]
field b of a subclass: true n,i,s,o,u,f,extra {"n":1.5,"i":7,"s":"text","o":{"inner":1},"extra":[1]} [n=1.5wec i=7wec s=textwec o=[object Object]wec u=undefinedwec f=() => 3wec extra=1wec]
field b of a frozen one: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5-e- i=7-e- s=text-e- o=[object Object]-e- b=true-e- u=undefined-e- f=() => 3-e-]
field b of a sealed one: TypeError: Unable to delete property. n,i,s,o,b,u,f [n=1.5we- i=7we- s=textwe- o=[object Object]we- b=truewe- u=undefinedwe- f=() => 3we-]
field b made a getter: 9 true undefined n,i,s,o,u,f [n=1.5wec i=7wec s=textwec o=[object Object]wec u=undefinedwec f=() => 3wec]
field b made fixed: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewe- u=undefinedwec f=() => 3wec]
field b with extras: true n,i,s,o,u,f,z true n,i,s,o,u,f [n=1.5wec i=7wec s=textwec o=[object Object]wec u=undefinedwec f=() => 3wec]
field b behind another: truetrue n,i,o,u,f [n=1.5wec i=7wec o=[object Object]wec u=undefinedwec f=() => 3wec]
field b of a prototype: true true undefined [n=1.5wec i=7wec s=textwec o=[object Object]wec u=undefinedwec f=() => 3wec]
field u: true undefined false n,i,s,o,b,f [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec f=() => 3wec]
field u twice: truetrue n,i,s,o,b,f [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec f=() => 3wec]
field u and back: true 5 n,i,s,o,b,f,u [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec f=() => 3wec u=5wec]
field u of a subclass: true n,i,s,o,b,f,extra {"n":1.5,"i":7,"s":"text","o":{"inner":1},"b":true,"extra":[1]} [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec f=() => 3wec extra=1wec]
field u of a frozen one: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5-e- i=7-e- s=text-e- o=[object Object]-e- b=true-e- u=undefined-e- f=() => 3-e-]
field u of a sealed one: TypeError: Unable to delete property. n,i,s,o,b,u,f [n=1.5we- i=7we- s=textwe- o=[object Object]we- b=truewe- u=undefinedwe- f=() => 3we-]
field u made a getter: 9 true undefined n,i,s,o,b,f [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec f=() => 3wec]
field u made fixed: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwe- f=() => 3wec]
field u with extras: true n,i,s,o,b,f,z true n,i,s,o,b,f [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec f=() => 3wec]
field u behind another: truetrue n,i,o,b,f [n=1.5wec i=7wec o=[object Object]wec b=truewec f=() => 3wec]
field u of a prototype: undefined true undefined [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec f=() => 3wec]
field f: true undefined false n,i,s,o,b,u [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec]
field f twice: truetrue n,i,s,o,b,u [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec]
field f and back: true 5 n,i,s,o,b,u,f [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=5wec]
field f of a subclass: true n,i,s,o,b,u,extra {"n":1.5,"i":7,"s":"text","o":{"inner":1},"b":true,"extra":[1]} [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec extra=1wec]
field f of a frozen one: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5-e- i=7-e- s=text-e- o=[object Object]-e- b=true-e- u=undefined-e- f=() => 3-e-]
field f of a sealed one: TypeError: Unable to delete property. n,i,s,o,b,u,f [n=1.5we- i=7we- s=textwe- o=[object Object]we- b=truewe- u=undefinedwe- f=() => 3we-]
field f made a getter: 9 true undefined n,i,s,o,b,u [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec]
field f made fixed: TypeError: Unable to delete property. false n,i,s,o,b,u,f [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3we-]
field f with extras: true n,i,s,o,b,u,z true n,i,s,o,b,u [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec]
field f behind another: truetrue n,i,o,b,u [n=1.5wec i=7wec o=[object Object]wec b=truewec u=undefinedwec]
field f of a prototype: () => 3 true undefined [n=1.5wec i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec]
every field, forwards: ttttttt0 []
every field, backwards, and back: f,u,b,o,s,i,n [f=1wec u=1wec b=1wec o=1wec s=1wec i=1wec n=1wec]
fields in turn: 7 [i=7wec s=textwec o=[object Object]wec b=truewec u=undefinedwec f=() => 3wec n=0wec] BUT 80 ROUNDS DIFFER
fields of old instances: 4000
fields that hold raw values: 60,60,60,60,60 7 true y,end,x {"y":2,"end":59,"x":7} | other true y,end,x {"y":2,"end":59,"x":"other"} | false true y,end,x {"y":2,"end":59,"x":false} | 2199023255552 true y,end,x {"y":2,"end":59,"x":2199023255552} | b true y,end,x {"y":2,"end":59,"x":"b"}
proxy: false false true [a=1wec]
proxy without trap: true true []
array index: true true 3 false [2=3wec length=3w--]
array length: TypeError: Unable to delete property. false [0=1wec 1=2wec 2=3wec length=3w--]
string object: TypeError: Unable to delete property. false true [0=a-e- 1=b-e- length=2---]
typed array: TypeError: Unable to delete property. false true true [0=0wec 1=0wec]
function name and length: true true TypeError: Unable to delete property.  0 [prototype=[object Object]w--]
arrow function: true true [] [length=0--c]
class constructor: true TypeError: Unable to delete property. true [length=0--c prototype=[object Object]---]
arguments: true true TypeError: Unable to delete property. [1=2wec callee=accessor--- Symbol(Symbol.iterator)=function values() { [native code] }w-c]
error: true true  undefined []
regexp: TypeError: Unable to delete property. false true [lastIndex=0w--]
map: true true []
date: true []
promise: true []
number: true true 5
string: TypeError: Unable to delete property. false true ab
boolean and symbol: true true true
undefined: TypeError: undefined is not an object
null by key: TypeError: null is not an object
null sloppy: TypeError
key that throws: RangeError: no
null and a key that throws: TypeError: null is not an object
Math.PI: TypeError: Unable to delete property. false
globalThis.undefined: TypeError: Unable to delete property. false
globalThis property: true undefined
module namespace: true
dictionary: 150 150 k1,k3,k5,k7
dictionary, added again: k299,k0
one object, added and deleted for ever: 400 [keep=1wec]
one instance, added and deleted for ever: 400 [x=1wec y=2wec]
old objects: 4000
old instances: 4000
young tables under allocation: 200000
Reflect.deleteProperty: truetrue [b=2wec]
spread after: true {"a":1,"c":3} {"a":1,"c":3} [["a",1],["c",3]] [a=1wec c=3wec]
instance spread after: true {"x":1,"y":2,"b":2} [["x",1],["y",2],["b",2]] {"x":1,"y":2,"b":2} [x=1wec y=2wec b=2wec]
*/
