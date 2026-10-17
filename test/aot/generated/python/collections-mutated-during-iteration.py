#!/usr/bin/env python3
"""collections-mutated-during-iteration.py <seed> [<functions>]: typed Maps and Sets of every kind of key (strings made at run time that equal each other, whole numbers and doubles that equal each other, -0 and 0, NaN, records, null | undefined, mixed) under random sequences of set | add | get | has | delete | clear | size, with ITERATIONS THAT ARE CHANGED WHILE THEY RUN: for-of over entries | keys | values | the table itself and forEach, in whose bodies the current entry is deleted, a later one deleted, one added, a deleted one added again, all cleared; iterators held by hand across changes and asked again after their end; nested iterations over one table; growth to hundreds and deletion down to none, so that the table grows, compacts and is made anew under a running iteration. Everything seen is written down in order. Every line as plain Bun's."""
import random, sys
seed = int(sys.argv[1]); count = int(sys.argv[2]) if len(sys.argv) > 2 else 60
R = random.Random(seed)
print('''declare const console: { log(...values: unknown[]): void };
type Rec = { id: number };
const recs: Rec[] = []; for (let i = 0; i < 12; i++) recs.push({ id: i });
const show = (v: unknown): string => (v === null ? "null" : typeof v === "object" ? "r" + (v as Rec).id : typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "string" ? "'" + v + "'" : String(v));
const text = (i: number): string => (i % 3 === 0 ? "k" + i : i % 3 === 1 ? ("xk" + i).slice(1) : ["k", i].join(""));''')
KEYS = {
 'string': ('string', lambda: 'text(%d)' % R.randrange(14)),
 'number': ('number', lambda: R.choice(['0', '-0', '1', '1.0', '2', '3', '0.5', '-1', 'NaN', '0 / 0', '2147483648', '-2147483649', '1e21', 'Infinity', '7', '8', '9', '4294967296'])),
 'rec': ('Rec', lambda: 'recs[%d]!' % R.randrange(12)),
 'mixed': ('string | number | Rec | null | undefined | boolean', lambda: R.choice(['text(%d)' % R.randrange(6), str(R.randrange(6)), '"%d"' % R.randrange(6), 'recs[%d]!' % R.randrange(5), 'null', 'undefined', 'true', 'false', 'NaN', '-0', '""'])),
 'small': ('number', lambda: str(R.randrange(10))),
}
def change(kind, is_map, cur):
    k = KEYS[kind][1]
    c = R.randrange(9)
    if c == 0 and cur: return 't.delete(%s);' % cur
    if c == 1: return 't.delete(%s);' % k()
    if c in (2, 3): return ('t.set(%s, n++);' if is_map else 't.add(%s);') % k()
    if c == 4 and cur: return ('t.delete(%s); t.set(%s, n++);' if is_map else 't.delete(%s); t.add(%s);') % (cur, cur)
    if c == 5: return 'if (n % 7 === 0) t.clear();'
    if c == 6: return ('if (t.size < 40) for (let g = 0; g < 30; g++) t.set(%s, n++);' if is_map else 'if (t.size < 40) for (let g = 0; g < 30; g++) t.add(%s);') % ({'string': 'text(100 + g)', 'number': '100 + g', 'small': '100 + g', 'rec': 'recs[g % 12]!', 'mixed': '100 + g'}[kind])
    if c == 7: return 'log += t.size + ";";'
    return 'log += t.has(%s) ? "h" : "n";' % k()
for f in range(count):
    kind = R.choice(list(KEYS)); is_map = R.random() < 0.6; K = KEYS[kind][0]; k = KEYS[kind][1]
    T = 'Map<%s, number>' % K if is_map else 'Set<%s>' % K
    b = ['  const t: %s = new %s(); let log = "", n = 1, guard = 0;' % (T, T.split('<')[0] + '<' + T.split('<', 1)[1])]
    for s in range(R.randrange(5, 14)):
        c = R.randrange(16)
        if c < 4: b.append('  ' + (('t.set(%s, n++);' if is_map else 't.add(%s);') % k()))
        elif c == 4: b.append('  log += t.delete(%s) ? "D" : "d";' % k())
        elif c == 5: b.append('  log += %s;' % ('show(t.get(%s))' % k() if is_map else '(t.has(%s) ? "H" : "N")' % k()))
        elif c == 6: b.append('  log += "[" + [...t].map(e => %s).join() + "]";' % ('show(e[0]) + "=" + e[1]' if is_map else 'show(e)'))
        elif c == 7: b.append('  for (const e of t) { if (guard++ > 300) break; log += %s + ","; %s %s }' % ('show(e[0]) + e[1]' if is_map else 'show(e)', change(kind, is_map, 'e[0]' if is_map else 'e'), change(kind, is_map, None)))
        elif c == 8: b.append('  for (const key of t.keys()) { if (guard++ > 300) break; log += show(key) + ","; %s }' % change(kind, is_map, 'key'))
        elif c == 9: b.append('  for (const v of t.values()) { if (guard++ > 300) break; log += show(v) + ","; %s }' % change(kind, is_map, None))
        elif c == 10: b.append('  for (const [p, q] of t.entries()) { if (guard++ > 300) break; log += show(p) + show(q) + ","; %s }' % change(kind, is_map, 'p'))
        elif c == 11: b.append('  t.forEach((v, key) => { if (guard++ > 300) return; log += show(key) + show(v) + ","; %s });' % change(kind, is_map, 'key'))
        elif c == 12: b.append('  { const it = t.%s(); const first = it.next(); %s %s const second = it.next(); %s const rest = [...it].length; const after = it.next(); log += "<" + first.done + second.done + rest + after.done + show(after.value) + ">"; }' % (R.choice(['keys', 'values', 'entries']), change(kind, is_map, None), change(kind, is_map, None), change(kind, is_map, None)))
        elif c == 13: b.append('  for (const p of t.keys()) { if (guard++ > 300) break; for (const q of t.keys()) { if (guard++ > 300) break; log += show(p) + show(q) + ","; %s } }' % change(kind, is_map, 'q'))
        elif c == 14: b.append('  ' + change(kind, is_map, None))
        else: b.append('  log += "(" + t.size + ")";')
    b.append('  return log + "#" + t.size + "[" + [...t.keys()].map(show).join() + "]";')
    print('function f%d(): string {\n%s\n}\nconsole.log("f%d: " + f%d());' % (f, '\n'.join(b), f, f))
