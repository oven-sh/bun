// A method call on a receiver of unknown type is a single call instruction at the call site.

declare const console: any; declare const globalThis: any;
const said: string[] = [];
function describeError(error: any): string { return error instanceof TypeError ? "TypeError" : error?.constructor?.name + " " + error?.message; }
function block(name: string, body: () => unknown) { try { said.push(name + ": " + body()); } catch (error) { said.push(name + ": THROWS " + describeError(error)); } }
function attempt(body: () => unknown): string { try { return String(body()); } catch (error) { return "THROWS " + describeError(error); } }
function m0(o: any): unknown { const r = o.m(); return r; }
function m0InTry(o: any): unknown { try { const r = o.m(); return r; } catch (error) { return "caught at the site: " + describeError(error); } }
function twice(o: any): unknown { const a = o.m(); const b = o.n(); return a + "|" + b; }
class C { v = 1; m() { return "C.m " + this.v; } n() { return "C.n"; } }
class D extends C { override m() { return "D.m " + this.v; } }
block("its own, inherited, of a class, of a subclass", () => [m0({ m() { return "own"; } }), m0(Object.create({ m() { return "inherited"; } })), m0(new C()), m0(new D()), twice(new D())].join(" "));
block("this is the receiver", () => { const o: any = { v: 7, m() { return this.v; } }; const p: any = Object.create(o); p.v = 8; return [m0(o), m0(p)].join(); });
block("thirty structures at one site, three rounds", () => { const all: any[] = []; for (let i = 0; i < 30; i++) { const o: any = {}; for (let k = 0; k < i; k++) o["p" + k] = k; o.m = function () { return i; }; all.push(o); } let sum = 0; for (let r = 0; r < 3; r++) for (const o of all) sum += m0(o) as number; return sum; });
block("a getter that yields the method", () => { let reads = 0; const o: any = { get m() { reads++; return function (this: unknown) { return "from the getter " + (this === o); }; } }; return [m0(o), m0(o), m0(Object.create(o)), reads].join(" "); });
block("a getter that throws: no try, a try at the site, a try around", () => { const o: any = { get m() { throw new RangeError("the getter"); } }; return [attempt(() => m0(o)), m0InTry(o), m0InTry(Object.create(o)), attempt(() => twice(o))].join(" | "); });
block("the method throws: a try at the site", () => m0InTry({ m() { throw new Error("the method"); } }));
block("what is no function, by its name", () => [{ m: 1 }, { m: "s" }, { m: null }, { m: undefined }, {}, { m: {} }, Object.create({ m: true }), { get m() { return 5; } }].map(o => attempt(() => m0(o))).join(" | "));
block("the same with a try at the site", () => [{ m: 1 }, {}, { get m() { return 5; } }].map(o => m0InTry(o)).join(" | "));
block("nil receivers", () => [undefined, null].map(o => attempt(() => m0(o)) + " / " + m0InTry(o)).join(" | "));
function text0(o: any): unknown { const r = o.toString(); return r; }
block("primitive receivers: a method of the engine's, by name, without arguments", () => [text0("text"), text0(5), text0(1.5), text0(true), text0(10n), text0(Symbol.iterator), attempt(() => m0(true)).split(" ").slice(0, 2).join(" "), attempt(() => m0("s")).split(" ").slice(0, 2).join(" "), attempt(() => m0(7)).split(" ").slice(0, 2).join(" ")].join(" "));
block("arrays, functions, maps as receivers", () => { const a: any = [1, 2]; a.m = function () { return this.length; }; const f: any = () => 0; f.m = function () { return typeof this; }; const map: any = new Map(); map.m = function () { return this.size; }; return [m0(a), m0(f), m0(map)].join(); });
block("a proxy", () => { let log = ""; const p = new Proxy({ m() { return "target's"; } }, { get(target: any, key: string | symbol, receiver: unknown) { log += String(key) + ";"; return Reflect.get(target, key, receiver); } }); return [m0(p), m0(p), log].join(" "); });
block("a proxy whose trap throws, a try at the site", () => m0InTry(new Proxy({}, { get() { throw new TypeError("the trap"); } })));
block("host functions and bound functions as methods", () => { const o: any = { m: Object.prototype.toString, n: function (this: unknown) { return String(this); }.bind("bound") }; return twice(o); });
block("the method replaced, deleted, shadowed between calls", () => { const parent: any = { m() { return 1; } }; const o: any = Object.create(parent); const out = [m0(o)]; parent.m = () => 2; out.push(m0(o)); o.m = () => 3; out.push(m0(o)); delete o.m; out.push(m0(o)); delete parent.m; out.push(attempt(() => m0(o))); Object.setPrototypeOf(o, { m() { return 4; } }); out.push(m0(o)); return out.join(" "); });
block("a collection in the getter, what is passed on stays", () => { const collect: any = globalThis.gc ?? globalThis.Bun?.gc ?? (() => undefined); let sum = 0; for (let i = 0; i < 24; i++) { const o: any = { tag: "t" + i, get m() { if (i % 6 === 0) collect(true); const made = { i }; return function (this: any) { return this.tag.length + made.i; }; } }; sum += m0(o) as number; } return sum; });
let kept: unknown; function keep(x: unknown) { kept = x; }
block("the names in a trace: thrown by the method, by the getter, by what is no function", () => { function inner(o: any): unknown { const r = o.m(); keep(r); return r; } function outer(o: any): unknown { const r = inner(o); keep(r); return r; } const names = (o: any) => { try { outer(o); return "no error"; } catch (error) { const s = (error as Error).stack ?? ""; return ["inner", "outer"].map(n => new RegExp("\\b" + n + "\\b").test(s)).join(); } }; return [names({ m() { throw new Error("x"); } }), names({ get m() { throw new Error("y"); } }), names({ m: 1 }), names(null)].join(" "); });
block("nil, primitives and what has no such method, at a site that has seen many structures", () => { function site(o: any): unknown { const r = o.m(); return r; } for (let i = 0; i < 12; i++) { const o: any = {}; for (let k = 0; k < i; k++) o["q" + k] = k; o.m = () => i; site(o); } return [undefined, null, "text", 5, true, {}, [], () => 0, { m: 2 }].map(o => attempt(() => site(o))).join(" | "); });
block("many calls at one site, then another structure, then a getter", () => { let sum = 0; let o: any = { m() { return 1; } }; for (let i = 0; i < 3000; i++) { if (i === 1000) o = { a: 1, m() { return 2; } }; if (i === 2000) o = { get m() { return () => 3; } }; sum += m0(o) as number; } return sum; });
console.log(said.join("\n"));
export {};
