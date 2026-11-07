// a name that has a slot though the layout does not list it is deleted and added again, which moves it behind the other keys, and is refused by an object that is frozen, sealed or not extensible as any other new property is
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
function Thing(this: any, n: number) { this.n = n; }
class K { n: number; constructor(n: number) { this.n = n; } }
const show = (o: any) => Object.keys(o).join(",") + " " + JSON.stringify(o);
function run(o: any, turn: number) { o.p = turn; o.q = "q"; o.r = turn + 1; report(show(o) + o.p + o.q + o.r); delete o.q; report(show(o) + String(o.q) + ("q" in o) + Object.prototype.hasOwnProperty.call(o, "q")); o.q = "again"; report(show(o) + o.q + ("q" in o)); delete o.p; delete o.r; delete o.n; report(show(o) + String(o.p) + String(o.r) + String(o.n)); o.n = 1; o.r = 2; o.p = 3; report(show(o) + (o.p + o.r + o.n)); delete o.nothing; report(show(o)); }
for (let turn = 0; turn < 3; turn++) { run(new (Thing as any)(turn), turn); run(new K(turn), turn); run({ n: turn }, turn); }
class D { z = 1; }
function cycle(d: D, turn: number) { const o = d as any; o.t = turn; let s = String(o.t); delete o.t; s += "," + String(o.t) + "," + ("t" in o); o.u = 1; o.t = turn + 1; s += "," + o.t; let keys = ""; for (const k in o) keys += k; return s + "," + keys; }
report(cycle(new D(), 1) + cycle(new D(), 2));
function typed(turn: number) { const t: any = new D(); t.late = turn; let total = 0; for (let i = 0; i < 5; i++) { total += t.late === undefined ? 1000 : t.late; if (i === 2) delete t.late; if (i === 3) t.late = 7; } return total; }
for (let turn = 0; turn < 5; turn++) report(typed(turn));
function store(o: any, v: any) { "use strict"; try { o.late = v; return "stored"; } catch (e: any) { return e.constructor.name; } }
function storeOther(o: any, v: any) { "use strict"; try { o.other = v; return "stored"; } catch (e: any) { return e.constructor.name; } }
function remove(o: any) { "use strict"; try { return delete o.late; } catch (e: any) { return e.constructor.name; } }
const makers = [(n: number) => new (Thing as any)(n), (n: number) => new K(n), (n: number) => ({ n })];
for (let turn = 0; turn < 18; turn++) { const o = makers[turn % 3](turn); if (turn % 2 === 0) o.late = "early"; const how = Math.floor(turn / 6); if (how === 0) Object.freeze(o); else if (how === 1) Object.seal(o); else Object.preventExtensions(o); report([show(o), store(o, turn), o.late, storeOther(o, 1), o.other, remove(o), show(o), Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o), "late" in o].join(" ")); }
class Z { z = 1; }
function frozen(z: Z, freeze: boolean) { "use strict"; const o = z as any; if (freeze) Object.freeze(o); try { o.w = 5; } catch (e) { return "threw " + String(o.w); } return "stored " + o.w; }
report(frozen(new Z(), false) + frozen(new Z(), true) + frozen(new Z(), false));
report("end");
