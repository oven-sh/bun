// Object.keys, Object.values and Object.entries list what plain Bun lists, whatever has happened to the object since it was created, in code that runs once and in a loop, called by name, in tail position and by value. Object.getPrototypeOf by value too.
class Point {
  x: number;
  y: number;
  label?: string;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  get sum(): number {
    return this.x + this.y;
  }
  scaled(by: number): Point {
    return new Point(this.x * by, this.y * by);
  }
}

class Point3 extends Point {
  z: number;
  constructor(x: number, y: number, z: number) {
    super(x, y);
    this.z = z;
  }
}

class Triple {
  a: unknown;
  b: unknown;
  c: unknown;
  constructor(a: unknown, b: unknown, c: unknown) {
    this.a = a;
    this.b = b;
    this.c = c;
  }
}

class Handlers {
  static count = 0;
  #secret = 1;
  name = "handlers";
  onOpen = () => this.name + " open";
  onClose = function () {
    return "close";
  };
  secret(): number {
    return this.#secret;
  }
}

const tag = Symbol("tag");

function describe(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(describe).join(", ") + "]";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "object" && value !== null) return "{" + Object.getOwnPropertyNames(value).join(" ") + "}";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

function show(name: string, f: () => unknown): void {
  try {
    console.log(name + ": " + describe(f()));
  } catch (e: any) {
    // `bun run` quotes the source in some of these messages, an executable does not (docs/bundler/aot-compatibility.mdx).
    console.log(name + ": " + e.name + ": " + e.message.replace(/ \(evaluating '.*'\)$/, ""));
  }
}

function changed(o: any, change: (o: any) => void): any {
  change(o);
  return o;
}

type State = [string, () => any];

const quietStates: State[] = [
  ["class instance", () => new Point(1, 2.5)],
  ["subclass instance", () => new Point3(1, 2, 3)],
  ["optional field stored late", () => changed(new Point(1, 2), p => (p.label = "late"))],
  ["field deleted", () => changed(new Point(1, 2), p => delete p.x)],
  ["last field deleted", () => changed(new Point(1, 2), p => delete p.y)],
  ["every field deleted", () => changed(new Point(1, 2), p => (delete p.x, delete p.y))],
  ["field deleted and stored again", () => changed(new Point(1, 2), p => (delete p.x, (p.x = 3)))],
  ["extra property", () => changed(new Point(1, 2), p => (p.extra = "e"))],
  ["extra property, then the optional field", () => changed(new Point(1, 2), p => ((p.extra = "e"), (p.label = "l")))],
  ["extra property deleted again", () => changed(new Point(1, 2), p => ((p.extra = "e"), delete p.extra))],
  ["extra index keys", () => changed(new Point(1, 2), p => ((p[2] = "two"), (p[0] = "zero")))],
  ["extra symbol key", () => changed(new Point(1, 2), p => (p[tag] = "tagged"))],
  ["field hidden", () => changed(new Point(1, 2), p => Object.defineProperty(p, "x", { enumerable: false }))],
  ["field read-only", () => changed(new Point(1, 2), p => Object.defineProperty(p, "x", { writable: false }))],
  ["field defined again with a value", () => changed(new Point(1, 2), p => Object.defineProperty(p, "x", { value: "defined" }))],
  ["hidden extra property", () => changed(new Point(1, 2), p => Object.defineProperty(p, "hidden", { value: 1 }))],
  ["value of another type", () => changed(new Point(1, 2), p => (p.x = "text"))],
  ["undefined in a number field", () => changed(new Point(1, 2), p => (p.y = undefined))],
  ["own property over a getter of the class", () => changed(new Point(1, 2), p => Object.defineProperty(p, "sum", { value: "own", enumerable: true }))],
  ["own property over a method of the class", () => changed(new Point(1, 2), p => (p.scaled = "own"))],
  ["frozen", () => Object.freeze(new Point(1, 2))],
  ["sealed", () => Object.seal(new Point(1, 2))],
  ["not extensible", () => Object.preventExtensions(new Point(1, 2))],
  ["another prototype", () => Object.setPrototypeOf(new Point(1, 2), { inherited: 1 })],
  ["no prototype", () => Object.setPrototypeOf(new Point(1, 2), null)],
  ["heir of an instance", () => Object.create(new Point(1, 2))],
  ["heir of an instance with a property", () => changed(Object.create(new Point(1, 2)), o => (o.y = "own"))],
  ["closures in fields", () => new Handlers()],
  ["values of every kind, 1", () => new Triple(undefined, null, true)],
  ["values of every kind, 2", () => new Triple(-0, NaN, 2 ** 31)],
  ["values of every kind, 3", () => new Triple(1.5, 10n, "text")],
  ["values of every kind, 4", () => new Triple(Symbol.iterator, [1, [2]], { inner: 1 })],
  ["values of every kind, 5", () => new Triple(describe, new Point(1, 2), -(2 ** 31) - 1)],
  ["literal", () => ({ b: 1, a: "two", c: [3] })],
  ["empty literal", () => ({})],
  ["empty literal filled by name", () => changed({}, o => ((o.z = 1), (o.a = 2)))],
  ["literal with keys that are indexes", () => ({ b: 1, 2: "two", a: 2, 1: "one", "-1": "minus", "01": "text" })],
  ["literal with a symbol key", () => ({ a: 1, [tag]: 2, b: 3 })],
  ["literal with a method and an arrow function", () => ({ method() {}, arrow: () => 1, value: 2 })],
  ["literal with a spread", () => ({ first: 0, ...new Point(1, 2), last: 3 })],
  ["literal with a prototype", () => ({ __proto__: { inherited: 1 }, own: 2 })],
  ["literal with a computed key", () => ({ ["com" + "puted"]: 1, plain: 2 })],
  ["object without a prototype", () => changed(Object.create(null), o => ((o.b = 1), (o.a = 2)))],
  ["parsed text", () => JSON.parse('{"b":1,"a":{"c":2},"1":[]}')],
  ["array with a hole", () => ["a", , "c"]],
  ["array with a named property", () => changed(["a"], a => (a.named = 1))],
  ["string object", () => new String("ab")],
  ["number object with a property", () => changed(new Number(5), n => (n.extra = 1))],
  ["typed array", () => new Uint8Array([7, 8])],
  ["map", () => new Map([[1, 2]])],
  ["regular expression", () => /a/g],
  ["function with a property", () => changed(function named() {}, f => (f.extra = 1))],
  ["class", () => Handlers],
  ["arguments object", () => (function (a?: unknown, b?: unknown) { return arguments; })("a", "b")],
];

