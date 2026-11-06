#!/usr/bin/env python3
"""registers-live-across-cold-branch.py <folder>: A rare arm that is one operation declares no register changed: it saves and restores what it changes. Two users: the text of `string | undefined | null`, and the opening of an iteration over an array that is no longer as it was made. Each with four loads of registers (nothing, eight integers, ten fractions, both and six cells alive ACROSS the place), in a function with a frame and in one without, the rare road taken and not taken, an exception out of the operation caught by a caller that has its own registers full: late.ts."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
INTS = 'let n0 = k + 1, n1 = k * 2, n2 = k + 3, n3 = k * 4, n4 = k + 5, n5 = k * 6, n6 = k + 7, n7 = k * 8;'
FRAC = 'let d0 = x + 0.5, d1 = x * 1.5, d2 = x - 2.5, d3 = x / 3, d4 = x + 4.25, d5 = x * 5.5, d6 = x - 6.5, d7 = x / 7, d8 = x + 8.125, d9 = x * 9.5;'
CELL = 'const c0 = "c" + k, c1 = [k], c2 = { k }, c3 = "d" + k, c4 = [k + 1], c5 = { k: k + 2 };'
SUMI = '(n0 + n1 + n2 + n3 + n4 + n5 + n6 + n7)'; SUMF = '(d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9).toFixed(4)'; SUMC = 'c0 + c1[0] + c2.k + c3 + c4[0] + c5.k'
P = [('bare', '', '""'), ('ints', INTS, SUMI), ('fracs', FRAC, SUMF), ('all', INTS + ' ' + FRAC + ' ' + CELL, SUMI + ' + "|" + ' + SUMF + ' + "|" + ' + SUMC)]
G = 'if (depth > 0) { depth--; %s; } '
out = ['declare const console: { log(...values: any[]): void };', 'export { };', 'let depth = 0; let notes = 0; function note(): void { ++notes; }', 'type Nilly = string | undefined | null;', 'class Mine<T> extends Array<T> { }']
names_t, names_i = [], []
for p, decl, total in P:
    for form, expr in (('plus', '"" + s'), ('template', '`${s}`'), ('call', 'String(s)'), ('concat3', '"<" + s + ">"'), ('two', '"" + s + t')):
        n = 'text_%s_%s' % (form, p); names_t.append(n)
        out.append('function %s(s: Nilly, t: Nilly, k: number, x: number): string { %s%s const r = %s; return r + "/" + %s; }' % (n, G % ('%s(s, t, k, x)' % n), decl, expr, total))
    n = 'iter_%s' % p; names_i.append(n)
    out.append('function %s(a: number[], k: number, x: number): string { %s%s let s = 0; for (const v of a) s += v; return s + "/" + %s; }' % (n, G % ('%s(a, k, x)' % n), decl, total))
    n = 'iters_%s' % p; names_i.append(n)
    out.append('function %s(a: number[], k: number, x: number): string { %s%s let s = 0; for (const v of a) s += v; note(); for (const v of a) s -= v * 2; return s + "/" + %s; }' % (n, G % ('%s(a, k, x)' % n), decl, total))
    n = 'spread_%s' % p; names_i.append(n)
    out.append('function %s(a: number[], k: number, x: number): string { %s%s const [first, second] = a; return String(first) + second + "/" + %s; }' % (n, G % ('%s(a, k, x)' % n), decl, total))
# without a frame: no call, no guard: reached through a table so that it is not inlined
out.append('function leafPlus(s: Nilly): string { return "" + s; }'); out.append('function leafTemplate(s: Nilly): string { return `${s}`; }')
out.append('const leaves: ((s: Nilly) => string)[] = [leafPlus, leafTemplate];')
out.append('function catcher(a: number[], k: number, x: number, which: number): string { %s %s %s let r = ""; try { r = ITERS[which]!(a, k, x); } catch (e) { r = "caught " + (e as Error).message; } return r + "#" + %s + "|" + %s + "|" + %s; }' % (INTS, FRAC, CELL, SUMI, SUMF, SUMC))
out.append('const ITERS: ((a: number[], k: number, x: number) => string)[] = [%s];' % ', '.join(names_i))
out.append('const TEXTS: ((s: Nilly, t: Nilly, k: number, x: number) => string)[] = [%s];' % ', '.join(names_t))
out.append('''function arrays(): [string, number[]][] {
  const heir = [1, 2, 3]; Object.setPrototypeOf(heir, { __proto__: Array.prototype });
  const getter = [1, 2, 3]; Object.defineProperty(getter, "1", { get() { return 20; }, enumerable: true, configurable: true });
  const sparse = [1]; sparse[9] = 5; const far = [1]; far[100000] = 2; far.length = 3;
  const own = [1, 2, 3]; Object.defineProperty(own, Symbol.iterator, { value: function* () { yield 7; yield 8; }, configurable: true });
  const thrower = [1, 2, 3]; Object.defineProperty(thrower, Symbol.iterator, { value() { throw new Error("no iterator"); }, configurable: true });
  const late = [1, 2, 3]; Object.defineProperty(late, Symbol.iterator, { value() { let n = 0; return { next() { if (++n > 2) throw new Error("next throws"); return { done: false, value: n }; } }; }, configurable: true });
  return [["plain", [1, 2, 3]], ["fractions", [1.5, 2.5]], ["empty", []], ["holes", [1, , 3] as number[]], ["frozen", Object.freeze([4, 5]) as number[]], ["subclass", Mine.from([1, 2, 3])], ["heir", heir], ["getter", getter], ["sparse", sparse], ["far", far], ["own iterator", own], ["thrower", thrower], ["next throws", late]];
}''')
out.append('const given: any = (globalThis as any).arguments; const rounds: number = given && given.length ? +given[0] : 2;')
out.append('for (let r = 0; r < rounds; ++r) {')
out.append('  for (let i = 0; i < TEXTS.length; ++i) console.log("text", i, ([["a", "b"], [undefined, "b"], [null, undefined], ["", null], [undefined, undefined], ["long" + r, "er" + r]] as [Nilly, Nilly][]).map(([s, t]) => TEXTS[i]!(s, t, r * 3 + i, r + i / 4)).join(" ; "));')
out.append('  console.log("leaves", (["a", undefined, null, ""] as Nilly[]).map(s => leaves[0]!(s) + leaves[1]!(s)).join());')
out.append('  for (const [name, a] of arrays()) for (let i = 0; i < ITERS.length; ++i) console.log("iter", name, i, catcher(a, r * 5 + i, r + i / 8, i));')
out.append('}')
out.append('console.log("notes", notes);')
open('late.ts', 'w').write('\n'.join(out) + '\n')
print(len(names_t), 'texts,', len(names_i), 'iterations')
