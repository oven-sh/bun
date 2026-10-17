// `o.f = v; .. o.f ..`: cases where the value read is not simply the value stored (calls in between, aliases, deleted, redefined or frozen properties).
declare const console: any;
const log: any[] = [];
interface Links { check: number; other?: number }
interface Sym { flags: number; name?: string }
interface TransientSym extends Sym { links: Links; count: number; label?: string }
let seen: TransientSym | undefined;
function touch(s: TransientSym) { s.links = { check: 99 }; s.count = -1; }
function make(): TransientSym { return { flags: 1, links: { check: 0 }, count: 0, label: undefined }; }
// A call in between stores to it.
{ const s = make(); s.links = { check: 1 }; touch(s); log.push(s.links.check, s.count); }
// It has escaped, and what runs in between is not known.
{ const s = make(); seen = s; s.count = 5; (() => { seen!.count = 6; })(); log.push(s.count); }
// A second store to the same field, and a store to another one.
{ const s = make(); s.count = 1; s.flags = 2; s.count = 3; log.push(s.count, s.flags); }
// Two objects of one layout.
{ const a = make(); const b = make(); a.count = 1; b.count = 2; log.push(a.count, b.count); }
// Deleted, redefined, frozen in between.
{ const s: any = make(); s.label = "x"; delete s.label; log.push(s.label, "label" in s); }
{ const s = make(); s.count = 1; Object.defineProperty(s, "count", { value: 7, writable: true, enumerable: true, configurable: true }); log.push(s.count); }
{ const s = make(); s.count = 1; Object.freeze(s); try { s.count = 2; } catch (e) { log.push("frozen"); } log.push(s.count); }
// Numbers are read back unchanged.
{ const s = make(); s.count = -0; log.push(Object.is(s.count, -0)); s.count = NaN; log.push(s.count); s.count = 2 ** 40; log.push(s.count); s.count = 1.5; log.push(s.count); }
// The same object is read back: identity.
{ const s = make(); const l: Links = { check: 4 }; s.links = l; log.push(s.links === l); s.links.check = 8; log.push(l.check, s.links.check); }
// Through a view in which a member lacks the field, as in createSymbol.
function create(flags: number): TransientSym {
    const s = { flags } as Sym as TransientSym;
    s.links = { check: 0 };
    s.links.check = flags + 1;
    s.count = flags; s.label = undefined;
    return s;
}
log.push(JSON.stringify(create(3)), Object.keys(create(4)).join());
// In a loop: the store of one iteration, the read of the next.
{ const s = make(); let sum = 0; for (let i = 0; i < 4; i++) { sum += s.count; s.count = i; } log.push(sum, s.count); }
// On two ways.
function branch(c: boolean) { const s = make(); if (c) s.count = 1; else s.count = 2; return s.count; }
log.push(branch(true), branch(false));
// In a handler's sight.
function guarded() { const s = make(); try { s.count = 3; return s.count; } finally { log.push("finally"); } }
log.push(guarded());
// An accessor on the `prototype` of the function that makes the object: a store by its name runs the setter, which stores to ANOTHER field; a read by its name runs the getter.
interface Celsius { degrees: number; fahrenheit: number }
function Celsius(this: Celsius, f: number) { this.degrees = 0; this.fahrenheit = f; }
Object.defineProperty(Celsius.prototype, "fahrenheit", {
    get(this: Celsius) { return this.degrees * 9 / 5 + 32 + 1; },
    set(this: Celsius, f: number) { this.degrees = (f - 32) * 5 / 9; },
});
type CelsiusConstructor = new (f: number) => Celsius;
function boil() { const c = new (Celsius as unknown as CelsiusConstructor)(212); return c.degrees + " " + c.fahrenheit + " " + Object.keys(c).join(); }
function storeAndRead() { const c = new (Celsius as unknown as CelsiusConstructor)(32); c.fahrenheit = 50; const read = c.fahrenheit; return read + " " + c.degrees; }
function storeAcross() { const c = new (Celsius as unknown as CelsiusConstructor)(32); c.degrees = 7; c.fahrenheit = 212; return c.degrees; }
log.push(boil(), storeAndRead(), storeAcross());
console.log(log.join("\n"));
export {};
