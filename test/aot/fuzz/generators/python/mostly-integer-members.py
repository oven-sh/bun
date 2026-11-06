#!/usr/bin/env python3
"""mostly-integer-members.py <seed> [<functions>]: typed classes and records whose number members are whole nearly always and now and then are not; small typed functions read one or two of them and ASK THEM AS NUMBERS in every way that could become an integer operation: truthiness, !, comparisons with constants and with each other, ===, an index into an array, | 0, >>> 0, ~~, Math.abs | floor | trunc | sign | min | max, + - * with constants, %, a sum carried round a loop, a number joined by ?: ?? || && with another, optional members. Each function runs over a grid of values: 0, -0, 1, -1, 2, 7, 2^31 - 1, -2^31, 2^31, 2^32, 2^53, -2^53, 0.5, -0.5, 1e21, NaN, both infinities, and undefined where the member is optional; first 300 times on small whole numbers. -0 is told from 0 in what is printed."""
import random, sys
seed = int(sys.argv[1]); count = int(sys.argv[2]) if len(sys.argv) > 2 else 90
R = random.Random(seed)
import os
no_minus_zero = bool(os.environ.get('NO_MINUS_ZERO'))
HEAD = ('''declare const console: { log(...values: unknown[]): void };
class Node { id: number; flags: number; pos: number; end: number; merge?: number; constructor(id: number, flags: number, pos: number, end: number, merge?: number) { this.id = id; this.flags = flags; this.pos = pos; this.end = end; if (merge !== undefined) this.merge = merge; } }
type Rec = { a: number; b: number; c?: number };
const table: string[] = ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"];
const show = (v: unknown): string => (typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : String(v));
const GRID: number[] = [0, -0, 1, -1, 2, 7, 2147483647, -2147483648, 2147483648, 4294967296, 9007199254740992, -9007199254740992, 0.5, -0.5, 1e21, NaN, Infinity, -Infinity, 3, 1.5];
const nan: number = GRID[15]!;''')
print(HEAD.replace('[0, -0, 1,', '[0, 4, 1,') if no_minus_zero else HEAD)
def num(vs):
    return R.choice(vs)
def const(): return R.choice(['0', '1', '-1', '2', '7', '0.5', '2147483647', '-2147483648', '4294967296', '100', '-0', '1e21', 'nan'])
def expr(vs, d=0):
    x, y = num(vs), num(vs)
    f = R.randrange(34 if d < 2 else 22)
    E = [
     '(%s ? "T" : "F")' % x, '(!%s ? "N" : "Y")' % x, '(%s === %s)' % (x, const()), '(%s !== %s)' % (x, const()), '(%s < %s)' % (x, const()), '(%s >= %s)' % (x, const()), '(%s > %s)' % (x, y), '(%s <= %s)' % (x, y), '(%s === %s)' % (x, y), 'table[%s]' % x,
     '(%s | 0)' % x, '(%s >>> 0)' % x, '(~~%s)' % x, 'Math.abs(%s)' % x, 'Math.floor(%s)' % x, 'Math.trunc(%s)' % x, 'Math.sign(%s)' % x, 'Math.min(%s, %s)' % (x, y), 'Math.max(%s, %s)' % (x, const()), '(%s + %s)' % (x, const()), '(%s - %s)' % (x, y), '(%s * %s)' % (x, const()),
    ]
    if f < 22: return E[f]
    a = '(%s + 1)' % x if R.random() < 0.5 else '(%s - %s)' % (x, y)
    return ['(%s ? "T" : "F")' % a, '(%s === %s)' % (a, const()), 'table[%s]' % a, '(%s | 0)' % a, '(%s < %s)' % (a, const()), '(Math.abs(%s) > 0)' % x, '(%s %% %s)' % (x, R.choice(['2', '7', '-3', '0'])), '(%s == %s)' % (x, const()), '(%s & 255)' % x, '(%s << 1)' % x, '(%s / %s)' % (x, R.choice(['2', '0', '-1'])), '(-%s)' % x][f - 22]
for f in range(count):
    kind = R.randrange(4)
    if kind == 0: sig, vs = 'n: Node', ['n.id', 'n.flags', 'n.pos', 'n.end']
    elif kind == 1: sig, vs = 'n: Node', ['n.id', 'n.pos', '(n.merge ?? %s)' % const(), '(n.merge === undefined ? n.end : n.merge)']
    elif kind == 2: sig, vs = 'r: Rec', ['r.a', 'r.b', '(r.c ?? r.a)', '(r.c || r.b)']
    else: sig, vs = 'n: Node, r: Rec', ['n.id', 'r.a', '(n.flags ? n.pos : r.b)', '(r.a && n.end)']
    lines = []
    names = list(vs)
    for i in range(R.randrange(0, 3)):
        lines.append('const x%d = %s;' % (i, R.choice(['%s ? %s : %s' % (num(names), num(names), const()), '%s + %s' % (num(names), const()), '%s' % num(names), '%s < %s ? %s : %s' % (num(names), const(), num(names), num(names))])))
        names.append('x%d' % i)
    shape = R.randrange(5)
    outs = ' + "," + '.join('show(%s)' % expr(names) for _ in range(R.randrange(2, 5)))
    if shape == 0: body = 'return %s;' % outs
    elif shape == 1: body = 'if (%s) return "then:" + %s; return "else:" + %s;' % (num(names), outs, 'show(%s)' % expr(names))
    elif shape == 2: body = 'let acc = %s; for (let i = 0; i < 3; i++) { acc = acc + %s; if (acc > 1e6) break; } return show(acc) + "," + show(%s) + "," + %s;' % (num(names), R.choice(['1', num(names), '0.5', 'i']), expr(names + ['acc']), outs)
    elif shape == 3: body = 'let s = ""; let y = %s; while (y > 0 && y < 5) { s += table[y]; y = y - 1; } return s + "," + show(y) + "," + %s;' % (num(names), outs)
    else: body = 'const z = %s; const t = table[z]; return (t === undefined ? "none" : t) + "," + show(z ? z | 0 : -1) + "," + %s;' % (num(names), outs)
    print('function f%d(%s): string { %s %s }' % (f, sig, ' '.join(lines), body))
    call = {'n: Node': 'f%d(n)', 'r: Rec': 'f%d(r)', 'n: Node, r: Rec': 'f%d(n, r)'}[sig] % f
    print('function run%d(): string { let warm = 0; for (let i = 0; i < 300; i++) { const n = new Node(i & 7, i & 3, i, i + 1, i & 1 ? i : undefined); const r: Rec = i & 1 ? { a: i & 7, b: 2, c: i } : { a: 1, b: i & 7 }; warm += %s.length; } let digest = 0, first = ""; for (const p of GRID) for (const q of GRID) { const n = new Node(p, q, q, p, Number.isNaN(q) ? undefined : q); const r: Rec = Number.isNaN(p) ? { a: q, b: p } : { a: p, b: q, c: p }; const s = %s; if (first.length < 150) first += s + " "; for (let i = 0; i < s.length; i++) digest = (Math.imul(digest, 31) + s.charCodeAt(i)) | 0; } return warm + " " + digest + " " + first; }' % (f, call, call))
    print('console.log("f%d: " + run%d());' % (f, f))
