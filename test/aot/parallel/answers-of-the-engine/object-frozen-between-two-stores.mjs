// What a look at the cell of an object has shown ends where a callee, a getter or a conversion may have frozen it, closed it or redefined a property, between two stores and between two turns of a loop.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Point { x; y; label; constructor(x, y) { this.x = x; this.y = y; } }
function attempt(run) { try { return run(); } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; } }
function state(p) { return Object.keys(p).join() + (Object.isFrozen(p) ? " frozen " : " ") + p.x + " " + p.y + " " + p.label; }
const hooks = [(o) => {}, (o) => { Object.freeze(o); }, (o) => { Object.seal(o); }, (o) => { Object.preventExtensions(o); }, (o) => { Object.defineProperty(o, "y", { writable: false }); }, (o) => { Object.defineProperty(o, "y", { get() { return -1; }, set(v) {}, configurable: true }); }, (o) => { delete o.y; }, (o) => { delete o.y; Object.preventExtensions(o); }];
function aroundCall(p, hook) { p.x = 10; hook(p); p.y = 20; return p.x + p.y; }
function sameField(p, hook) { p.x = 10; hook(p); p.x = 11; return p.x; }
function added(p, hook) { p.x = 10; hook(p); p.label = "late"; return p.label; }
function inLoop(p, hook, at) { let sum = 0; for (let i = 0;i < 6; i++) { p.x = i; if (i === at) hook(p); p.y = i * 2; sum = sum * 3 + p.x + p.y; } return sum; }
function caught(p, hook, at) { let refused = 0; for (let i = 0;i < 6; i++) { try { p.x = i; if (i === at) hook(p); p.y = i * 2; } catch { refused++; } } return refused; }
class Trigger { target = undefined; hook = hooks[0]; get value() { if (this.target) this.hook(this.target); return 5; } valueOf() { if (this.target) this.hook(this.target); return 6; } }
function aroundGetter(p, t) { p.x = 1; const v = t.value; p.y = v; return p.x + p.y; }
function getterInStore(p, t) { p.x = 1; p.y = t.value; p.x = 2; return p.x + p.y; }
function aroundConversion(p, t) { p.x = 1; p.y = +t; p.x = 2; return p.x + p.y; }
function otherName(p, q) { p.x = 1; Object.freeze(q); p.x = 2; return p.x; }
function madeAndFrozen() { const p = new Point(1, 2); Object.freeze(p); p.x = 5; return p.x; }
function literalFrozen() { const o = { first: 1, second: 2 }; Object.freeze(o); o.first = 3; return o.first; }
function literalSealed() { const o = { first: 1 }; Object.seal(o); o.first = 3; o.note = "n"; return o.first; }
function maybeFrozen(freezes) { const p = new Point(1, 2); if (freezes) Object.freeze(p); p.x = 9; return p.x; }
function frozenInLoop(at) { const p = new Point(0, 0); for (let i = 0;i < 5; i++) { p.x = i; if (i === at) Object.freeze(p); } return p.x; }
function readOnlyInSight() { const p = new Point(1, 2); Object.defineProperty(p, "x", { writable: false }); p.y = 3; p.x = 4; return p.x; }
const idle = new Trigger;
for (let i = 0;i < 40; i++) { const p = new Point(i, i); aroundCall(p, hooks[0]); sameField(p, hooks[0]); added(new Point(1, 2), hooks[0]); inLoop(p, hooks[0], 2); caught(p, hooks[0], 2); aroundGetter(p, idle); getterInStore(p, idle); aroundConversion(p, idle); maybeFrozen(false); frozenInLoop(9); }
for (let h = 0;h < hooks.length; h++) { const hook = hooks[h]; let p = new Point(1, 2); report(attempt(() => aroundCall(p, hook))); report(state(p)); p = new Point(1, 2); report(attempt(() => sameField(p, hook))); report(state(p)); p = new Point(1, 2); report(attempt(() => added(p, hook))); report(state(p)); for (let at = 0;at < 6; at += 2) { p = new Point(1, 2); report(attempt(() => inLoop(p, hook, at))); report(state(p)); p = new Point(1, 2); report(attempt(() => caught(p, hook, at))); report(state(p)); } const t = new Trigger; t.hook = hook; t.target = p = new Point(1, 2); report(attempt(() => aroundGetter(p, t))); report(state(p)); t.target = p = new Point(1, 2); report(attempt(() => getterInStore(p, t))); report(state(p)); t.target = p = new Point(1, 2); report(attempt(() => aroundConversion(p, t))); report(state(p)); }
const one = new Point(1, 2);
report(attempt(() => otherName(one, new Point(3, 4))));
report(attempt(() => otherName(one, one)));
report(state(one));
report(attempt(madeAndFrozen));
report(attempt(literalFrozen));
report(attempt(literalSealed));
report(attempt(() => maybeFrozen(false)));
report(attempt(() => maybeFrozen(true)));
report(attempt(() => frozenInLoop(9)));
report(attempt(() => frozenInLoop(2)));
report(attempt(() => frozenInLoop(4)));
report(attempt(readOnlyInSight));
report("end");
