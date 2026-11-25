// answers: without-library
// # A for-in over an empty list takes the enumerator of what lists nothing, once a list of its Structure under its chain of prototypes is known to have no names; it no longer gathers the names of the whole chain at every opening.
// # It hears of every change all the same: a member, a name on the list, a key laid above it and taken away again (on a plain object between the list and Array.prototype, on the prototype of a class below Array), a field of such a class, another prototype. A list of holes is not an empty list.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 19 of 19 of 19
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function names(l: any): string { let s = ""; for (let i = 0; i < 2; i++) for (const k in l) s += k + ";"; return s; }
function all(lists: any[]): string { let s = ""; for (let i = 0; i < lists.length; i++) s += names(lists[i]) + ","; return s; }
const a: any[] = [], b: any[] = [1]; b.pop(); const c: any[] = [1.5]; c.length = 0; const d: any[] = ["x"]; d.shift();
report(all([a, b, c, d, new Array(3), [,]]));
report(names([1]) + names([]) + names([, 1]));
a.push(5); report(names(a)); a.length = 0; report(names(a));
(b as any).extra = 1; report(names(b)); delete (b as any).extra; report(names(b));
const between: any = Object.create(Array.prototype), under: any[] = []; Object.setPrototypeOf(under, between);
report(names(under) + names(under)); between.laid = 1; report(names(under) + names([])); delete between.laid; report(names(under) + names(under));
const filled: any[] = [7]; Object.setPrototypeOf(filled, between); report(names(filled)); filled.pop(); report(names(filled)); between.again = 1; report(names(filled) + names(under)); delete between.again; report(names(filled));
class Bare extends Array {}
const bare = new Bare(); report(names(bare) + names(new Bare())); (Bare.prototype as any).laid = 1; report(names(bare) + names(new Bare()) + names([])); delete (Bare.prototype as any).laid; report(names(bare) + names(new Bare()));
class L extends Array { own = 1; }
report(names(new L()));
const p: any[] = []; names(p); Object.setPrototypeOf(p, { up: 1, __proto__: Array.prototype }); report(names(p) + names([]));
report("end");
