#!/usr/bin/env python3
"""registers-live-across-only-cold-branch.py <folder>: What is alive across the rare arm and across nothing else: born behind the last call ahead of it, summed ahead of the next call behind it, so that the allocator may lay it into the registers that the arm changes: late2.ts."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
out = ['declare const console: { log(...values: any[]): void };', 'export { };', 'let depth = 0;', 'type Nilly = string | undefined | null;', 'class Mine<T> extends Array<T> { }']
G = 'if (depth > 0) { depth--; %s; } '
names, iters = [], []
for n in (4, 8, 12, 16, 20):
    ints = ' '.join('const n%d = (k + %d) ^ (j * %d);' % (i, i + 1, i + 3) for i in range(n)); isum = ' ^ '.join('(n%d + %d)' % (i, i) for i in range(n))
    fr = ' '.join('const d%d = x * %d.5 + y / %d;' % (i, i + 1, i + 2) for i in range(n)); fsum = ' + '.join('d%d * %d' % (i, i + 1) for i in range(n))
    for form, expr in (('template', '`${s}`'), ('plus', '"" + s')):
        f = 'ints%d_%s' % (n, form); names.append(f); out.append('function %s(s: Nilly, k: number, j: number, x: number, y: number): string { %s%s const r = %s; const total = %s; return r + total; }' % (f, G % ('%s(s, k, j, x, y)' % f), ints, expr, isum))
        f = 'fracs%d_%s' % (n, form); names.append(f); out.append('function %s(s: Nilly, k: number, j: number, x: number, y: number): string { %s%s const r = %s; const total = %s; return r + total.toFixed(3); }' % (f, G % ('%s(s, k, j, x, y)' % f), fr, expr, fsum))
        f = 'both%d_%s' % (n, form); names.append(f); out.append('function %s(s: Nilly, k: number, j: number, x: number, y: number): string { %s%s %s const r = %s; const total = %s; const sum = %s; return r + total + "," + sum.toFixed(3); }' % (f, G % ('%s(s, k, j, x, y)' % f), ints, fr, expr, isum, fsum))
    f = 'open%d' % n; iters.append(f); out.append('function %s(a: number[], k: number, j: number, x: number, y: number): string { %s%s %s let t = 0; for (const v of a) { t += v; } const total = %s; const sum = %s; return t + "," + total + "," + sum.toFixed(3); }' % (f, G % ('%s(a, k, j, x, y)' % f), ints, fr, isum, fsum))
out.append('const TEXTS: ((s: Nilly, k: number, j: number, x: number, y: number) => string)[] = [%s];' % ', '.join(names))
out.append('const OPENS: ((a: number[], k: number, j: number, x: number, y: number) => string)[] = [%s];' % ', '.join(iters))
out.append('const heir = [1, 2, 3]; Object.setPrototypeOf(heir, { __proto__: Array.prototype }); const sparse = [1]; sparse[9] = 5; const own = [1, 2, 3]; Object.defineProperty(own, Symbol.iterator, { value: function* () { yield 7; yield 8; }, configurable: true }); const thrower = [1, 2]; Object.defineProperty(thrower, Symbol.iterator, { value() { throw new Error("no iterator"); }, configurable: true });')
out.append('for (let r = 0; r < 3; ++r) { for (let i = 0; i < TEXTS.length; ++i) console.log("text", i, (["a", undefined, null, "", "long" + r] as Nilly[]).map(s => TEXTS[i]!(s, r * 7 + i, i + 2, r + 0.25, i + 1.5)).join(" ; "));')
out.append('  for (let i = 0; i < OPENS.length; ++i) for (const a of [[1, 2, 3], [1.5], [], Mine.from([4, 5]), heir, sparse, own, thrower]) { let said: string; try { said = OPENS[i]!(a, r * 7 + i, i + 2, r + 0.25, i + 1.5); } catch (e) { said = "caught " + (e as Error).message.slice(0, 20); } console.log("open", i, said); } }')
open('late2.ts', 'w').write('\n'.join(out) + '\n'); print(len(names), len(iters))
