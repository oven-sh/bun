// answers: without-library
// # If what Object.create() makes for `prototype` counted as linked from the start, the object made in front of the store would find the methods of the level above. Below null no lookup comes to Object.prototype, and a map of descriptors may lay an accessor.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 25 of 25 of 25
// # CHECK-NEXT: exited with 0
function Base(a) { this.a = a; }
Base.prototype.first = function () { return this.a; };
Base.prototype.name = function () { return "base"; };
function Below(a, b) { Base.call(this, a); this.b = b; }
const early = new Below(1, 2);
function first(o) { return o.first === undefined ? "none" : o.first(); }
function who(o) { return o.constructor === Below ? "Below" : o.constructor === Base ? "Base" : "other"; }
report(first(early));
report(who(early));
Below.prototype = Object.create(Base.prototype);
const between = new Below(3, 4);
report(who(between));
Below.prototype.constructor = Below;
Below.prototype.second = function () { return this.b + this.first(); };
Below.prototype.name = function () { return "below"; };
const late = new Below(5, 6);
report(first(early));
report(first(late));
report(who(early));
report(who(between));
report(who(late));
report(late.second());
report(between.second());
report(late.name() + new Base(0).name());
report(early instanceof Base);
report(late instanceof Base);
report(late instanceof Below);
report(Object.getPrototypeOf(Below.prototype) === Base.prototype);
let total = 0;
for (let i = 0; i < 300; i++) { const item = new Below(i, 2); total += item.second() + item.a; }
report(total);
function Bare() { this.x = 1; }
Bare.prototype = Object.create(null);
const bare = new Bare();
report(bare.x);
report(bare.toString === undefined);
report(bare.constructor === undefined);
function Described() { this.d = 2; }
Described.prototype = Object.create(Base.prototype, { twice: { get: function () { return this.d * 2; } } });
report(new Described().twice);
report(new Described().first());
function Cut() { this.c = 1; }
Object.setPrototypeOf(Cut.prototype, null);
function text(o) { return o.toString === undefined ? "no toString" : typeof o.toString; }
report(text(new Cut()));
report(text(new Base(1)));
report(new Cut().hasOwnProperty === undefined);
report("end");
