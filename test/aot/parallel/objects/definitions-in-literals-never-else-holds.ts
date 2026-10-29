// Literals whose later definitions are made one by one: more fields than an allocation takes, values that are computed in between, code that runs once and code that runs often.
// While a literal is built nobody else has it. Afterwards everything may happen to it: a store of another type, a redefinition, a delete, a freeze. The keys keep the order of the source.
const lines: string[] = [];
const show = (label: string, value: unknown) => lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
const keysOf = (object: object) => Reflect.ownKeys(object).map(String).join();
let calls = 0;
function next(): number { return ++calls; }

function large(start: number) { return { f0: start + 0, f1: start + 1, f2: start + 2, f3: Symbol.iterator, f4: start + 4, f5: "s5", f6: start + 6, f7: start + 7, f8: start + 8, f9: start + 9, f10: Symbol.iterator, f11: start + 11, f12: "s12", f13: start + 13, f14: start + 14, f15: start + 15, f16: start + 16, f17: Symbol.iterator, f18: start + 18, f19: "s19", f20: start + 20, f21: start + 21, f22: start + 22, f23: start + 23, f24: Symbol.iterator, f25: start + 25, f26: "s26", f27: start + 27, f28: start + 28, f29: start + 29, f30: start + 30, f31: Symbol.iterator, f32: start + 32, f33: "s33", f34: start + 34, f35: start + 35, f36: start + 36, f37: start + 37, f38: Symbol.iterator, f39: start + 39, f40: "s40", f41: start + 41, f42: start + 42, f43: start + 43, f44: start + 44, f45: Symbol.iterator, f46: start + 46, f47: "s47", f48: start + 48, f49: start + 49, f50: start + 50, f51: start + 51, f52: Symbol.iterator, f53: start + 53, f54: "s54", f55: start + 55, f56: start + 56, f57: start + 57, f58: start + 58, f59: Symbol.iterator, f60: start + 60, f61: "s61", f62: start + 62, f63: start + 63, f64: start + 64, f65: start + 65, f66: Symbol.iterator, f67: start + 67, f68: "s68", f69: start + 69, f70: start + 70, f71: start + 71, f72: start + 72, f73: Symbol.iterator, f74: start + 74, f75: "s75", f76: start + 76, f77: start + 77, f78: start + 78, f79: start + 79 }; }
const once = large(1000);
show("large, once", keysOf(once).length + " " + once.f0 + " " + String(once.f3) + " " + once.f5 + " " + once.f79 + " " + Object.keys(once).slice(60, 70).join());
let total = 0;
for (let i = 0; i < 300; i++) total += large(i).f79 + Object.keys(large(i)).length;
show("large, often", total);

type Wide = { a: number; b: string; c: symbol; d?: number; e?: string };
function computedBetween(): Wide { return { a: next(), b: String(next()), c: Symbol.for("c" + next()), d: next(), e: "e" + next() }; }
const built = computedBetween();
show("computed in between", keysOf(built) + " " + built.a + built.b + String(built.c) + built.d + built.e);

// Afterwards the fields leave their slots, and the next literal of the same place starts afresh.
const loose = built as any;
loose.c = 12; loose.a = "text"; delete loose.b; Object.defineProperty(loose, "d", { get() { return "getter"; }, enumerable: true, configurable: true });
show("changed afterwards", keysOf(loose) + " " + loose.a + " " + loose.b + " " + loose.c + " " + loose.d);
Object.freeze(loose);
const again = computedBetween();
show("the next one", keysOf(again) + " " + again.a + again.b + String(again.c) + again.d + again.e + " " + Object.isFrozen(again));

