// `new` on a function value, in the cases where allocating the object at the call site would be observable.
declare const console: any;
const log: any[] = [];
interface P { x: number; y?: number }
function Returns(this: P, x: number): any { this.x = x; return { other: x }; }
function ReturnsNumber(this: P, x: number): any { this.x = x; return 5; }
function Reprototyped(this: P, x: number) { this.x = x; }
function Throws(this: P, x: number) { this.x = x; if (x > 1) throw new Error("no " + x); }
function WrongArgument(this: P, x: number) { this.x = x; }
const Target = class { t: any; constructor() { this.t = new.target === Target ? "itself" : "another"; } };
const SubTarget = class extends Target {};
const Base = class { a = 1; constructor(public b: number) { log.push("base " + b); } };
const Derived = class extends Base { c = 3; constructor() { super(2); log.push("derived"); } };
let only: any;
const ReturnsObject = class { v = 1; constructor() { if (only) return only; only = this; } };
let Reassigned: any = class { k = "first"; };
const Rest = class { n: number; constructor(...all: number[]) { this.n = all.length; } };
const arrow: any = () => 1;
const Static = class { static count = 0; id: number; constructor() { this.id = ++Static.count; } };
function make(C: any, ...args: any[]) { return new C(...args); }
for (let round = 0; round < 3; round++) {
    log.push(JSON.stringify(new (Returns as any)(round)), JSON.stringify(new (ReturnsNumber as any)(round)));
    const r = new (Reprototyped as any)(round);
    log.push(Object.getPrototypeOf(r) === Reprototyped.prototype, (r as any).hello);
    (Reprototyped as any).prototype = { hello: "round " + round };
    try { log.push(JSON.stringify(new (Throws as any)(round))); } catch (e: any) { log.push(e.message); }
    log.push(new Target().t, new SubTarget().t, (Reflect.construct(Target, []) as any).t);
    const d = new Derived(); log.push(JSON.stringify(d), d instanceof Base, Object.keys(d).join());
    log.push(new ReturnsObject() === new ReturnsObject(), new Reassigned().k, new Rest(1, 2, 3).n, new Static().id);
    Reassigned = class { k = "round " + round; };
    try { new arrow(); } catch (e: any) { log.push(e instanceof TypeError); }
    try { (Target as any)(); } catch (e: any) { log.push(e instanceof TypeError); }
    log.push(JSON.stringify(make(Base, 9)), JSON.stringify(make(ReturnsNumber, 8)));
}
// Before the declaration.
function early() { return new Later().z; }
try { log.push(early()); } catch (e: any) { log.push(e instanceof ReferenceError); }
const Later = class { z = 1; };
log.push(early());
// In a handler's sight, and with an argument of another type than is declared.
try { new (Throws as any)(7); } catch (e: any) { log.push("caught " + e.message); } finally { log.push("finally"); }
// The compiled program throws, by the rule for annotated parameters. Plain Bun does not. Either way it goes on.
try { new (WrongArgument as any)("text"); } catch (e: any) { if (!(e instanceof TypeError)) log.push("not a TypeError"); }
log.push("after the wrong argument");
console.log(log.join("\n"));
export {};
