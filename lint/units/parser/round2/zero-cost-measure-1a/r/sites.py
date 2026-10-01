#!/usr/bin/env python3
"""Per group: Bc of head lines whose text matches REGEX (all symbols), minus the Bc of base lines with the same (file, fn, text).
usage: sites.py REGEX"""
import sys, re, collections
sys.path.insert(0, '/workspace/notes/lint/units/parser/round2/zero-cost-measure-1a')
from cgline import load, Src
rx = re.compile(sys.argv[1]); frx = re.compile(r'^src/js_parser/')
M = '/workspace/notes/lint/measure/parser/cg'
groups = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
def agg(path, root, keep_line):
    S = Src(root); per = load(path); out = collections.defaultdict(lambda: [0, 0]); lines = {}
    for (fl, fn, line), v in per.items():
        if not fl or not frx.search(fl): continue
        t = S.text(fl, line)
        if not rx.search(t): continue
        k = (fl.split('/')[-1], S.fn(fl, line), t[:95]); out[k][0] += v[0]; out[k][1] += v[1]
        if keep_line: lines.setdefault(k, set()).add(line)
    return out, lines
rows = collections.defaultdict(lambda: [0] * 5); where = {}
for gi, g in enumerate(groups):
    A, _ = agg(f'{M}/base.{g}.cg', '/tmp/zc1a/basetree', False); B, L = agg(f'{M}/head.{g}.cg', '/workspace/wt/parser', True)
    for k in set(A) | set(B):
        rows[k][gi] = B.get(k, [0, 0])[1] - A.get(k, [0, 0])[1]
    where.update(L)
tot = [sum(r[i] for r in rows.values()) for i in range(5)]
print(f'{"":60}' + ''.join(f'{g:>15}' for g in groups))
print(f'{"TOTAL dBc":60}' + ''.join(f'{t:>+15,}' for t in tot))
for k, r in sorted(rows.items(), key=lambda kv: -sum(abs(x) for x in kv[1])):
    if not any(r): continue
    ln = ','.join(str(x) for x in sorted(where.get(k, [])))
    print(f'{(k[0] + ":" + ln + " " + k[1])[:60]:60}' + ''.join(f'{x:>+15,}' for x in r) + '  | ' + k[2][:70])