// What is no plain definition: a spread, a computed key that spells a later name, an accessor beside the names, another prototype, a value of another type. (A name twice and an accessor under a name that is also defined: the program beside this one, in JavaScript.)
const source = { d: "from the spread", z: 1 } as any;
function withSpread(i: number): any { return { a: i, ...source, d: i + 1, e: "e" }; }
function withSpreadBehind(i: number): any { return { a: i, d: i + 1, ...source, e: "e" }; }
function withComputedKey(key: string, i: number): any { return { a: i, [key]: "computed", d: i + 1, e: "e" }; }
function withAccessorBeside(i: number): any { return { a: i, get other() { return "getter " + this.d; }, set other(value) { this.e = value; }, d: i + 1, e: "e" }; }
function withPrototype(i: number): any { return { __proto__: { set d(value: number) { lines.push("the setter ran"); }, inherited: true }, a: i, d: i + 1, e: "e" }; }
function otherType(i: number): Wide { return { a: i, b: "b", c: Symbol.iterator, d: ("not a number " + i) as any, e: (i * 2) as any }; }
for (const [label, make] of Object.entries({ withSpread, withSpreadBehind, withAccessorBeside, withPrototype, otherType })) {
  let last: any;
  for (let i = 0; i < 40; i++) last = make(i);
  show(label, keysOf(last) + " | " + String(last.d) + " | " + String(last.e) + " | " + JSON.stringify(Object.getOwnPropertyDescriptor(last, "d")) + " | " + String(last.inherited));
}
for (const key of ["d", "e", "x", "a", "0"]) show("computed key " + key, keysOf(withComputedKey(key, 5)) + " | " + JSON.stringify(withComputedKey(key, 5)));

// One definition gets a value that its field does not admit, so that field lies outside its slot while the definitions behind it are made.
type Mixed = { a: number; run(): number; b: number; c: number; d: string; e?: number };
function mixed(i: number, odd: unknown): Mixed { return { __proto__: null, a: i, run() { return this.a + this.c; }, b: odd as number, c: i + 1, d: "d" + i, e: odd as number } as Mixed; }
function mixedBesideAccessor(i: number, odd: unknown): Mixed { return { get lazy() { return this.d; }, a: i, run() { return this.a + this.c; }, d: odd as string, b: i, c: i + 1 } as Mixed; }
for (const odd of [5, "text", undefined, null, 1.5, { object: 1 }, Symbol.iterator, -0, 2 ** 40, true]) {
  for (const make of [mixed, mixedBesideAccessor]) {
    let last = make(0, odd);
    for (let i = 1; i < 12; i++) last = make(i, odd);
    show(make.name + " " + String(odd), keysOf(last) + " | " + [last.a, last.b, last.c, last.d, last.e].map(String).join() + " | " + last.run() + " | " + Object.entries(Object.getOwnPropertyDescriptors(last)).map(([key, d]) => key + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "")).join());
  }
}

// The value of a later definition throws, suspends, or looks at the world in between.
function throwsInBetween(i: number): Wide { return { a: i, b: "b", c: Symbol.iterator, d: i > 2 ? (() => { throw new RangeError("at " + i); })() : i, e: "e" }; }
for (let i = 0; i < 5; i++) { try { show("throws " + i, keysOf(throwsInBetween(i))); } catch (error) { show("throws " + i, (error as Error).message); } }
async function suspended(i: number): Promise<Wide> { return { a: i, b: await Promise.resolve("awaited"), c: Symbol.iterator, d: await Promise.resolve(i + 1), e: "e" }; }
function* yielded(i: number): Generator<number, Wide, number> { return { a: i, b: "b", c: Symbol.iterator, d: yield i, e: "e" + (yield i + 1) }; }
const generator = yielded(7); generator.next(); generator.next(70);
show("yielded", JSON.stringify(generator.next(71).value) );
show("nested", JSON.stringify({ outer: next(), inner: { a: next(), b: { c: next(), d: [next(), { e: next() }] } }, last: next() }));
show("suspended", JSON.stringify(await suspended(3), (key, value) => typeof value === "symbol" ? String(value) : value));
console.log(lines.join("\n"));
