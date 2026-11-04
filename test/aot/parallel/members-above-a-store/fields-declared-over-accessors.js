let log = "";
function show(o) { return Object.keys(o).join() + "|" + JSON.stringify(o) + "|" + log; }
function attempt(run) { log = ""; try { return show(run()); } catch (e) { return (e instanceof TypeError ? "TypeError" : "other " + e) + "|" + log; } }
class Setter { set x(v) { log += " set x=" + v; } get x() { return -1; } }
class Getter { get x() { return -2; } }
class FieldThenDeleted extends Setter { x; y = 1; constructor() { super(); delete this.x; this.x = 5; } }
class FieldThenDeletedBelowGetter extends Getter { x; y = 1; constructor() { super(); delete this.x; this.x = 6; } }
class FieldKept extends Setter { x; y = 1; constructor() { super(); this.x = 7; } }
class DeletedByCallee extends Setter { x = 0; y = 1; constructor(hook) { super(); hook(this); this.x = 8; this.y = 9; } }
class TwoLevels extends FieldKept { constructor() { super(); delete this.x; this.x = 10; } }
function Old() { this.y = 1; this.x = 11; }
Old.prototype = Object.create(Setter.prototype);
function OldBelowClass() { this.y = 1; this.x = 12; }
Object.setPrototypeOf(OldBelowClass.prototype, Setter.prototype);
function OldBelowGetter() { this.y = 1; this.x = 13; }
Object.setPrototypeOf(OldBelowGetter.prototype, Getter.prototype);
const literalBelow = v => { const o = { __proto__: Setter.prototype, y: 1 }; o.x = v; return o; };
const createdBelow = v => { const o = Object.create(Setter.prototype); o.y = 1; o.x = v; return o; };
const movedBelow = v => { const o = { y: 1 }; Object.setPrototypeOf(o, Setter.prototype); o.x = v; return o; };
for (let i = 0; i < 40; i++) { new FieldThenDeleted(); new FieldKept(); new DeletedByCallee(() => { }); new TwoLevels(); new Old(); new OldBelowClass(); literalBelow(i); createdBelow(i); movedBelow(i); }
console.log(attempt(() => new FieldThenDeleted()), attempt(() => new FieldThenDeletedBelowGetter()), attempt(() => new FieldKept()), attempt(() => new TwoLevels()));
console.log(attempt(() => new DeletedByCallee(() => { })), attempt(() => new DeletedByCallee(o => { delete o.x; })), attempt(() => new DeletedByCallee(o => { delete o.x; delete o.y; })));
console.log(attempt(() => new Old()), attempt(() => new OldBelowClass()), attempt(() => new OldBelowGetter()), attempt(() => literalBelow(1)), attempt(() => createdBelow(2)), attempt(() => movedBelow(3)));
