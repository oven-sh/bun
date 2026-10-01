#!/usr/bin/env python3
"""Per-symbol difference of two cachegrind files over EVERY symbol, split into parser and the rest.
usage: cgall.py <a.cg> <b.cg> [--min-bc N] [--rest-top N] [--tsv FILE]
A symbol belongs to the parser when its name has bun_js_parser or bun_ast. The ' (.llvm.<n>)' suffix is cut."""
import re, sys, collections, argparse
ap = argparse.ArgumentParser()
ap.add_argument('a'); ap.add_argument('b'); ap.add_argument('--min-bc', type=int, default=0); ap.add_argument('--rest-top', type=int, default=40); ap.add_argument('--tsv')
o = ap.parse_args()
def load(path):
    events = []; fn = None; per = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    with open(path, errors='replace') as f:
        for line in f:
            c = line[0]
            if c == 'f':
                if line.startswith('fn='): fn = re.sub(r' \(\.llvm\.\d+\)', '', line[3:].rstrip('\n'))
                continue
            if not c.isdigit():
                if line.startswith('events:'): events = line.split()[1:]
                continue
            parts = line.split()
            p = per[fn]
            for i in range(1, min(len(parts), 6)): p[i - 1] += int(parts[i])
    return per
a = load(o.a); b = load(o.b)
rx = re.compile(r'bun_js_parser|bun_ast')
def tot(d, i, pred): return sum(v[i] for k, v in d.items() if pred(k))
for label, pred in (('program', lambda k: True), ('parser ', lambda k: bool(rx.search(k))), ('rest   ', lambda k: not rx.search(k))):
    print(f"{label} Ir {tot(a,0,pred):>14,} -> {tot(b,0,pred):>14,} ({tot(b,0,pred)-tot(a,0,pred):+,})  Bc {tot(a,1,pred):>13,} -> {tot(b,1,pred):>13,} ({tot(b,1,pred)-tot(a,1,pred):+,})  Bi {tot(a,3,pred):>11,} -> {tot(b,3,pred):>11,} ({tot(b,3,pred)-tot(a,3,pred):+,})")
rows = []
for n in set(a) | set(b):
    x = a.get(n, [0] * 5); y = b.get(n, [0] * 5)
    if (x[0], x[1], x[3]) != (y[0], y[1], y[3]):
        rows.append((y[0] - x[0], y[1] - x[1], y[3] - x[3], x[0], x[1], n, n not in a, n not in b))
if o.tsv:
    with open(o.tsv, 'w') as f:
        f.write('dIr\tdBc\tdBi\taIr\taBc\tstate\tparser\tname\n')
        for dI, dC, dB, ai, ac, n, new, gone in sorted(rows, key=lambda r: -abs(r[1])):
            f.write(f"{dI}\t{dC}\t{dB}\t{ai}\t{ac}\t{'NEW' if new else 'GONE' if gone else 'BOTH'}\t{1 if rx.search(n) else 0}\t{n}\n")
pr = [r for r in rows if rx.search(r[5])]; rest = [r for r in rows if not rx.search(r[5])]
print(f"{len(pr)} parser symbols differ, {len(rest)} other symbols differ")
print('-- parser symbols with |dBc| >= %d, by dBc' % o.min_bc)
for dI, dC, dB, ai, ac, n, new, gone in sorted(pr, key=lambda r: -r[1]):
    if abs(dC) < o.min_bc: continue
    print(f"  Bc {dC:+11,}  Ir {dI:+12,}  Bi {dB:+9,}  (a Bc {ac:,}) {'NEW ' if new else ''}{'GONE ' if gone else ''}{n[:170]}")
print('-- other symbols, top by |dBc|')
for dI, dC, dB, ai, ac, n, new, gone in sorted(rest, key=lambda r: -abs(r[1]))[:o.rest_top]:
    print(f"  Bc {dC:+11,}  Ir {dI:+12,}  Bi {dB:+9,}  (a Bc {ac:,}) {'NEW ' if new else ''}{'GONE ' if gone else ''}{n[:170]}")
