#!/usr/bin/env python3
"""checked-reads-after-cold-branch.py <folder>: Every kind of type, every kind of value, and twelve placings of a read whose result is held to its type behind a rare arm: rows.ts.
JSON is declared by the program: of the JSON.parse that the compiler knows, the interface is left ordinary and no read has a quick arm.
A read has a quick arm (the program's own object, by its shape) and a rare arm (a stranger: JSON.parse and Object.assign) only where the text is hot, so every reader is called straight from a loop.
What fits must also come back as the very value that was put in."""
import os, re, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
TYPES = [
 ('s', 'string'), ('os', 'string | undefined'), ('ns', 'string | null'), ('nus', 'string | null | undefined'), ('u', 'string | number'), ('nb', 'number | boolean | undefined'),
 ('ob', 'boolean | undefined'), ('sb', 'string | boolean'), ('sy', 'symbol'), ('bi', 'bigint'), ('sbs', 'string | bigint | symbol'), ('four', 'string | bigint | symbol | number[]'),
 ('five', 'string | bigint | symbol | number[] | Map<string, number>'), ('o', 'object'), ('oo', 'object | null'), ('f', '() => number'), ('of', '(() => number) | undefined'), ('a', 'number[]'), ('oa', 'string[] | undefined'),
 ('k', 'K'), ('k1', 'K1'), ('k2', 'K2'), ('kl', 'K1 | L'), ('klm', 'K1 | L | M'), ('okl', 'K2 | M | undefined'), ('q', 'Q'), ('oq', 'Q | undefined'), ('m', 'Map<string, number>'), ('d', 'Date'), ('r', 'RegExp'), ('e', 'Error'),
 ('p', 'Promise<number>'), ('u8', 'Uint8Array'), ('st', 'Set<number>'), ('fk', '(() => number) | K'), ('ak', 'number[] | K | undefined'), ('ts', 'true | string'), ('lit', '"a" | "b"'), ('md', 'Map<string, number> | Date | null'),
 ('sk', 'string | K1'), ('nk', 'number | K'), ('bk', 'boolean | L | null'),
]
OWN = {'s': '"s"', 'os': 'undefined', 'ns': 'null', 'nus': '"n"', 'u': '2', 'nb': 'true', 'ob': 'undefined', 'sb': '"sb"', 'sy': 'Symbol("own")', 'bi': '5n', 'sbs': '"t"', 'four': '[4]', 'five': 'new Map()', 'o': '{ }', 'oo': 'null', 'f': '() => 1', 'of': 'undefined', 'a': '[1]', 'oa': 'undefined',
 'k': 'new K()', 'k1': 'new K1()', 'k2': 'new K2()', 'kl': 'new L()', 'klm': 'new M()', 'okl': 'undefined', 'q': '{ x: 7 }', 'oq': 'undefined', 'm': 'new Map()', 'd': 'new Date(1)', 'r': '/own/', 'e': 'new Error("own")', 'p': 'Promise.resolve(2)', 'u8': 'new Uint8Array(1)', 'st': 'new Set()',
 'fk': 'new K()', 'ak': '[2]', 'ts': 'true', 'lit': '"a"', 'md': 'null', 'sk': '"sk"', 'nk': '3', 'bk': 'false'}
