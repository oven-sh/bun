// answers: without-library
// # a loop calls a method of what is declared a Map. For an instance of a class below Map the look "as its class made it" fails at every turn: the closed call behind it asks a site of its own, and is not looked up anew
// # f3 = sweep
// # RUN(SWEPT): bytes f3:Body mechanisms=all-Inlining
// # SWEPT: CallMethodOfOneBuiltinClassAtSite.MapClear
// # LIBRARY: own
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const counts = new Map<string, number>();
function note(what: unknown): void { const key = String(what); counts.set(key, (counts.get(key) ?? 0) + 1); }
function say(): void { let line = ""; counts.forEach((times, key) => { line += key + "x" + times + " "; }); report(line); counts.clear(); }
class Tracked extends Map<string, number> { tag = "t"; }
class Loud extends Map<string, number> { clear(): void { note("loud"); super.clear(); } }
const first = new Tracked(); const last = new Tracked();
const all = new Set<Map<string, number>>([first, new Map(), new Loud(), last]);
function sweep(): void { for (const one of all) { one.set("a", 1); one.clear(); note(one.has("a")); } }
function phase(): void { for (let turn = 0; turn < 300; turn++) sweep(); say(); }
phase();
(Tracked.prototype as any).clear = function (this: Map<string, number>) { note("laid"); Map.prototype.clear.call(this); }; phase();
delete (Tracked.prototype as any).clear; phase();
const between = Object.create(Map.prototype, { clear: { configurable: true, value(this: Map<string, number>) { note("between"); Map.prototype.clear.call(this); } } });
Object.setPrototypeOf(Tracked.prototype, between); phase();
Object.setPrototypeOf(Tracked.prototype, Map.prototype); phase();
(first as any).clear = () => { note("own"); }; phase();
delete (first as any).clear; Object.setPrototypeOf(last, Loud.prototype); phase();
report("end");