let log: string[] = [];

function logged(target: object): object {
  return new Proxy(target, {
    ownKeys(t) {
      log.push("ownKeys");
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, key) {
      log.push("describe " + String(key));
      return Reflect.getOwnPropertyDescriptor(t, key);
    },
    get(t, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(t, key, receiver);
    },
  });
}

function withGetter(o: any, key: string, getter: () => unknown): any {
  return Object.defineProperty(o, key, { get: getter, enumerable: true, configurable: true });
}

const statesThatRunCode: State[] = [
  ["field turned into a getter", () => withGetter(new Triple(1, 2, 3), "b", () => (log.push("b is read"), "got"))],
  ["extra getter", () => withGetter(new Triple(1, 2, 3), "d", () => (log.push("d is read"), "got"))],
  ["hidden getter", () => Object.defineProperty(new Triple(1, 2, 3), "b", { get: () => log.push("never read"), enumerable: false })],
  ["setter alone", () => Object.defineProperty(new Triple(1, 2, 3), "b", { set(v) {}, enumerable: true })],
  ["getter of a literal", () => ({ a: 1, get b() { log.push("b is read"); return this.a + 1; }, c: 3 })],
  ["a getter deletes the next key", () => { const o: any = new Triple(1, 2, 3); return withGetter(o, "a", () => delete o.b); }],
  ["a getter hides the next key", () => { const o: any = new Triple(1, 2, 3); return withGetter(o, "a", () => typeof Object.defineProperty(o, "b", { enumerable: false })); }],
  ["a getter adds a key", () => { const o: any = new Triple(1, 2, 3); return withGetter(o, "a", () => (o.d = "added")); }],
  ["a getter stores to the next key", () => { const o: any = new Triple(1, 2, 3); return withGetter(o, "a", () => (o.b = "stored")); }],
  ["a getter throws", () => withGetter(new Triple(1, 2, 3), "b", () => { throw new RangeError("from the getter"); })],
  ["proxy of an instance", () => logged(new Point(1, 2))],
  ["proxy of a literal with a symbol key", () => logged({ a: 1, [tag]: 2 })],
  ["proxy that lists fewer keys", () => new Proxy(new Point(1, 2), { ownKeys: () => ["y"] })],
  ["proxy that throws", () => new Proxy({}, { ownKeys() { throw new RangeError("from the trap"); } })],
];

