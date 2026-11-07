// `o.m()` where the written type names a class: who is called depends on the object's own class, on how the object was made, on what the callee does to its own name meanwhile, and the method is read in front of the arguments.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function attempt(run) { try { return String(run()); } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; } }
class Shape { area() { return 0; } name() { return "shape"; } describe() { return this.name() + ":" + this.area(); } }
class Square extends Shape { side; constructor(side) { super(); this.side = side; } area() { return this.side * this.side; } name() { return "square"; } }
class Circle extends Shape { r; constructor(r) { super(); this.r = r; } area() { return 3 * this.r * this.r; } }
class Unit extends Square { unit = true; constructor() { super(1); } }
class Odd extends Square { odd = true; area() { return -1; } describe() { return "odd " + super.describe(); } }
function area(s) { return s.area(); }
function areaOfSquare(s) { return s.area(); }
function nameOfCircle(c) { let s = ""; for (let r = 0;r < 1; r++) s += c.name(); return s; }
function describe(s) { return s.describe(); }
function describeSquare(s) { let t = ""; for (let r = 0;r < 1; r++) t += s.describe() + "/" + s.name() + "/" + s.area(); return t; }
function unsettle(o, on) { if (on) { Object.setPrototypeOf(o, null); o.area = 1; o.name = 1; o.describe = 1; } }
const shapes = [new Shape, new Square(2), new Circle(1), new Unit, new Odd(3)];
for (let i = 0;i < shapes.length; i++) { const s = shapes[i]; unsettle(s, false); report(area(s)); report(describe(s)); }
const squares = [new Square(2), new Unit, new Odd(3)];
for (let i = 0;i < squares.length; i++) { const s = squares[i]; unsettle(s, false); report(areaOfSquare(s)); report(describeSquare(s)); }
report(nameOfCircle(new Circle(2)));
const strangers = [Object.create(Square.prototype), { area() { return 42; }, name() { return "literal"; }, describe() { return "d"; } }, Object.create(null), Reflect.construct(Square, [4], Circle), Reflect.construct(Square, [5], Odd), Reflect.construct(Shape, [], Square), Reflect.construct(Square, [6], function() {}), null, undefined, 5, "text"];
for (let i = 0;i < strangers.length; i++) { const s = strangers[i]; report(attempt(() => area(s))); report(attempt(() => areaOfSquare(s))); report(attempt(() => describe(s))); report(attempt(() => describeSquare(s))); }
class Stepper { n = 0; step(i) { this.n++; if (i === 1) Stepper.prototype.step = function(i) { this.n += 10; return "new" + i; }; return "old" + i; } }
function steps(o) { let s = ""; for (let i = 0;i < 4; i++) s += o.step(i) + ","; return s + o.n; }
class RowStepper { n = 0; step(i) { this.n++; if (i === 1) RowStepper.prototype.step = function(i) { this.n += 10; return "new" + i; }; return "old" + i; } }
function stepsInARow(o) { let s = ""; for (let r = 0;r < 1; r++) s += o.step(0) + o.step(1) + o.step(2) + o.step(3); return s + o.n; }
class OwnStepper { n = 0; step(i) { this.n++; if (i === 1) this.step = (i) => "own" + i; return "old" + i; } }
function ownSteps(o) { let s = ""; for (let r = 0;r < 1; r++) s += o.step(0) + o.step(1) + o.step(2) + o.step(3); return s + o.n; }
class Leaver { n = 0; step(i) { this.n++; if (i === 1) Object.setPrototypeOf(this, { step: (i) => "left" + i }); return "old" + i; } }
function leaves(o) { let s = ""; for (let i = 0;i < 4; i++) s += o.step(i) + ","; return s + o.n; }
report(steps(new Stepper));
report(steps(new Stepper));
report(stepsInARow(new RowStepper));
report(stepsInARow(new RowStepper));
report(ownSteps(new OwnStepper));
report(ownSteps(new OwnStepper));
report(leaves(new Leaver));
report(leaves(new Leaver));
class Late { m(x) { return "old(" + x + ")"; } }
function replaceLate() { Late.prototype.m = (x) => "new(" + x + ")"; return "argument"; }
function argumentReplaces(o) { let s = ""; for (let r = 0;r < 1; r++) s += o.m(replaceLate()) + o.m("after"); return s; }
class LateOwn { m(x) { return "old(" + x + ")"; } }
function hide(o) { o.m = (x) => "own(" + x + ")"; return "argument"; }
function argumentHides(o) { let s = ""; for (let r = 0;r < 1; r++) s += o.m(hide(o)) + o.m("after"); return s; }
class LateLink { m(x) { return "old(" + x + ")"; } }
function relink(o) { Object.setPrototypeOf(o, { m: (x) => "linked(" + x + ")" }); return "argument"; }
function argumentRelinks(o) { let s = ""; for (let r = 0;r < 1; r++) s += o.m(relink(o)) + o.m("after"); return s; }
report(argumentReplaces(new Late));
report(argumentReplaces(new Late));
report(argumentHides(new LateOwn));
report(argumentHides(new LateOwn));
report(argumentRelinks(new LateLink));
report(argumentRelinks(new LateLink));
report("end");