VALUES = [
 '"OWN"', 'undefined', 'null', 'true', 'false', '0', '1', '-1', '1.5', 'NaN', '-0', '2147483648', '9007199254740992', 'Infinity', '""', '"a"', '"x"', 'rope()', 'Symbol("w")', 'Symbol.iterator', '10n', '2n ** 70n',
 '{}', '{ x: 1 }', '{ x: "no" }', 'Object.create(null)', '[]', '[1]', '["a"]', '[1.5]', 'new Array(3)', 'new Heir()', '() => 1', 'function () { return 1; }', 'class { }', '(function () { return 1; }).bind(null)',
 'async function () { }', 'function* () { }', 'new Proxy({}, {})', 'new Proxy(function () { return 1; }, {})', 'new Proxy([], {})', 'new K()', 'new K1()', 'new K2()', 'new L()', 'new M()', 'new Map()', 'new Set()', 'new Date(0)', '/x/',
 'new Error("e")', 'new TypeError("t")', 'Promise.resolve(1)', 'new Uint8Array(2)', 'new Float64Array(1)', 'new ArrayBuffer(1)', 'new WeakMap()', 'Object(1)', 'Object("s")', 'Object(1n)', 'Object.freeze({ x: 2 })',
 'Object.freeze([1])', 'Object.freeze(new K1())', 'Math', 'JSON', 'args()',
]
PLACINGS = list(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] != '-' else list('ABCDEFGHIJKL')
if len(sys.argv) > 3 and sys.argv[3] != "-": TYPES = [x for x in TYPES if x[0] in sys.argv[3].split(',')]
out = []
counter = [0]
COLD = len(sys.argv) > 4 and sys.argv[4] == 'cold'
w = out.append
w('''export { };
declare const console: { log(...values: any[]): void };
declare const JSON: { parse(text: string): any };
interface Q { x: number }
class K { k = 1; m(): number { return this.k; } }
class K1 extends K { k1 = 2; }
class K2 extends K { k2 = "two"; }
class L { l = 3; }
class M { m1 = 4; m2 = 5; }
class Heir extends Array<number> { }
let turn = 0, fin = 0;
function rope(): string { turn++; return "ab" + String(turn % 2) + "cdefghijklmnop" + String(turn % 3); }
function args(): any { return (function (this: any) { return arguments; } as any)(1, 2); }
function show(v: unknown): string {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "function") return "function";
    if (t === "symbol") return "symbol " + String((v as symbol).description);
    if (t === "bigint") return "bigint " + String(v);
    if (t === "number") return "number " + (Object.is(v, -0) ? "-0" : String(v));
    if (t === "object") return "object " + Object.prototype.toString.call(v);
    return t + " " + String(v);
}
function said(e: unknown): string { return "THROWS " + String((e as any).message).split(" (bun")[0] + STACK; }
function same(put: any, got: unknown): string { return got === put || (got !== got && put !== put) ? (Object.is(got, put) ? "" : " SIGN") : " NOT THE VALUE PUT IN"; }
function isCaught(v: unknown): boolean { return typeof v === "string" && v.startsWith("caught"); }
const base = '{"zero":0}';
const lines: string[] = [];
const k0 = new K(), l0 = new L();
const keep: unknown[] = [];''')
w('const values: [string, () => any][] = [')
for v in VALUES:
    w('    [`%s`, () => (%s)],' % (v.replace('"OWN"', 'OWN'), v))
