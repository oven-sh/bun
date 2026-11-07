// answers: with-library
// # The body of a constructor function creates what it stores on this in the order in which the stores are written, whatever happens to the object between two rows of them.
// # At the end the shell runs the same text itself: every answer is the same.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 34 of 34 of 34
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const kFirst = Symbol("first");
const kSecond = Symbol("second");
function Base(this: any) { this.base1 = 1; this.base2 = 2; }
Base.prototype.kind = function () { return "base"; };
function touch(o: any, how: number) { if (how === 1) o.extra = "e"; if (how === 2) delete o.a; if (how === 3) Object.freeze(o); if (how === 4) o.c = "early"; if (how === 5) Object.defineProperty(o, "d", { get() { return "got"; }, set(v) { o.seen = v; }, enumerable: true, configurable: true }); if (how === 6) o[kSecond] = "early"; if (how === 7) Object.preventExtensions(o); return how; }
function Made(this: any, how: number, path: number): any { this.a = 1; this[kFirst] = "f"; this.b = 2; touch(this, how); this.c = 3; this[kSecond] = "s"; this.d = 4; if (path === 1) { this.e = 5; Base.call(this); return; } this.f = path === 2 ? 6 : undefined; touch(this, 0); Base.call(this); this.g = 7; }
Made.prototype = Object.create(Base.prototype);
const show = (o: any) => [Object.keys(o).join(), Reflect.ownKeys(o).map(String).join(), JSON.stringify(o), Object.isFrozen(o), Object.isExtensible(o)].join("|");
function make(how: number, path: number) { try { return show(new (Made as any)(how, path)); } catch (e: any) { return e.name; } }
function makeOn(target: any, how: number, path: number) { try { Made.call(target, how, path); return show(target); } catch (e: any) { return e.name + "|" + show(target); } }
for (let how = 0; how < 8; how++) { for (let path = 0; path < 3; path++) report(make(how, path)); }
report(makeOn({}, 0, 0));
report(makeOn({ d: "own", a: "own" }, 0, 1));
report(makeOn(new (Made as any)(0, 1), 0, 2));
report(makeOn(new (Base as any)(), 0, 0));
report(makeOn(Object.create(Made.prototype), 4, 2));
report(makeOn([], 0, 1));
Object.defineProperty(Made.prototype, "c", { set(v) { (this as any).viaSetter = v; }, configurable: true });
report(make(0, 0));
report(make(1, 1));
Object.defineProperty(Base.prototype, "g", { value: "fixed", writable: false, configurable: true });
report(make(0, 2));
report("end");
