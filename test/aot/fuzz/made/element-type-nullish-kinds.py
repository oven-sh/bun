#!/usr/bin/env python3
"""element-type-nullish-kinds.py <folder>: Four kinds of elements, four declarations (T, T or undefined, T or null, both), and what the array really holds (undefined, null, a hole, nothing beyond its end). One program for each kind and declaration. What is read is USED AS ITS TYPE and asked `=== null` and `=== undefined`: a nil that the type does not admit must be refused, or those questions are folded wrongly."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
KINDS = [('flag', 'boolean', 'true', 'false'), ('text', 'string', '"a" + one', '"b" + one'), ('rec', 'Rec', 'new Rec(1)', 'new Rec(2)'), ('sym', 'symbol', 'S1', 'S2')]
DECLS = [('bare', '%s'), ('undef', '%s | undefined'), ('null', '%s | null'), ('both', '%s | undefined | null')]
for k, t, v0, v1 in KINDS:
    for d, form in DECLS:
        E = form % t
        out = ['declare const console: { log(...values: any[]): void };', 'export { };', 'class Rec { constructor(public n: number) { } }', 'const S1 = Symbol("s1"), S2 = Symbol("s2"); let one = 1; let depth = 0;',
         'function plain(v: unknown): string { return v === undefined ? "undefined" : v === null ? "null" : v instanceof Rec ? "Rec" + v.n : typeof v + ":" + String(v); }',
         'function use(v: %s): string { if (depth > 0) { depth--; use(v); } return plain(v) + (v === null ? " isnull" : "") + (v === undefined ? " isundefined" : "") + (v == null ? " nil" : "") + (v ? " truthy" : " falsy"); }' % E,
         'function loop(a: (%s)[]): string { let s = ""; for (let i = 0; i < a.length + 1; ++i) { const v: %s = a[i]; s += use(v) + ","; } return s; }' % (E, E),
         'function within(a: (%s)[]): string { let s = ""; for (let i = 0; i < a.length; ++i) { const v: %s = a[i]; s += use(v) + ","; } return s; }' % (E, E),
         'function of(a: (%s)[]): string { let s = ""; for (const v of a) s += use(v) + ","; return s; }' % E,
         'function at(a: (%s)[], i: number): %s { if (depth > 0) { depth--; at(a, i); } return a[i]; }' % (E, E),
         'function tell(name: string, f: () => string): void { let text: string; try { text = f(); } catch (e) { text = (e as Error).name; } console.log(name + ": " + text); }',
         'function all(name: string, a: (%s)[]): void { tell(name + " loop", () => loop(a)); tell(name + " within", () => within(a)); tell(name + " of", () => of(a)); tell(name + " at", () => [0, 1, 2, 3].map(i => use(at(a, i))).join()); }' % E,
         'all("as declared", [%s, %s]);' % (v0, v1), 'all("undefined in it", [%s, undefined, %s] as unknown as (%s)[]);' % (v0, v1, E), 'all("null in it", [%s, null, %s] as unknown as (%s)[]);' % (v0, v1, E),
         'all("a hole in it", [%s, , %s] as unknown as (%s)[]);' % (v0, v1, E), 'all("empty", []);', 'all("new Array(2)", new Array<%s>(2));' % E]
        open('nils_%s_%s.ts' % (k, d), 'w').write('\n'.join(out) + '\n')
print(len(KINDS) * len(DECLS), 'programs')
