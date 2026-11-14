// answers: without-library
// # If every field that the constructor stores counted as filled for whoever has the object, code that is handed `this` halfway (a call, a variable, a closure, a list) would read empty slots, and a freeze, an accessor or a deletion in the constructor would be missed.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
const seen = [];
function look(value) { seen.push(String(value.a) + String(value.b) + Object.keys(value).join()); return value; }
function P() { this.a = 1; look(this); this.b = 2; look(this); }
new P();
report(seen.join(";"));
let kept;
function Q() { kept = this; this.a = 1; fill(); this.c = this.b + 1; }
function fill() { kept.b = 10; }
const q = new Q();
report(String(q.a) + q.b + q.c + Object.keys(q).join());
function R() { this.self = this; this.get = () => this.v; this.v = 5; }
const r = new R();
report(r.self === r);
report(r.get());
function S(registry) { registry.push(this); this.id = registry.length; }
const registry = [];
for (let i = 0; i < 50; i++) new S(registry);
let total = 0;
for (const s of registry) total += s.id;
report(total);
function T() { Object.freeze(this); try { this.a = 1; } catch (error) { this.b = 2; } }
let frozenThrew = "no";
try { new T(); } catch (error) { frozenThrew = error instanceof TypeError; }
report(frozenThrew);
function U() { this.a = 1; Object.defineProperty(this, "b", { get() { return this.a + 1; }, enumerable: true }); this.a = 5; }
report(new U().b);
function V() { this.a = 1; delete this.a; this.c = 3; }
report(String(new V().a) + Object.keys(new V()).join());
report("end");
