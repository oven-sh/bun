// A predicted callee that turns out to be wrong costs time but never changes the result.
// @ts-ignore
import Emitter from "./req/un_emitter.js";
declare const console: any;
const E: any = Emitter;
let n = 0;
const listen = (v: number) => { n += v };
function attempt(label: string, f: () => unknown) { try { console.log(label + ":", String(f()), n) } catch (e) { console.log(label + ":", (e as Error).constructor.name, n) } }
function make() { const e = new E(); e.on("x", listen); return e }
function fire(e: any) { return e.emit("x", 1) }
const first = new E(); first.on("x", listen);
attempt("as predicted", () => first.emit("x", 1));
attempt("no listener", () => first.emit("y", 1));
attempt("through a function", () => fire(make()));
attempt("this.emit", () => make().both("x", 2));
// An own property shadows the prototype's.
const shadowed = new E(); shadowed.on("x", listen);
attempt("before the own store", () => shadowed.emit("x", 1));
shadowed.emit = function () { return "own" };
attempt("an own function", () => shadowed.emit("x", 1));
attempt("an own function, this.emit", () => shadowed.both("x", 1));
attempt("an own function, through a function", () => fire(shadowed));
delete shadowed.emit;
attempt("deleted again", () => shadowed.emit("x", 1));
Object.defineProperty(shadowed, "emit", { get() { n += 100; return () => "from a getter" }, configurable: true });
attempt("an own getter", () => shadowed.emit("x", 1));
// Not a function.
const broken = new E(); broken.emit = 5;
attempt("a number", () => broken.emit("x", 1));
broken.emit = undefined;
attempt("undefined", () => broken.emit("x", 1));
attempt("undefined, this.emit", () => broken.both("x", 1));
// Objects that the constructor has not made.
attempt("a literal", () => fire({ emit(type: string, a: number) { return type + a } }));
attempt("borrowed", () => fire({ table: { x: listen }, emit: E.prototype.emit }));
attempt("Emitter.call(plain)", () => { const plain: any = Object.create(E.prototype); E.call(plain); plain.on("x", listen); return fire(plain) });
attempt("another prototype", () => { const e = make(); Object.setPrototypeOf(e, { emit() { return "moved" } }); return fire(e) });
attempt("no prototype", () => { const e = make(); Object.setPrototypeOf(e, null); return fire(e) });
attempt("null", () => fire(null));
// Subclasses.
class Plain extends E { ping() { return this.emit("x", 3) } }
class Overriding extends E { emit(..._: unknown[]) { return "overridden" } ping() { return this.emit("x", 3) } }
attempt("a subclass", () => { const g: any = new Plain(); g.on("x", listen); return g.ping() });
attempt("a subclass that overrides", () => { const g: any = new Overriding(); g.on("x", listen); return [g.ping(), g.both("x", 1), fire(g)].join() });
// The argument differs from what the other calls pass.
attempt("a symbol for the event", () => { const e = make(); const key = Symbol("k"); e.on(key, listen); return e.emit(key, 4) });
attempt("a number for the event", () => { const e = make(); e.on(7, listen); return e.emit(7, 5) });
attempt("no function for the listener", () => { const e = make(); e.on("x", 5); return e.emit("x", 1) });
attempt("another listener", () => { const e = make(); e.on("x", (v: number) => { n -= v }); return e.emit("x", 6) });
// The prototype is patched for all, last.
const before = make();
E.prototype.emit = function () { return "patched" };
attempt("the prototype is patched", () => [before.emit("x", 1), first.emit("x", 1), fire(make()), make().both("x", 1), new Plain().ping()].join());
delete E.prototype.emit;
attempt("the prototype has none", () => first.emit("x", 1));
export {};
