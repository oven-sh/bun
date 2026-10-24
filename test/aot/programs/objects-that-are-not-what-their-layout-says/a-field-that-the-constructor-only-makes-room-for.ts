// A constructor function makes room for a name that its own type does not have: `(this as any).links = undefined`. A narrower interface declares the name, and typed code stores and reads through it.
// Whatever else is stored under the name, by whatever road, is read back as plain JavaScript reads it.
declare const console: { log(...values: unknown[]): void };
const lines: string[] = [];
function say(label: string, value: unknown) { lines.push(label + ": " + JSON.stringify(value, (_, v) => v === undefined ? "#undefined" : typeof v === "function" ? "#function" : v)); }

class Links { constructor(public check: number, public target: Sym | undefined) {} }
class OtherLinks { constructor(public check: string) {} }
interface Sym { flags: number; name: string }
interface TransientSym extends Sym { links: Links; depth: number; label: string }
const Sym = function (this: Sym, flags: number, name: string) {
  this.flags = flags; this.name = name;
  (this as any).links = undefined; (this as any).depth = undefined; (this as any).label = undefined; (this as any).spare = undefined;
} as unknown as new (flags: number, name: string) => Sym;

function checkOf(sym: Sym): number { return sym.flags & 1 ? (sym as TransientSym).links.check : 0; }
function targetName(sym: Sym): string { const links = (sym as TransientSym).links; return links && links.target ? links.target.name : "none"; }
function depthOf(sym: Sym): number { return (sym as TransientSym).depth ?? -1; }
function labelOf(sym: Sym): string { return (sym as TransientSym).label ?? "no label"; }
function make(flags: number, name: string): Sym { const sym = new Sym(flags, name); if (flags & 1) (sym as TransientSym).links = new Links(flags * 2, undefined); return sym; }
function show(sym: Sym) { let check: unknown; try { check = checkOf(sym); } catch (error) { check = (error as Error).constructor.name; } let target: unknown; try { target = targetName(sym); } catch (error) { target = (error as Error).constructor.name; } return [check, target, depthOf(sym), labelOf(sym), Object.keys(sym).join()]; }

const all: Sym[] = [];
for (let i = 0; i < 400; i++) { const sym = make(i & 3, "s" + i); if (i % 5 === 0) (sym as TransientSym).depth = i; if (i % 7 === 0) (sym as TransientSym).label = "l" + i; if (i & 1 && i > 2) (sym as TransientSym).links.target = all[i - 2]; all.push(sym); }
function tally() { let t = 0; for (const sym of all) t += checkOf(sym) + targetName(sym).length + depthOf(sym) + labelOf(sym).length; return t; }
for (let round = 0; round < 60; round++) tally();
say("tally", tally());
say("some", [0, 1, 3, 5, 7, 35, 399].map(i => show(all[i])));

const put = (object: any, key: string, value: unknown) => { object[key] = value; };
const key = (index: number) => ["links", "depth", "label", "spare"][index];
{ const a = make(1, "a"); put(a, key(0), new OtherLinks("other")); say("links of another class", show(a)); }
{ const a = make(1, "a"); put(a, key(0), { check: 7, target: all[3] }); say("links that are a literal", show(a)); }
{ const a = make(1, "a"); put(a, key(0), 12); say("links that are a number", show(a)); }
{ const a = make(1, "a"); put(a, key(0), "text"); say("links that are a string", show(a)); }
{ const a = make(1, "a"); put(a, key(0), null); say("links that are null", show(a)); }
{ const a = make(1, "a"); put(a, key(0), undefined); say("links that are undefined again", show(a)); (a as TransientSym).links = new Links(5, all[1]); say("and filled again", show(a)); }
{ const a = make(1, "a"); delete (a as any)[key(0)]; say("links deleted", show(a)); (a as TransientSym).links = new Links(6, undefined); say("and stored again", show(a)); }
{ const a = make(1, "a"); Object.defineProperty(a, key(0), { get() { return new Links(9, all[2]); }, configurable: true, enumerable: true }); say("links behind a getter", show(a)); }
{ const a = make(0, "a"); put(a, key(1), "deep"); put(a, key(2), 4); put(a, key(3), all[0]); say("a string for the number, a number for the string", show(a)); }
{ const a = make(0, "a"); put(a, key(1), 1.5); say("a fraction", show(a)); put(a, key(1), 2 ** 40); say("a large number", show(a)); }
{ const a = make(2, "a"); say("never stored", [show(a), "links" in a, (a as any).links, (a as any).spare]); }
{ const frozen = Object.freeze(make(1, "f")); try { (frozen as TransientSym).links = new Links(1, undefined); } catch (error) { say("frozen", (error as Error).constructor.name); } say("frozen, read", show(frozen)); }
say("the others are as they were", tally());
console.log(lines.join("\n"));
