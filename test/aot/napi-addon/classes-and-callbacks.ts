// A class that the addon defines, classes of the program that extend it, typed functions that the addon calls, members of every kind read by the addon, finalizers.
import type { Addon } from "./counter";
const loaded = { exports: {} as Addon }; process.dlopen(loaded, process.env.ADDON!); const addon: Addon = loaded.exports;
class Named extends addon.Counter { label: string; hits = 0; constructor(label: string, start: number) { super(start); this.label = label; } bump() { this.hits++; return this.label + this.increment(2); } }
class Twice extends Named { override bump() { return super.bump() + super.bump(); } }
interface Kinds { when: Date; bytes: Buffer; big: bigint; text: string; whole: number; half: number; handle: unknown; none: null; missing?: string }
function kinds(): Kinds { return { when: new Date(5), bytes: Buffer.from([7, 8]), big: 12n, text: "héllo", whole: 3, half: 2.5, handle: addon.makeExternal(), none: null }; }
function plusOne(n: number): number { return n + 1; } function shout(s: string): string { return s.toUpperCase(); }
interface Result { id: number; name: string }
let at = 0;
function row(label: string, f: () => unknown) { at++; let said: string; try { said = JSON.stringify(f(), (_, x) => (typeof x === "bigint" ? x + "n" : typeof x === "symbol" ? String(x) : x)); } catch (e) { said = "THROWN " + (e as Error).constructor.name + ": " + String((e as Error).message).replace(/ \(bun compile[^)]*\)/, "").replace(/\n */g, " ~ "); } console.log(String(at).padStart(3) + " " + label + ": " + said); }
// A row that stores what the declared type does not allow: one call; what the call said | what the object looks like afterwards | what an object that nobody touched looks like.
function typeRow<T>(label: string, make: () => T, change: (o: T) => unknown, look: (o: T) => unknown) {
  at++; const o = make(); const told = (f: () => unknown) => { try { return JSON.stringify(f()); } catch (e) { return JSON.stringify("threw " + String((e as Error).message).replace(/ \(bun compile[^)]*\)/, "").replace(/\n */g, " ~ ")); } };
  console.log(String(at).padStart(3) + " TYPE " + label + ": " + told(() => change(o)) + " | after: " + told(() => look(o)) + " | untouched: " + told(() => look(make())));
}
row("the addon's class", () => { const c = new addon.Counter(5); return [c.increment(), c.increment(3), c.value, (c.value = 1), c.value, addon.unwrap(c), c instanceof addon.Counter, addon.instanceOf(c, addon.Counter), addon.names(c), addon.typeOf(c)]; });
row("its prototype and statics", () => [addon.allNames(addon.Counter.prototype, 1, 16, 0), typeof addon.Counter.made(), addon.Counter.name, addon.typeOf(addon.Counter)]);
row("a class of the program that extends it", () => { const n = new Named("n", 10); return [n.bump(), n.hits, n.value, n.label, addon.unwrap(n), addon.names(n), n instanceof Named, addon.instanceOf(n, addon.Counter), addon.instanceOf(n, Named)]; });
row("one more level", () => { const t = new Twice("t", 0); return [t.bump(), t.hits, t.value, addon.names(t)]; });
row("constructed by the addon", () => { const n = addon.construct(Named, "c", 1) as Named; return [n.bump(), n.label, n instanceof Named]; });
row("its members set by the addon", () => { const n = new Named("n", 1); return [addon.callMethod(n, "bump", 0), addon.callMethod(n, "increment", 5), n.hits]; });
for (const name of ["when", "bytes", "big", "text", "whole", "half", "handle", "none", "missing"]) row("valueAt " + name, () => addon.valueAt(kinds(), name));
row("a typed function called by the addon", () => [addon.call(undefined, plusOne, 1), addon.call(undefined, shout, "s")]);
row("an arrow that closes over a typed record", () => { const k = kinds(); return addon.call(undefined, (n: number) => n + k.whole, 1); });
row("a result object of the program's, filled by the addon", () => { const r: Result = { id: 0, name: "" }; const back = addon.fill(r); return [back === r, r.id, r.name]; });
typeRow("a typed function called with another kind", () => plusOne, f => addon.call(undefined, f, "s"), f => f(1));
row("finalizers of typed records run", () => { const before = addon.finalizedSoFar(); for (let i = 0; i < 2000; i++) addon.addFinalizer(kinds()); Bun.gc(true); Bun.gc(true); return addon.finalizedSoFar() - before > 0; });
export {};
