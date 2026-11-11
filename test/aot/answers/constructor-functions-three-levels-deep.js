// answers: without-library
// # Object.create(), Object.setPrototypeOf() and a class below: each level lays its methods by statements, calls the level above on `this`, hides a method and a value of the level above, and is changed afterwards.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 12 of 12 of 12
// # CHECK-NEXT: exited with 0
function Base(a) { this.a = a; this.tag = "base"; }
Base.prototype.describe = function () { return "Base(" + this.a + ")"; };
Base.prototype.kind = function () { return "base"; };
Base.prototype.shared = 1;
function Mid(a, b) { Base.call(this, a); this.b = b; this.tag = "mid"; }
Mid.prototype = Object.create(Base.prototype);
Mid.prototype.constructor = Mid;
Mid.prototype.describe = function () { return "Mid(" + Base.prototype.describe.call(this) + "," + this.b + ")"; };
function Low(a, b, c) { Mid.call(this, a, b); this.c = c; }
Object.setPrototypeOf(Low.prototype, Mid.prototype);
Low.prototype.describe = function () { return "Low(" + Mid.prototype.describe.call(this) + "," + this.c + ")"; };
Low.prototype.kind = function () { return "low"; };
function show(value) { return value.describe() + value.kind() + value.tag + value.shared + Object.keys(value).join(); }
report(show(new Base(1)));
report(show(new Mid(1, 2)));
report(show(new Low(1, 2, 3)));
const all = [new Base(4), new Mid(5, 6), new Low(7, 8, 9)];
let text = "";
for (let turn = 0; turn < 40; turn++) for (const value of all) text = show(value) + text.length;
report(text);
report(new Low(1, 2, 3) instanceof Base);
report(new Low(1, 2, 3).constructor === Low);
report(new Mid(1, 2).constructor === Mid);
Base.prototype.kind = function () { return "changed"; };
report(show(new Mid(1, 2)));
report(show(new Low(1, 2, 3)));
Mid.prototype.shared = 2;
report(new Base(0).shared + new Mid(0, 0).shared * 10 + new Low(0, 0, 0).shared * 100);
class Lowest extends Low { constructor() { super(1, 2, 3); this.d = 4; } kind() { return "lowest" + super.kind(); } }
report(show(new Lowest()));
report("end");
