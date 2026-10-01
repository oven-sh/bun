#!/usr/bin/env python3
"""The decorator bench on the inputs that both builds transform to the same text: per pass = (3 passes - 1 pass) / 2.
usage: decodiff.py <dir> [suffix]      files <dir>/{base,head}.decoc{1,3}<suffix>.cg (suffix "raw" = --vex-guest-chase=no)
Prints the parser symbols (bun_js_parser|bun_ast) per pass for both builds, their difference, and the symbols that differ."""
import re, sys, collections
d = sys.argv[1]; suf = sys.argv[2] if len(sys.argv) > 2 else ''
rx = re.compile(r'bun_js_parser|bun_ast')
def load(path):
    fn = None; per = collections.defaultdict(lambda: [0, 0, 0])
    with open(path, errors='replace') as f:
        for line in f:
            c = line[0]
            if c == 'f':
                if line.startswith('fn='): fn = re.sub(r' \(\.llvm\.\d+\)', '', line[3:].rstrip('\n'))
                continue
            if not c.isdigit(): continue
            q = line.split(); v = per[fn]; v[0] += int(q[1]); v[1] += int(q[2]); v[2] += int(q[4]) if len(q) > 4 else 0
    return per
pp = {}
for t in ('base', 'head'):
    a = load(f'{d}/{t}.decoc3{suf}.cg'); b = load(f'{d}/{t}.decoc1{suf}.cg')
    pp[t] = {k: [(a[k][i] - b.get(k, [0, 0, 0])[i]) / 2 for i in range(3)] for k in a if rx.search(k)}
tot = {t: [sum(v[i] for v in pp[t].values()) for i in range(3)] for t in pp}
print(f"per pass, parser symbols: base Ir {tot['base'][0]:,.0f} Bc {tot['base'][1]:,.0f} Bi {tot['base'][2]:,.0f} | head Ir {tot['head'][0]:,.0f} Bc {tot['head'][1]:,.0f} Bi {tot['head'][2]:,.0f} | delta Ir {tot['head'][0]-tot['base'][0]:+,.0f} Bc {tot['head'][1]-tot['base'][1]:+,.0f} Bi {tot['head'][2]-tot['base'][2]:+,.0f}")
def sink(n): return 'metadata' if 'DecoratorMetadata' in n else 'discard' if 'Discard' in n else 'other'
for s in ('metadata', 'discard'):
    x = [sum(v[i] for k, v in pp['base'].items() if sink(k) == s) for i in range(3)]; y = [sum(v[i] for k, v in pp['head'].items() if sink(k) == s) for i in range(3)]
    print(f"  symbols named with the {s} sink: base Ir {x[0]:,.0f} Bc {x[1]:,.0f} | head Ir {y[0]:,.0f} Bc {y[1]:,.0f}")
rows = []
for k in set(pp['base']) | set(pp['head']):
    x = pp['base'].get(k, [0, 0, 0]); y = pp['head'].get(k, [0, 0, 0])
    if x != y: rows.append((y[1] - x[1], y[0] - x[0], k))
for dc, di, k in sorted(rows, key=lambda r: -abs(r[0]))[:int(sys.argv[3]) if len(sys.argv) > 3 else 30]:
    print(f"  Bc {dc:>+12,.0f} Ir {di:>+13,.0f}  {k.replace('bun_js_parser::', '').replace('parse::type_sink::', '')[:150]}")
