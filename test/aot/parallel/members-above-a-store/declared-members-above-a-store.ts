// Does a store that creates a property see a member that a class DECLARES above the object?
let log = "";
function show(o: object): string { return Object.keys(o).join() + "|" + JSON.stringify(o) + "|" + log; }
function attempt(run: () => object): string { log = ""; try { return show(run()); } catch (e) { return (e instanceof TypeError ? "TypeError" : "other " + e) + "|" + log; } }

class BaseWithSetter { set x(v: number) { log += " set x=" + v; } get x(): number { return -1; } }
class BelowSetter extends BaseWithSetter { y: number; constructor() { super(); this.y = 1; (this as any).x = 2; } }
class TwoBelowSetter extends BelowSetter { z: number; constructor() { super(); this.z = 3; (this as any).x = 4; } }
class OwnSetter { y = 1; set x(v: number) { log += " own class set x=" + v; } constructor() { (this as any).x = 5; } }
class OnlyGetter { get x(): number { return 7; } }
class BelowGetter extends OnlyGetter { y = 1; constructor() { super(); (this as any).x = 6; } }
class WithMethod { x() { return 1; } }
class BelowMethod extends WithMethod { y = 1; constructor() { super(); (this as any).x = 8; } }
class WithStatic { static set x(v: number) { log += " static set x=" + v; } y = 1; constructor() { (this as any).x = 9; } }
class Computed { set ["x"](v: number) { log += " computed set x=" + v; } }
class BelowComputed extends Computed { y = 1; constructor() { super(); (this as any).x = 10; } }
class Plain { y = 1; }
interface Plain { x?: number }
class BelowSetterPlain extends BaseWithSetter { y = 1; }
class BelowGetterPlain extends OnlyGetter { y = 1; }

function storeX(o: { x?: number }, v: number) { o.x = v; return o; }
function storeOnBelowSetter(o: BelowSetterPlain, v: number) { o.x = v; return o; }
function storeOnBelowGetter(o: BelowGetterPlain, v: number) { (o as any).x = v; return o; }
function storeOnPlain(o: Plain, v: number) { o.x = v; return o; }
function storeInLoop(o: BelowSetterPlain, n: number) { for (let i = 0; i < n; i++) o.x = i; return o; }
function storeOnPlainInLoop(o: Plain, n: number) { for (let i = 0; i < n; i++) o.x = i; return o; }
function makeAndStore(v: number) { const o = new BelowSetterPlain(); o.x = v; return o; }
function makePlainAndStore(v: number) { const o = new Plain(); o.x = v; return o; }

function OldBase(this: any) { this.y = 1; }
Object.defineProperty(OldBase.prototype, "x", { set(v) { log += " old set x=" + v; }, configurable: true });
function OldStores(this: any) { this.y = 1; this.x = 11; }
OldStores.prototype = Object.create(OldBase.prototype);
function OldOwn(this: any) { this.y = 1; this.x = 12; }
Object.defineProperty(OldOwn.prototype, "x", { set(v) { log += " old own set x=" + v; }, configurable: true });
function OldFixed(this: any) { this.y = 1; this.x = 13; }
Object.defineProperty(OldFixed.prototype, "x", { value: 0, writable: false, configurable: true });
function OldLater(this: any) { this.y = 1; this.x = 14; }

for (let i = 0; i < 40; i++) { new BelowSetter(); new TwoBelowSetter(); new OwnSetter(); new BelowMethod(); new WithStatic(); new BelowComputed(); storeX(new Plain(), i); storeOnBelowSetter(new BelowSetterPlain(), i); storeOnPlain(new Plain(), i); storeInLoop(new BelowSetterPlain(), 2); storeOnPlainInLoop(new Plain(), 2); makeAndStore(i); makePlainAndStore(i); new (OldStores as any)(); new (OldOwn as any)(); new (OldLater as any)(); }
console.log(attempt(() => new BelowSetter()), attempt(() => new TwoBelowSetter()), attempt(() => new OwnSetter()));
console.log(attempt(() => new BelowGetter()), attempt(() => new BelowMethod()), attempt(() => new WithStatic()), attempt(() => new BelowComputed()));
console.log(attempt(() => storeX(new BelowSetterPlain(), 1)), attempt(() => storeX(new Plain(), 1)), attempt(() => storeX(new BelowGetterPlain() as any, 1)));
console.log(attempt(() => storeOnBelowSetter(new BelowSetterPlain(), 2)), attempt(() => storeOnBelowGetter(new BelowGetterPlain(), 2)), attempt(() => storeOnPlain(new Plain(), 2)));
console.log(attempt(() => storeInLoop(new BelowSetterPlain(), 3)), attempt(() => storeOnPlainInLoop(new Plain(), 3)), attempt(() => makeAndStore(4)), attempt(() => makePlainAndStore(4)));
console.log(attempt(() => new (OldStores as any)()), attempt(() => new (OldOwn as any)()), attempt(() => new (OldFixed as any)()), attempt(() => new (OldLater as any)()));
Object.defineProperty(OldLater.prototype, "x", { set(v) { log += " later set x=" + v; }, configurable: true });
Object.defineProperty(Plain.prototype, "x", { set(v) { log += " plain later set x=" + v; }, configurable: true });
console.log(attempt(() => new (OldLater as any)()), attempt(() => storeOnPlain(new Plain(), 5)), attempt(() => storeOnPlainInLoop(new Plain(), 2)), attempt(() => makePlainAndStore(5)), attempt(() => storeX(new Plain(), 5)));