function showWithLog(name: string, f: () => unknown): void {
  log = [];
  show(name, f);
  if (log.length) console.log("  " + log.join(", "));
}

function keysInTailPosition(o: any) {
  return Object.keys(o);
}
function valuesInTailPosition(o: any) {
  return Object.values(o);
}
function entriesInTailPosition(o: any) {
  return Object.entries(o);
}

// The name is known at run time only, so the callee is whatever the read finds.
const memberNames: string[] = JSON.parse('["keys", "values", "entries", "getPrototypeOf"]');
function callMember(index: number, ...operands: unknown[]): any {
  return (Object as any)[memberNames[index]](...operands);
}
function callMemberWithOne(index: number, operand: unknown): any {
  return (Object as any)[memberNames[index]](operand);
}
const keysByValue = (o: unknown) => callMemberWithOne(0, o);
const valuesByValue = (o: unknown) => callMemberWithOne(1, o);
const entriesByValue = (o: unknown) => callMemberWithOne(2, o);

for (const [name, make] of [...quietStates, ...statesThatRunCode]) {
  showWithLog(name + ", keys", () => Object.keys(make()));
  showWithLog(name + ", values", () => Object.values(make()));
  showWithLog(name + ", entries", () => Object.entries(make()));
  showWithLog(name + ", names", () => Object.getOwnPropertyNames(make()));
  showWithLog(name + ", symbols", () => Object.getOwnPropertySymbols(make()));
  showWithLog(name + ", all keys", () => Reflect.ownKeys(make()));
  showWithLog(name + ", in tail position", () => [keysInTailPosition(make()), valuesInTailPosition(make()), entriesInTailPosition(make())]);
  showWithLog(name + ", by value", () => [keysByValue(make()), valuesByValue(make()), entriesByValue(make())]);
}

const notObjects: [string, unknown][] = [
  ["text", "ab"],
  ["empty text", ""],
  ["number", 5],
  ["boolean", true],
  ["bigint", 10n],
  ["symbol", tag],
  ["undefined", undefined],
  ["null", null],
];
for (const [name, value] of notObjects) {
  const untyped: any = value;
  show(name + ", keys", () => Object.keys(untyped));
  show(name + ", values", () => Object.values(untyped));
  show(name + ", entries", () => Object.entries(untyped));
  show(name + ", in tail position", () => [keysInTailPosition(untyped), valuesInTailPosition(untyped), entriesInTailPosition(untyped)]);
  show(name + ", by value", () => [keysByValue(untyped), valuesByValue(untyped), entriesByValue(untyped)]);
}
show("no argument, keys", () => (Object.keys as any)());
show("no argument, values", () => (Object.values as any)());
show("no argument, entries", () => (Object.entries as any)());
show("more arguments", () => [(Object.keys as any)(new Point(1, 2), 1), (Object.values as any)(new Point(1, 2), 1), (Object.entries as any)(new Point(1, 2), 1)]);
show("no argument, by value", () => callMember(1));
show("more arguments, by value", () => [callMember(0, new Point(1, 2), 1), callMember(1, new Point(1, 2), 1), callMember(2, new Point(1, 2), 1)]);

show("the lists belong to the caller", () => {
  const p = new Point(1, 2);
  const keys: any[] = Object.keys(p);
  keys.push("more");
  keys[0] = "changed";
  const values: any[] = Object.values(p);
  values.length = 0;
  const entries: any[] = Object.entries(p);
  entries[0][1] = "changed";
  entries[1].push("more");
  return [keys, values, entries, Object.keys(p), Object.values(p), Object.entries(p), p.x, p.y];
});
show("every call makes new lists", () => {
  const p = new Point(1, 2);
  return [Object.keys(p) === Object.keys(p), Object.values(p) === Object.values(p), Object.entries(p) === Object.entries(p), Object.entries(p)[0] === Object.entries(p)[0]];
});
show("the values are the objects themselves", () => {
  const inner = { inner: 1 };
  const t = new Triple(inner, inner, describe);
  return [Object.values(t)[0] === inner, Object.entries(t)[1][1] === inner, Object.values(t)[2] === describe];
});
show("a closure in a field is one object", () => {
  const h = new Handlers();
  const values: any[] = Object.values(h);
  return [values[1] === h.onOpen, Object.entries(h)[1][1] === h.onOpen, values[1](), values[2] === h.onClose];
});
show("the lists are ordinary arrays", () => {
  const lists: any[][] = [Object.keys(new Point(1, 2)), Object.values(new Point(1, 2)), Object.entries(new Point(1, 2)), Object.entries(new Point(1, 2))[0]];
  return lists.map(list => [Array.isArray(list), Object.getPrototypeOf(list) === Array.prototype, list.length, Object.isFrozen(list), Object.keys(list)]);
});

