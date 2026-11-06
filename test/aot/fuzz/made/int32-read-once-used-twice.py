#!/usr/bin/env python3
"""int32-read-once-used-twice.py <folder>: ONE CASE A FOLDER: a NEGATIVE whole number out of a field kept in four bytes is read ONCE,
used in arithmetic (the sign extension) AND handed to something that takes the word as it stands in the register: every way in which a word is boxed, stored, compared, used as a key or saved by a stub or a patchpoint.
What comes out is then asked whether it is THE number: ===, Object.is, a Set, includes, indexOf, a switch, JSON, a Map key: a boxed int32 with a dirty high half passes for a number and fails these."""
import os, sys, json
out = sys.argv[1]
HEAD = '''declare const console: { log(...values: unknown[]): void };
class Rec { n: number; m: number; constructor(n: number, m: number) { this.n = n; this.m = m; } }
const values: number[] = [-1, -2, -255, -65536, -1073741824, -2147483647, -2147483648, 2147483647, 1073741824, 0, 1];
function isIt(got: unknown, want: number): string {
  const list: unknown[] = [got]; let inSwitch = "no"; switch (got) { case want: inSwitch = "yes"; }
  return [got === want, Object.is(got, want), new Set<unknown>([got, want]).size, list.includes(want), list.indexOf(want), inSwitch, JSON.stringify(got), new Map<unknown, number>([[want, 1]]).get(got), String(got), typeof got, (got as number) + 0 === want, (got as number) | 0].join();
}
const bag: any = {}; const sink: unknown[] = []; let kept: unknown; const names: Record<string, unknown> = {};
function untyped(v: any): any { return v; }
function pair(a: unknown, b: unknown): unknown[] { return [a, b]; }
function* gen(o: Rec): Generator<unknown, number> { const v = o.n; const a = v + 1; yield v; return a + v; }
async function later(o: Rec): Promise<unknown[]> { const v = o.n; const a = v + 1; await 0; return [v, a]; }
'''
# (name, statements that use v and set `got`)
USES = [
 ("returned as unknown", "got = v;"), ("stored by name", "bag.x = v; got = bag.x;"), ("defined in a literal", "const l: any = { x: v }; got = l.x;"), ("stored by a computed name", 'names["k" + (a & 1)] = v; got = names["k" + (a & 1)];'),
 ("pushed", "sink.length = 0; sink.push(v); got = sink[0];"), ("an element of a literal", "got = [v as unknown][0];"), ("stored to an element", "sink[0] = v; got = sink[0];"), ("a module variable", "kept = v; got = kept;"),
 ("an argument of untyped code", "got = untyped(v);"), ("two arguments", "got = pair(v, a)[0];"), ("a map's key", "const m = new Map<unknown, number>(); m.set(v, 1); got = [...m.keys()][0];"), ("a map's value", "const m = new Map<number, unknown>(); m.set(1, v); got = m.get(1);"),
 ("a typed map's key", "const m = new Map<number, number>(); m.set(v, 1); got = [...m.keys()][0];"), ("a set's member", "const s = new Set<number>(); s.add(v); got = [...s][0];"), ("captured", "const f = (): unknown => v; got = f();"), ("captured and called later", "const f = (): unknown => v; sink[0] = f; got = (sink[0] as () => unknown)();"),
 ("thrown", "try { throw v; } catch (e) { got = e; }"), ("spread", "got = pair(...[v, a] as [unknown, unknown])[0];"), ("a template, parsed back", "got = Number(`${v}`);"), ("a string, parsed back", "got = Number(String(v));"), ("toString, parsed back", "got = Number(v.toString());"),
 ("a conditional", "got = a > 0 ? v : (v as unknown);"), ("nullish", "got = (v as number | undefined) ?? 0;"), ("Math.max with itself", "got = Math.max(v, v);"), ("Math.abs negated back", "got = v < 0 && v !== -2147483648 ? -Math.abs(v) : v;"), ("a typed array", "const t = new Int32Array(1); t[0] = v; got = t[0];"),
 ("a float array", "const t = new Float64Array(1); t[0] = v; got = t[0];"), ("a number array", "const t: number[] = [0.5]; t[0] = v; got = t[0];"), ("another field", "const other = new Rec(0, 0); other.m = v; got = other.m;"), ("a field typed unknown", "const h: { u: unknown } = { u: 0 }; h.u = v; got = h.u;"),
 ("Object.is at once", "got = Object.is(v, o.n) ? v : 'differs';"), ("compared with the other field", "got = v === o.m ? v : 'differs';"), ("a bigint and back", "got = Number(BigInt(v));"), ("JSON and back", "got = JSON.parse(JSON.stringify({ v })).v;"), ("Reflect.apply", "got = Reflect.apply(untyped, null, [v]);"),
 ("bound", "got = untyped.bind(null, v)();"), ("a default parameter", "got = ((x: unknown = v) => x)();"), ("destructured", "const { x } = { x: v as unknown }; got = x;"), ("an optional call", "got = (untyped as ((v: any) => any) | undefined)?.(v);"), ("Array.of", "got = Array.of<unknown>(v)[0];"), ("fill", "got = new Array<unknown>(2).fill(v)[1];"),
 ("Object.assign", "got = Object.assign({}, { x: v }).x;"), ("a getter's result", "got = ({ get x(): unknown { return v; } }).x;"), ("a class field", "got = new (class { x: unknown = v; })().x;"), ("a shift by it", "got = (1 << v) === (1 << (o.m & 31)) ? v : 'differs';"), ("a remainder", "got = (v % 7) === (o.m % 7) ? v : 'differs';"), ("a division", "got = v / 2 === o.m / 2 ? v : 'differs';"),
 ("unsigned", "got = (v >>> 0) === (o.m >>> 0) ? v : 'differs';"), ("as an index", "const t: number[] = [5]; got = t[v] === t[o.m] ? v : 'differs';"), ("charCodeAt", "got = Object.is('abc'.charCodeAt(v), 'abc'.charCodeAt(o.m)) ? v : 'differs';"),
]
os.makedirs(out + "/words_shared", exist_ok=True)
s = HEAD
for i, (name, body) in enumerate(USES):
    s += "function u%d(o: Rec): unknown[] { const v = o.n; const a = v + 1; let got: unknown; %s return [got, a]; }\n" % (i, body)
    s += "function w%d(list: Rec[]): string { let total = 0; let r = ''; for (let i = 0; i < list.length; i++) { const o = list[i]; const v = o.n; const a = v + 1; total += v; let got: unknown; %s r += isIt(got, values[i]) + ';'; } return r + total; }\n" % (i, body)
