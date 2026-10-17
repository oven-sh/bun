// `Object.assign(this, ..)`, `Object.freeze(this)`, `defineProperty`, `bind`, `for..in`, `setPrototypeOf` and `delete` in constructors.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
interface Opts { a?: number; b?: string; extra?: boolean }
class Assigned { a = 1; b = "b"; constructor(o: Opts) { Object.assign(this, o) } }
class Frozen { v: number; constructor(v: number) { this.v = v; Object.freeze(this) } }
class Defined { v = 1; hidden!: number; constructor() { Object.defineProperty(this, "hidden", { value: 7, enumerable: false }); Object.defineProperty(this, "lazy", { get: () => this.v * 2, configurable: true }) } }
class Bound { n = 1; constructor() { this.get = this.get.bind(this) } get(): number { return this.n } }
class Loop { [k: string]: unknown; constructor(o: Record<string, unknown>) { for (const k in o) this[k] = o[k] } }
class SelfProto extends Error { constructor(m: string) { super(m); Object.setPrototypeOf(this, SelfProto.prototype); this.name = "SelfProto" } }
class NewTargetProto extends Error { constructor(m: string) { super(m); Object.setPrototypeOf(this, new.target.prototype) } }
class Deleter { tmp?: number = 1; keep = 2; constructor() { delete this.tmp } }
class Counter { static made = 0; id: number; constructor() { this.id = ++Counter.made } }
row("Object.assign(this, options)", () => { const x = new Assigned({ a: 5, extra: true }); return x.a + " " + x.b + " " + Object.keys(x).join() + " " + hide(x).extra });
row("Object.freeze(this)", () => { const x = new Frozen(3); let s = ""; try { x.v = 4 } catch (e) { s = (e as Error).name } return s + " " + x.v + " " + Object.isFrozen(x) });
row("defineProperty(this, ..)", () => { const x = new Defined(); return x.hidden + " " + hide(x).lazy + " " + Object.keys(x).join() + " " + JSON.stringify(x) });
row("this.m = this.m.bind(this)", () => { const x = new Bound(); const g = x.get; return g() + " " + Object.keys(x).join() + " " + (x.get !== Bound.prototype.get) });
row("for..in into this", () => { const x = new Loop({ p: 1, q: "two" }); return Object.keys(x).join() + " " + x.p + " " + x.q });
row("setPrototypeOf(this, Class.prototype)", () => { const e = new SelfProto("m"); return e.name + " " + (e instanceof SelfProto) + " " + (e instanceof Error) + " " + e.message });
row("setPrototypeOf(this, new.target.prototype)", () => { class Kid extends NewTargetProto { } const e = new Kid("m"); return (e instanceof Kid) + " " + (e instanceof NewTargetProto) + " " + e.message });
row("delete this.tmp", () => { const x = new Deleter(); return Object.keys(x).join() + " " + ("tmp" in x) + " " + x.tmp });
row("statics", () => { new Counter(); const c = new Counter(); hide(Counter).made = 10; return c.id + " " + new Counter().id + " " + Object.keys(Counter).join() });
