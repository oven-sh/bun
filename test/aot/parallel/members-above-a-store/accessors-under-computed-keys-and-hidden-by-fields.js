let log = "";
function show(o) { return Object.keys(o).join() + "|" + JSON.stringify(o) + "|" + log; }
function attempt(run) { log = ""; try { return show(run()); } catch (e) { return (e instanceof TypeError ? "TypeError" : "other " + e) + "|" + log; } }
const k = String.fromCharCode(120), m = ["z"].join("");

class ComputedSetter { set [k](v) { log += " computed set x=" + v; } }
class BelowComputedSetter extends ComputedSetter { constructor() { super(); this.y = 1; this.x = 2; } }
class OwnComputedSetter { set [k](v) { log += " own computed set x=" + v; } constructor() { this.y = 1; this.x = 3; } }
class ComputedGetter { get [k]() { return 7; } }
class BelowComputedGetter extends ComputedGetter { constructor() { super(); this.y = 1; this.x = 4; } }
class TwoBelowComputed extends BelowComputedSetter { constructor() { super(); this.w = 1; this.x = 5; } }
class ComputedStatic { static set [k](v) { log += " static"; } constructor() { this.y = 1; this.x = 6; } }
class ComputedOther { set [m](v) { log += " computed set z=" + v; } constructor() { this.y = 1; this.x = 7; this.z = 8; } }
class PlainBelowComputed extends ComputedSetter { constructor() { super(); this.y = 1; } }
function storeX(o, v) { o.x = v; return o; }
function storeOnPlainBelow(v) { const o = new PlainBelowComputed(); o.x = v; return o; }
function storeInLoop(n) { const o = new PlainBelowComputed(); for (let i = 0; i < n; i++) o.x = i; return o; }

class Setter { set x(v) { log += " set x=" + v; } get x() { return -1; } }
class FieldOverSetter extends Setter { x = 1; y = 2; }
class DefinedOverSetter extends Setter { constructor() { super(); this.y = 2; Object.defineProperty(this, "x", { value: 1, writable: true, enumerable: true, configurable: true }); } }
function overwrite(o, v) { o.x = v; return o; }
function deleteAndStore(o, v) { delete o.x; o.x = v; return o; }
function deleteElsewhere(o) { delete o.x; }
function storeAfter(o, v) { deleteElsewhere(o); o.x = v; o.y = v; return o; }
function storeFieldOver(v) { const o = new FieldOverSetter(); o.x = v; delete o.x; o.x = v + 1; return o; }

for (let i = 0; i < 40; i++) { new BelowComputedSetter(); new OwnComputedSetter(); new TwoBelowComputed(); new ComputedStatic(); new ComputedOther(); storeX(new PlainBelowComputed(), i); storeOnPlainBelow(i); storeInLoop(2); overwrite(new FieldOverSetter(), i); overwrite(new DefinedOverSetter(), i); deleteAndStore(new FieldOverSetter(), i); storeAfter(new FieldOverSetter(), i); storeFieldOver(i); }
console.log(attempt(() => new BelowComputedSetter()), attempt(() => new OwnComputedSetter()), attempt(() => new BelowComputedGetter()), attempt(() => new TwoBelowComputed()));
console.log(attempt(() => new ComputedStatic()), attempt(() => new ComputedOther()), attempt(() => storeX(new PlainBelowComputed(), 1)), attempt(() => storeOnPlainBelow(2)), attempt(() => storeInLoop(3)));
console.log(attempt(() => overwrite(new FieldOverSetter(), 5)), attempt(() => overwrite(new DefinedOverSetter(), 5)), attempt(() => deleteAndStore(new FieldOverSetter(), 6)), attempt(() => deleteAndStore(new DefinedOverSetter(), 6)));
console.log(attempt(() => storeAfter(new FieldOverSetter(), 7)), attempt(() => storeAfter(new DefinedOverSetter(), 7)), attempt(() => storeFieldOver(8)));
