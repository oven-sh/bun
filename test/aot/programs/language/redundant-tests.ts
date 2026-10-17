// Tests whose answer an earlier test has given on some ways to them and not on others: a cast and a read of what may be undefined or null, conditions joined by && and ||, chains of tests of one set of flags, a boolean handed on through variables, the same test on both sides of a join, in loops and outside: every way is taken, with every kind of value.
declare const console: { log(...values: unknown[]): void };
class Base { constructor(public kind: number, public flags: number) {} }
class Leaf extends Base { constructor(public text: string) { super(0, 1); } }
class Pair extends Base { constructor(public left: Tree | undefined, public right: Tree | null) { super(1, 6); } }
class Wrap extends Base { constructor(public inner: Tree | undefined) { super(2, 12); } }
type Tree = Leaf | Pair | Wrap;
function isWrap(t: Tree | undefined | null): t is Wrap { return !!t && t.kind === 2; }
function unwrap(t: Tree | undefined): Tree | undefined { while (isWrap(t)) t = t.inner; return t; }
function textOf(t: Tree | undefined | null): string { if (!t) return t === null ? "null" : "undefined"; if (t instanceof Leaf) return t.text; if (t instanceof Pair) return "(" + textOf(t.left) + " " + textOf(t.right) + ")"; return "[" + textOf(t.inner) + "]"; }
function leftText(t: Tree | undefined): string { const p = t as Pair; return p.left ? textOf(p.left) : "none"; }
function flagsOf(f: number): string { let s = ""; if (f & 1) s += "a"; else if (f & 2) s += "b"; else if (f & 4) s += "c"; if (f & 2) s += "B"; if (f & 1 && f & 4) s += "x"; if (f & 1 || f & 8) s += "y"; if (!(f & 1) && !(f & 8)) s += "z"; return s; }
function constantFlags(which: number): string { const f = which === 0 ? 1 : which === 1 ? 6 : which === 2 ? 12 : 0; return flagsOf(f) + (f & 4 ? "+" : "-") + (f & 8 ? "+" : "-"); }
function handedOn(a: boolean, b: boolean, c: number): number { const first = a && b; const second = first || c > 2; const third = second ? first : !first; let n = 0; if (first) n += 1; if (second) n += 2; if (third) n += 4; if (first && third) n += 8; if (second !== third) n += 16; return n; }
function twice(t: Tree | undefined, n: number): number { let r = 0; if (t) r += 1; if (n > 1) r += 10; if (t) r += t.kind * 100; if (n > 1 && t) r += t.flags * 1000; return r; }
function inLoop(ts: (Tree | undefined)[]): number { let r = 0; for (const t of ts) { const known = t !== undefined; if (known) r += 1; if (t && t.kind === 1) r += 10; if (known && t.flags & 4) r += 100; if (!known) r += 1000; } return r; }
function optional(t: Tree | undefined | null): number { return (t?.kind ?? -1) + (t?.flags ?? -10) * 10 + (t ? 1000 : 0); }
function tell(name: string, f: () => unknown): void { let text: string; try { text = String(f()); } catch (e) { text = e instanceof Error ? e.name : "thrown"; } console.log(name + ": " + text); }
const leaf = new Leaf("l"), pair = new Pair(leaf, null), empty = new Pair(undefined, leaf), wrap = new Wrap(new Wrap(pair)), hollow = new Wrap(undefined);
const all: (Tree | undefined)[] = [leaf, pair, empty, wrap, hollow, undefined];
for (const t of all) {
  tell("text", () => textOf(t) + " " + textOf(unwrap(t)) + " " + isWrap(t) + " " + optional(t) + " " + twice(t, 0) + " " + twice(t, 2));
  tell("left", () => (t === undefined || t instanceof Pair ? leftText(t) : "-"));
}
tell("null", () => textOf(null) + " " + optional(null) + " " + isWrap(null));
for (let f = 0; f < 16; f++) console.log(f, flagsOf(f));
for (let w = 0; w < 4; w++) console.log(w, constantFlags(w));
for (const a of [false, true]) for (const b of [false, true]) for (const c of [0, 3]) console.log(a, b, c, handedOn(a, b, c));
console.log(inLoop(all), inLoop([]), inLoop([undefined, undefined]), inLoop([pair, pair, wrap]));
