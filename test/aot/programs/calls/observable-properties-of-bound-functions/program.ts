declare const console: any;
const O: any = Object;
function describe(d: any): string { return d ? [typeof d.value === "function" ? "function" : JSON.stringify(d.value), d.writable, d.enumerable, d.configurable].join() : "none"; }
function observe(name: string, b: any, target: any, receiver: any): void {
    const say = (what: string, f: () => unknown): void => { let r: string; try { r = String(f()); } catch (e: any) { r = "throws " + e.constructor.name; } console.log(name + " " + what + ": " + r); };
    say("typeof", () => typeof b); say("name", () => b.name); say("length", () => b.length);
    say("own keys", () => Reflect.ownKeys(b).map(String).join()); say("name's descriptor", () => describe(O.getOwnPropertyDescriptor(b, "name"))); say("length's descriptor", () => describe(O.getOwnPropertyDescriptor(b, "length")));
    say("has prototype", () => "prototype" in b); say("own prototype", () => O.hasOwn(b, "prototype")); say("its prototype", () => O.getPrototypeOf(b) === O.getPrototypeOf(target));
    say("toString", () => Function.prototype.toString.call(b).replace(/\s+/g, " ")); say("String", () => String(b).replace(/\s+/g, " ")); say("tag", () => O.prototype.toString.call(b));
    say("is the target", () => b === target); say("two binds", () => target.bind(receiver) === target.bind(receiver));
    say("call", () => b(1, 2)); say("call with another this", () => b.call({ v: 100 }, 1, 2)); say("apply", () => b.apply({ v: 100 }, [1, 2])); say("Reflect.apply", () => Reflect.apply(b, { v: 100 }, [1, 2])); say("as a method", () => ({ v: 100, b }).b(1, 2));
    say("no arguments", () => b()); say("many arguments", () => b(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
    say("new", () => typeof new b(1, 2)); say("Reflect.construct", () => typeof Reflect.construct(b, [1, 2])); say("as newTarget", () => typeof Reflect.construct(O, [], b));
    say("instanceof", () => ({}) instanceof b); say("primitive instanceof", () => (1 as any) instanceof b); say("receiver instanceof", () => receiver instanceof b);
    say("bound again", () => b.bind({ v: 100 })(1, 2)); say("bound again, name", () => b.bind(null).name); say("bound again with an argument", () => b.bind(null, 7)(2)); say("bound again, length", () => b.bind(null, 7).length);
    say("a property", () => { b.extra = 5; return [b.extra, target.extra, O.keys(b).join()]; }); say("extensible", () => O.isExtensible(b)); say("frozen", () => O.isFrozen(O.freeze(b)));
    say("caller", () => b.caller); say("arguments", () => b.arguments);
    say("name is redefined", () => { O.defineProperty(b, "name", { value: "mine" }); return b.name; }); say("delete length", () => [delete b.length, b.length]);
}
class K { v = 10; add(a: number = 0, b: number = 0): number { return this.v + a + b; } rest(...a: number[]): number { return this.v + a.length; } uses(): number { return this.v + arguments.length; } async later(a: number): Promise<number> { return this.v + a; } *gen(a: number): Generator<number> { yield this.v + a; } static make(this: unknown, a?: number): string { return typeof this + a; } get getter(): number { return this.v; } }
const k = new K();
function free(this: any, a: number = 0, b: number = 0): number { return this.v + a * b; }
function sloppyThis(this: unknown): string { return typeof this; }
const arrow = (a: number = 0, b: number = 0): number => a - b;
const literal = { v: 20, m(a: number = 0): number { return this.v + a; } };
observe("method", k.add.bind(k), k.add, k);
observe("rest", k.rest.bind(k), k.rest, k);
observe("arguments", k.uses.bind(k), k.uses, k);
observe("declaration", free.bind(k), free, k);
observe("arrow", (arrow as any).bind(k), arrow, k);
observe("literal's method", literal.m.bind(literal), literal.m, literal);
observe("static", K.make.bind(K), K.make, K);
observe("one bound argument", k.add.bind(k, 5), k.add, k);
observe("more bound arguments than parameters", (k.add as any).bind(k, 1, 2, 3), k.add, k);
observe("class", (K as any).bind(null), K, null);
console.log("primitive this: " + [sloppyThis.bind(1)(), sloppyThis.bind("s")(), sloppyThis.bind(undefined)(), sloppyThis.bind(null)(), (sloppyThis as any).bind()()]);
console.log("async: " + await k.later.bind(k)(1) + " " + k.later.bind(k).name + " " + O.prototype.toString.call(k.later.bind(k)));
console.log("generator: " + [...k.gen.bind(k)(1)] + " " + k.gen.bind(k).name + " " + O.prototype.toString.call(k.gen.bind(k)));
// name and length are read from the target when it is bound.
function renamed(a: number, b: number, c: number): number { return a + b + c; }
O.defineProperty(renamed, "name", { value: "other" }); O.defineProperty(renamed, "length", { value: 7 });
console.log("a target with another name and length: " + [renamed.bind(null).name, renamed.bind(null).length, renamed.bind(null, 1).length]);
function oddName(): void { } O.defineProperty(oddName, "name", { value: 5 }); O.defineProperty(oddName, "length", { value: "x" });
console.log("a name that is no string: " + JSON.stringify([oddName.bind(null).name, oddName.bind(null).length]));
// The idioms.
class Button { n = 0; constructor() { this.click = this.click.bind(this); } click(): number { return ++this.n; } }
{ const b = new Button(), c = b.click; console.log("bound in the constructor: " + [c(), c(), b.n, O.keys(b).join(), b.click === c, b.click === Button.prototype.click, c.name]); }
{ const fs = [1, 2, 3].map(k.add.bind(k)); console.log("as a callback: " + fs); }
{ const seen = new Set<unknown>(); const f = k.add.bind(k); seen.add(f); seen.add(f); seen.add(k.add.bind(k)); console.log("identity: " + seen.size); }
{ let t = 0; const f = k.add.bind(k); for (let i = 0; i < 1000; i++) t += f(i, 1); console.log("a loop: " + t); }
export {};
