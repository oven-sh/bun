// answers: without-library
// # A for-in over `{}`, over an instance of a class without fields, or over an object whose keys were all deleted lists nothing. All of them share one enumerator, which belongs to no Structure; it is published like any other, so that an opening does not go to the run time.
// # It hears of every change all the same: a key of its own, a key laid above it and taken away again, another prototype, a hidden and a shown key, a key laid while the loop runs.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 21 of 21 of 21
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function names(o: any): string { let s = ""; for (const k in o) s += k + ";"; return s; }
function twice(o: any): string { return names(o) + "|" + names(o); }
function all(list: any[]): string { let s = ""; for (let i = 0; i < list.length; i++) s += twice(list[i]) + ","; return s; }
class Empty {}
class Heir extends Empty { x = 1; }
class Lazy { set(k: string, v: unknown): this { (this as any)[k] = v; return this; } }
const plain = {}, e = new Empty(), l = new Lazy().set("a", 1);
report(twice(plain)); (plain as any).late = 1; report(twice(plain)); delete (plain as any).late; report(twice(plain));
report(twice(e)); (Empty.prototype as any).up = 1; report(twice(e)); report(twice(new Heir())); delete (Empty.prototype as any).up; report(twice(e));
delete (l as any).a; report(twice(l)); (Lazy.prototype as any).above = 1; report(twice(l)); delete (Lazy.prototype as any).above; report(twice(l)); l.set("b", 2); report(twice(l)); delete (l as any).b; report(twice(l));
const p = {}; names(p); names(p); Object.setPrototypeOf(p, { inherited: 1 }); report(twice(p));
const parent: any = {}, child = Object.create(parent); report(twice(child)); parent.given = 1; report(twice(child)); delete parent.given; report(twice(child));
const h = {}; names(h); Object.defineProperty(h, "hidden", { value: 1, enumerable: false }); report(twice(h)); Object.defineProperty(h, "shown", { value: 1, enumerable: true }); report(twice(h));
let grown = ""; const g: any = {}; for (const k in g) grown += k; for (const k in (g.a = 1, g)) { grown += k; g.b = 2; } report(grown);
report(all([{}, [], "", null, undefined, 5, () => 1, Object.create(null), Object.freeze({})]));
report("end");
