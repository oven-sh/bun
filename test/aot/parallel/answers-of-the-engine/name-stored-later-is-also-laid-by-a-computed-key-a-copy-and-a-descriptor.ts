// the same name comes to the object by name, under a computed key, by Object.assign, by Reflect and by a descriptor: as an accessor, hidden from enumeration, read only. Whoever reads or stores by name afterwards finds what the descriptor laid
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
function Rec(this: any, n: number) { this.n = n; }
class C { n: number; constructor(n: number) { this.n = n; } }
const show = (o: any) => { let f = ""; for (const k in o) f += k + ","; return Object.keys(o).join(",") + "|" + f + "|" + JSON.stringify(o) + "|" + Object.getOwnPropertyNames(o).join(","); };
const names = ["late", "other", "n", "third"];
function byKey(o: any, turn: number) { o[names[turn % names.length]] = turn; return o; }
function byName(o: any, turn: number) { o.late = "name" + turn; return o; }
const make = (turn: number) => turn & 8 ? new C(turn) : new (Rec as any)(turn);
for (let turn = 0; turn < 16; turn++) { const a = byKey(make(turn), turn); report(show(a) + String(a.late) + String(a.other) + String(a.third) + a.n); const b = byName(byKey(make(turn), turn), turn); report(show(b) + b.late); const c = byKey(byName(make(turn), turn), turn); report(show(c) + c.late); }
function assigned(turn: number) { const o = make(turn); if (turn & 1) o.late = 1; Object.assign(o, turn & 2 ? { other: "o", late: "assigned" } : { third: 3 }); if (turn & 4) o.late = "stored"; return o; }
for (let turn = 0; turn < 16; turn++) { const o = assigned(turn); report(show(o) + String(o.late) + String(o.other) + String(o.third)); }
for (let turn = 0; turn < 4; turn++) { const o = make(turn * 4); Reflect.set(o, "late", turn); report(show(o) + o.late + Reflect.has(o, "late") + Reflect.ownKeys(o).join(",")); Reflect.deleteProperty(o, "late"); report(show(o) + String(o.late) + Reflect.has(o, "late")); Reflect.defineProperty(o, "late", { value: 5, writable: true, enumerable: true, configurable: true }); o.other = 1; report(show(o) + o.late); }
function store(o: any, v: any) { "use strict"; try { o.late = v; return "stored"; } catch (e: any) { return e.constructor.name; } }
function read(o: any) { return o.late; }
let log = "";
for (let turn = 0; turn < 24; turn++) { const o = make(turn); if (turn % 2) o.first = "f"; switch (turn % 6) { case 0: Object.defineProperty(o, "late", { get() { log += "get" + this.n; return 10 + this.n; }, set(v) { log += "set" + v; }, enumerable: true, configurable: true }); break; case 1: Object.defineProperty(o, "late", { value: "hidden", enumerable: false, writable: true, configurable: true }); break; case 2: Object.defineProperty(o, "late", { value: "fixed", enumerable: true, writable: false, configurable: true }); break; case 3: o.late = "plain"; Object.defineProperty(o, "late", { get() { return "getter over " + this.n; }, configurable: true }); break; case 4: o.late = "plain"; Object.defineProperty(o, "late", { enumerable: false }); break; case 5: Object.defineProperty(o, "late", { value: 1, enumerable: true, writable: true, configurable: true }); break; } o.last = "l"; report([show(o), read(o), store(o, "new" + turn), read(o), JSON.stringify(Object.getOwnPropertyDescriptor(o, "late")), log].join(" ")); log = ""; }
report("end");
