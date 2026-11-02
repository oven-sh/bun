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
