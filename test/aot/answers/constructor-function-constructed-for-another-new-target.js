// answers: without-library
// # If `this` of P were an object of P's layout in every construction, the object that Reflect.construct() makes for Q, for a class below, or for a bound function would be stored into by P's slots.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 21 of 21 of 21
// # CHECK-NEXT: exited with 0
function P(a) { this.x = a; this.target = new.target === undefined ? "none" : new.target.name; }
P.prototype.who = function () { return "P" + this.x; };
function Q(a) { this.q = a; }
Q.prototype.who = function () { return "Q" + this.x + this.q; };
function who(value) { return value.who(); }
const mixed = Reflect.construct(P, [1], Q);
report(who(mixed));
report(mixed instanceof P);
report(mixed instanceof Q);
report(mixed.target);
report(Object.keys(mixed).join());
report(who(new P(2)));
report(who(new Q(3)));
report(new P(2).target);
const same = Reflect.construct(P, [4], P);
report(who(same));
report(same instanceof P);
const byDefault = Reflect.construct(P, [5]);
report(who(byDefault));
class D extends P { constructor() { super(6); this.d = 1; } }
report(who(new D()));
report(new D().target);
const viaClass = Reflect.construct(P, [7], D);
report(viaClass instanceof D);
report(viaClass.d);
report(who(viaClass));
const bound = Q.bind(null);
const viaBound = Reflect.construct(P, [8], bound);
report(viaBound instanceof Q);
report(typeof viaBound.who);
report(viaBound.x);
let total = 0;
for (let i = 0; i < 100; i++) total += Reflect.construct(P, [i], i & 1 ? Q : P).x;
report(total);
report("end");
