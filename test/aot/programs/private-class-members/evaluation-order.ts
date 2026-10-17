// The order of evaluation around private members: receiver, value, default, element and argument.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

const log: string[] = [];
function note<T>(what: string, v: T): T { log.push(what); return v; }
function told(f: () => unknown) { log.length = 0; const r = said(f); return log.join(" ") + " -> " + r; }
function boom(): number { log.push("boom"); throw new RangeError("boom"); }
class C {
  static #f = 0;
  static #x: any = 0;
  static #hidden = 0;
  static set #s(v: number) { log.push("setter " + v); C.#hidden = v; }
  static get #s() { log.push("getter"); return C.#hidden; }
  static get #g() { log.push("getter"); return 1; }
  static set #w(v: number) { log.push("setter " + v); }
  static #m() { return 1; }
  static field(o: any) { o.#f = note("value", 5); }
  static fieldThrows(o: any) { o.#f = boom(); }
  static viaThis() { this.#f = note("value", 5); }
  static receiver(o: () => any) { o().#f = note("value", 5); }
  static setter(o: any) { o.#s = note("value", 5); }
  static getterOnly(o: any) { o.#g = note("value", 5); }
  static add(o: any) { o.#f += note("value", 5); }
  static addSetter(o: any) { o.#s += note("value", 5); }
  static addGetterOnly(o: any) { o.#g += note("value", 5); }
  static addSetterOnly(o: any) { o.#w += note("value", 5); }
  static increment(o: any) { return o.#f++; }
  static incrementSetterOnly(o: any) { return o.#w++; }
  static incrementGetterOnly(o: any) { return ++o.#g; }
  static or(o: any) { return o.#f ||= note("value", 5); }
  static and(o: any) { return o.#f &&= note("value", 6); }
  static nullish(o: any) { return o.#f ??= note("value", 7); }
  static nullishSetterOnly(o: any) { return o.#w ??= note("value", 7); }
  static orGetterOnly(o: any) { return o.#g ||= note("value", 7); }
  static andGetterOnly(o: any) { return o.#g &&= note("value", 7); }
  static array(o: any, it: Iterable<number>) { [o.#f] = it; }
  static arrayDefault(o: any) { [o.#f = note("default", 3)] = []; }
  static arrayRest(o: any, it: Iterable<number>) { [...o.#x] = it; }
  static object(o: any) { ({ a: o.#f } = { a: 9 }); }
  static objectRest(o: any) { ({ ...o.#x } = { a: 9 }); }
  static forOf(o: any) { for (o.#f of [note("element", 1)]) log.push("body"); }
  static forIn(o: any) { for (o.#x in { a: 1 }) log.push("body"); }
  static call(o: any) { return o.#m(note("argument", 1)); }
  static read(o: any) { return o.#f; }
  static chain(o: any) { return o.#f; }
  static reset() { C.#f = 0; C.#x = 0; }
  static now() { return C.#f + " " + String(C.#x); }
}
class D extends C {}
function steps(): Iterable<number> {
  return { [Symbol.iterator]() { log.push("open"); return { next() { log.push("next"); return { done: false, value: 4 }; }, return() { log.push("return"); return {}; } }; } } as Iterable<number>;
}
const others: [string, any][] = [["an heir", D], ["an object below", Object.create(C)], ["a proxy", new Proxy(C, {})], ["an instance", new C()], ["a function", function () {}], ["null", null], ["undefined", undefined], ["a number", 1], ["a string", "s"], ["a boolean", true], ["a symbol", Symbol()], ["a bigint", 1n]];
const doors = ["field", "fieldThrows", "setter", "getterOnly", "method", "add", "addSetter", "addGetterOnly", "addSetterOnly", "addMethod", "increment", "incrementSetterOnly", "incrementGetterOnly", "or", "and", "nullish", "nullishSetterOnly", "orGetterOnly", "andGetterOnly", "arrayDefault", "object", "objectRest", "forOf", "forIn", "call", "read", "chain"];
for (const door of doors) {
  C.reset();
  console.log(door + " on the class: " + told(() => (C as any)[door](C)) + " now " + C.now());
  for (const [name, o] of others) console.log(door + " on " + name + ": " + told(() => (C as any)[door](o)) + " now " + C.now());
}
for (const [name, o] of [["the class", C] as [string, any], ...others]) {
  C.reset();
  console.log("array on " + name + ": " + told(() => C.array(o, steps())) + " now " + C.now());
  console.log("arrayRest on " + name + ": " + told(() => C.arrayRest(o, [1, 2])));
  console.log("receiver on " + name + ": " + told(() => C.receiver(() => note("receiver", o))));
}
console.log("this is the class: " + told(() => C.viaThis()));
console.log("this is an heir: " + told(() => D.viaThis()));

