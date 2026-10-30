#!/usr/bin/env python3
"""loose-holder-after-tightening.py <folder>: A written cast is also a cast between the types of the fields that the two have by one name: a Loose below the cast BECOMES a Strict where it is, at the typed read. THE LOOSE HOLDER STILL HAS THE OBJECT: what it deletes, clears or widens afterwards acts on a Strict. Does compiled code that leans on what Strict says (the length of a text, raw numbers, booleans, a cell that is never nil) still say what plain Bun says? One road a program, because types that rows share change what is laid out. """
import os, re, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
HEAD = '''declare const console: { log(...values: any[]): void };
export { };
function row(name: string, f: () => unknown): void { let said: string; try { said = String(f()); } catch (e) { said = (e as Error).name; } console.log(name + ": " + said); }
'''
TEXT = '''interface Strict { outfile: string; target?: string }
interface Loose { outfile?: string; target?: string }
interface Top { name: string; below: Strict }
const madeStrict: Strict = { outfile: "made" }; const madeTop: Top = { name: "made", below: madeStrict }; const madeLoose: Loose = { target: "made" };
function len(t: Top): number { return t.below.outfile.length; }
function glued(t: Top): string { return t.below.outfile + "!"; }
row("made", () => len(madeTop) + glued(madeTop) + madeLoose.target);
'''
NUM = '''interface Strict { size: number; tag?: string }
interface Loose { size?: number; tag?: string }
interface Top { name: string; below: Strict }
const madeStrict: Strict = { size: 1.5 }; const madeTop: Top = { name: "made", below: madeStrict }; const madeLoose: Loose = { tag: "made" };
function plus(t: Top): number { return t.below.size + 1; }
function twice(t: Top): number { let s = 0; for (let i = 0; i < 2; ++i) s += t.below.size * 2; return s; }
row("made", () => plus(madeTop) + twice(madeTop) + String(madeLoose.tag));
'''
R = {
'n01_a_text_deleted_then_its_length': TEXT + 'row("deleted", () => { const k: Loose = { outfile: "o" }; const t = { name: "n", below: k } as Top; const a = len(t); delete k.outfile; return a + ":" + len(t); });',
'n02_a_text_cleared_then_its_length': TEXT + 'row("cleared", () => { const k: Loose = { outfile: "o" }; const t = { name: "n", below: k } as Top; const a = len(t); k.outfile = undefined; return a + ":" + len(t); });',
'n03_a_text_deleted_then_glued': TEXT + 'row("deleted", () => { const k: Loose = { outfile: "o" }; const t = { name: "n", below: k } as Top; const a = glued(t); delete k.outfile; return a + ":" + glued(t); });',
'n04_a_text_cleared_then_glued': TEXT + 'row("cleared", () => { const k: Loose = { outfile: "o" }; const t = { name: "n", below: k } as Top; const a = glued(t); k.outfile = undefined; return a + ":" + glued(t); });',
'n05_a_number_deleted': NUM + 'row("deleted", () => { const k: Loose = { size: 2.5 }; const t = { name: "n", below: k } as Top; const a = plus(t); delete k.size; return a + ":" + plus(t) + ":" + twice(t) + ":" + Object.keys(k).join(); });',
'n06_a_number_cleared': NUM + 'row("cleared", () => { const k: Loose = { size: 2.5 }; const t = { name: "n", below: k } as Top; const a = plus(t); k.size = undefined; return a + ":" + plus(t) + ":" + twice(t) + ":" + Object.keys(k).join() + JSON.stringify(t); });',
'n07_a_number_changed_by_the_holder': NUM + 'row("changed", () => { const k: Loose = { size: 2.5 }; const t = { name: "n", below: k } as Top; const a = plus(t); k.size = 7; return a + ":" + plus(t) + ":" + k.size; });',
'n08_a_number_that_was_never_there': NUM + 'row("absent", () => { const k: Loose = { tag: "t" }; const t = { name: "n", below: k } as Top; return plus(t) + ":" + twice(t); });',
'n09_a_wrong_kind_through_any': TEXT + 'row("a number for a text", () => { const k: Loose = { outfile: "o" }; const t = { name: "n", below: k } as Top; const a = len(t); (k as any).outfile = 5; return a + ":" + len(t) + ":" + glued(t); });',
'n10_a_boolean': '''interface Strict { on: boolean } interface Loose { on?: boolean } interface Top { name: string; below: Strict }
const madeStrict: Strict = { on: true }; const madeTop: Top = { name: "made", below: madeStrict }; const madeLoose: Loose = { };
function says(t: Top): string { return (t.below.on ? "yes" : "no") + (t.below.on === false ? " false" : " not false"); }
row("made", () => says(madeTop) + String(madeLoose.on));
row("deleted", () => { const k: Loose = { on: true }; const t = { name: "n", below: k } as Top; const a = says(t); delete k.on; return a + ":" + says(t); });''',
'n11_a_cell': '''interface Strict { inner: { x: number } } interface Loose { inner?: { x: number } } interface Top { name: string; below: Strict }
const madeStrict: Strict = { inner: { x: 1 } }; const madeTop: Top = { name: "made", below: madeStrict }; const madeLoose: Loose = { };
function x(t: Top): number { return t.below.inner.x; }
row("made", () => x(madeTop) + String(madeLoose.inner));
row("deleted", () => { const k: Loose = { inner: { x: 2 } }; const t = { name: "n", below: k } as Top; const a = x(t); delete k.inner; return a + ":" + x(t); });
''',
'n12_two_levels_down': '''interface Strict { outfile: string } interface Loose { outfile?: string }
interface MidStrict { leaf: Strict } interface MidLoose { leaf: Loose } interface Top { name: string; mid: MidStrict }
const madeTop: Top = { name: "made", mid: { leaf: { outfile: "made" } } }; const madeLoose: MidLoose = { leaf: { } };
function len(t: Top): number { return t.mid.leaf.outfile.length; }
row("made", () => len(madeTop) + String(madeLoose.leaf.outfile));
row("deleted", () => { const k: Loose = { outfile: "o" }; const m: MidLoose = { leaf: k }; const t = { name: "n", mid: m } as Top; const a = len(t); delete k.outfile; return a + ":" + len(t); });''',
'n13_in_an_array': '''interface Strict { outfile: string } interface Loose { outfile?: string } interface Many { list: Strict[] }
const madeMany: Many = { list: [{ outfile: "made" }] }; const madeLoose: Loose = { };
function lens(m: Many): string { return m.list.map(c => c.outfile.length).join(); }
row("made", () => lens(madeMany) + String(madeLoose.outfile));
row("deleted", () => { const k: Loose = { outfile: "o" }; const m = { list: [k, { outfile: "pq" }] } as Many; const a = lens(m); delete k.outfile; return a + ":" + lens(m); });''',
'n14_the_holder_adds_a_member': TEXT + 'row("added", () => { const k: Loose = { outfile: "o" }; const t = { name: "n", below: k } as Top; const a = len(t); (k as any).extra = 1; k.target = "t"; return a + ":" + len(t) + Object.keys(k).join() + JSON.stringify(t); });',
'n15_frozen_ahead_of_the_read': TEXT + 'row("frozen", () => { const k: Loose = Object.freeze({ outfile: "o" }); const t = { name: "n", below: k } as Top; return len(t) + glued(t) + Object.isFrozen(k) + Object.isFrozen(t.below); });',
'n16_many_under_the_collector': TEXT + 'row("many", () => { let s = 0; const kept: Loose[] = []; for (let i = 0; i < 20000; ++i) { const k: Loose = { outfile: "o" + i }; const t = { name: "n", below: k } as Top; s += len(t); if (i % 3 === 0) { delete k.outfile; kept.push(k); } else if (i % 3 === 1) k.outfile = "longer" + i; try { s += len(t); } catch { s += 1000; } if (kept.length > 50) kept.length = 0; } return s; });',
'n17_another_loose_one_stays_loose': TEXT + 'row("beside", () => { const k: Loose = { outfile: "o" }; const other: Loose = { outfile: "p" }; const t = { name: "n", below: k } as Top; const a = len(t); delete other.outfile; other.target = "t"; return a + JSON.stringify(other) + JSON.stringify(k); });',
'n18_a_typed_store_seen_by_the_holder': TEXT + 'row("stored", () => { const k: Loose = { outfile: "o" }; const t = { name: "n", below: k } as Top; const a = len(t); t.below.outfile = "changed"; return a + ":" + k.outfile + (t.below === (k as unknown)); });',
'n19_a_union_in_the_field': '''interface Strict { outfile: string } interface Loose { outfile?: string } interface Top { name: string; below: Strict | boolean }
const madeTop: Top = { name: "made", below: { outfile: "made" } }; const madeLoose: Loose = { };
function len(t: Top): number { const b = t.below; return typeof b === "object" ? b.outfile.length : -1; }
row("made", () => len(madeTop) + String(madeLoose.outfile) + len({ name: "b", below: true }));
row("deleted", () => { const k: Loose = { outfile: "o" }; const t = { name: "n", below: k } as Top; const a = len(t); delete k.outfile; return a + ":" + len(t); });''',
'n20_a_generic_box': '''interface Strict { outfile: string } interface Loose { outfile?: string } interface Box<T> { held: T }
const madeBox: Box<Strict> = { held: { outfile: "made" } }; const madeLoose: Box<Loose> = { held: { } };
function len(b: Box<Strict>): number { return b.held.outfile.length; }
row("made", () => len(madeBox) + String(madeLoose.held.outfile));
row("deleted", () => { const k: Loose = { outfile: "o" }; const b = { held: k } as Box<Strict>; const a = len(b); delete k.outfile; return a + ":" + len(b); });''',
'n21_wider_below_the_cast': '''interface Strict { v: string } interface Loose { v: string | number } interface Top { name: string; below: Strict }
const madeTop: Top = { name: "made", below: { v: "made" } }; const madeLoose: Loose = { v: 1 };
function len(t: Top): number { return t.below.v.length; }
row("made", () => len(madeTop) + String(madeLoose.v));
row("a text, then a number", () => { const k: Loose = { v: "o" }; const t = { name: "n", below: k } as unknown as Top; const a = len(t); k.v = 5; return a + ":" + len(t); });''',
}
for f in os.listdir('.'):
    if re.match(r'^n\d\d_.*\.ts$', f): os.remove(f)
for k, v in R.items(): open(k + '.ts', 'w').write('// ' + k[4:].replace('_', ' ') + '\n' + HEAD + v + '\n')
print(len(R), 'programs')
