// What a place was stored is what a read of it yields: a field of an object that came from elsewhere, read back by name.
// IR= 0 setLinks GetById v[0-9]+ "links"
// IR= 1 next GetField
// IR= 0 bumpModule GetModuleVariable
// IR= 0 acrossBlocks GetById v[0-9]+ "flags"
// IR= 1 onOneWay GetById v[0-9]+ "flags"
declare const console: any;
interface Links { checkFlags: number }
interface Sym { flags: number; links: Links | undefined }
function setLinks(s: Sym, f: number): number { s.links = { checkFlags: 0 }; s.links.checkFlags = f; return s.links.checkFlags; }
function counter() { let count = 0; function next(): number { count++; return count; } return next; }
let total = 0;
function bumpModule(by: number): number { total = by + 1; return total + total; }
function acrossBlocks(s: Sym, f: number): number { s.flags = f; let x = 0; if (f & 1) x = 1; else x = 2; return s.flags + x; }
function onOneWay(s: Sym, f: number): number { if (f & 1) s.flags = f; return s.flags; }
const next = counter();
const syms: Sym[] = []; for (let i = 0; i < 16; i++) syms.push({ flags: i, links: undefined });
let s = 0;
for (let i = 0; i < 3_000_000; i++) { const sym = syms[i & 15]; s += setLinks(sym, i & 7) + next() + bumpModule(i & 3) + acrossBlocks(sym, i & 31) + onOneWay(sym, i & 15); }
// Called once outside any loop too: top-level code that runs once takes nothing in, so the function keeps a body for the expectations to look at.
s += setLinks(syms[0], 1) + bumpModule(1) + acrossBlocks(syms[1], 3) + onOneWay(syms[2], 5);
console.log(s, total, JSON.stringify(syms[3]));
export {};