function countAll(objects: any[]): number {
  let count = 0;
  for (let round = 0; round < 300; ++round) {
    for (const o of objects) count += Object.keys(o).length + Object.values(o).length * 3 + Object.entries(o).length * 5;
  }
  return count;
}
show("every quiet state in a loop", () => countAll(quietStates.map(([, make]) => make())));

function sumOfPoint(p: Point): number {
  let sum = 0;
  for (const value of Object.values(p)) if (typeof value === "number") sum += value;
  for (const [key, value] of Object.entries(p)) if (typeof value === "number") sum += value * key.length;
  return sum + Object.keys(p).length;
}
show("one class in a loop, then its other states", () => {
  let sum = 0;
  for (let i = 0; i < 3000; ++i) sum += sumOfPoint(new Point(i, 0.5));
  const others = quietStates.slice(0, 25).map(([, make]) => sumOfPoint(make()));
  return [sum, others];
});

const prototypeOfByValue = (o: unknown) => callMemberWithOne(3, o);
const otherPrototype = { other: 1 };

function nameOfPrototype(prototype: unknown): string {
  const known: [unknown, string][] = [
    [null, "null"],
    [Object.prototype, "Object.prototype"],
    [Function.prototype, "Function.prototype"],
    [Array.prototype, "Array.prototype"],
    [String.prototype, "String.prototype"],
    [Number.prototype, "Number.prototype"],
    [Boolean.prototype, "Boolean.prototype"],
    [BigInt.prototype, "BigInt.prototype"],
    [Symbol.prototype, "Symbol.prototype"],
    [Point.prototype, "Point.prototype"],
    [Point3.prototype, "Point3.prototype"],
    [Point, "Point"],
    [otherPrototype, "otherPrototype"],
  ];
  for (const [object, name] of known) if (object === prototype) return name;
  return describe(prototype);
}

const holders: [string, () => unknown][] = [
  ["class instance", () => new Point(1, 2)],
  ["subclass instance", () => new Point3(1, 2, 3)],
  ["instance with another prototype", () => Object.setPrototypeOf(new Point(1, 2), otherPrototype)],
  ["instance without a prototype", () => Object.setPrototypeOf(new Point(1, 2), null)],
  ["instance with extra properties", () => changed(new Point(1, 2), p => (p.extra = 1))],
  ["prototype of a subclass", () => Point3.prototype],
  ["subclass", () => Point3],
  ["class", () => Point],
  ["literal", () => ({ a: 1 })],
  ["literal with a prototype", () => ({ __proto__: otherPrototype })],
  ["object without a prototype", () => Object.create(null)],
  ["array", () => []],
  ["function", () => describe],
  ["proxy", () => new Proxy(new Point(1, 2), {})],
  ["proxy with a trap", () => new Proxy({}, { getPrototypeOf: () => otherPrototype })],
  ["proxy that throws", () => new Proxy({}, { getPrototypeOf() { throw new RangeError("from the trap"); } })],
  ["text", () => "ab"],
  ["number", () => 5],
  ["boolean", () => false],
  ["bigint", () => 10n],
  ["symbol", () => tag],
  ["undefined", () => undefined],
  ["null", () => null],
];
for (const [name, make] of holders) {
  show("prototype of " + name, () => nameOfPrototype(Object.getPrototypeOf(make())));
  show("prototype of " + name + ", by value", () => nameOfPrototype(prototypeOfByValue(make())));
}
show("prototype, no argument", () => callMember(3));
show("prototype, more arguments", () => nameOfPrototype(callMember(3, new Point(1, 2), otherPrototype)));
show("prototype, as a callback", () => holders.slice(0, 13).map(([, make]) => make()).map(Object.getPrototypeOf).map(nameOfPrototype));
show("prototype by value in a loop", () => {
  const objects = holders.slice(0, 13).map(([, make]) => make());
  let points = 0;
  for (let round = 0; round < 2000; ++round) {
    for (const o of objects) if (prototypeOfByValue(o) === Point.prototype) ++points;
  }
  return points;
});