w('];')
for n, t in TYPES:
    T = '(' + t + ')'
    d = dict(n=n, T=T, t=t, own=OWN[n])
    def e(text): w(text % d)
    e('interface P_%(n)s { pad: number; %(n)s: %(t)s; g_%(n)s: () => %(T)s; }')
    e('const own_%(n)s: P_%(n)s = { pad: 1, %(n)s: %(own)s, g_%(n)s: () => own_%(n)s.%(n)s };')
    e('function stranger_%(n)s(value: any): P_%(n)s { const more: any = { }; more["%(n)s"] = value; more["g_%(n)s"] = () => value; return Object.assign(JSON.parse(base), more) as P_%(n)s; }')
    if 'A' in PLACINGS: e('function A_%(n)s(p: P_%(n)s): %(T)s { return p.%(n)s; }')
    if 'B' in PLACINGS: e('function B_%(n)s(p: P_%(n)s, times: number): %(T)s { let last: %(T)s = p.%(n)s; let count = 0; for (let i = 0; i < times; i++) { last = p.%(n)s; count += i; } if (count !== 3) throw new Error("bad count"); return last; }')
    if 'C' in PLACINGS: e('function C_%(n)s(p: P_%(n)s): %(T)s | string { let step = 1; try { step = 2; const v: %(T)s = p.%(n)s; step = 3; return v; } catch (e) { return "caught at " + step + ": " + said(e); } finally { fin++; } }')
    if 'D' in PLACINGS: e('function D_%(n)s(p: P_%(n)s, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, x: number, y: number, z: number, s1: string, s2: string, o1: K, o2: L): [%(T)s, string] { const ab = a * 3 + b; const cd = c * 5 + d; const ef = e * 7 + f; const gh = g * 11 + h; const xy = x * 1.5 + y; const yz = y * 2.5 + z; const ss = s1 + s2; const v: %(T)s = p.%(n)s; return [v, ab + "," + cd + "," + ef + "," + gh + "," + xy + "," + yz + "," + ss + "," + a + b + c + d + e + f + g + h + "," + x + "," + y + "," + z + "," + s1 + s2 + "," + o1.k + "," + o2.l]; }')
    if 'E' in PLACINGS: e('class E_%(n)s { one = 1; two = 2.5; three = "three"; constructor(public p: P_%(n)s) { } read(): [%(T)s, string] { const v: %(T)s = this.p.%(n)s; return [v, this.one + "," + this.two + "," + this.three]; } }')
    if 'F' in PLACINGS: e('async function F_%(n)s(p: P_%(n)s, before: number): Promise<[%(T)s, number]> { const n = await Promise.resolve(before + 1); const v: %(T)s = p.%(n)s; const m = await Promise.resolve(n + 1); return [v, m]; }')
    if 'G' in PLACINGS: e('function* G_%(n)s(p: P_%(n)s): Generator<%(T)s | number | string, void, void> { yield 1; const v: %(T)s = p.%(n)s; yield v; const again: %(T)s = p.%(n)s; yield again === v || (again !== again && v !== v) ? "same" : "NOT THE SAME"; }')
    if 'H' in PLACINGS: e('function H_%(n)s(p: P_%(n)s, r: P_%(n)s): [%(T)s, %(T)s] { const v: %(T)s = p.%(n)s; const u: %(T)s = r.%(n)s; return [v, u]; }')
    if 'I' in PLACINGS: e('function I_%(n)s(p: P_%(n)s): %(T)s { const { %(n)s: v } = p; return v; }')
    if 'J' in PLACINGS: e('function J_%(n)s(p: P_%(n)s): %(T)s { return p.g_%(n)s(); }')
    if 'K' in PLACINGS: e('function K_%(n)s(a: %(T)s[], i: number): %(T)s { return a[i]; }')
    if 'L' in PLACINGS: e('function L_%(n)s(a: %(T)s[], i: number, x: number, y: number): [%(T)s, number] { const xy = x * 1.5 + y; const v: %(T)s = a[i]; return [v, xy + x + y + i]; }')
    e('const ownArray_%(n)s: %(T)s[] = [%(own)s];')
    e('function sparse_%(n)s(value: any): %(T)s[] { const a: any = JSON.parse("[]"); a[70000] = value; return a as %(T)s[]; }')
    at = {}
    for c in PLACINGS:
        if c != 'E':
            at[c] = counter[0]; counter[0] += 1
            if not COLD: e('keep.push(' + c + '_%(n)s);')
    e('async function run_%(n)s(): Promise<void> {')
    e('    for (let i = 0; i < values.length; i++) {')
    e('        const isOwn = i === 0; const put: any = isOwn ? own_%(n)s.%(n)s : values[i][1](); const p: P_%(n)s = isOwn ? own_%(n)s : stranger_%(n)s(put); const label = " %(n)s <- " + values[i][0] + ": "; let t: string;')
    def one(c, call): e('        try { const got = ' + call + '; t = show(got) + (isCaught(got) ? "" : same(put, got)); } catch (e) { t = said(e); } lines.push("' + c + '" + label + t);')
    def two(c, call): e('        try { const got = ' + call + '; t = show(got[0]) + same(put, got[0]) + " | " + (typeof got[1] === "string" || typeof got[1] === "number" ? String(got[1]) : show(got[1]) + same(put, got[1])); } catch (e) { t = said(e); } lines.push("' + c + '" + label + t);')
    if 'A' in PLACINGS: one('A', 'A_%(n)s(p)')
    if 'B' in PLACINGS: one('B', 'B_%(n)s(p, 3)')
    if 'C' in PLACINGS: one('C', 'C_%(n)s(p)')
    if 'D' in PLACINGS: two('D', 'D_%(n)s(p, 1, 2, 3, 4, 5, 6, 7, 8, 0.5, 1.25, 2.75, "l", "r", k0, l0)')
    if 'E' in PLACINGS: two('E', 'new E_%(n)s(p).read()')
    if 'F' in PLACINGS: two('F', 'await F_%(n)s(p, 40)')
    if 'G' in PLACINGS: e('        t = ""; try { for (const got of G_%(n)s(p)) t += show(got) + ";"; } catch (e) { t += said(e); } lines.push("G" + label + t);')
    if 'H' in PLACINGS: two('H', 'H_%(n)s(p, p)')
    if 'I' in PLACINGS: one('I', 'I_%(n)s(p)')
    if 'J' in PLACINGS: one('J', 'J_%(n)s(p)')
    if 'K' in PLACINGS or 'L' in PLACINGS: e('        const arr: %(T)s[] = isOwn ? ownArray_%(n)s : sparse_%(n)s(put); const index = isOwn ? 0 : 70000; const putK: any = isOwn ? ownArray_%(n)s[0] : put;')
    if 'K' in PLACINGS: e('        try { const got = K_%(n)s(arr, index); t = show(got) + same(putK, got); } catch (e) { t = said(e); } lines.push("K" + label + t);')
    if 'L' in PLACINGS: e('        try { const got = L_%(n)s(arr, index, 0.5, 2.25); t = show(got[0]) + same(putK, got[0]) + " | " + got[1]; } catch (e) { t = said(e); } lines.push("L" + label + t);')
    ARGS = {'A': 'p', 'B': 'p, 3', 'C': 'p', 'D': 'p, 1, 2, 3, 4, 5, 6, 7, 8, 0.5, 1.25, 2.75, "l", "r", k0, l0', 'H': 'p, p', 'I': 'p', 'J': 'p', 'K': 'arr, index', 'L': 'arr, index, 0.5, 2.25'}
    for c in ([] if COLD else PLACINGS):
        if c in 'ABCIJ': one(c.lower(), '(keep[%d] as any)(%s) as unknown' % (at[c], ARGS[c]))
        if c in 'DH': two(c.lower(), '(keep[%d] as any)(%s) as [unknown, unknown]' % (at[c], ARGS[c]))
        if c == 'K': e('        try { const got = (keep[%d] as any)(arr, index) as unknown; t = show(got) + same(putK, got); } catch (e) { t = said(e); } lines.push("k" + label + t);' % at[c])
        if c == 'L': e('        try { const got = (keep[%d] as any)(arr, index, 0.5, 2.25) as [unknown, number]; t = show(got[0]) + same(putK, got[0]) + " | " + got[1]; } catch (e) { t = said(e); } lines.push("l" + label + t);' % at[c])
    e('    }')
    e('}')
w('async function main(): Promise<void> {')
for n, t in TYPES:
    w('    try { if (lines.length >= 0) throw new Error("to the cold side"); } catch { await run_%s(); }' % n if COLD else '    await run_%s();' % n)
w('    lines.push("finally ran " + fin + ", kept " + keep.length);')
w('    console.log(lines.join("\\n"));')
w('}')
w('main();')
if len(sys.argv) > 4 and sys.argv[4] == 'table': out = [l for l in out if not re.search(r'lines\.push\("[A-L]" \+ label', l)]
text = '\n'.join(out) + '\n'
text = text.replace(' + STACK;', ' + " @ " + String((e as any).stack).split("\\n").slice(0, 4).join(" < ") + " line " + (e as any).line + ":" + (e as any).column;' if len(sys.argv) > 4 and sys.argv[4] == 'stack' else ';')
open('rows.ts', 'w').write(text)
print('%d types x %d values x %d placings = %d rows' % (len(TYPES), len(VALUES), len(PLACINGS), len(TYPES) * len(VALUES) * len(PLACINGS)))
