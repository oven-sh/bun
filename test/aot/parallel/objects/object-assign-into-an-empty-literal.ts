// Object.assign({}, source, ..) of sources whose names are known only when the program runs. It stores where { ...source } defines, which a name __proto__ tells apart.
const log: string[] = [];
function digest(object: any): string {
  const keys = Reflect.ownKeys(object).map(key => {
    const place = Object.getOwnPropertyDescriptor(object, key)!;
    return String(key) + "=" + String(place.get ? "get" : place.value) + (place.enumerable ? "" : "~") + (place.writable === false ? "!" : "") + (place.configurable ? "" : "#");
  });
  const above = Object.getPrototypeOf(object);
  return "{" + keys.join() + "}" + (above === Object.prototype ? "" : above === null ? " below null" : " below another") + (Object.isExtensible(object) ? "" : " closed");
}
function show(name: string, make: () => any) {
  let line = "";
  for (let turn = 0; turn < 6; turn++) {
    log.length = 0;
    try {
      line = digest(make());
    } catch (error) {
      line = (error as Error).name + ": " + (error as Error).message;
    }
    if (log.length) line += " | " + log.join();
  }
  console.log(name + ": " + line);
}
function one(source: any): any { return Object.assign({}, source); }
function two(first: any, second: any): any { return Object.assign({}, first, second); }
function three(first: any, second: any, third: any): any { return Object.assign({}, first, second, third); }
function generic<T>(source: T) { return Object.assign({}, source); }
function counts(source: Record<string, number>) { return Object.assign({}, source); }

const local = Symbol("local");
class Holder { a = 1; b = "two"; #hidden = 3; get hidden() { return this.#hidden; } static made = 0; }
function filled(): any { const made: any = {}; for (const name of ["a", "b", "c", "d"]) made[name] = name.length; return made; }
function dictionary(): any { const made: any = {}; for (let i = 0; i < 80; i++) made["k" + i] = i; for (let i = 4; i < 80; i++) delete made["k" + i]; made.a = 1; return made; }
function named() {}
named.extra = 1;

const sources: Record<string, () => any> = {
  undefined: () => undefined,
  null: () => null,
  number: () => 5,
  boolean: () => true,
  bigint: () => 5n,
  symbol: () => local,
  text: () => "ab",
  "empty text": () => "",
  empty: () => ({}),
  literal: () => ({ a: 1, b: 2, c: "three", d: 4 }),
  parsed: () => JSON.parse('{"a":1,"b":2,"c":"three","d":4}'),
  "parsed of twelve": () => JSON.parse('{"a":1,"b":2,"c":"three","d":4,"e":5,"f":6,"g":7,"h":8,"i":9,"j":10,"k":11,"l":12}'),
  filled,
  dictionary,
  instance: () => new Holder(),
  "class": () => Holder,
  function: () => named,
  list: () => [1, , 3],
  map: () => new Map([[1, 2]]),
  elements: () => ({ b: 1, 1: "one", a: 2, 0: "zero" }),
  "far element": () => ({ a: 1, 5000: "far" }),
  "symbol key": () => ({ a: 1, [local]: 2, b: 3 }),
  hidden: () => Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }),
  "read-only": () => Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: true }),
  frozen: () => Object.freeze({ a: 1, b: 2 }),
  sealed: () => Object.seal({ a: 1, b: 2 }),
  "below null": () => Object.assign(Object.create(null), { a: 1 }),
  "below another": () => Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true } }),
  getter: () => ({ a: 1, get b() { log.push("b"); return 2; }, c: 3 }),
  "getter and setter": () => ({ get a() { log.push("get a"); return 1; }, set a(value) { log.push("set a"); } }),
  "setter alone": () => ({ a: 1, set b(value: number) { log.push("set b"); } }),
  "getter that throws": () => ({ a: 1, get b(): number { throw new RangeError("from b"); }, get c() { log.push("c"); return 3; } }),
  "getter that deletes": () => { const made: any = { a: 1, get b() { delete made.c; return 2; }, c: 3, d: 4 }; return made; },
  "getter that adds": () => { const made: any = { a: 1, get b() { made.late = 5; return 2; }, c: 3 }; return made; },
  "getter that hides": () => { const made: any = { a: 1, get b() { Object.defineProperty(made, "c", { enumerable: false }); return 2; }, c: 3 }; return made; },
  "getter that changes": () => { const made: any = { a: 1, get b() { made.c = "changed"; return 2; }, c: 3 }; return made; },
  "getter defined late": () => Object.defineProperty(filled(), "late", { get() { log.push("late"); return 9; }, enumerable: true }),
  proxy: () => new Proxy({ a: 1, b: 2 }, {
    ownKeys(target) { log.push("keys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { log.push("describe " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
    get(target, key) { log.push("get " + String(key)); return Reflect.get(target, key); },
  }),
  "parsed __proto__": () => JSON.parse('{"a":1,"__proto__":{"inherited":2},"b":3}'),
  "parsed __proto__ of a number": () => JSON.parse('{"a":1,"__proto__":5}'),
  "parsed __proto__ of null": () => JSON.parse('{"__proto__":null,"a":1}'),
  "computed __proto__": () => ({ a: 1, ["__proto__"]: { inherited: 2 } }),
  "defined __proto__": () => Object.defineProperty({ a: 1 }, "__proto__", { value: { inherited: 2 }, enumerable: true }),
  "stored __proto__ by key": () => { const made: any = Object.create(null); made["__proto__"] = { inherited: 2 }; made.a = 1; return made; },
};

for (const [name, make] of Object.entries(sources)) {
  show("one " + name, () => one(make()));
  show("generic " + name, () => generic(make()));
}
show("counts", () => counts({ a: 1, b: 2 }));
show("counts of a dictionary", () => counts(dictionary()));
for (const [name, make] of Object.entries(sources)) {
  show("literal then " + name, () => two({ a: "first", z: 0 }, make()));
  show(name + " then literal", () => two(make(), { a: "last", z: 0 }));
  show(name + " twice", () => two(make(), make()));
}
show("three", () => three({ a: 1 }, null, { b: 2 }));
show("three that overlap", () => three(filled(), JSON.parse('{"b":"parsed","e":5}'), { a: "last" }));

// The copy is an object of its own.
{
  const source: any = { a: 1, inner: { b: 2 } };
  const copy = one(source);
  copy.a = 5;
  copy.more = 6;
  copy.inner.b = 7;
  console.log(digest(source), source.inner.b, digest(copy), copy === source, copy instanceof Holder);
  const ofInstance = one(new Holder());
  console.log(ofInstance instanceof Holder, ofInstance.hidden, Object.keys(ofInstance).join());
  const ofFrozen = one(Object.freeze({ a: 1 }));
  ofFrozen.a = 2;
  ofFrozen.b = 3;
  delete ofFrozen.a;
  console.log(digest(ofFrozen));
}

// The arguments are evaluated first, in order, and then read in order.
{
  const order: string[] = [];
  const note = (name: string, value: any): any => { order.push(name); return value; };
  const made = Object.assign({}, note("first", { get a() { order.push("read a"); return 1; } }), note("second", { get b() { order.push("read b"); return 2; } }));
  console.log(order.join(), digest(made));
}