for i, (name, body) in enumerate(USES):
    s += "function x%d(words: Int32Array, list: Rec[]): string { let total = 0; let r = ''; for (let i = 0; i < words.length; i++) { const o = list[i]; const v = words[i]; const a = v + 1; total += v; let got: unknown; %s r += isIt(got, values[i]) + ';'; } return r + total; }\n" % (i, body)
    s += "function y%d(words: Int32Array, list: Rec[], i: number): unknown[] { const o = list[i]; const v = words[i]; const a = v + 1; let got: unknown; %s return [got, a, v * 4294967296]; }\n" % (i, body)
s += "const recs: Rec[] = [new Rec(-1, -1), new Rec(-2, -2), new Rec(-255, -255), new Rec(-65536, -65536), new Rec(-1073741824, -1073741824), new Rec(-2147483647, -2147483647), new Rec(-2147483648, -2147483648), new Rec(2147483647, 2147483647), new Rec(1073741824, 1073741824), new Rec(0, 0), new Rec(1, 1)];\n"
for i, (name, body) in enumerate(USES):
    s += "console.log(%s, values.map((n, k) => { const [got, a] = u%d(recs[k]); return isIt(got, n) + '/' + a; }).join(' '));\nconsole.log(%s, w%d(recs));\n" % (json.dumps(name), i, json.dumps(name + ', in a loop'), i)
s += "const int32s = Int32Array.from(values);\n"
for i, (name, body) in enumerate(USES):
    s += "console.log(%s, x%d(int32s, recs));\nconsole.log(%s, values.map((n, k) => { const [got, a, b] = y%d(int32s, recs, k); return isIt(got, n) + '/' + a + '/' + b; }).join(' '));\n" % (json.dumps(name + ', out of an Int32Array in a loop'), i, json.dumps(name + ', out of an Int32Array'), i)
s += "console.log('yielded', values.map((n, k) => { const g = gen(recs[k]); return isIt(g.next().value, n) + '/' + g.next().value; }).join(' '));\nconsole.log('across an await', (await Promise.all(recs.map(later))).map(([v, a], k) => isIt(v, values[k]) + '/' + a).join(' '));\n"
open(out + "/words_shared/main.ts", "w").write(s)
print(len(USES), "uses")
